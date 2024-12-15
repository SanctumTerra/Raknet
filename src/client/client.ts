import { Emitter } from "@serenityjs/emitter";
import type { ClientEvents } from "./client-events";
import { type RemoteInfo, type Socket, createSocket } from "node:dgram";
import { Framer } from "./framer";
import {
	Ack,
	Address,
	type Advertisement,
	ConnectionRequest,
	type Frame,
	fromString,
	OpenConnectionReplyOne,
	OpenConnectionReplyTwo,
	OpenConnectionRequestOne,
	OpenConnectionRequestTwo,
	Packet,
	Priority,
	UnconnectedPing,
	UnconnectedPong,
} from "../proto";
import { type ClientOptions, defaultClientOptions } from "./client-options";
import { Logger } from "../utils";
import { Frameset } from "../proto/packets/frameset";
import { measureExecutionTime, optimizeConnection } from "../utils/decorators";

export class Client extends Emitter<ClientEvents> {
	public socket!: Socket;
	public framer!: Framer;
	public options: ClientOptions;
	private timer!: NodeJS.Timeout;
	private timeout!: NodeJS.Timeout;
	public serverAddress!: Address;
	private isConnecting = false;
	private packetHandlers: Map<number, (msg: Buffer, rinfo: RemoteInfo) => void>;
	private fastPathPackets = new Set([
		Packet.Ack,
		Packet.Nack,
		Packet.ConnectedPing,
		Packet.ConnectedPong,
	]);

	constructor(options: Partial<ClientOptions> = defaultClientOptions) {
		super();
		this.options = { ...defaultClientOptions, ...options };
		this.maxListeners = 20;
		this.packetHandlers = new Map([
			[Packet.Ack, this.handleAck.bind(this)],
			[Packet.UnconnectedPong, this.handleUnconnectedPong.bind(this)],
			[
				Packet.OpenConnectionReplyOne,
				this.handleOpenConnectionReplyOne.bind(this),
			],
			[
				Packet.OpenConnectionReplyTwo,
				this.handleOpenConnectionReplyTwo.bind(this),
			],
			[Packet.FrameSet, this.handleFrameSet.bind(this)],
		]);
	}

	public initSocket() {
		try {
			this.socket = createSocket("udp4");
			this.framer = new Framer(this);
			this.remove("tick", () => this.framer.tick());
			this.on("tick", () => this.framer.tick());
			this.socket.removeAllListeners("message");
			this.socket.on("message", this.onMessage.bind(this));
		} catch (error) {
			Logger.error(`Failed to create socket: ${error}`);
		}
	}

