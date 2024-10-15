import { Frame, FrameSet, Packet } from "@serenityjs/raknet";
import { Client } from "../client/client";
import type { Connection } from "../server";
import { BinaryStream } from "@serenityjs/binarystream";
import Emitter from "@serenityjs/emitter";

interface FramerEvents {
	encapsulated: [frame: Frame];
	disconnect: [frame: Frame];
	"connection-request-accepted": [frame: Frame];
	"connection-request": [frame: Frame];
	"new-incoming-connection": [frame: Frame];
}

export class Framer extends Emitter<FramerEvents> {
	private lastInputSequence = -1;
	private receivedFrameSequences = new Set<number>();
	private lostFrameSequences = new Set<number>();
	private inputHighestSequenceIndex = new Array(64).fill(0);
	private inputOrderIndex = new Array(64).fill(0);
	protected inputOrderingQueue = new Map<number, Map<number, Frame>>();
	protected readonly fragmentsQueue = new Map<number, Map<number, Frame>>();

	constructor(private readonly connection: Connection | Client) {
		super();
		for (let index = 0; index < 64; index++) {
			this.inputOrderingQueue.set(index, new Map());
		}
	}

	public handleFrameSet(buffer: Buffer): void {
		const frameset = new FrameSet(buffer).deserialize();
		if (this.receivedFrameSequences.has(frameset.sequence)) {
			return;
		}
		this.lostFrameSequences.delete(frameset.sequence);
		if (
			frameset.sequence < this.lastInputSequence ||
			frameset.sequence === this.lastInputSequence
		) {
			return;
		}
		this.receivedFrameSequences.add(frameset.sequence);
		if (frameset.sequence - this.lastInputSequence > 1) {
			for (
				let index = this.lastInputSequence + 1;
				index < frameset.sequence;
				index++
			)
				this.lostFrameSequences.add(index);
		}
		this.lastInputSequence = frameset.sequence;
		for (const frame of frameset.frames) {
			this.handleFrame(frame);
		}
	}

	public handleFrame(frame: Frame): void {
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
		if (this.connection instanceof Client && this.connection.options.debug) {
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
			if (this.connection instanceof Client && this.connection.options.debug)
				console.debug(`Queuing out-of-order frame: ${frame.orderIndex}`);
			orderingQueue.set(frame.orderIndex, frame);
		} else {
			if (this.connection instanceof Client && this.connection.options.debug)
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
				if (this.connection instanceof Client && this.connection.options.debug)
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
		if (this.connection instanceof Client && this.connection.options.debug) {
			console.debug(
				`Handling sequenced frame: sequenceIndex=${frame.sequenceIndex}, currentHighest=${currentHighestSequence}`,
			);
		}

		if (frame.sequenceIndex > currentHighestSequence) {
			this.inputHighestSequenceIndex[frame.orderChannel] = frame.sequenceIndex;
			this.processFrame(frame);
		} else {
			if (this.connection instanceof Client && this.connection.options.debug)
				console.debug(`Discarding old sequenced frame: ${frame.sequenceIndex}`);
		}
	}

	private handleFragment(frame: Frame): void {
		const fragment =
			this.fragmentsQueue.get(frame.splitId) || new Map<number, Frame>();
		this.fragmentsQueue.set(frame.splitId, fragment);
		fragment.set(frame.splitIndex, frame);
		if (fragment.size === frame.splitSize) {
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

	private processFrame(frame: Frame): void {
		const header = frame.payload[0] as number;

		switch (header) {
			case Packet.NewIncomingConnection: {
				this.emit("new-incoming-connection", frame);
				break;
			}
			case Packet.ConnectionRequest: {
				this.emit("connection-request", frame);
				break;
			}
			case Packet.ConnectionRequestAccepted: {
				this.emit("connection-request-accepted", frame);
				break;
			}
			case Packet.Disconnect: {
				this.emit("disconnect", frame);
				break;
			}
			case 254: {
				this.emit("encapsulated", frame);
				break;
			}
			default: {
				if (this.connection instanceof Client && this.connection.options.debug)
					console.debug(`Received unknown packet in processFrame: ${header}`);
				break;
			}
		}
	}
}
