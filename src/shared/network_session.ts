import { BinaryStream } from "@serenityjs/binarystream";
import { Ack, Frame, FrameSet, Packets, Priority, Reliability } from "./proto";
import { Logger } from "./logger";

const MTU_HEADER_SIZE = 36;

export class NetworkSession {
	public mtu: number;
	public send!: (data: Buffer) => void;
	public handle!: (data: Buffer) => void;

	// Output
	public outputReliableIndex = 0;
	public outputSplitIndex = 0;
	protected outputSequence = 0;
	public outputSequenceIndex: number[];
	public outputOrderIndex: number[];
	public outputFrames: Set<Frame> = new Set();
	public outputBackup = new Map<number, Frame[]>();

	// Input
	public receivedFrameSequences: Set<number> = new Set();
	public lostFrameSequences: Set<number> = new Set();
	public lastInputSequence = -1;
	public fragmentsQueue: Map<number, Map<number, Frame>> = new Map();
	public inputHighestSequenceIndex: Array<number>;
	public inputOrderIndex: Array<number>;
	protected inputOrderingQueue: Map<number, Map<number, Frame>> = new Map();

	constructor(mtu: number) {
		this.mtu = mtu;
		this.outputOrderIndex = new Array(32).fill(0);
		this.outputSequenceIndex = new Array(32).fill(0);
		this.inputHighestSequenceIndex = Array.from<number>({ length: 32 }).fill(0);
		this.inputOrderIndex = Array.from<number>({ length: 32 }).fill(0);
		for (let index = 0; index < 32; index++)
			this.inputOrderingQueue.set(index, new Map());
	}

	onTick(tick: number) {
		if (this.receivedFrameSequences.size > 0) {
			const ackSeqs = Array.from(this.receivedFrameSequences);
			this.receivedFrameSequences.clear();
			const ack = new Ack();
			ack.sequences = ackSeqs;
			this.send(ack.serialize());
		}

		if (this.lostFrameSequences.size > 0) {
			const nackSeqs = Array.from(this.lostFrameSequences);
			this.lostFrameSequences.clear();
			const nack = new Ack();
			nack.sequences = nackSeqs;
			const payload = nack.serialize();
			payload[0] = Packets.Nack;
			this.send(payload);
		}

		const size = this.outputFrames.size;
		if (size > 0) this.sendQueue(size);
	}

	onAck(ack: Ack) {
		for (let i = 0, len = ack.sequences.length; i < len; i++) {
			this.outputBackup.delete(ack.sequences[i]);
		}
	}

	onNack(nack: Ack) {
		for (let i = 0, len = nack.sequences.length; i < len; i++) {
			const seq = nack.sequences[i];
			const lostFrames = this.outputBackup.get(seq) || [];
			for (let j = 0, lostLen = lostFrames.length; j < lostLen; j++) {
				this.sendFrame(lostFrames[j], Priority.High);
			}
		}
	}

	public frameAndSend(data: Buffer, priority: Priority = Priority.Medium) {
		const frame = new Frame();
		frame.orderChannel = 0;
		frame.payload = data;
		this.sendFrame(frame, priority);
	}

	public sendFrame(frame: Frame, priority: Priority = Priority.Medium) {
		const channel = frame.orderChannel;
		if (frame.isSequenced()) {
			frame.orderedFrameIndex = this.outputOrderIndex[channel];
			frame.sequenceFrameIndex = this.outputSequenceIndex[channel]++;
		} else if (frame.isOrdered()) {
			frame.orderedFrameIndex = this.outputOrderIndex[channel]++;
			this.outputSequenceIndex[channel] = 0;
		}

		const maxSize = this.mtu - MTU_HEADER_SIZE;
		const payloadSize = frame.payload.byteLength;

		if (payloadSize > maxSize) {
			const splitSize = Math.ceil(payloadSize / maxSize);
			const splitId = this.outputSplitIndex++ & 0xffff;

			for (let i = 0; i < splitSize; i++) {
				const index = i * maxSize;
				const nF = new Frame();

				if (frame.isReliable()) {
					nF.reliableFrameIndex = this.outputReliableIndex++;
				}

				nF.sequenceFrameIndex = frame.sequenceFrameIndex;
				nF.orderedFrameIndex = frame.orderedFrameIndex;
				nF.orderChannel = frame.orderChannel;
				nF.reliability = frame.reliability;
				nF.payload = frame.payload.subarray(
					index,
					Math.min(index + maxSize, payloadSize),
				);
				nF.splitFrameIndex = i;
				nF.splitId = splitId;
				nF.splitSize = splitSize;
				this.queueFrame(nF, priority);
			}
		} else {
			if (frame.isReliable()) {
				frame.reliableFrameIndex = this.outputReliableIndex++;
			}
			this.queueFrame(frame, priority);
		}
	}

	public queueFrame(frame: Frame, priority: Priority) {
		let length = 4;
		for (const frame of this.outputFrames) length += frame.getByteLength();

		if (length + frame.getByteLength() > this.mtu - MTU_HEADER_SIZE)
			this.sendQueue(this.outputFrames.size);

		this.outputFrames.add(frame);
		if (priority === Priority.High) this.sendQueue(1);
	}

