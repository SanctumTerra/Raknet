import { BinaryStream } from "@serenityjs/binarystream";
import { Ack, Frame, FrameSet, Packets, Priority, Reliability } from "./proto";
import { Logger } from "./logger";

const MTU_HEADER_SIZE = 36;

export class NetworkSession {
	public mtu: number;
	public debug: boolean;
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
	public pendingAcks: Set<number> = new Set();
	public lastInputSequence = -1;
	public fragmentsQueue: Map<
		number,
		{ frames: Map<number, Frame>; timestamp: number }
	> = new Map();
	public inputHighestSequenceIndex: Array<number>;
	public inputOrderIndex: Array<number>;
	protected inputOrderingQueue: Map<number, Map<number, Frame>> = new Map();

	private receivedReliableFrameIndices: Set<number> = new Set();
	private highestReliableIndex = -1;

	// goofy ahh geyser stuff
	private static readonly RECEIVE_WINDOW_SIZE = 2048;
	private static readonly RELIABLE_WINDOW_SIZE = 4096;
	private static readonly FRAGMENT_TIMEOUT_MS = 30000;
	private static readonly ORDER_QUEUE_MAX_SIZE = 256;

	constructor(mtu: number, debug = false) {
		this.mtu = mtu;
		this.debug = debug;
		this.outputOrderIndex = new Array(32).fill(0);
		this.outputSequenceIndex = new Array(32).fill(0);
		this.inputHighestSequenceIndex = Array.from<number>({ length: 32 }).fill(0);
		this.inputOrderIndex = Array.from<number>({ length: 32 }).fill(0);
		for (let index = 0; index < 32; index++)
			this.inputOrderingQueue.set(index, new Map());
	}

	onTick(_tick?: number) {
		const now = Date.now();

		const windowStart =
			this.lastInputSequence - NetworkSession.RECEIVE_WINDOW_SIZE;
		if (windowStart > 0) {
			for (const seq of this.receivedFrameSequences) {
				if (seq < windowStart) this.receivedFrameSequences.delete(seq);
			}
			for (const seq of this.lostFrameSequences) {
				if (seq < windowStart) this.lostFrameSequences.delete(seq);
			}
		}

		const reliableWindowStart =
			this.highestReliableIndex - NetworkSession.RELIABLE_WINDOW_SIZE;
		if (reliableWindowStart > 0) {
			for (const idx of this.receivedReliableFrameIndices) {
				if (idx < reliableWindowStart)
					this.receivedReliableFrameIndices.delete(idx);
			}
		}

		for (const [splitId, entry] of this.fragmentsQueue) {
			if (now - entry.timestamp > NetworkSession.FRAGMENT_TIMEOUT_MS) {
				if (this.debug)
					Logger.warn(
						`Fragment queue ${splitId} timed out, dropping ${entry.frames.size} fragments`,
					);
				this.fragmentsQueue.delete(splitId);
			}
		}

		if (this.pendingAcks.size > 0) {
			const ackSeqs = Array.from(this.pendingAcks);
			this.pendingAcks.clear();
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
			const lostFrames = this.outputBackup.get(seq);
			if (!lostFrames || lostFrames.length === 0) continue;

			// Resend the exact same frameset with the same sequence number
			const frameset = new FrameSet();
			frameset.sequence = seq;
			frameset.frames = lostFrames;
			const buffer = frameset.serialize();
			this.send(buffer);
		}
	}

	public frameAndSend(data: Buffer, priority: Priority = Priority.Medium) {
		const frame = new Frame();
		frame.reliability = Reliability.ReliableOrdered;
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
		// Already received this exact sequence so ignore duplicate
		if (this.receivedFrameSequences.has(frameSet.sequence)) {
			if (this.debug)
				Logger.warn(
					`Duplicate frame set received: sequence ${frameSet.sequence}`,
				);
			return;
		}

		// Remove from lost if we finally got it
		this.lostFrameSequences.delete(frameSet.sequence);

		// Track this sequence as received and queue ACK
		this.receivedFrameSequences.add(frameSet.sequence);
		this.pendingAcks.add(frameSet.sequence);

		// If this is a newer sequence than we've seen, update tracking
		if (frameSet.sequence > this.lastInputSequence) {
			const diff = frameSet.sequence - this.lastInputSequence;

			// Mark any gaps as lost (for NACK)
			if (diff > 1) {
				for (
					let index = this.lastInputSequence + 1;
					index < frameSet.sequence;
					index++
				) {
					// Only mark as lost if we haven't already received it
					if (!this.receivedFrameSequences.has(index)) {
						this.lostFrameSequences.add(index);
					}
				}
			}

			this.lastInputSequence = frameSet.sequence;
		} else {
			// zOut-of-order packet (arrived late but still valid)
			if (this.debug)
				Logger.warn(
					`Out-of-order frame set received: sequence ${frameSet.sequence} (expected > ${this.lastInputSequence})`,
				);
		}

		// Process all frames
		for (const frame of frameSet.frames) {
			this.handleFrame(frame);
		}
	}

