import { Emitter } from "@serenityjs/emitter";
import type { ClientEvents } from "./client-events";
import { type RemoteInfo, type Socket, createSocket } from "node:dgram";
import { Framer } from "./framer";
import {
	Ack,
	type Address,
	type Advertisement,
	ConnectionRequest,
	Frame,
	fromString,
	OpenConnectionReplyOne,
	OpenConnectionReplyTwo,
	OpenConnectionRequestOne,
	OpenConnectionRequestTwo,
	Packet,
	type Priority,
	Reliability,
	Status,
	UnconnectedPing,
	UnconnectedPong,
} from "../proto";
import DisconnectionNotification from "../proto/packets/disconnect";
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
			Logger.disabled = this.options.loggerDisabled;
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
		if (this.status === Status.Connected) {
			throw new Error("Already connected");
		}

		this.status = Status.Connecting;
		this.initSocket();

		this.timer = setInterval(() => this.emit("tick"), 50);

		try {
			const advertisement = await this.ping();
			if (!advertisement) throw new Error("Failed to get server advertisement");

			return new Promise((resolve, reject) => {
				let isResolved = false;
				let shouldContinueSending = true;

				const cleanup = () => {
					clearTimeout(connectionTimeout);
					clearInterval(requestInterval);
					if (!isResolved) {
						Logger.error("Could not resolve connection.");
						this.cleanup();
					}
				};

				const connectionTimeout = setTimeout(() => {
					cleanup();
					reject(new Error("Connection timed out"));
				}, this.options.timeout);

				const request = new OpenConnectionRequestOne();
				request.mtu = this.options.mtuSize;
				request.protocol = this.options.protocolVersion;

				this.on("open-connection-reply-two", (packet) => {
					const mtu = packet.mtu;
					if (mtu > 400 && mtu < 1500) {
						shouldContinueSending = false;
					} else {
						cleanup();
						reject(new Error(`Invalid MTU size: ${mtu}`));
					}
				});

				this.emit("open-connection-request-one", request);
				this.send(request.serialize());

				const requestInterval = setInterval(() => {
					if (!isResolved && shouldContinueSending) {
						this.send(request.serialize());
					}
				}, 50);

				this.onceAfter("new-incoming-connection", () => {
					if (!isResolved) {
						isResolved = true;
						this.emit("connect", advertisement);
						this.status = Status.Connected;
						resolve(advertisement);
					}
				});

				this.once("error", (error) => {
					cleanup();
					reject(error);
				});
			});
		} catch (error) {
			this.status = Status.Disconnected;
			throw error;
		}
	}

	public sendFrame(frame: Frame, priority: Priority): void {
		try {
			this.framer.sendFrame(frame, priority);
		} catch (error) {
			Logger.error("[Raknet] Failed to send frame", error);
		}
	}

	public frameAndSend(payload: Buffer, priority: Priority): void {
		const frame = new Frame();
		frame.reliability = Reliability.ReliableOrdered;
		frame.payload = payload;
		frame.orderChannel = 0;
		this.sendFrame(frame, priority);
	}

	public send(buffer: Buffer) {
		if (this.status === Status.Disconnected) {
			Logger.warn("[Client] Attempting to send packet while disconnected");
			return;
		}

		Logger.debug(
			`[Client] Sending packet ${buffer[0]}, ${buffer.length} bytes to ${this.options.address}:${this.options.port}`,
		);
		Logger.debug(`[Client] Current connection status: ${Status[this.status]}`);

		try {
			this.socket.send(
				buffer,
				0,
				buffer.length,
				this.options.port,
				this.options.address,
			);
		} catch (error) {
			Logger.error("[Client] Failed to send packet", error as Error);
			this.cleanup();
		}
	}

	public cleanup(): void {
		if (this.status === Status.Disconnected) {
			return;
		}

		Logger.info("[Client] Cleaning up connection and resources");
		const wasConnected = this.status === Status.Connected;
		this.status = Status.Disconnecting;

		try {
			// Send disconnect notification if we were connected
			if (wasConnected) {
				const disconnect = new DisconnectionNotification();
				this.send(disconnect.serialize());
			}

			this.removeAll();
			this.socket.removeAllListeners();
			this.socket.close();
			clearInterval(this.timer);
			clearTimeout(this.timeout);
		} catch (error) {
			Logger.error("[Client] Error during cleanup", error as Error);
		} finally {
			this.status = Status.Disconnected;
			Logger.info("[Client] Cleanup complete, status set to Disconnected");
		}
	}
}
