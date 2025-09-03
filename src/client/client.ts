import {
	ConnectionStatus,
	EventEmitter,
	Packets,
	UnconnectedPing,
	UnconnectedPong,
	OpenConnectionReplyOne,
	OpenConnectionRequestOne,
	Address,
	OpenConnectionRequestTwo,
	OpenConnectionReplyTwo,
	NetworkSession,
	ConnectionRequest,
	Priority,
	FrameSet,
	ConnectionRequestAccepted,
	NewIncomingConnection,
	type Frame,
	ConnectedPing,
	ConnectedPong,
	Ack,
} from "../shared";
import type { ClientEvents } from "./types";
import {
	type ClientOptions,
	defaultClientOptions,
} from "./types/client-options";
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import { Logger } from "../shared";

export class Client extends EventEmitter<ClientEvents> {
	public options: ClientOptions;
	private socket: Socket;
	private interval: NodeJS.Timeout | null;
	private status: ConnectionStatus;
	public tick: number;
	private session: NetworkSession;

	constructor(options: Partial<ClientOptions> = {}) {
		super();
		this.options = { ...defaultClientOptions, ...options };
		this.status = ConnectionStatus.Disconnected;
		this.tick = 0;
		this.socket = createSocket("udp4");
		this.socket.bind();
		this.interval = setInterval(
			this.onTick.bind(this),
			1000 / this.options.tickRate,
		);
		this.socket.on("message", this.onMessage.bind(this));
		this.session = new NetworkSession(this.options.mtu);
		this.session.send = this.send.bind(this);
		this.session.handle = (data: Buffer) => {
			this.handleOnline(data);
		};
	}

	public connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.status = ConnectionStatus.Connecting;
			const request = new OpenConnectionRequestOne();
			request.mtu = this.options.mtu;
			request.protocol = 11; // Only 11 is supported
			const serialized = request.serialize();
			this.send(serialized);
			const timeout = setTimeout(() => {
				reject(new Error("Connection timed out"));
			}, this.options.timeout);
			this.once("connect", () => {
				clearTimeout(timeout);
				resolve();
			});
		});
	}

	public onTick(): void {
		const isDisconnected = this.status === ConnectionStatus.Disconnected;
		const isDisconnecting = this.status === ConnectionStatus.Disconnecting;

		const canPing = isDisconnected && this.tick % this.options.pingRate === 0;
		if (canPing) this.ping();
		if (!isDisconnecting || !isDisconnected) {
			this.session.onTick(this.tick);
		}
		this.tick++;
	}

	public onMessage(data: Buffer, rinfo: RemoteInfo): void {
		let id = data[0];
		const isOnline = (id & 0xf0) === 0x80;
		if (isOnline) id = 0x80;

		switch (id) {
			case Packets.UnconnectedPong: {
				const pong = new UnconnectedPong(data).deserialize();
				this.emit("unconnectedPong", pong);
				break;
			}
			case Packets.OpenConnectionReply1: {
				const reply = new OpenConnectionReplyOne(data).deserialize();
				const request = new OpenConnectionRequestTwo();
				request.address = Address.fromIdentifier(rinfo);
				request.mtu = reply.mtu;
				request.guid = this.options.guid;
				this.send(request.serialize());
				break;
			}
			case Packets.OpenConnectionReply2: {
				const reply = new OpenConnectionReplyTwo(data).deserialize();
				const request = new ConnectionRequest();
				request.guid = this.options.guid;
				request.timestamp = BigInt(Date.now());
				const serialized = request.serialize();
				this.frameAndSend(serialized, Priority.High);

				break;
			}
			case Packets.FrameSet: {
				const frameSet = new FrameSet(data).deserialize();
				this.session.onFrameSet(frameSet);
				break;
			}
			case Packets.Ack: {
				const ack = new Ack(data).deserialize();
				this.session.onAck(ack);
				break;
			}
			case Packets.Nack: {
				const nack = new Ack(data).deserialize();
				this.session.onNack(nack);
				break;
			}

			default: {
				Logger.warn(`Unknown packet type: ${id}`);
				break;
			}
		}
	}

	public handleOnline(data: Buffer) {
		const id = data[0];
		switch (id) {
			case 254: {
				this.emit("encapsulated", data);
				break;
			}
			case Packets.ConnectedPong: {
				break;
			}
			case Packets.ConnectedPing: {
				const ping = new ConnectedPing(data).deserialize();
				const pong = new ConnectedPong();
				pong.pingTimestamp = ping.timestamp;
				pong.pongTimestamp = BigInt(Date.now());
				this.frameAndSend(ping.serialize(), Priority.High);
				break;
			}
			case Packets.ConnectionRequestAccepted: {
				const accepted = new ConnectionRequestAccepted(data).deserialize();
				const nic = new NewIncomingConnection();
				nic.address = new Address(
					this.socket.address().address,
					this.socket.address().port,
					this.socket.address().family === "IPv4" ? 4 : 6,
				);
				nic.internalAddress = new Address("127.0.0.1", 0, 4);
				nic.incomingTimestamp = BigInt(Date.now());
				nic.serverTimestamp = accepted.timestamp;
				this.frameAndSend(nic.serialize(), Priority.High);
				this.emit("connect");
				break;
			}
			default: {
				Logger.warn(`Unknown packet type: ${id}`);
				break;
			}
		}
	}

	public sendFrame(frame: Frame, priority: Priority = Priority.Medium) {
		this.session.sendFrame(frame, priority);
	}

	public frameAndSend(data: Buffer, priority: Priority = Priority.Medium) {
		this.session.frameAndSend(data, priority);
	}

	public ping(): void {
		const ping = new UnconnectedPing();
		ping.guid = this.options.guid;
		ping.timestamp = BigInt(Date.now());
		const serialized = ping.serialize();
		this.send(serialized);
	}

	public send(data: Buffer): void {
		this.socket.send(data, this.options.port, this.options.address);
	}

	public disconnect(): void {
		this.socket.close();
		if (this.interval) clearInterval(this.interval);
	}
}
