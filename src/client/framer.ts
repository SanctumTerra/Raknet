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
import DisconnectionNotification from "../proto/packets/disconnect";

export class Framer {
	private client: Client;
	private lastInputSequence = -1;
	private receivedFrameSequences: Set<number> = new Set();
	private lostFrameSequences: Set<number> = new Set();
	private inputHighestSequenceIndex: number[] = new Array(64).fill(0);
	private inputOrderIndex: number[] = new Array(64).fill(0);
	protected inputOrderingQueue: Array<Map<number, Frame>> = Array.from(
		{ length: 64 },
		() => new Map(),
	);
	protected readonly fragmentsQueue: Map<number, Map<number, Frame>> =
		new Map();

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

	constructor(client: Client) {
		this.client = client;
		this.outputFrameQueue = new Frameset();
		this.outputFrameQueue.frames = [];
		this.outputOrderIndex = Array.from<number>({ length: 32 }).fill(0);
		this.outputSequenceIndex = Array.from<number>({ length: 32 }).fill(0);
	}

	public tick() {
		this._tickCount++;
		if (
			this.client.status === Status.Disconnected ||
			this.client.status === Status.Disconnecting
		) {
			Logger.debug(
				`[Framer] Skipping tick - client status: ${Status[this.client.status]}`,
			);
			return;
		}

		if (this._tickCount % 50 === 0) {
			const now = Date.now();
			const ping = new ConnectedPing();
			ping.timestamp = BigInt(now);
			this.frameAndSend(ping.serialize(), Priority.Immediate);
		}

		const ackSeqs = this.receivedFrameSequences;
		if (ackSeqs.size > 0) {
			this.receivedFrameSequences = new Set();
			Logger.debug(`[Framer] Sending ACK for ${ackSeqs.size} sequences`);
			const ack = new Ack();
			ack.sequences = Array.from(ackSeqs);
			this.client.send(ack.serialize());
		}

		const nackSeqs = this.lostFrameSequences;
		if (nackSeqs.size > 0) {
			this.lostFrameSequences = new Set();
			Logger.debug(`[Framer] Sending NACK for ${nackSeqs.size} sequences`);
			const pk = new Nack();
			pk.sequences = Array.from(nackSeqs);
			this.client.send(pk.serialize());
		}

		Logger.debug(
			`[Framer] Queue state - Frames: ${this.outputFrames.length}, Backup: ${this.outputBackup.size}`,
		);
		this.sendQueue(this.outputFrames.length);
	}

