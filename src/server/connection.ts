import Emitter from "@serenityjs/emitter";
import type { RemoteInfo } from "node:dgram";
import type { Server } from "./server";
import {
	Ack,
	Address,
	ConnectedPing,
	ConnectedPong,
	ConnectionRequest,
	ConnectionRequestAccepted,
	Frame,
	Frameset,
	Nack,
	NewIncomingConnection,
	Priority,
	Reliability,
	Status,
	Packet,
} from "../proto";
import { Logger } from "../utils";
import { BinaryStream } from "@serenityjs/binarystream";
import DisconnectionNotification from "../proto/packets/disconnect";

type ConnectionEvents = {
	disconnect: [];
	encapsulated: [Buffer];
};

interface QueuedFrame {
	frame: Frame;
	timestamp: number;
}

interface FragmentGroup {
	fragments: Map<number, Frame>;
	timestamp: number;
}

class Connection extends Emitter<ConnectionEvents> {
	public readonly server: Server;
	public readonly remoteInfo: RemoteInfo;
	public readonly guid: bigint;
	public readonly mtu: number;

	public status: Status = Status.Disconnected;
	private lastUpdate: number;

	protected readonly receivedFrameSequences = new Set<number>();
	protected readonly lostFrameSequences = new Set<number>();
	protected lastInputSequence = -1;
	protected fragmentsQueue: Map<number, FragmentGroup> = new Map();

	private inputOrderIndex: number[] = new Array(64).fill(0);
	protected inputOrderingQueue: Map<number, Map<number, QueuedFrame>> =
		new Map();
	private inputHighestSequenceIndex: number[] = new Array(64).fill(0);

	public outputOrderIndex: number[];
	public outputSequenceIndex: number[];
	protected outputFrameQueue: Frame[] = [];
	protected outputFramesByteLength = 0;

	protected outputSequence = 0;
	protected outputSplitIndex = 0;
	protected outputReliableIndex = 0;
	public outputBackup = new Map<number, Frame[]>();

	private readonly ORDERING_QUEUE_TIMEOUT = 500;

	constructor(
		server: Server,
		remoteInfo: RemoteInfo,
		guid: bigint,
		mtu: number,
	) {
		super();
		this.server = server;
		this.remoteInfo = remoteInfo;
		this.guid = guid;
		this.mtu = mtu;
		this.lastUpdate = Date.now();
		this.status = Status.Connecting;

		this.outputOrderIndex = new Array(32).fill(0);
		this.outputSequenceIndex = new Array(32).fill(0);

		for (let i = 0; i < 64; i++) {
			this.inputOrderingQueue.set(i, new Map<number, QueuedFrame>());
		}
	}

	public tick() {
		const now = Date.now();

		Logger.debug(
			`[Connection] Time since last update: ${now - this.lastUpdate} ms`,
		);
		if (now - this.lastUpdate > this.server.options.connectionTimeout) {
			Logger.warn(
				`Connection to ${this.remoteInfo.address}:${this.remoteInfo.port} timed out`,
			);
			this.server.deleteConnection(
				`${this.remoteInfo.address}:${this.remoteInfo.port}`,
			);
			return;
		}

		if (this.receivedFrameSequences.size > 0) {
			const ack = new Ack();
			ack.sequences = Array.from(this.receivedFrameSequences);
			this.receivedFrameSequences.clear();
			this.send(ack.serialize());
		}

		if (this.lostFrameSequences.size > 0) {
			const nack = new Nack();
			nack.sequences = Array.from(this.lostFrameSequences);
			this.lostFrameSequences.clear();
			this.send(nack.serialize());
		}

		for (let channel = 0; channel < 64; channel++) {
			const queue = this.inputOrderingQueue.get(channel);
			if (!queue) continue;
			const expectedIndex = this.inputOrderIndex[channel];
			if (queue.has(expectedIndex)) {
				const queued = queue.get(expectedIndex);
				if (queued && now - queued.timestamp > this.ORDERING_QUEUE_TIMEOUT) {
					Logger.warn(
						`[Connection] Timeout waiting for ordered frame ${expectedIndex} on channel ${channel}; processing it to unblock.`,
					);
					this.handlePackets(queued.frame.payload);
					queue.delete(expectedIndex);
					this.inputOrderIndex[channel] = expectedIndex + 1;
				}
			}
		}

		this.sendQueue(this.outputFrameQueue.length);
	}

