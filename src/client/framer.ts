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

	private mtuDiff: number;

	constructor(client: Client) {
		this.client = client;
		this.outputFrameQueue = new Frameset();
		this.outputFrameQueue.frames = [];
		this.outputOrderIndex = new Array(32).fill(0);
		this.outputSequenceIndex = new Array(32).fill(0);
		this.mtuDiff = this.client.options.mtuSize - 36;
	}

	public tick() {
		this._tickCount++;
		if (
			this.client.status === Status.Disconnected ||
			this.client.status === Status.Disconnecting
		) {
			if (this.client.options.debug) {
				Logger.debug(
					`[Framer] Skipping tick - client status: ${Status[this.client.status]}`,
				);
			}
			return;
		}

		// Send a ping every 50 ticks.
		if (this._tickCount % 50 === 0) {
			const now = Date.now();
			const ping = new ConnectedPing();
			ping.timestamp = BigInt(now);
			this.frameAndSend(ping.serialize(), Priority.Immediate);
		}

		// Process ACKs.
		if (this.receivedFrameSequences.size > 0) {
			const ackSeqs = Array.from(this.receivedFrameSequences);
			this.receivedFrameSequences.clear();
			if (this.client.options.debug) {
				Logger.debug(`[Framer] Sending ACK for ${ackSeqs.length} sequences`);
			}
			const ack = new Ack();
			ack.sequences = ackSeqs;
			this.client.send(ack.serialize());
		}

		// Process NACKs.
		if (this.lostFrameSequences.size > 0) {
			const nackSeqs = Array.from(this.lostFrameSequences);
			this.lostFrameSequences.clear();
			if (this.client.options.debug) {
				Logger.debug(`[Framer] Sending NACK for ${nackSeqs.length} sequences`);
			}
			const nack = new Nack();
			nack.sequences = nackSeqs;
			this.client.send(nack.serialize());
		}

		if (this.client.options.debug) {
			Logger.debug(
				`[Framer] Queue state - Frames: ${this.outputFrames.length}, Backup: ${this.outputBackup.size}`,
			);
		}
		this.sendQueue(this.outputFrames.length);
	}

	public incommingMessage(payload: Buffer, rinfo: RemoteInfo) {
		let header = payload.readUint8();
		if ((header & 0xf0) === 0x80) header = 0x80;
		if (this.client.options.debug) {
			Logger.debug(
				`[Framer] Received packet ${header} from ${rinfo.address}:${rinfo.port}`,
			);
		}

		switch (header) {
			case Packet.Ack: {
				const ack = new Ack(payload).deserialize();
				if (this.client.options.debug) {
					Logger.debug(
						`[Framer] Processing ACK with ${ack.sequences.length} sequences`,
					);
				}
				for (let i = 0, len = ack.sequences.length; i < len; i++) {
					this.outputBackup.delete(ack.sequences[i]);
				}
				break;
			}
			case Packet.Nack: {
				const nack = new Nack(payload).deserialize();
				if (this.client.options.debug) {
					Logger.debug(
						`[Framer] Processing NACK with ${nack.sequences.length} sequences`,
					);
				}
				for (let i = 0, len = nack.sequences.length; i < len; i++) {
					const seq = nack.sequences[i];
					const lostFrames = this.outputBackup.get(seq) || [];
					if (this.client.options.debug) {
						Logger.debug(
							`[Framer] Resending ${lostFrames.length} lost frames for sequence ${seq}`,
						);
					}
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
				// (Optional) update mtuDiff here if mtuSize can change:
				// this.mtuDiff = this.client.options.mtuSize - 36;
				const conReq = new ConnectionRequest();
				conReq.clientGuid = this.client.options.clientId;
				conReq.timestamp = BigInt(Date.now());
				conReq.useSecurity = false;

				this.client.emit("connection-request", conReq);
				this.frameAndSend(conReq.serialize(), Priority.Immediate);
				break;
			}
			case Packet.FrameSet: {
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
				if (this.client.options.debug) {
					Logger.debug(
						`[Framer] Received duplicate frameset ${frameSet.sequence}`,
					);
				}
				return;
			}
			// Remove from lost sequences if we now received it.
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
			const diff = frameSet.sequence - this.lastInputSequence;

			if (diff > 1) {
				if (this.client.options.debug) {
					Logger.debug(
						`[Framer] Detected ${diff - 1} missing sequences between ${this.lastInputSequence} and ${frameSet.sequence}`,
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

			for (let i = 0, len = frameSet.frames.length; i < len; i++) {
				try {
					this.handleFrame(frameSet.frames[i]);
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
		const channel = frame.orderChannel;
		const expectedOrderIndex = this.inputOrderIndex[channel];

		if (frame.orderedFrameIndex === expectedOrderIndex) {
			this.processOrderedFrames(frame);
		} else if (frame.orderedFrameIndex > expectedOrderIndex) {
			if (this.client.options.debug) {
				Logger.debug(`Queuing out-of-order frame: ${frame.orderedFrameIndex}`);
			}
			this.inputOrderingQueue[channel].set(frame.orderedFrameIndex, frame);
		} else {
			if (this.client.options.debug) {
				Logger.debug(`Discarding old frame: ${frame.orderedFrameIndex}`);
			}
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
			const nextFrame = queue.get(nextOrderIndex);
			if (nextFrame) {
				this.processFrame(nextFrame);
				queue.delete(nextOrderIndex);
			}
			nextOrderIndex++;
		}
		this.inputOrderIndex[channel] = nextOrderIndex;
	}

	private handleSequenced(frame: Frame): void {
		const channel = frame.orderChannel;
		const currentHighestSequence = this.inputHighestSequenceIndex[channel];
		if (this.client.options.debug) {
			Logger.debug(
				`Handling sequenced frame: sequenceFrameIndex=${frame.sequenceFrameIndex}, currentHighest=${currentHighestSequence}`,
			);
		}

		if (
			frame.sequenceFrameIndex < currentHighestSequence ||
			frame.orderedFrameIndex === this.inputOrderIndex[channel]
		) {
			if (this.client.options.debug) {
				Logger.debug(
					`Discarding old sequenced frame: ${frame.sequenceFrameIndex}`,
				);
			}
			return;
		}

		this.inputHighestSequenceIndex[channel] = frame.sequenceFrameIndex + 1;
		this.processFrame(frame);
	}

	private handleSplit(frame: Frame): void {
		const splitId = frame.splitId;
		let fragment = this.fragmentsQueue.get(splitId);
		if (!fragment) {
			fragment = new Map<number, Frame>();
			this.fragmentsQueue.set(splitId, fragment);
		}
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
		for (let index = 0; index < frame.splitCount; index++) {
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
		const channel = frame.orderChannel;
		if (frame.isSequenced) {
			frame.orderedFrameIndex = this.outputOrderIndex[channel];
			frame.sequenceFrameIndex = this.outputSequenceIndex[channel]++;
		} else if (frame.isOrdered) {
			frame.orderedFrameIndex = this.outputOrderIndex[channel]++;
			this.outputSequenceIndex[channel] = 0;
		}
		// Use cached mtuDiff
		const maxSize = this.mtuDiff;
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

		if (totalLength > this.mtuDiff) {
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

		if (this.client.options.debug) {
			Logger.debug(
				`[Framer] Sending queue with ${amount} frames, total queued: ${this.outputFrames.length}`,
			);
		}

		const frameset = new Frameset();
		frameset.sequence = this.outputSequence++;
		const framesToSend = this.outputFrames.splice(0, amount);
		frameset.frames = framesToSend;

		const sentLength = framesToSend.reduce(
			(sum, f) => sum + f.getByteLength(),
			0,
		);
		this.outputFramesByteLength -= sentLength;

		this.outputBackup.set(frameset.sequence, framesToSend);

		if (this.client.options.debug) {
			Logger.debug(
				`[Framer] Frameset sequence: ${frameset.sequence}, remaining in queue: ${this.outputFrames.length}`,
			);
		}

		this.client.send(frameset.serialize());
	}
}