	public async ping(): Promise<Advertisement | null> {
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.removeAll("unconnected-pong");
				reject(new Error("Ping timed out"));
			}, this.options.initialConnectionTimeout);

			const sendPing = () => {
				const unconnectedPing = new UnconnectedPing();
				unconnectedPing.guid = this.options.clientId;
				unconnectedPing.clientTimestamp = BigInt(Date.now());
				this.send(unconnectedPing.serialize());
			};

			sendPing();
			const pingInterval = setInterval(sendPing, 50);

			this.once("unconnected-pong", (packet) => {
				clearTimeout(timeoutId);
				clearInterval(pingInterval);
				resolve(fromString(packet.message));
			});
		});
	}

	@measureExecutionTime
	@optimizeConnection
	public async connect(): Promise<Advertisement> {
		if (this.isConnecting)
			throw new Error("Connection attempt already in progress");

		try {
			this.isConnecting = true;
			this.initSocket();
			const [advertisement] = await Promise.all([
				this.ping(),
				this.setupConnection(),
			]);
			if (!advertisement) throw new Error("Failed to get server advertisement");
			return advertisement;
		} catch (error) {
			this.isConnecting = false;
			throw error;
		}
	}

	private async setupConnection(): Promise<void> {
		this.timer = setInterval(
			() => this.emit("tick"),
			this.options.tickInterval,
		);
		const request = new OpenConnectionRequestOne();
		request.mtu = this.options.mtuSize;
		request.protocol = this.options.protocolVersion;

		return new Promise((resolve, reject) => {
			let connectionAttempts = 0;
			const maxAttempts = 3;
			let isResolved = false;
			let timeoutId: NodeJS.Timeout;

			const cleanup = () => {
				clearTimeout(timeoutId);
				this.removeAll("open-connection-reply-one");
				this.removeAll("new-incoming-connection");
			};

			const attemptConnection = () => {
				if (isResolved) return;
				if (connectionAttempts >= maxAttempts) {
					cleanup();
					reject(new Error("Connection timed out"));
					return;
				}

				connectionAttempts++;
				this.emit("open-connection-request-one", request);
				this.send(request.serialize());

				const delay =
					connectionAttempts === 1
						? 50
						: Math.min(75 * 1.5 ** (connectionAttempts - 1), 200);
				timeoutId = setTimeout(attemptConnection, delay);
			};

			// biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
			this.once("open-connection-reply-one", () => (connectionAttempts = 0));

			this.onceAfter("new-incoming-connection", () => {
				if (!isResolved) {
					isResolved = true;
					cleanup();
					this.emit("connect");
					this.isConnecting = false;
					resolve();
				}
			});

			attemptConnection();
		});
	}

	public sendFrame(frame: Frame, priority: Priority): void {
		this.framer.sendFrame(frame, priority);
	}

	public send(buffer: Buffer) {
		if (this.options.debug) {
			Logger.debug(
				`Sending ${buffer[0]}, ${buffer.length} bytes to ${this.options.address}:${this.options.port}`,
			);
		}
		this.socket.send(
			buffer,
			0,
			buffer.length,
			this.options.port,
			this.options.address,
		);
	}

	private onMessage(msg: Buffer, rinfo: RemoteInfo) {
		try {
			const packetId = (msg[0] & 0xf0) === 0x80 ? 0x80 : msg[0];

			if (this.fastPathPackets.has(packetId)) {
				this.packetHandlers.get(packetId)?.(msg, rinfo);
				return;
			}

			const handler = this.packetHandlers.get(packetId);
			if (handler) {
				handler(msg, rinfo);
				return;
			}

			if (this.options.debug) {
				Logger.debug(
					`Unhandled packet ${packetId} from ${rinfo.address}:${rinfo.port}`,
				);
			}
		} catch (error) {
			Logger.error("Failed to handle packet", { error: error as Error });
		}
	}

	private cleanup(): void {
		this.removeAll();
		this.socket.removeAllListeners();
		this.socket.close();
		clearInterval(this.timer);
		clearTimeout(this.timeout);
		this.isConnecting = false;
	}

	private handleAck(msg: Buffer, _rinfo: RemoteInfo): void {
		this.emit("ack", new Ack(msg).deserialize());
	}

	private handleUnconnectedPong(msg: Buffer, _rinfo: RemoteInfo): void {
		this.emit("unconnected-pong", new UnconnectedPong(msg).deserialize());
	}

	private handleOpenConnectionReplyOne(msg: Buffer, rinfo: RemoteInfo): void {
		const packet = new OpenConnectionReplyOne(msg).deserialize();
		this.emit("open-connection-reply-one", packet);
		this.serverAddress = new Address(
			rinfo.address,
			rinfo.port,
			rinfo.family === "IPv4" ? 4 : 6,
		);

		const request = new OpenConnectionRequestTwo();
		request.mtu = packet.mtu;
		request.address = this.serverAddress;
		request.clientGuid = this.options.clientId;

		this.emit("open-connection-request-two", request);
		this.send(request.serialize());
	}

	private handleOpenConnectionReplyTwo(msg: Buffer, _rinfo: RemoteInfo): void {
		const packet = new OpenConnectionReplyTwo(msg).deserialize();
		this.emit("open-connection-reply-two", packet);
		this.options.mtuSize = packet.mtu;

		const conReq = new ConnectionRequest();
		conReq.clientGuid = this.options.clientId;
		conReq.timestamp = BigInt(Date.now());
		conReq.useSecurity = false;

		let connectionAttempts = 0;
		let lastAttemptTime = 0;

		this.emit("connection-request", conReq);
		this.framer.frameAndSend(conReq.serialize(), Priority.Immediate);
		lastAttemptTime = Date.now();

		const connectionInterval = setInterval(() => {
			const now = Date.now();
			if (now - lastAttemptTime < 100) return;

			if (connectionAttempts >= 3) {
				clearInterval(connectionInterval);
				this.cleanup();
				this.emit("error", new Error("Connection request timed out"));
				return;
			}

			lastAttemptTime = now;
			connectionAttempts++;
			this.emit("connection-request", conReq);
			this.framer.frameAndSend(conReq.serialize(), Priority.Immediate);
		}, 100);

		this.once("new-incoming-connection", () =>
			clearInterval(connectionInterval),
		);
	}

	private handleFrameSet(msg: Buffer, _rinfo: RemoteInfo): void {
		const frameset = new Frameset(msg).deserialize();
		this.emit("frameset", frameset);
		this.framer.handle(frameset);
	}
}
