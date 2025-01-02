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
} from "../proto";
import { Packet } from "../proto";
import { Logger } from "../utils";
import { BinaryStream } from "@serenityjs/binarystream";
import DisconnectionNotification from "../proto/packets/disconnect";

type ConnectionEvents = {
	disconnect: [];
	encapsulated: [Buffer];
};

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
	protected fragmentsQueue: Map<number, Map<number, Frame>> = new Map();
	private inputOrderIndex: number[] = new Array(64).fill(0);
	protected inputOrderingQueue: Map<number, Map<number, Frame>> = new Map();
	private inputHighestSequenceIndex: number[] = new Array(64).fill(0);

	public outputOrderIndex: number[];
	public outputSequenceIndex: number[];
	public outputFrameQueue: Frameset;
	protected outputSequence = 0;
	protected outputSplitIndex = 0;
	protected outputReliableIndex = 0;
	protected outputFrames = new Set<Frame>();
	public outputBackup = new Map<number, Frame[]>();

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

		this.outputFrameQueue = new Frameset();
		this.outputFrameQueue.frames = [];
		this.outputOrderIndex = Array.from<number>({ length: 32 }).fill(0);
		this.outputSequenceIndex = Array.from<number>({ length: 32 }).fill(0);

		for (let index = 0; index < 64; index++) {
			this.inputOrderingQueue.set(index, new Map());
		}
	}

	public tick() {
		if (Date.now() - this.lastUpdate > this.server.options.connectionTimeout) {
			Logger.warn(
				`Connection to ${this.remoteInfo.address}:${this.remoteInfo.port} timed out`,
			);
			this.server.deleteConnection(
				`${this.remoteInfo.address}:${this.remoteInfo.port}`,
			);
		}

		if (this.receivedFrameSequences.size > 0) {
			const ack = new Ack();
			ack.sequences = Array.from(this.receivedFrameSequences).map((seq) => {
				this.receivedFrameSequences.delete(seq);
				return seq;
			});
			this.send(ack.serialize());
		}
		if (this.lostFrameSequences.size > 0) {
			const pk = new Nack();
			pk.sequences = Array.from(this.lostFrameSequences).map((seq) => {
				this.lostFrameSequences.delete(seq);
				return seq;
			});
			this.send(pk.serialize());
		}
		this.sendQueue(this.outputFrames.size);
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
				accepted.systemAddresses = Array.from<Address>({ length: 20 }).fill(
					new Address(this.remoteInfo.address, this.remoteInfo.port, version),
				);
				accepted.timestamp = BigInt(Date.now());
				accepted.systemIndex = 0;
				this.frameAndSend(accepted.serialize(), Priority.Immediate);
				break;
			}
			case Packet.NewIncomingConnection: {
				const packet = new NewIncomingConnection(message).deserialize();

				// Prevents naughty proxies from connecting to the server.
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
				// Delete Connection if the client has disconnected.
				this.server.deleteConnection(
					`${this.remoteInfo.address}:${this.remoteInfo.port}`,
				);
				break;
			}
			case 254: {
				// Basically Encapsulated Packets are used by Minecraft to send and receive stuff (packets not drugs).
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
		let packetId = message[0];
		if ((packetId & 0xf0) === 0x80) packetId = 0x80;
		this.lastUpdate = Date.now();

		switch (packetId) {
			case Packet.FrameSet: {
				const frame = new Frameset(message).deserialize();
				Logger.debug(
					`Received FrameSet from ${this.remoteInfo.address}:${this.remoteInfo.port} with frame ${frame.sequence}`,
				);
				this.handleFrameSet(frame);
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
					const lostFrames = this.outputBackup.get(seq) ?? [];
					for (const lostFrame of lostFrames) {
						this.sendFrame(lostFrame, Priority.Immediate);
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
		if (this.receivedFrameSequences.has(frameset.sequence)) {
			Logger.debug(
				`Received duplicate FrameSet from ${this.remoteInfo.address}:${this.remoteInfo.port} with frame ${frameset.sequence}`,
			);
			return;
		}
		this.lostFrameSequences.delete(frameset.sequence);
		if (frameset.sequence <= this.lastInputSequence) {
			Logger.debug(
				`Received out of order FrameSet from ${this.remoteInfo.address}:${this.remoteInfo.port} with frame ${frameset.sequence}`,
			);
			return;
		}
		this.receivedFrameSequences.add(frameset.sequence);

		if (frameset.sequence - this.lastInputSequence > 1) {
			for (let i = this.lastInputSequence + 1; i < frameset.sequence; i++) {
				this.lostFrameSequences.add(i);
			}
		}
		this.lastInputSequence = frameset.sequence;

		for (const frame of frameset.frames) {
			this.handleFrame(frame);
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
	) {
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

	private handleOrdered(frame: Frame): void {
		const expectedOrderIndex = this.inputOrderIndex[frame.orderChannel];

		if (frame.orderedFrameIndex === expectedOrderIndex) {
			this.processOrderedFrames(frame);
		} else if (frame.orderedFrameIndex > expectedOrderIndex) {
			Logger.debug(`Queuing out-of-order frame: ${frame.orderedFrameIndex}`);
			const unorderedQueue = this.inputOrderingQueue.get(
				frame.orderChannel,
			) as Map<number, Frame>;
			if (!unorderedQueue) return;
			unorderedQueue.set(frame.orderedFrameIndex, frame);
		} else {
			Logger.debug(`Discarding old frame: ${frame.orderedFrameIndex}`);
		}
	}

	private processOrderedFrames(frame: Frame): void {
		this.inputOrderIndex[frame.orderChannel] = frame.orderedFrameIndex + 1;
		this.inputHighestSequenceIndex[frame.orderChannel] = 0;
		this.handlePackets(frame.payload);

		const outOfOrderQueue = this.inputOrderingQueue.get(
			frame.orderChannel,
		) as Map<number, Frame>;
		let nextOrderIndex = this.inputOrderIndex[frame.orderChannel];

		for (; outOfOrderQueue.has(nextOrderIndex); nextOrderIndex++) {
			const nextFrame = outOfOrderQueue.get(nextOrderIndex);
			if (nextFrame) {
				this.handlePackets(nextFrame.payload);
				outOfOrderQueue.delete(nextOrderIndex);
			}
		}

		this.inputOrderingQueue.set(frame.orderChannel, outOfOrderQueue);
		this.inputOrderIndex[frame.orderChannel] = nextOrderIndex;
	}

	private handleSequenced(frame: Frame): void {
		const currentHighestSequence =
			this.inputHighestSequenceIndex[frame.orderChannel];
		Logger.debug(
			`Handling sequenced frame: sequenceFrameIndex=${frame.sequenceFrameIndex}, currentHighest=${currentHighestSequence}`,
		);

		if (
			frame.sequenceFrameIndex < currentHighestSequence ||
			frame.orderedFrameIndex === this.inputOrderIndex[frame.orderChannel]
		) {
			Logger.debug(
				`Discarding old sequenced frame: ${frame.sequenceFrameIndex}`,
			);
			return;
		}

		this.inputHighestSequenceIndex[frame.orderChannel] =
			frame.sequenceFrameIndex + 1;
		this.handlePackets(frame.payload);
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
		const maxSize = this.mtu - 36;
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

		if (length + frame.getByteLength() > this.mtu - 36) {
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
		this.send(frameset.serialize());
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
        const time = this.server.connectionTimes.get(`${this.remoteInfo.address}:${this.remoteInfo.port}`) ?? 0;
        if(type === "ms") return time;
        if(type === "s") return time / 1000;
        if(type === "min") return time / 60000;
        return time;
    }

}

export { Connection };