import { Emitter } from "@serenityjs/emitter";
import type { ClientEvents } from "./client-events";
import { type RemoteInfo, type Socket, createSocket } from "node:dgram";
import { Framer } from "./framer";
import {
	Ack,
	type Address,
	type Advertisement,
	ConnectionRequest,
	type Frame,
	fromString,
	OpenConnectionReplyOne,
	OpenConnectionReplyTwo,
	OpenConnectionRequestOne,
	OpenConnectionRequestTwo,
	Packet,
	type Priority,
	Status,
	UnconnectedPing,
	UnconnectedPong,
} from "../proto";
import { type ClientOptions, defaultClientOptions } from "./client-options";
import { Logger } from "../utils";
import { Frameset } from "../proto/packets/frameset";

export class Client extends Emitter<ClientEvents> {
	public socket!: Socket;
	public framer!: Framer;
	public options: ClientOptions;
	private timer!: NodeJS.Timeout;
	private timeout!: NodeJS.Timeout;
	public serverAddress!: Address;

	public status = Status.Disconnected;

	constructor(options: Partial<ClientOptions> = defaultClientOptions) {
		super();
		this.options = { ...defaultClientOptions, ...options };
		// 20 is enough, but 60 is incase someone will really need it
		this.maxListeners = 60;
	}

	public initSocket() {
		try {
			this.socket = createSocket("udp4");
			this.framer = new Framer(this);
			this.remove("tick", () => this.framer.tick());
			this.on("tick", () => this.framer.tick());
			this.socket.removeAllListeners("message");
			this.socket.on("message", (payload, rinfo) => {
				this.framer.incommingMessage(payload, rinfo);
			});
		} catch (error) {
			Logger.error(`Failed to create socket: ${error}`);
		}
	}

	public async ping(): Promise<Advertisement | null> {
		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				throw new Error("Failed to ping, timed out.");
			}, this.options.timeout);

			this.on("unconnected-pong", (packet) => {
				clearTimeout(timeout);
				resolve(fromString(packet.message));
			});

			const unconnectedPing = new UnconnectedPing();
			unconnectedPing.guid = this.options.clientId;
			unconnectedPing.clientTimestamp = BigInt(Date.now());
			this.send(unconnectedPing.serialize());
		});
	}

	public async connect(): Promise<Advertisement> {
		if (this.status === Status.Connecting) {
			throw new Error("Connection attempt already in progress");
		}

		this.status = Status.Connecting;
		this.initSocket();

		this.timer = setInterval(() => this.emit("tick"), 20);

		try {
			const advertisement = await this.ping();
			if (!advertisement) throw new Error("Failed to get server advertisement");

			return new Promise((resolve, reject) => {
				let isResolved = false;

				const connectionTimeout = setTimeout(() => {
					if (!isResolved) {
						this.cleanup();
						reject(new Error("Connection timed out"));
					}
				}, this.options.timeout);

				const request = new OpenConnectionRequestOne();
				request.mtu = this.options.mtuSize;
				request.protocol = this.options.protocolVersion;

				this.emit("open-connection-request-one", request);
				this.send(request.serialize());

				const requestInterval = setInterval(() => {
					if (!isResolved) {
						this.send(request.serialize());
					}
				}, 20);

				this.onceAfter("new-incoming-connection", () => {
					if (!isResolved) {
						clearTimeout(connectionTimeout);
						clearInterval(requestInterval);
						isResolved = true;
						this.emit("connect");
						this.status = Status.Connected;
						resolve(advertisement);
					}
				});
			});
		} catch (error) {
			this.status = Status.Disconnected;
			throw error;
		}
	}

	public sendFrame(frame: Frame, priority: Priority): void {
		this.framer.sendFrame(frame, priority);
	}

	public send(buffer: Buffer) {
		if (this.options.debug)
			Logger.debug(
				`Sending ${buffer[0]}, ${buffer.length} bytes to ${this.options.address}:${this.options.port}`,
			);
		this.socket.send(
			buffer,
			0,
			buffer.length,
			this.options.port,
			this.options.address,
		);
	}

	public cleanup(): void {
		this.removeAll();
		this.socket.removeAllListeners();
		this.socket.close();
		clearInterval(this.timer);
		clearTimeout(this.timeout);
		this.status = Status.Disconnected;
	}
}
