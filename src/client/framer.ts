import {
	Ack,
	ConnectedPing,
	ConnectedPong,
	Frame,
	NewIncomingConnection,
	Packet,
	Priority,
	Reliability,
	SystemAddress,
	Nack,
	Status,
	OpenConnectionReplyOne,
	ConnectionRequest,
	UnconnectedPong,
	Address,
	OpenConnectionRequestTwo,
	OpenConnectionReplyTwo,
} from "../proto";
import { Frameset } from "../proto";
import { Logger } from "../utils";
import type { Client } from "./client";
import { BinaryStream } from "@serenityjs/binarystream";
import { ConnectionRequestAccepted } from "../proto/packets/connection-request-accepted";
import type { RemoteInfo } from "node:dgram";

export class Framer {
	private client: Client;

	private lastInputSequence = -1;
	private receivedFrameSequences: Set<number> = new Set();
	private lostFrameSequences: Set<number> = new Set();
	private inputHighestSequenceIndex: number[] = new Array(64).fill(0);
	private inputOrderIndex: number[] = new Array(64).fill(0);
	protected inputOrderingQueue: Map<number, Map<number, Frame>> = new Map();
	protected readonly fragmentsQueue: Map<number, Map<number, Frame>> =
		new Map();

	public outputOrderIndex: number[];
	public outputSequenceIndex: number[];
	public outputFrameQueue: Frameset;
	protected outputSequence = 0;
	protected outputSplitIndex = 0;
	protected outputReliableIndex = 0;
	protected outputFrames = new Set<Frame>();
	public outputBackup = new Map<number, Frame[]>();

	constructor(client: Client) {
		this.client = client;
		this.outputFrameQueue = new Frameset();
		this.outputFrameQueue.frames = [];
		this.outputOrderIndex = Array.from<number>({ length: 32 }).fill(0);
		this.outputSequenceIndex = Array.from<number>({ length: 32 }).fill(0);

		for (let index = 0; index < 64; index++) {
			this.inputOrderingQueue.set(index, new Map());
		}
	}

	public tick() {
		if (
			this.client.status === Status.Disconnected ||
			this.client.status === Status.Disconnecting
		)
			return;
		if (this.receivedFrameSequences.size > 0) {
			const ack = new Ack();
			ack.sequences = Array.from(this.receivedFrameSequences).map((seq) => {
				this.receivedFrameSequences.delete(seq);
				return seq;
			});
			this.client.send(ack.serialize());
		}
		if (this.lostFrameSequences.size > 0) {
			const pk = new Nack();
			pk.sequences = Array.from(this.lostFrameSequences).map((seq) => {
				this.lostFrameSequences.delete(seq);
				return seq;
			});
			this.client.send(pk.serialize());
		}

		this.sendQueue(this.outputFrames.size);
	}

