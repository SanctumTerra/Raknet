import {
	Address,
	DGRAM_HEADER_SIZE,
	Frame,
	FrameSet,
	Magic,
	Packet,
	Priority,
	Reliability,
	Status,
} from "@serenityjs/raknet";
import type { Client } from "./client";
import {} from "./packets/open-connection-first-request";
import {
	type OpenConnectionFirstReply,
	ConnectionRequest,
	UnconnectedPong,
	type OpenConnectionSecondReply,
	OpenConnectionSecondRequest,
	UnconnectedPing,
	OpenFirstConnectionRequest,
	type ConnectionRequestAccepted,
	NewIncomingConnection,
} from "./packets";
import { type Advertisement, fromString } from "./types/Advertisement";

class Sender {
	public outputOrderIndex: number[];
	public outputSequenceIndex: number[];
	public outputFrameQueue: FrameSet;
	public mtu: number;
	protected outputSequence = 0;
	protected outputSplitIndex = 0;
	protected outputReliableIndex = 0;
	protected outputFrames = new Set<Frame>();
	public outputBackup = new Map<number, Frame[]>();

	constructor(private readonly client: Client) {
		this.outputOrderIndex = Array(32).fill(0);
		this.outputSequenceIndex = Array(32).fill(0);
		this.outputFrameQueue = new FrameSet();
		this.mtu = client.options.mtu;
		this.outputFrameQueue.frames = [];
		this.client.on("tick", () => this.tick());
	}

	private tick(): void {
		if (
			this.client.status === Status.Disconnecting ||
			this.client.status === Status.Disconnected
		)
			return;
		this.sendQueue(this.outputFrames.size);
	}

	public sendFrame(frame: Frame, priority: Priority): void {
		if (frame.isSequenced()) {
			frame.orderIndex = this.outputOrderIndex[frame.orderChannel];
			frame.sequenceIndex = (this.outputSequenceIndex[
				frame.orderChannel
			] as number)++;
		} else if (frame.isOrdered()) {
			frame.orderIndex = (this.outputOrderIndex[
				frame.orderChannel
			] as number)++;
			this.outputSequenceIndex[frame.orderChannel] = 0;
		}
		const maxSize = this.mtu - 36;
		const splitSize = Math.ceil(frame.payload.byteLength / maxSize);
		if (frame.payload.byteLength > maxSize) {
			this.handleLargePayload(frame, maxSize, splitSize);
		} else {
			if (frame.isReliable()) frame.reliableIndex = this.outputReliableIndex++;
			this.queueFrame(frame, priority);
		}
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
		nframe.reliability = originalFrame.reliability;
		nframe.sequenceIndex = originalFrame.sequenceIndex;
		nframe.orderIndex = originalFrame.orderIndex;
		nframe.orderChannel = originalFrame.orderChannel;
		nframe.payload = originalFrame.payload.subarray(index, index + maxSize);
		nframe.splitIndex = index / maxSize;
		nframe.splitId = splitId;
		nframe.splitSize = splitSize;

		if (nframe.isReliable()) {
			nframe.reliableIndex = this.outputReliableIndex++;
		}

		return nframe;
	}

	private queueFrame(frame: Frame, priority: Priority): void {
		let length = DGRAM_HEADER_SIZE;
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
		const frameset = new FrameSet();
		frameset.sequence = this.outputSequence++;
		frameset.frames = [...this.outputFrames].slice(0, amount);
		this.outputBackup.set(frameset.sequence, frameset.frames);
		for (const frame of frameset.frames) this.outputFrames.delete(frame);
		this.client.send(frameset.serialize());
	}
	public newIncommingConnection(
		payload: Buffer,
		deserialized: ConnectionRequestAccepted | null = null,
	) {
		const packet = new NewIncomingConnection();
		if (deserialized === null) {
			packet.internalAddresses = new Array<Address>(10).fill(
				new Address("0.0.0.0", 0, 4),
			);
			packet.serverAddress = new Address("0.0.0.0", 0, 0);
			packet.incomingTimestamp = BigInt(Date.now());
			packet.serverTimestamp = 0n;
		} else {
			packet.internalAddresses = new Array<Address>(10).fill(
				new Address("0.0.0.0", 0, 4),
			);
			packet.serverAddress = new Address(
				deserialized.address.address,
				deserialized.address.port,
				4,
			);
			packet.incomingTimestamp = BigInt(Date.now());
			packet.serverTimestamp = deserialized.timestamp;
		}
		this.client.sender.frameAndSend(packet.serialize(), Priority.Immediate);
	}

	public connectionRequest() {
		const packet = new ConnectionRequest();
		packet.client = BigInt(this.client.options.guid);
		packet.timestamp = BigInt(Date.now());
		packet.security = false;
		const frame = new Frame();
		frame.reliability = Reliability.Reliable;
		frame.orderChannel = 0;
		frame.payload = packet.serialize();
		this.sendFrame(frame, Priority.Immediate);
	}

	static secondRequest(client: Client, reply1: OpenConnectionFirstReply) {
		const packet = new OpenConnectionSecondRequest();
		packet.magic = new Magic();
		packet.address = new Address(
			client.socket.address().address,
			client.socket.address().port,
			4,
		);
		packet.mtu = client.options.mtu;
		packet.client = reply1.guid;
		client.send(packet.serialize());
	}

	static async ping(client: Client): Promise<Advertisement> {
		return new Promise((resolve, reject) => {
			const ping = new UnconnectedPing();
			ping.magic = new Magic();
			ping.timestamp = BigInt(Date.now());
			ping.client = client.options.guid;
			client.send(ping.serialize());
			const timer = setTimeout(() => {
				reject(
					new Error(`Ping has timed out after ${client.options.timeout}ms.`),
				);
				client.socket.off("message", listener);
				clearTimeout(timer);
			}, client.options.timeout);
			const listener = (packet: Buffer) => {
				if (packet[0] === Packet.UnconnectedPong) {
					client.socket.off("message", listener);
					clearTimeout(timer);
					resolve(
						fromString(new UnconnectedPong(packet).deserialize().message),
					);
				}
			};
			client.socket.on("message", listener);
		});
	}

	static async connect(client: Client): Promise<void> {
		return new Promise((resolve, reject) => {
			const packet = new OpenFirstConnectionRequest();
			packet.magic = new Magic();
			packet.mtu = client.options.mtu;
			packet.protocol = client.options.protocol;
			client.send(packet.serialize());
			const timer = setTimeout(() => {
				reject(
					new Error(
						`Connection request has timed out after ${client.options.timeout}ms.`,
					),
				);
				client.socket.off("message", listener);
				clearTimeout(timer);
			}, client.options.timeout);
			const listener = (packet: Buffer) => {
				if (packet[0] === Packet.Ack) {
					client.socket.off("message", listener);
					clearTimeout(timer);
					resolve();
				}
			};
			client.socket.on("message", listener);
		});
	}
}

export { Sender };
