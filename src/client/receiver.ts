import { BinaryStream } from "@serenityjs/binarystream";
import {
	Ack,
	Bitflags,
	Frame,
	FrameSet,
	Nack,
	Packet,
} from "@serenityjs/raknet";
import type { Socket } from "node:dgram";
import type { Client } from "./client";
import {
	ConnectionRequestAccepted,
	OpenConnectionFirstReply,
	OpenConnectionSecondReply,
	UnconnectedPong,
} from "./packets";
import { Sender } from "./sender";

class Receiver {
	private readonly client: Client;
	private readonly socket: Socket;
	private lastInputSequence = -1;
	private receivedFrameSequences = new Set<number>();
	private lostFrameSequences = new Set<number>();
	private inputHighestSequenceIndex = new Array(64).fill(0);
	private inputOrderIndex = new Array(64).fill(0);
	protected inputOrderingQueue = new Map<number, Map<number, Frame>>();
	protected readonly fragmentsQueue = new Map<number, Map<number, Frame>>();

	constructor(client: Client, socket: Socket) {
		this.client = client;
		this.socket = socket;
		this.socket.on("message", (packet) => this.handle(packet));
		this.client.on("tick", () => this.tick());
		for (let index = 0; index < 64; index++) {
			this.inputOrderingQueue.set(index, new Map());
		}
	}

	private tick(): void {
		this.handleAckSequences();
		this.handleNackSequences();
	}

	public handle(packet: Buffer): void {
		const packetType = packet[0];
		if (packetType !== Packet.UnconnectedPong && this.client.tick <= 0) return;

		switch (packetType) {
			case Packet.UnconnectedPong:
				this.handleUnconnectedPong(packet);
				break;
			case Packet.OpenConnectionReply1:
				this.handleOpenConnectionReply1(packet);
				break;
			case Packet.OpenConnectionReply2:
				this.handleOpenConnectionReply2(packet);
				break;
			case Bitflags.Valid:
				this.handleValidPacket(packet);
				break;
			case Packet.Ack: {
				this.client.emit("ack", new Ack(packet).deserialize());
				break;
			}
			default:
				if (this.client.options.debug)
					console.debug(`Received unknown packet: ${packetType}`);
				break;
		}
	}

	private handleFrameSet(buffer: Buffer): void {
		const frameSet = new FrameSet(buffer).deserialize();

		if (this.receivedFrameSequences.has(frameSet.sequence)) {
			if (this.client.options.debug)
				console.debug(`Received duplicate frameset ${frameSet.sequence}`);
			return;
		}

		this.lostFrameSequences.delete(frameSet.sequence);

		if (frameSet.sequence <= this.lastInputSequence) {
			if (this.client.options.debug)
				console.debug(`Received out of order frameset ${frameSet.sequence}!`);
			return;
		}

		this.receivedFrameSequences.add(frameSet.sequence);
		this.handleSequenceGap(frameSet.sequence);
		this.lastInputSequence = frameSet.sequence;

		for (const frame of frameSet.frames) {
			this.handleFrame(frame);
		}
	}

	private handleFrame(frame: Frame): void {
		if (this.client.options.debug) {
			console.debug(
				`Handling frame: reliability=${frame.reliability}, orderIndex=${frame.orderIndex}, sequenceIndex=${frame.sequenceIndex}`,
			);
		}

		if (frame.isSplit()) {
			this.handleFragment(frame);
		} else if (frame.isSequenced()) {
			this.handleSequenced(frame);
		} else if (frame.isOrdered()) {
			this.handleOrdered(frame);
		} else {
			this.processFrame(frame);
		}
	}

	private handleOrdered(frame: Frame): void {
		if (this.client.options.debug) {
			console.debug(
				`Handling ordered frame: orderIndex=${frame.orderIndex}, channel=${frame.orderChannel}`,
			);
		}

		const expectedOrderIndex = this.inputOrderIndex[frame.orderChannel];
		const orderingQueue =
			this.inputOrderingQueue.get(frame.orderChannel) ||
			new Map<number, Frame>();

		if (frame.orderIndex === expectedOrderIndex) {
			this.processOrderedFrames(frame, orderingQueue);
		} else if (frame.orderIndex > expectedOrderIndex) {
			if (this.client.options.debug)
				console.debug(`Queuing out-of-order frame: ${frame.orderIndex}`);
			orderingQueue.set(frame.orderIndex, frame);
		} else {
			if (this.client.options.debug)
				console.debug(`Discarding old frame: ${frame.orderIndex}`);
		}
	}

	private processOrderedFrames(
		frame: Frame,
		orderingQueue: Map<number, Frame>,
	): void {
		this.processFrame(frame);
		this.inputOrderIndex[frame.orderChannel]++;

		let nextOrderIndex = this.inputOrderIndex[frame.orderChannel];
		while (orderingQueue.has(nextOrderIndex)) {
			const nextFrame = orderingQueue.get(nextOrderIndex);
			if (nextFrame) {
				if (this.client.options.debug)
					console.debug(`Processing queued frame: ${nextOrderIndex}`);
				this.processFrame(nextFrame);
				orderingQueue.delete(nextOrderIndex);
				this.inputOrderIndex[frame.orderChannel]++;
				nextOrderIndex++;
			}
		}
	}