	private handlePackets(message: Buffer) {
		const packetId = message[0];
		Logger.debug(
			`Received packet ${packetId} from ${this.remoteInfo.address}:${this.remoteInfo.port}`,
		);
		switch (packetId) {
			case Packet.ConnectionRequest: {
				const connectionRequest = new ConnectionRequest(message).deserialize();
				Logger.debug(
					`Received ConnectionRequest from ${this.remoteInfo.address}:${this.remoteInfo.port}`,
				);
				const accepted = new ConnectionRequestAccepted();
				const version = this.remoteInfo.address.includes(":") ? 6 : 4;
				accepted.address = new Address(
					this.remoteInfo.address,
					this.remoteInfo.port,
					version,
				);
				accepted.requestTimestamp = connectionRequest.timestamp;
				accepted.systemAddresses = new Array<Address>(20).fill(
					new Address(this.remoteInfo.address, this.remoteInfo.port, version),
				);
				accepted.timestamp = BigInt(Date.now());
				accepted.systemIndex = 0;
				this.frameAndSend(accepted.serialize(), Priority.Immediate);
				break;
			}
			case Packet.NewIncomingConnection: {
				const packet = new NewIncomingConnection(message).deserialize();
				if (packet.serverAddress.port !== this.server.options.port) {
					this.disconnect();
					return;
				}
				this.status = Status.Connected;
				const startTime = this.server.connectionTimes.get(
					`${this.remoteInfo.address}:${this.remoteInfo.port}`,
				);
				if (startTime) {
					const latency = Date.now() - startTime;
					this.server.connectionTimes.set(
						`${this.remoteInfo.address}:${this.remoteInfo.port}`,
						latency,
					);
				}
				this.server.emit("connect", this);
				break;
			}
			case Packet.ConnectedPing: {
				const connectedPing = new ConnectedPing(message).deserialize();
				const pong = new ConnectedPong();
				pong.pongTime = BigInt(Date.now());
				pong.pingTime = connectedPing.timestamp;
				this.frameAndSend(pong.serialize(), Priority.Immediate);
				break;
			}
			case Packet.DisconnectionNotification: {
				this.emit("disconnect");
				this.server.deleteConnection(
					`${this.remoteInfo.address}:${this.remoteInfo.port}`,
				);
				break;
			}
			case 254: {
				this.server.emit("encapsulated", message, this);
				this.emit("encapsulated", message);
				break;
			}
			default: {
				Logger.warn(
					`Received unknown packet ${packetId} from ${this.remoteInfo.address}:${this.remoteInfo.port}`,
				);
				break;
			}
		}
	}

	public handle(message: Buffer) {
		if (this.status === Status.Disconnected) return;
		this.lastUpdate = Date.now();

		let packetId = message[0];
		if ((packetId & 0xf0) === 0x80) packetId = 0x80;

		switch (packetId) {
			case Packet.FrameSet: {
				const frameset = new Frameset(message).deserialize();
				Logger.debug(
					`Received FrameSet from ${this.remoteInfo.address}:${this.remoteInfo.port} with sequence ${frameset.sequence}`,
				);
				this.handleFrameSet(frameset);
				break;
			}
			case Packet.Ack: {
				const ack = new Ack(message).deserialize();
				for (const seq of ack.sequences) {
					this.outputBackup.delete(seq);
				}
				break;
			}
			case Packet.Nack: {
				const nack = new Nack(message).deserialize();
				for (const seq of nack.sequences) {
					const lostFrames = this.outputBackup.get(seq);
					if (lostFrames && lostFrames.length > 0) {
						for (const lostFrame of lostFrames) {
							this.sendFrame(lostFrame, Priority.Immediate);
						}
					}
				}
				break;
			}
			default: {
				Logger.warn(
					`Received unknown packet ${packetId} from ${this.remoteInfo.address}:${this.remoteInfo.port}`,
				);
				break;
			}
		}
	}