	public handleFrame(frame: Frame): void {
		// Duplicate detection for reliable frames
		if (frame.isReliable()) {
			if (this.receivedReliableFrameIndices.has(frame.reliableFrameIndex)) {
				// Already processed tsis reliable frame, skip
				return;
			}
			this.receivedReliableFrameIndices.add(frame.reliableFrameIndex);
			if (frame.reliableFrameIndex > this.highestReliableIndex) {
				this.highestReliableIndex = frame.reliableFrameIndex;
			}
		}

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
			entry = { frames: new Map<number, Frame>(), timestamp: Date.now() };
			this.fragmentsQueue.set(splitId, entry);
		}
		entry.frames.set(frame.splitFrameIndex, frame);
		if (entry.frames.size === frame.splitSize) {
			const stream = new BinaryStream();
			for (let index = 0; index < frame.splitSize; index++) {
				const sframe = entry.frames.get(index);
				if (!sframe) {
					if (this.debug)
						Logger.warn(
							`Missing fragment at index ${index} for splitId=${frame.splitId}`,
						);
					this.fragmentsQueue.delete(splitId);
					return;
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

			this.fragmentsQueue.delete(splitId);

			// Process the reassembled frame (but skip split handling since it's no longer split)
			if (reassembledFrame.isSequenced()) {
				this.handleSequenced(reassembledFrame);
			} else if (reassembledFrame.isOrdered()) {
				this.handleOrdered(reassembledFrame);
			} else {
				this.handle(reassembledFrame.payload);
			}
		}
	}

	public handleSequenced(frame: Frame): void {
		const channel = frame.orderChannel;
		const currentHighestSequence = this.inputHighestSequenceIndex[channel] ?? 0;

		// Sequenced frames: drop if older than what we've seen, otherwise process immediately
		// They don't need ordering, just drop stale ones
		if (frame.sequenceFrameIndex < currentHighestSequence) {
			// Old sequenced frame, drop it
			return;
		}

		this.inputHighestSequenceIndex[channel] = frame.sequenceFrameIndex + 1;
		this.handle(frame.payload);
	}

	public handleOrdered(frame: Frame): void {
		const channel = frame.orderChannel;
		const expectedOrderIndex = this.inputOrderIndex[channel] ?? 0;

		if (frame.orderedFrameIndex === expectedOrderIndex) {
			// This is the frame we're waiting for - process it
			this.inputHighestSequenceIndex[channel] = 0;
			this.inputOrderIndex[channel] = expectedOrderIndex + 1;
			this.handle(frame.payload);

			// Now flush any queued frames that are now in order
			const outOfOrderQueue = this.inputOrderingQueue.get(channel);
			if (outOfOrderQueue) {
				let nextIndex = expectedOrderIndex + 1;
				while (outOfOrderQueue.has(nextIndex)) {
					const queuedFrame = outOfOrderQueue.get(nextIndex);
					if (queuedFrame) {
						this.handle(queuedFrame.payload);
						outOfOrderQueue.delete(nextIndex);
					}
					nextIndex++;
				}
				this.inputOrderIndex[channel] = nextIndex;
			}
		} else if (frame.orderedFrameIndex > expectedOrderIndex) {
			// Future frame n queue it for later
			const outOfOrderQueue = this.inputOrderingQueue.get(channel);
			if (outOfOrderQueue) {
				// Prevent unbounded queue growth
				if (outOfOrderQueue.size < NetworkSession.ORDER_QUEUE_MAX_SIZE) {
					outOfOrderQueue.set(frame.orderedFrameIndex, frame);
				} else {
					if (this.debug)
						Logger.debug(
							`Order queue for channel ${channel} is full, dropping frame ${frame.orderedFrameIndex}`,
						);
				}
			}
		}
		// If frame.orderedFrameIndex < expectedOrderIndex, it's a duplicate/old frame - ignore it
	}
}