	public incommingMessage(payload: Buffer, rinfo: RemoteInfo) {
		let header = payload.readUint8();
		if ((header & 0xf0) === 0x80) header = 0x80;
		if (this.client.options.debug)
			Logger.debug(
				`Received packet ${header} from ${rinfo.address}:${rinfo.port}`,
			);

		switch (header) {
			case Packet.Ack: {
				const ack = new Ack(payload).deserialize();
				for (const seq of ack.sequences) {
					this.outputBackup.delete(seq);
				}
				break;
			}
			case Packet.Nack: {
				const nack = new Nack(payload).deserialize();
				for (const seq of nack.sequences) {
					const lostFrames = this.outputBackup.get(seq) ?? [];
					for (const lostFrame of lostFrames) {
						this.sendFrame(lostFrame, Priority.Immediate);
					}
					// this.outputBackup.delete(seq);
				}
				break;
			}
			case Packet.UnconnectedPong: {
				const packet = new UnconnectedPong(payload).deserialize();
				this.client.emit("unconnected-pong", packet);
				break;
			}
			case Packet.OpenConnectionReplyOne: {
				const packet = new OpenConnectionReplyOne(payload).deserialize();
				this.client.emit("open-connection-reply-one", packet);
				this.client.serverAddress = new Address(
					rinfo.address,
					rinfo.port,
					rinfo.family === "IPv4" ? 4 : 6,
				);
				const request = new OpenConnectionRequestTwo();
				request.mtu = packet.mtu;
				request.address = this.client.serverAddress;
				request.clientGuid = this.client.options.clientId;
				this.client.emit("open-connection-request-two", request);
				this.client.send(request.serialize());
				break;
			}
			case Packet.OpenConnectionReplyTwo: {
				const packet = new OpenConnectionReplyTwo(payload).deserialize();
				this.client.emit("open-connection-reply-two", packet);
				this.client.options.mtuSize = packet.mtu;
				const conReq = new ConnectionRequest();
				conReq.clientGuid = this.client.options.clientId;
				conReq.timestamp = BigInt(Date.now());
				conReq.useSecurity = false;

				this.client.emit("connection-request", conReq);
				this.client.framer.frameAndSend(conReq.serialize(), Priority.Immediate);
				break;
			}
			case Packet.FrameSet: {
				const frameset = new Frameset(payload).deserialize();
				this.client.emit("frameset", frameset);
				this.client.framer.handle(frameset);
				break;
			}
		}
	}

	private processFrame(frame: Frame): void {
		const header = frame.payload[0] as number;
		if (this.client.options.debug)
			Logger.debug(`Received FrameSet Packet ${header}`);

		if (this.client.status === Status.Connecting) {
			switch (header) {
				case Packet.ConnectionRequest: {
					const packet = new ConnectionRequest(frame.payload).deserialize();
					this.client.emit("connection-request", packet);
					break;
				}
				case Packet.ConnectionRequestAccepted: {
					const packet = new ConnectionRequestAccepted(
						frame.payload,
					).deserialize();
					const newI = new NewIncomingConnection();
					SystemAddress.count = 20;
					newI.serverAddress = this.client.serverAddress;
					newI.incomingTimestamp = BigInt(Date.now());
					newI.serverTimestamp = packet.timestamp;
					this.client.emit("new-incoming-connection", newI);
					this.frameAndSend(newI.serialize(), Priority.Immediate);
					SystemAddress.count = 0;
					break;
				}
			}
		}

		if (this.client.status === Status.Connected) {
			switch (header) {
				case Packet.ConnectedPing: {
					const packet = new ConnectedPing(frame.payload).deserialize();
					this.client.emit("connected-ping", packet);
					const pong = new ConnectedPong();
					pong.pongTime = BigInt(Date.now());
					pong.pingTime = packet.timestamp;
					this.frameAndSend(pong.serialize(), Priority.Immediate);
					break;
				}
				case 0xfe: {
					this.client.emit("encapsulated", frame.payload);
					break;
				}
			}
		}
	}

	public handle(frameSet: Frameset) {
		try {
			if (this.receivedFrameSequences.has(frameSet.sequence)) {
				if (this.client.options.debug)
					Logger.debug(`Received duplicate frameset ${frameSet.sequence}`);
				return;
			}
			this.lostFrameSequences.delete(frameSet.sequence);

			if (
				frameSet.sequence < this.lastInputSequence ||
				frameSet.sequence === this.lastInputSequence
			) {
				if (this.client.options.debug)
					Logger.debug(`Received out of order frameset ${frameSet.sequence}!`);
				return;
			}

			this.receivedFrameSequences.add(frameSet.sequence);
			const diff = frameSet.sequence - this.lastInputSequence;

			if (diff > 1) {
				for (
					let index = this.lastInputSequence + 1;
					index < frameSet.sequence;
					index++
				) {
					this.lostFrameSequences.add(index);
				}
			}

			this.lastInputSequence = frameSet.sequence;

			for (const frame of frameSet.frames) {
				try {
					this.handleFrame(frame);
				} catch (err) {
					Logger.error("Error handling frame", err as Error);
				}
			}
		} catch (err) {
			Logger.error("Error handling frameset", err as Error);
		}
	}