	private handleFrameSet(frameset: Frameset) {
		const sequence = frameset.sequence;
		if (
			sequence <= this.lastInputSequence ||
			this.receivedFrameSequences.has(sequence)
		) {
			Logger.debug(
				`Skipping FrameSet from ${this.remoteInfo.address}:${this.remoteInfo.port} - sequence ${sequence} (duplicate/old)`,
			);
			return;
		}
		this.lostFrameSequences.delete(sequence);

		if (
			frameset.sequence < this.lastInputSequence ||
			frameset.sequence === this.lastInputSequence
		) {
			Logger.debug(
				`Out of order Frameset from ${this.remoteInfo.address}:${this.remoteInfo.port}`,
			);
			return;
		}

		this.receivedFrameSequences.add(sequence);

		if (frameset.sequence - this.lastInputSequence > 1) {
			for (
				let index = this.lastInputSequence + 1;
				index < frameset.sequence;
				index++
			)
				this.lostFrameSequences.add(index);
		}

		this.lastInputSequence = sequence;

		for (let i = 0, len = frameset.frames.length; i < len; i++) {
			this.handleFrame(frameset.frames[i]);
		}
	}

	private handleFrame(frame: Frame) {
		if (frame.isSplit) {
			this.handleSplit(frame);
		} else if (frame.isSequenced) {
			this.handleSequenced(frame);
		} else if (frame.isOrdered) {
			this.handleOrdered(frame);
		} else {
			this.handlePackets(frame.payload);
		}
	}

	private handleSplit(frame: Frame) {
		const splitId = frame.splitId;
		let group = this.fragmentsQueue.get(splitId);
		if (!group) {
			group = { fragments: new Map<number, Frame>(), timestamp: Date.now() };
			this.fragmentsQueue.set(splitId, group);
		}
		group.fragments.set(frame.splitFrameIndex, frame);

		if (group.fragments.size === frame.splitCount) {
			let totalSize = 0;
			for (let i = 0; i < frame.splitCount; i++) {
				const sframe = group.fragments.get(i);
				if (!sframe) {
					Logger.error(`Missing fragment at index ${i} for splitId=${splitId}`);
					return;
				}
				totalSize += sframe.payload.length;
			}

			const buffer = Buffer.allocUnsafe(totalSize);
			let offset = 0;
			for (let i = 0; i < frame.splitCount; i++) {
				const sframe = group.fragments.get(i);
				if (sframe) {
					sframe.payload.copy(buffer, offset);
					offset += sframe.payload.length;
				}
			}

			const reassembledFrame = new Frame();
			reassembledFrame.reliability = frame.reliability;
			reassembledFrame.reliableFrameIndex = frame.reliableFrameIndex;
			reassembledFrame.sequenceFrameIndex = frame.sequenceFrameIndex;
			reassembledFrame.orderedFrameIndex = frame.orderedFrameIndex;
			reassembledFrame.orderChannel = frame.orderChannel;
			reassembledFrame.payload = buffer;

			this.fragmentsQueue.delete(splitId);
			this.handleFrame(reassembledFrame);
		}
	}

	private handleOrdered(frame: Frame): void {
		const channel = frame.orderChannel;
		const expectedIndex = this.inputOrderIndex[channel];
		const frameIndex = frame.orderedFrameIndex;

		if (frameIndex === expectedIndex) {
			this.handlePackets(frame.payload);
			this.inputOrderIndex[channel] = frameIndex + 1;
			this.inputHighestSequenceIndex[channel] = 0;

			const queue = this.inputOrderingQueue.get(channel);
			if (queue) {
				let nextIndex = frameIndex + 1;
				while (queue.has(nextIndex)) {
					const queued = queue.get(nextIndex);
					if (queued) {
						this.handlePackets(queued.frame.payload);
						queue.delete(nextIndex);
						nextIndex++;
					}
				}
				this.inputOrderIndex[channel] = nextIndex;
			}
		} else if (frameIndex > expectedIndex) {
			const queue = this.inputOrderingQueue.get(channel);
			if (queue) {
				queue.set(frameIndex, { frame, timestamp: Date.now() });
			}
		}
	}