	public incommingMessage(payload: Buffer, rinfo: RemoteInfo) {
		let header = payload.readUint8();
		if ((header & 0xf0) === 0x80) header = 0x80;
		Logger.debug(
			`[Framer] Received packet ${header} from ${rinfo.address}:${rinfo.port}`,
		);

		switch (header) {
			case Packet.Ack: {
				const ack = new Ack(payload).deserialize();
				Logger.debug(
					`[Framer] Processing ACK with ${ack.sequences.length} sequences`,
				);
				for (const seq of ack.sequences) {
					this.outputBackup.delete(seq);
				}
				break;
			}
			case Packet.Nack: {
				const nack = new Nack(payload).deserialize();
				Logger.debug(
					`[Framer] Processing NACK with ${nack.sequences.length} sequences`,
				);
				for (const seq of nack.sequences) {
					const lostFrames = this.outputBackup.get(seq) ?? [];
					Logger.debug(
						`[Framer] Resending ${lostFrames.length} lost frames for sequence ${seq}`,
					);
					for (const lostFrame of lostFrames) {
						this.sendFrame(lostFrame, Priority.Immediate);
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
				this.client.framer.frameAndSend(conReq.serialize(), Priority.Immediate);
				break;
			}
			case Packet.FrameSet: {
				const frameset = new Frameset(payload).deserialize();
				this.client.emit("frameset", frameset);
				this.client.framer.handle(frameset);
				break;
			}
			default: {
				Logger.error(`Unknown packet header: ${header}`);
			}
		}
	}

	private processFrame(frame: Frame): void {
		const header = frame.payload[0] as number;
		Logger.debug(`[Framer] Processing frame with header ${header}`);

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
				case Packet.DisconnectionNotification: {
					Logger.info(
						"[Framer] Received disconnection notification while connecting",
					);
					this.client.cleanup();
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
				case Packet.ConnectedPong: {
					const packet = new ConnectedPong(frame.payload).deserialize();
					Logger.debug(
						`[Framer] Received pong, latency: ${
							Date.now() - Number(packet.pingTime)
						}ms`,
					);
					this.client.emit("connected-pong", packet);
					break;
				}
				case 0xfe: {
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
				Logger.debug(
					`[Framer] Received duplicate frameset ${frameSet.sequence}`,
				);
				return;
			}
			this.lostFrameSequences.delete(frameSet.sequence);

			if (
				frameSet.sequence < this.lastInputSequence ||
				frameSet.sequence === this.lastInputSequence
			) {
				Logger.debug(
					`[Framer] Received out of order frameset ${frameSet.sequence}!`,
				);
				return;
			}

			this.receivedFrameSequences.add(frameSet.sequence);
			const diff = frameSet.sequence - this.lastInputSequence;

			if (diff > 1) {
				Logger.debug(
					`[Framer] Detected ${diff - 1} missing sequences between ${
						this.lastInputSequence
					} and ${frameSet.sequence}`,
				);
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
					Logger.error("[Framer] Error handling frame", err as Error);
				}
			}
		} catch (err) {
			Logger.error("[Framer] Error handling frameset", err as Error);
		}
	}

	private handleFrame(frame: Frame): void {
		if (this.client.options.debug) {
			Logger.debug(
				`[Framer] Handling frame - Split: ${frame.isSplit}, Sequenced: ${frame.isSequenced}, Ordered: ${frame.isOrdered}`,
			);
		}

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
			const unorderedQueue = this.inputOrderingQueue[frame.orderChannel];
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

		const outOfOrderQueue = this.inputOrderingQueue[frame.orderChannel];
		let nextOrderIndex = this.inputOrderIndex[frame.orderChannel];

		for (; outOfOrderQueue.has(nextOrderIndex); nextOrderIndex++) {
			const nextFrame = outOfOrderQueue.get(nextOrderIndex);
			if (nextFrame) {
				this.processFrame(nextFrame);
				outOfOrderQueue.delete(nextOrderIndex);
			}
		}

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
			const splitId = this.outputSplitIndex++ & 0xffff;
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
		} else {
			if (frame.isReliable)
				frame.reliableFrameIndex = this.outputReliableIndex++;
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
		const frameLength = frame.getByteLength();
		const totalLength = 4 + this.outputFramesByteLength + frameLength;

		if (totalLength > this.client.options.mtuSize - 36) {
			this.sendQueue(this.outputFrames.length);
		}

		this.outputFrames.push(frame);
		this.outputFramesByteLength += frameLength;

		if (priority === Priority.Immediate) {
			this.sendQueue(1);
		}
	}

	public sendQueue(amount: number): void {
		if (this.outputFrames.length === 0) return;

		Logger.debug(
			`[Framer] Sending queue with ${amount} frames, total queued: ${this.outputFrames.length}`,
		);

		const frameset = new Frameset();
		frameset.sequence = this.outputSequence++;
		const framesToSend = this.outputFrames.slice(0, amount);
		frameset.frames = framesToSend;

		this.outputFrames = this.outputFrames.slice(amount);
		const sentLength = framesToSend.reduce(
			(sum, f) => sum + f.getByteLength(),
			0,
		);
		this.outputFramesByteLength -= sentLength;

		this.outputBackup.set(frameset.sequence, framesToSend);

		Logger.debug(
			`[Framer] Frameset sequence: ${frameset.sequence}, remaining in queue: ${this.outputFrames.length}`,
		);

		this.client.send(frameset.serialize());
	}
}