	private handleSequenced(frame: Frame): void {
		const currentHighestSequence =
			this.inputHighestSequenceIndex[frame.orderChannel];
		if (this.client.options.debug) {
			console.debug(
				`Handling sequenced frame: sequenceIndex=${frame.sequenceIndex}, currentHighest=${currentHighestSequence}`,
			);
		}

		if (frame.sequenceIndex > currentHighestSequence) {
			this.inputHighestSequenceIndex[frame.orderChannel] = frame.sequenceIndex;
			this.processFrame(frame);
		} else {
			if (this.client.options.debug)
				console.debug(`Discarding old sequenced frame: ${frame.sequenceIndex}`);
		}
	}

	private handleFragment(frame: Frame): void {
		if (this.client.options.debug) {
			console.debug(
				`Handling fragment: splitId=${frame.splitId}, splitIndex=${frame.splitIndex}, splitSize=${frame.splitSize}`,
			);
		}

		const fragment =
			this.fragmentsQueue.get(frame.splitId) || new Map<number, Frame>();
		this.fragmentsQueue.set(frame.splitId, fragment);

		fragment.set(frame.splitIndex, frame);

		if (fragment.size === frame.splitSize) {
			if (this.client.options.debug)
				console.debug(
					`Reassembling complete frame from fragments: splitId=${frame.splitId}`,
				);
			this.reassembleAndProcessFragment(frame, fragment);
		}
	}

	private reassembleAndProcessFragment(
		frame: Frame,
		fragment: Map<number, Frame>,
	): void {
		const stream = new BinaryStream();
		for (let index = 0; index < fragment.size; index++) {
			const sframe = fragment.get(index);
			if (sframe) {
				stream.writeBuffer(sframe.payload);
			} else {
				console.error(
					`Missing fragment at index ${index} for splitId=${frame.splitId}`,
				);
				return;
			}
		}

		const reassembledFrame = this.createReassembledFrame(
			frame,
			stream.getBuffer(),
		);
		this.fragmentsQueue.delete(frame.splitId);
		this.handleFrame(reassembledFrame);
	}

	private processFrame(frame: Frame): void {
		const header = frame.payload[0] as number;

		switch (header) {
			case Packet.ConnectionRequestAccepted: {
				this.handleConnectionRequestAccepted(frame);
				break;
			}
			case Packet.Disconnect: {
				this.client.close();
				break;
			}
			case 254: {
				this.client.emit("encapsulated", frame);
				break;
			}
			default: {
				if (this.client.options.debug)
					console.debug(`Received unknown packet in processFrame: ${header}`);
				break;
			}
		}
	}

	private handleAckSequences(): void {
		if (this.receivedFrameSequences.size > 0) {
			const ack = new Ack();
			ack.sequences = [...this.receivedFrameSequences];
			this.receivedFrameSequences.clear();
			this.client.send(ack.serialize());
		}
	}

	private handleNackSequences(): void {
		if (this.lostFrameSequences.size > 0) {
			const nack = new Nack();
			nack.sequences = [...this.lostFrameSequences];
			this.lostFrameSequences.clear();
			this.client.send(nack.serialize());
		}
	}

	private handleUnconnectedPong(packet: Buffer): void {
		const pong = new UnconnectedPong(packet);
		this.client.emit("unconnected-pong", pong.deserialize());
	}

	private handleOpenConnectionReply1(packet: Buffer): void {
		const reply = new OpenConnectionFirstReply(packet);
		const deserialized = reply.deserialize();
		this.client.emit("open-connection-first-reply", deserialized);
		Sender.secondRequest(this.client, deserialized);
	}

	private handleOpenConnectionReply2(packet: Buffer): void {
		const reply = new OpenConnectionSecondReply(packet);
		const deserialized = reply.deserialize();
		this.client.emit("open-connection-second-reply", deserialized);
		this.client.sender.connectionRequest();
	}

	private handleValidPacket(packet: Buffer): void {
		const frameSet = new FrameSet(packet);
		const deserialized = frameSet.deserialize();
		this.client.emit("frameset", deserialized);
		this.handleFrameSet(packet);
	}

	private handleSequenceGap(currentSequence: number): void {
		const diff = currentSequence - this.lastInputSequence;
		if (diff !== 1) {
			for (
				let index = this.lastInputSequence + 1;
				index < currentSequence;
				index++
			) {
				if (!this.receivedFrameSequences.has(index)) {
					this.lostFrameSequences.add(index);
				}
			}
		}
	}

	private createReassembledFrame(originalFrame: Frame, payload: Buffer): Frame {
		const reassembledFrame = new Frame();
		reassembledFrame.reliability = originalFrame.reliability;
		reassembledFrame.reliableIndex = originalFrame.reliableIndex;
		reassembledFrame.sequenceIndex = originalFrame.sequenceIndex;
		reassembledFrame.orderIndex = originalFrame.orderIndex;
		reassembledFrame.orderChannel = originalFrame.orderChannel;
		reassembledFrame.payload = payload;
		return reassembledFrame;
	}

	private handleConnectionRequestAccepted(frame: Frame): void {
		const packet = new ConnectionRequestAccepted(frame.payload);
		const deserialized = packet.deserialize();
		this.client.sender.newIncommingConnection(frame.payload, deserialized);
	}
}

export { Receiver };