	private handleSequenced(frame: Frame): void {
		const channel = frame.orderChannel;
		const newSequence = frame.sequenceFrameIndex;
		const currentHighest = this.inputHighestSequenceIndex[channel];
		if (
			newSequence >= currentHighest &&
			frame.orderedFrameIndex >= this.inputOrderIndex[channel]
		) {
			this.inputHighestSequenceIndex[channel] = newSequence + 1;
			this.handlePackets(frame.payload);
		}
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
		const payloadSize = frame.payload.byteLength;
		const maxSize = this.mtu - 36;
		if (payloadSize > maxSize) {
			const splitSize = Math.ceil(payloadSize / maxSize);
			this.handleLargePayload(frame, maxSize, splitSize);
			return;
		}
		if (frame.isReliable) {
			frame.reliableFrameIndex = this.outputReliableIndex++;
		}
		this.queueFrame(frame, priority);
	}

	private handleLargePayload(
		frame: Frame,
		maxSize: number,
		splitSize: number,
	): void {
		const splitId = this.outputSplitIndex++ % 65536;
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
		return nframe;
	}

	private queueFrame(frame: Frame, priority: Priority): void {
		const frameLength = frame.getByteLength();
		Logger.debug(
			`[Connection] Queueing frame (length=${frameLength}). Queue count before push: ${this.outputFrameQueue.length}.`,
		);
		this.outputFrameQueue.push(frame);
		this.outputFramesByteLength += frameLength;

		if (priority === Priority.Immediate) {
			Logger.debug(
				"[Connection] Immediate frame queued. Flushing output queue.",
			);
			this.sendQueue(this.outputFrameQueue.length);
		}
	}

	public sendQueue(amount: number): void {
		if (this.outputFrameQueue.length === 0) return;
		Logger.debug(
			`[Connection] Flushing output queue: sending ${amount} frame(s), total bytes = ${this.outputFramesByteLength}.`,
		);
		const frameset = new Frameset();
		frameset.sequence = this.outputSequence++;
		const framesToSend = this.outputFrameQueue.splice(0, amount);
		let sentLength = 0;
		for (const frame of framesToSend) {
			sentLength += frame.getByteLength();
		}
		this.outputFramesByteLength -= sentLength;
		frameset.frames = framesToSend;
		this.outputBackup.set(frameset.sequence, frameset.frames);
		const serialized = frameset.serialize();
		Logger.debug(
			`[Connection] Sending frameset sequence ${frameset.sequence}, serialized length = ${serialized.byteLength}.`,
		);
		this.send(serialized);
	}

	public frameAndSend(
		payload: Buffer | BinaryStream,
		priority: Priority,
	): void {
		const frame = new Frame();
		frame.payload =
			payload instanceof BinaryStream ? payload.getBuffer() : payload;
		frame.reliability = Reliability.ReliableOrdered;
		frame.orderChannel = 0;
		this.sendFrame(frame, priority);
	}

	public send(message: Buffer) {
		this.server.send(message, this.remoteInfo);
	}

	public disconnect(timeout = true): void {
		const disconnect = new DisconnectionNotification();
		this.frameAndSend(disconnect.serialize(), Priority.Immediate);
		this.status = Status.Disconnected;
		if (timeout) {
			setTimeout(() => {
				this.server.deleteConnection(
					`${this.remoteInfo.address}:${this.remoteInfo.port}`,
				);
			}, 1000);
		}
	}

	public getConnectionTime(type: "ms" | "s" | "min" = "ms"): number {
		const time =
			this.server.connectionTimes.get(
				`${this.remoteInfo.address}:${this.remoteInfo.port}`,
			) ?? 0;
		if (type === "ms") return time;
		if (type === "s") return time / 1000;
		if (type === "min") return time / 60000;
		return time;
	}

	public getAddress(): Address {
		return Address.fromIdentifier(this.remoteInfo);
	}
}

export { Connection };