	private handleFrame(frame: Frame): void {
		if (frame.isSplit) {
			this.handleSplit(frame);
		} else if (frame.isSequenced) {
			this.handleSequenced(frame);
		} else if (frame.isOrdered) {
			this.handleOrdered(frame);
		} else {
			this.processFrame(frame);
		}
	}

	private handleOrdered(frame: Frame): void {
		const expectedOrderIndex = this.inputOrderIndex[frame.orderChannel];

		if (frame.orderedFrameIndex === expectedOrderIndex) {
			this.processOrderedFrames(frame);
		} else if (frame.orderedFrameIndex > expectedOrderIndex) {
			if (this.client.options.debug)
				Logger.debug(`Queuing out-of-order frame: ${frame.orderedFrameIndex}`);
			const unorderedQueue = this.inputOrderingQueue.get(
				frame.orderChannel,
			) as Map<number, Frame>;
			if (!unorderedQueue) return;
			unorderedQueue.set(frame.orderedFrameIndex, frame);
		} else {
			if (this.client.options.debug)
				Logger.debug(`Discarding old frame: ${frame.orderedFrameIndex}`);
		}
	}

	private processOrderedFrames(frame: Frame): void {
		this.inputOrderIndex[frame.orderChannel] = frame.orderedFrameIndex + 1;
		this.inputHighestSequenceIndex[frame.orderChannel] = 0;
		this.processFrame(frame);

		const outOfOrderQueue = this.inputOrderingQueue.get(
			frame.orderChannel,
		) as Map<number, Frame>;
		let nextOrderIndex = this.inputOrderIndex[frame.orderChannel];

		for (; outOfOrderQueue.has(nextOrderIndex); nextOrderIndex++) {
			const nextFrame = outOfOrderQueue.get(nextOrderIndex);
			if (nextFrame) {
				this.processFrame(nextFrame);
				outOfOrderQueue.delete(nextOrderIndex);
			}
		}

		this.inputOrderingQueue.set(frame.orderChannel, outOfOrderQueue);
		this.inputOrderIndex[frame.orderChannel] = nextOrderIndex;
	}

	private handleSequenced(frame: Frame): void {
		const currentHighestSequence =
			this.inputHighestSequenceIndex[frame.orderChannel];
		if (this.client.options.debug)
			Logger.debug(
				`Handling sequenced frame: sequenceFrameIndex=${frame.sequenceFrameIndex}, currentHighest=${currentHighestSequence}`,
			);

		if (
			frame.sequenceFrameIndex < currentHighestSequence ||
			frame.orderedFrameIndex === this.inputOrderIndex[frame.orderChannel]
		) {
			if (this.client.options.debug)
				Logger.debug(
					`Discarding old sequenced frame: ${frame.sequenceFrameIndex}`,
				);
			return;
		}

		this.inputHighestSequenceIndex[frame.orderChannel] =
			frame.sequenceFrameIndex + 1;
		this.processFrame(frame);
	}

	private handleSplit(frame: Frame): void {
		if (!this.fragmentsQueue.has(frame.splitId)) {
			this.fragmentsQueue.set(
				frame.splitId,
				new Map([[frame.splitFrameIndex, frame]]),
			);
			return;
		}

		const fragment = this.fragmentsQueue.get(frame.splitId);
		if (!fragment) return;

		fragment.set(frame.splitFrameIndex, frame);

		if (fragment.size === frame.splitCount) {
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
				Logger.error(
					`Missing fragment at index ${index} for splitId=${frame.splitId}`,
				);
				return;
			}
		}

