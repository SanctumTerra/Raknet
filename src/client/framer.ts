import { Z_BEST_COMPRESSION } from "node:zlib";
import {
	Ack,
	ConnectedPing,
	ConnectedPong,
	Flags,
	Frame,
	NewIncomingConnection,
	Packet,
	Priority,
	Reliability,
	SystemAddress,
	Nack,
} from "../proto";
import { Frameset } from "../proto";
import { Logger } from "../utils";
import type { Client } from "./client";
import { ConnectionRequestAccepted } from "../proto/packets/connection-request-accepted";
import { measureExecutionTime } from "../utils/index";

const FRAMESET_CACHE = new WeakMap<Frameset, Buffer>();
const FRAME_SIZE_CACHE = new WeakMap<Frame, number>();
const MAX_SPLIT_COUNT = 65_536;
const FRAME_HEADER_SIZE = 36;

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
	protected outputFrames: Frame[] = [];
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
			this.receivedFrameSequences.size > 0 ||
			this.lostFrameSequences.size > 0
		) {
			this.processPendingSequences();
		}

		this.sendQueue(this.outputFrames.length);
	}

	private processPendingSequences(): void {
		if (this.receivedFrameSequences.size > 0) {
			const ack = new Ack();
			ack.sequences = Array.from(this.receivedFrameSequences);
			this.receivedFrameSequences.clear();
			this.frameAndSend(ack.serialize(), Priority.Immediate);
		}

		if (this.lostFrameSequences.size > 0) {
			const nack = new Nack();
			nack.sequences = Array.from(this.lostFrameSequences);
			this.lostFrameSequences.clear();
			this.frameAndSend(nack.serialize(), Priority.Immediate);
		}
	}

	private processFrame(frame: Frame): void {
		const header = frame.payload[0] as number;
		if (this.client.options.debug)
			Logger.debug(`Received FrameSet Packet ${header}`);
		switch (header) {
			case Packet.Nack: {
				const nack = new Nack(frame.payload).deserialize();
				for (const seq of nack.sequences) {
					if (this.outputBackup.has(seq)) {
						const lostFrames = this.outputBackup.get(seq) ?? [];
						for (const lostFrame of lostFrames) {
							this.sendFrame(lostFrame, Priority.Immediate);
						}
						this.outputBackup.delete(seq);
					}
				}
				break;
			}
			case Packet.Ack: {
				const ack = new Ack(frame.payload).deserialize();
				for (const seq of ack.sequences) {
					this.outputBackup.delete(seq);
				}
				break;
			}
			case Packet.ConnectedPing: {
				const packet = new ConnectedPing(frame.payload).deserialize();
				this.client.emit("connected-ping", packet);
				const pong = new ConnectedPong();
				pong.pongTime = BigInt(Date.now());
				pong.pingTime = packet.timestamp;
				this.frameAndSend(pong.serialize(), Priority.Immediate);
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
			case 254: {
				this.client.emit("encapsulated", frame.payload);
				break;
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

			if (diff !== 1) {
				for (
					let index = this.lastInputSequence + 1;
					index < frameSet.sequence;
					index++
				) {
					if (!this.receivedFrameSequences.has(index)) {
						this.lostFrameSequences.add(index);
					}
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

	@measureExecutionTime
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
		const outOfOrderQueue = this.inputOrderingQueue.get(
			frame.orderChannel,
		) as Map<number, Frame>;

		if (frame.orderedFrameIndex === expectedOrderIndex) {
			this.processOrderedFrames(frame, outOfOrderQueue);
		} else if (frame.orderedFrameIndex > expectedOrderIndex) {
			if (this.client.options.debug)
				Logger.debug(`Queuing out-of-order frame: ${frame.orderedFrameIndex}`);
			outOfOrderQueue.set(frame.orderedFrameIndex, frame);
		} else {
			if (this.client.options.debug)
				Logger.debug(`Discarding old frame: ${frame.orderedFrameIndex}`);
		}
	}

	private processOrderedFrames(
		frame: Frame,
		outOfOrderQueue: Map<number, Frame>,
	): void {
		this.processFrame(frame);
		this.inputOrderIndex[frame.orderChannel]++;
		let nextOrderIndex = this.inputOrderIndex[frame.orderChannel];
		while (outOfOrderQueue.has(nextOrderIndex)) {
			const nextFrame = outOfOrderQueue.get(nextOrderIndex);
			if (nextFrame) {
				this.processFrame(nextFrame);
				outOfOrderQueue.delete(nextOrderIndex);
				this.inputOrderIndex[frame.orderChannel]++;
				nextOrderIndex++;
			}
		}
	}

	private handleSequenced(frame: Frame): void {
		const currentHighestSequence =
			this.inputHighestSequenceIndex[frame.orderChannel];
		if (this.client.options.debug)
			Logger.debug(
				`Handling sequenced frame: sequenceFrameIndex=${frame.sequenceFrameIndex}, currentHighest=${currentHighestSequence}`,
			);

		if (frame.sequenceFrameIndex > currentHighestSequence) {
			this.inputHighestSequenceIndex[frame.orderChannel] =
				frame.sequenceFrameIndex;
			this.processFrame(frame);
		} else {
			if (this.client.options.debug)
				Logger.debug(
					`Discarding old sequenced frame: ${frame.sequenceFrameIndex}`,
				);
		}
	}

	private handleSplit(frame: Frame): void {
		let fragmentMap = this.fragmentsQueue.get(frame.splitId);

		if (!fragmentMap) {
			fragmentMap = new Map();
			this.fragmentsQueue.set(frame.splitId, fragmentMap);
		}

		fragmentMap.set(frame.splitFrameIndex, frame);

		if (fragmentMap.size !== frame.splitCount) return;

		this.reassembleAndProcessFragment(frame, fragmentMap);
	}

	private reassembleAndProcessFragment(
		frame: Frame,
		fragment: Map<number, Frame>,
	): void {
		let totalSize = 0;
		for (const [_, sframe] of fragment) {
			totalSize += sframe.payload.length;
		}

		const buffer = Buffer.allocUnsafe(totalSize);
		let offset = 0;

		for (let index = 0; index < fragment.size; index++) {
			const sframe = fragment.get(index);
			if (!sframe) {
				Logger.error(
					`Missing fragment at index ${index} for splitId=${frame.splitId}`,
				);
				return;
			}
			sframe.payload.copy(buffer, offset);
			offset += sframe.payload.length;
		}

		const reassembledFrame = new Frame();
		reassembledFrame.reliability = frame.reliability;

		reassembledFrame.reliableFrameIndex = frame.reliableFrameIndex;
		reassembledFrame.sequenceFrameIndex = frame.sequenceFrameIndex;

		reassembledFrame.orderedFrameIndex = frame.orderedFrameIndex;
		reassembledFrame.orderChannel = frame.orderChannel;
		reassembledFrame.payload = buffer;

		this.fragmentsQueue.delete(frame.splitId);
		this.handleFrame(reassembledFrame);
	}

	public frameAndSend(
		payload: Buffer,
		priority: Priority = Priority.Normal,
	): void {
		const frame = this.createCachedFrame(
			Reliability.ReliableOrdered,
			0,
			payload,
		);
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

	@measureExecutionTime
	private handleLargePayload(
		frame: Frame,
		maxSize: number,
		splitSize: number,
	): void {
		const splitId = this.outputSplitIndex++ % MAX_SPLIT_COUNT;
		const payload = frame.payload;
		const frames = new Array<Frame>(splitSize);

		const commonProps = {
			reliability: frame.reliability,
			sequenceFrameIndex: frame.sequenceFrameIndex,
			orderedFrameIndex: frame.orderedFrameIndex,
			orderChannel: frame.orderChannel,
			splitCount: splitSize,
			splitId: splitId,
		};

		for (let i = 0; i < splitSize; i++) {
			const start = i * maxSize;
			const end = Math.min(start + maxSize, payload.length);

			frames[i] = this.createSplitFrameOptimized(
				payload.subarray(start, end),
				i,
				commonProps,
			);
		}

		for (const splitFrame of frames) {
			this.queueFrame(splitFrame, Priority.Immediate);
		}
	}

	private createSplitFrameOptimized(
		payload: Buffer,
		splitIndex: number,
		props: {
			reliability: number;
			sequenceFrameIndex: number;
			orderedFrameIndex: number;
			orderChannel: number;
			splitCount: number;
			splitId: number;
		},
	): Frame {
		const frame = new Frame();
		frame.reliability = props.reliability;
		frame.sequenceFrameIndex = props.sequenceFrameIndex;
		frame.orderedFrameIndex = props.orderedFrameIndex;
		frame.orderChannel = props.orderChannel;
		frame.payload = payload;
		frame.splitFrameIndex = splitIndex;
		frame.splitId = props.splitId;
		frame.splitCount = props.splitCount;

		if (frame.isReliable) {
			frame.reliableFrameIndex = this.outputReliableIndex++;
		}

		return frame;
	}

	@measureExecutionTime
	private queueFrame(frame: Frame, priority: Priority): void {
		const frameSize = this.getFrameSize(frame);
		let totalLength = 4;

		for (const queuedFrame of this.outputFrames) {
			totalLength += this.getFrameSize(queuedFrame);
		}

		if (
			totalLength + frameSize >
			this.client.options.mtuSize - FRAME_HEADER_SIZE
		) {
			this.sendQueue(this.outputFrames.length);
		}

		if (priority === Priority.Immediate) {
			this.outputFrames.unshift(frame);
			this.sendQueue(1);
		} else {
			this.outputFrames.push(frame);
		}
	}

	private getFrameSize(frame: Frame): number {
		let size = FRAME_SIZE_CACHE.get(frame);
		if (size === undefined) {
			size = frame.getByteLength();
			FRAME_SIZE_CACHE.set(frame, size);
		}
		return size;
	}

	@measureExecutionTime
	public sendQueue(amount: number): void {
		if (this.outputFrames.length === 0) return;

		const framesToSend = this.outputFrames.splice(0, amount);
		if (framesToSend.length === 0) return;

		const frameset = new Frameset();
		frameset.sequence = this.outputSequence++;
		frameset.frames = framesToSend;

		const reliableFrames = framesToSend.filter((frame) => frame.isReliable);
		if (reliableFrames.length > 0) {
			this.outputBackup.set(frameset.sequence, reliableFrames);
		}

		const buffer = this.createFramesetBuffer(frameset);
		this.client.send(buffer);
	}

	private createFramesetBuffer(frameset: Frameset): Buffer {
		const cached = FRAMESET_CACHE.get(frameset);
		if (cached) return cached;

		const buffer = frameset.serialize();
		FRAMESET_CACHE.set(frameset, buffer);
		return buffer;
	}

	private createCachedFrame(
		reliability: number,
		orderChannel: number,
		payload: Buffer,
	): Frame {
		const frame = new Frame();
		frame.reliability = reliability;
		frame.orderChannel = orderChannel;
		frame.payload = payload;

		if (frame.isReliable) {
			frame.reliableFrameIndex = this.outputReliableIndex++;
		}

		return frame;
	}
}