	public sendQueue(amount: number): void {
		if (this.outputFrames.size === 0) return;

		const frameset = new FrameSet();
		frameset.sequence = this.outputSequence++;
		frameset.frames = [...this.outputFrames].slice(0, amount);

		this.outputBackup.set(frameset.sequence, frameset.frames);

		for (const frame of frameset.frames) this.outputFrames.delete(frame);

		const buffer = frameset.serialize();

		if (!this.send) throw new Error("Send method was not initialized");
		this.send(buffer);
	}

	public onFrameSet(frameSet: FrameSet) {
		if (this.receivedFrameSequences.has(frameSet.sequence)) {
			throw new Error("Duplicate frame set received");
		}
		this.lostFrameSequences.delete(frameSet.sequence);
		const isLess = frameSet.sequence < this.lastInputSequence;
		const isEqual = frameSet.sequence === this.lastInputSequence;

		if (isLess || isEqual) {
			throw new Error("Frame set received is out of order");
		}
		this.receivedFrameSequences.add(frameSet.sequence);
		const diff = frameSet.sequence - this.lastInputSequence;

		if (diff > 1) {
			for (
				let index = this.lastInputSequence + 1;
				index < frameSet.sequence;
				index++
			)
				this.lostFrameSequences.add(index);
		}

		this.lastInputSequence = frameSet.sequence;
		for (const frame of frameSet.frames) {
			this.handleFrame(frame);
		}
	}

	public handleFrame(frame: Frame): void {
		if (frame.isSplit()) {
			this.handleSplitFrame(frame);
		} else if (frame.isSequenced()) {
			this.handleSequenced(frame);
		} else if (frame.isOrdered()) {
			this.handleOrdered(frame);
		} else {
			this.handle(frame.payload);
		}
	}

	public handleSplitFrame(frame: Frame): void {
		const splitId = frame.splitId;
		let entry = this.fragmentsQueue.get(splitId);
		if (!entry) {
			entry = new Map<number, Frame>();
			this.fragmentsQueue.set(splitId, entry);
		}
		entry.set(frame.splitFrameIndex, frame);
		if (entry.size === frame.splitSize) {
			{
				const stream = new BinaryStream();
				for (let index = 0; index < frame.splitSize; index++) {
					const sframe = entry.get(index);
					if (!sframe) {
						throw new Error(
							`Missing fragment at index ${index} for splitId=${frame.splitId}`,
						);
					}
					stream.write(sframe.payload);
				}
				const reassembledFrame = new Frame();
				reassembledFrame.reliability = frame.reliability;
				reassembledFrame.reliableFrameIndex = frame.reliableFrameIndex;
				reassembledFrame.sequenceFrameIndex = frame.sequenceFrameIndex;
				reassembledFrame.orderedFrameIndex = frame.orderedFrameIndex;
				reassembledFrame.orderChannel = frame.orderChannel;
				reassembledFrame.payload = stream.getBuffer();
				this.handleFrame(reassembledFrame);
			}
			this.fragmentsQueue.delete(splitId);
		}
	}

	public handleSequenced(frame: Frame): void {
		const channel = frame.orderChannel;
		const currentHighestSequence = this.inputHighestSequenceIndex[channel];
		const isLess = frame.sequenceFrameIndex < currentHighestSequence;
		if (isLess || frame.orderedFrameIndex === this.inputOrderIndex[channel]) {
			Logger.warn(
				"Frame dropped, sequence is less than current highest sequence",
			);
			return;
		}
		this.inputHighestSequenceIndex[channel] = frame.sequenceFrameIndex + 1;
		this.handle(frame.payload);
	}

	public handleOrdered(frame: Frame): void {
		const channel = frame.orderChannel;
		const expectedOrderIndex = this.inputOrderIndex[channel];
		const isEqual = frame.orderedFrameIndex === expectedOrderIndex;

		if (frame.orderedFrameIndex > expectedOrderIndex) {
			const unordered = this.inputOrderingQueue.get(channel);
			if (!unordered) {
				Logger.warn("No unordered queue found");
				return;
			}
			unordered.set(frame.orderedFrameIndex, frame);
		} else if (isEqual) {
			this.inputHighestSequenceIndex[frame.orderChannel] = 0;
			this.inputOrderIndex[frame.orderChannel] = frame.orderedFrameIndex + 1;
			this.handle(frame.payload);
			let index = this.inputOrderIndex[frame.orderChannel] as number;
			const outOfOrderQueue = this.inputOrderingQueue.get(
				frame.orderChannel,
			) as Map<number, Frame>;
			for (; outOfOrderQueue.has(index); index++) {
				const frame = outOfOrderQueue.get(index);
				if (!frame) break;
				this.handle(frame.payload);
				outOfOrderQueue.delete(index);
			}
			this.inputOrderingQueue.set(frame.orderChannel, outOfOrderQueue);
			this.inputOrderIndex[frame.orderChannel] = index;
		}
	}
}
