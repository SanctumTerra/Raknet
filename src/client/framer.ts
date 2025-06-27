import {
	Ack,
	ConnectedPing,
	ConnectedPong,
	Frame,
	NewIncomingConnection,
	Packet,
	Priority,
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

// Constants for packet handling
const PACKET_HEADER_MASK = 0xf0;
const PACKET_HEADER_FRAMESET = 0x80;
const PACKET_ENCAPSULATED = 0xfe;
const PING_INTERVAL = 50; // Send ping every 50 ticks
const MTU_HEADER_SIZE = 36;

interface QueuedFrame {
	frame: Frame;
	timestamp: number;
}

export class Framer {
	private client: Client;
	private lastInputSequence = -1;
	private receivedFrameSequences: Set<number> = new Set();
	private lostFrameSequences: Set<number> = new Set();
	private inputHighestSequenceIndex: number[] = new Array(64).fill(0);
	private inputOrderIndex: number[] = new Array(64).fill(0);
	protected inputOrderingQueue: Array<Map<number, QueuedFrame>> = Array.from(
		{ length: 64 },
		() => new Map(),
	);
	protected readonly fragmentsQueue: Map<
		number,
		{ fragments: Map<number, Frame>; timestamp: number }
	> = new Map();

	public outputOrderIndex: number[];
	public outputSequenceIndex: number[];
	public outputFrameQueue: Frameset;
	protected outputSequence = 0;
	protected outputSplitIndex = 0;
	protected outputReliableIndex = 0;
	public outputFrames: Frame[] = [];
	private outputFramesByteLength = 0;
	public outputBackup = new Map<number, Frame[]>();
	public _tickCount = 0;

	private mtuDiff: number;
	private readonly BATCH_SIZE = 32; // Maximum frames to process in a batch
	private readonly MAX_BATCH_INTERVAL = 50; // Maximum time (ms) to wait before processing a batch
	private lastBatchTime = 0;
	private readonly ORDERING_QUEUE_TIMEOUT = 500;

	constructor(client: Client) {
		this.client = client;
		this.outputFrameQueue = new Frameset();
		this.outputFrameQueue.frames = [];
		this.outputOrderIndex = new Array(32).fill(0);
		this.outputSequenceIndex = new Array(32).fill(0);
		this.mtuDiff = this.client.options.mtuSize - MTU_HEADER_SIZE;
	}

	public tick() {
		this._tickCount++;
		const now = Date.now();

		if (
			this.client.status === Status.Disconnected ||
			this.client.status === Status.Disconnecting
		) {
			return;
		}

		// Send a ping every PING_INTERVAL ticks
		if (this._tickCount % PING_INTERVAL === 0) {
			const ping = new ConnectedPing();
			ping.timestamp = BigInt(now);
			this.frameAndSend(ping.serialize(), Priority.Immediate);
		}

		// Batch process ACKs and NACKs
		this.processBatchedAcksAndNacks();

		// Process ordered frames in batches
		this.processBatchedOrderedFrames(now);

		// Send queued frames if we have enough or enough time has passed
		if (
			this.outputFrames.length >= this.BATCH_SIZE ||
			(this.outputFrames.length > 0 &&
				now - this.lastBatchTime >= this.MAX_BATCH_INTERVAL)
		) {
			this.sendQueue(this.outputFrames.length);
			this.lastBatchTime = now;
		}
	}

	private processBatchedAcksAndNacks(): void {
		// Batch process ACKs
		if (this.receivedFrameSequences.size > 0) {
			const ackSeqs = Array.from(this.receivedFrameSequences);
			this.receivedFrameSequences.clear();
			const ack = new Ack();
			ack.sequences = ackSeqs;
			this.client.send(ack.serialize());
		}

		// Batch process NACKs
		if (this.lostFrameSequences.size > 0) {
			const nackSeqs = Array.from(this.lostFrameSequences);
			this.lostFrameSequences.clear();
			const nack = new Nack();
			nack.sequences = nackSeqs;
			this.client.send(nack.serialize());
		}
	}

	private processBatchedOrderedFrames(now: number): void {
		const processedChannels = new Set<number>();

		for (let channel = 0; channel < this.inputOrderingQueue.length; channel++) {
			if (processedChannels.has(channel)) continue;

			const queue = this.inputOrderingQueue[channel];
			let processed = 0;
			let expected = this.inputOrderIndex[channel];

			while (queue.has(expected) && processed < this.BATCH_SIZE) {
				const queued = queue.get(expected);
				if (!queued) {
					expected++;
					continue;
				}
				if (now - queued.timestamp > this.ORDERING_QUEUE_TIMEOUT) {
					this.processFrame(queued.frame);
					queue.delete(expected);
					expected++;
					processed++;
				} else {
					break;
				}
			}

			if (processed > 0) {
				this.inputOrderIndex[channel] = expected;
				processedChannels.add(channel);
			}
		}
	}

	public incomingMessage(payload: Buffer, rinfo: RemoteInfo) {
		let header = payload.readUint8();
		if ((header & PACKET_HEADER_MASK) === PACKET_HEADER_FRAMESET) header = PACKET_HEADER_FRAMESET;

		switch (header) {
			case Packet.Ack: {
				const ack = new Ack(payload).deserialize();
				for (let i = 0, len = ack.sequences.length; i < len; i++) {
					this.outputBackup.delete(ack.sequences[i]);
				}
				break;
			}
			case Packet.Nack: {
				const nack = new Nack(payload).deserialize();
				for (let i = 0, len = nack.sequences.length; i < len; i++) {
					const seq = nack.sequences[i];
					const lostFrames = this.outputBackup.get(seq) || [];
					for (let j = 0, lostLen = lostFrames.length; j < lostLen; j++) {
						this.sendFrame(lostFrames[j], Priority.Immediate);
					}
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
				this.frameAndSend(conReq.serialize(), Priority.Immediate);
				break;
			}
			case PACKET_HEADER_FRAMESET: {
				const frameset = new Frameset(payload).deserialize();
				this.client.emit("frameset", frameset);
				this.handle(frameset);
				break;
			}
			default: {
				Logger.error(`Unknown packet header: ${header}`);
			}
		}
	}

	private processFrame(frame: Frame): void {
		const header = frame.payload[0];
		if (this.client.options.debug) {
			Logger.debug(`[Framer] Processing frame with header ${header}`);
		}

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
					if (!this.client.serverAddress) {
						Logger.error(
							"[Framer] Cannot create NewIncomingConnection: serverAddress is null",
						);
						return;
					}
					newI.serverAddress = this.client.serverAddress;
					newI.incomingTimestamp = BigInt(Date.now());
					newI.serverTimestamp = packet.timestamp;
					this.client.emit("new-incoming-connection", newI);
					this.frameAndSend(newI.serialize(), Priority.Immediate);
					SystemAddress.count = 0;
					break;
				}
				case Packet.DisconnectionNotification: {
					Logger.info(
						"[Framer] Received disconnection notification while connecting",
					);
					this.client.cleanup();
					break;
				}
			}
		} else if (this.client.status === Status.Connected) {
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
				case Packet.ConnectedPong: {
					const packet = new ConnectedPong(frame.payload).deserialize();
					if (this.client.options.debug) {
						Logger.debug(
							`[Framer] Received pong, latency: ${
								Date.now() - Number(packet.pingTime)
							}ms`,
						);
					}
					this.client.emit("connected-pong", packet);
					break;
				}
				case PACKET_ENCAPSULATED: {
					this.client.emit("encapsulated", frame.payload);
					break;
				}
				case Packet.DisconnectionNotification: {
					Logger.info("[Framer] Received disconnection notification");
					this.client.cleanup();
					break;
				}
			}
		}
	}

	public handle(frameSet: Frameset) {
		try {
			if (this.receivedFrameSequences.has(frameSet.sequence)) {
				if (this.client.options.debug) {
					Logger.debug(
						`[Framer] Received duplicate frameset ${frameSet.sequence}`,
					);
				}
				return;
			}
			this.lostFrameSequences.delete(frameSet.sequence);

			if (frameSet.sequence <= this.lastInputSequence) {
				if (this.client.options.debug) {
					Logger.debug(
						`[Framer] Received out of order frameset ${frameSet.sequence}!`,
					);
				}
				return;
			}

			this.receivedFrameSequences.add(frameSet.sequence);
			const sequenceGap = frameSet.sequence - this.lastInputSequence;

			if (sequenceGap > 1) {
				if (this.client.options.debug) {
					Logger.debug(
						`[Framer] Detected ${sequenceGap - 1} missing sequences between ${this.lastInputSequence} and ${frameSet.sequence}`,
					);
				}
				for (
					let index = this.lastInputSequence + 1;
					index < frameSet.sequence;
					index++
				) {
					this.lostFrameSequences.add(index);
				}
			}

			this.lastInputSequence = frameSet.sequence;

			// Process frames in batches
			const frames = frameSet.frames;
			for (let i = 0; i < frames.length; i += this.BATCH_SIZE) {
				const batch = frames.slice(i, i + this.BATCH_SIZE);
				for (const frame of batch) {
					try {
						this.handleFrame(frame);
					} catch (err) {
						Logger.error("[Framer] Error handling frame", err as Error);
					}
				}
			}
		} catch (err) {
			Logger.error("[Framer] Error handling frameset", err as Error);
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
		const channel = frame.orderChannel;
		const expectedOrderIndex = this.inputOrderIndex[channel];

		if (frame.orderedFrameIndex === expectedOrderIndex) {
			this.processOrderedFrames(frame);
		} else if (frame.orderedFrameIndex > expectedOrderIndex) {
			this.inputOrderingQueue[channel].set(frame.orderedFrameIndex, {
				frame,
				timestamp: Date.now(),
			});
		}
	}

	private processOrderedFrames(frame: Frame): void {
		const channel = frame.orderChannel;
		this.inputOrderIndex[channel] = frame.orderedFrameIndex + 1;
		this.inputHighestSequenceIndex[channel] = 0;
		this.processFrame(frame);

		const queue = this.inputOrderingQueue[channel];
		let nextOrderIndex = this.inputOrderIndex[channel];
		while (queue.has(nextOrderIndex)) {
			const queued = queue.get(nextOrderIndex);
			if (!queued) {
				nextOrderIndex++;
				continue;
			}
			this.processFrame(queued.frame);
			queue.delete(nextOrderIndex);
			nextOrderIndex++;
		}
		this.inputOrderIndex[channel] = nextOrderIndex;
	}

	private handleSequenced(frame: Frame): void {
		const channel = frame.orderChannel;
		const currentHighestSequence = this.inputHighestSequenceIndex[channel];

		if (
			frame.sequenceFrameIndex < currentHighestSequence ||
			frame.orderedFrameIndex === this.inputOrderIndex[channel]
		) {
			return;
		}

		this.inputHighestSequenceIndex[channel] = frame.sequenceFrameIndex + 1;
		this.processFrame(frame);
	}

	private handleSplit(frame: Frame): void {
		const splitId = frame.splitId;
		let entry = this.fragmentsQueue.get(splitId);
		if (!entry) {
			entry = { fragments: new Map<number, Frame>(), timestamp: Date.now() };
			this.fragmentsQueue.set(splitId, entry);
		}
		entry.fragments.set(frame.splitFrameIndex, frame);

		if (entry.fragments.size === frame.splitCount) {
			this.reassembleAndProcessFragment(frame, entry.fragments);
			this.fragmentsQueue.delete(splitId);
		}
	}

	private reassembleAndProcessFragment(
		frame: Frame,
		fragment: Map<number, Frame>,
	): void {
		const stream = new BinaryStream();
		for (let index = 0; index < frame.splitCount; index++) {
			const sframe = fragment.get(index);
			if (!sframe) {
				Logger.error(
					`Missing fragment at index ${index} for splitId=${frame.splitId}`,
				);
				return;
			}
			stream.writeBuffer(sframe.payload);
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

	public frameAndSend(
		payload: Buffer,
		priority: Priority = Priority.Normal,
	): void {
		const frame = new Frame();
		frame.orderChannel = 0;
		frame.payload = payload;
		this.sendFrame(frame, priority);
	}

	public sendFrame(frame: Frame, priority: Priority): void {
		const channel = frame.orderChannel;
		if (frame.isSequenced) {
			frame.orderedFrameIndex = this.outputOrderIndex[channel];
			frame.sequenceFrameIndex = this.outputSequenceIndex[channel]++;
		} else if (frame.isOrdered) {
			frame.orderedFrameIndex = this.outputOrderIndex[channel]++;
			this.outputSequenceIndex[channel] = 0;
		}
		const maxSize = this.mtuDiff;
		const payloadSize = frame.payload.byteLength;
		
		if (payloadSize > maxSize) {
			const splitSize = Math.ceil(payloadSize / maxSize);
			const splitId = this.outputSplitIndex++ & 0xffff;
			for (let index = 0; index < payloadSize; index += maxSize) {
				const nframe = this.createSplitFrame(
					frame,
					index,
					maxSize,
					splitId,
					splitSize,
				);
				this.queueFrame(nframe, priority);
			}
		} else {
			if (frame.isReliable) {
				frame.reliableFrameIndex = this.outputReliableIndex++;
			}
			this.queueFrame(frame, priority);
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
		if (originalFrame.isReliable) {
			nframe.reliableFrameIndex = this.outputReliableIndex++;
		}
		nframe.sequenceFrameIndex = originalFrame.sequenceFrameIndex;
		nframe.orderedFrameIndex = originalFrame.orderedFrameIndex;
		nframe.orderChannel = originalFrame.orderChannel;
		nframe.reliability = originalFrame.reliability;
		nframe.payload = originalFrame.payload.subarray(index, index + maxSize);
		nframe.splitFrameIndex = index / maxSize;
		nframe.splitId = splitId;
		nframe.splitCount = splitSize;
		return nframe;
	}

	private queueFrame(frame: Frame, priority: Priority): void {
		const frameLength = frame.getByteLength();
		const totalLength = 4 + this.outputFramesByteLength + frameLength;

		if (
			totalLength > this.mtuDiff ||
			this.outputFrames.length >= this.BATCH_SIZE
		) {
			this.sendQueue(this.outputFrames.length);
			this.lastBatchTime = Date.now();
		}

		this.outputFrames.push(frame);
		this.outputFramesByteLength += frameLength;

		if (priority === Priority.Immediate) {
			this.sendQueue(1);
			this.lastBatchTime = Date.now();
		}
	}

	public sendQueue(amount: number): void {
		if (this.outputFrames.length === 0) return;

		const frameset = new Frameset();
		frameset.sequence = this.outputSequence++;

		// Send in batches if amount is larger than batch size
		const remainingFrames = [...this.outputFrames];
		this.outputFrames = [];

		while (remainingFrames.length > 0) {
			const batchSize = Math.min(this.BATCH_SIZE, remainingFrames.length);
			const framesToSend = remainingFrames.splice(0, batchSize);

			frameset.frames = framesToSend;
			const sentLength = framesToSend.reduce(
				(sum, f) => sum + f.getByteLength(),
				0,
			);
			this.outputFramesByteLength -= sentLength;
			this.outputBackup.set(frameset.sequence, framesToSend);
			this.client.send(frameset.serialize());

			// Increment sequence for next batch if there are more frames
			if (remainingFrames.length > 0) {
				frameset.sequence = this.outputSequence++;
			}
		}
	}
}