		const reassembledFrame = new Frame();
		reassembledFrame.reliability = frame.reliability;
		reassembledFrame.reliableFrameIndex = frame.reliableFrameIndex;
		reassembledFrame.sequenceFrameIndex = frame.sequenceFrameIndex;
		reassembledFrame.orderedFrameIndex = frame.orderedFrameIndex;
		reassembledFrame.orderChannel = frame.orderChannel;
		reassembledFrame.payload = stream.getBuffer();

		this.fragmentsQueue.delete(frame.splitId);
		this.handleFrame(reassembledFrame);
	}

	public frameAndSend(
		payload: Buffer,
		priority: Priority = Priority.Normal,
	): void {
		const frame = new Frame();
		frame.reliability = Reliability.ReliableOrdered;
		frame.orderChannel = 0;
		frame.payload = payload;
		this.sendFrame(frame, priority);
	}

	public sendFrame(frame: Frame, priority: Priority): void {
		if (frame.isSequenced) {
			frame.orderedFrameIndex = this.outputOrderIndex[frame.orderChannel];
			frame.sequenceFrameIndex = (this.outputSequenceIndex[
				frame.orderChannel
			] as number)++;
		} else if (frame.isOrdered) {
			frame.orderedFrameIndex = (this.outputOrderIndex[
				frame.orderChannel
			] as number)++;
			this.outputSequenceIndex[frame.orderChannel] = 0;
		}
		const maxSize = this.client.options.mtuSize - 36;
		const splitSize = Math.ceil(frame.payload.byteLength / maxSize);
		if (frame.payload.byteLength > maxSize) {
			this.handleLargePayload(frame, maxSize, splitSize);
		} else {
			if (frame.isReliable)
				frame.reliableFrameIndex = this.outputReliableIndex++;
			this.queueFrame(frame, priority);
		}
	}

	private handleLargePayload(
		frame: Frame,
		maxSize: number,
		splitSize: number,
	): void {
		const splitId = this.outputSplitIndex++ % 65_536;
		for (let index = 0; index < frame.payload.byteLength; index += maxSize) {
			const nframe = this.createSplitFrame(
				frame,
				index,
				maxSize,
				splitId,
				splitSize,
			);
			this.queueFrame(nframe, Priority.Immediate);
		}
	}

	private createSplitFrame(
		originalFrame: Frame,
		index: number,
		maxSize: number,
		splitId: number,
		splitSize: number,
	): Frame {
		const nframe = new Frame();
		nframe.reliableFrameIndex = this.outputReliableIndex++;
		nframe.sequenceFrameIndex = originalFrame.sequenceFrameIndex;
		nframe.orderedFrameIndex = originalFrame.orderedFrameIndex;
		nframe.orderChannel = originalFrame.orderChannel;
		nframe.reliability = originalFrame.reliability;
		nframe.payload = originalFrame.payload.subarray(index, index + maxSize);
		nframe.splitFrameIndex = index / maxSize;
		nframe.splitId = splitId;
		nframe.splitCount = splitSize;
		if (nframe.isReliable) {
			nframe.reliableFrameIndex = this.outputReliableIndex++;
		}

		return nframe;
	}

	private queueFrame(frame: Frame, priority: Priority): void {
		let length = 4;
		for (const queuedFrame of this.outputFrames) {
			length += queuedFrame.getByteLength();
		}

		if (length + frame.getByteLength() > this.client.options.mtuSize - 36) {
			this.sendQueue(this.outputFrames.size);
		}

		this.outputFrames.add(frame);

		if (priority === Priority.Immediate) {
			this.sendQueue(1);
		}
	}

	public sendQueue(amount: number): void {
		if (this.outputFrames.size === 0) return;
		const frameset = new Frameset();
		frameset.sequence = this.outputSequence++;
		frameset.frames = [...this.outputFrames].slice(0, amount);
		this.outputBackup.set(frameset.sequence, frameset.frames);
		for (const frame of frameset.frames) this.outputFrames.delete(frame);
		this.client.send(frameset.serialize());
	}
}
