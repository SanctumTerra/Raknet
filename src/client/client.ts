import { Emitter } from "@serenityjs/emitter";
import { createSocket, type Socket } from "node:dgram";
import {
	type Address,
	type Advertisement,
	Frame,
	fromString,
	type OpenConnectionReplyTwo,
	OpenConnectionRequestOne,
	type Priority,
	Status,
	UnconnectedPing,
	type UnconnectedPong,
} from "../proto";
import DisconnectionNotification from "../proto/packets/disconnect";
import { Logger } from "../utils";
import { Framer } from "./framer";
import { ClientEvents, ClientOptions, defaultClientOptions } from "./types";

const TICK_INTERVAL = 50;
const REQUEST_INTERVAL = 500;

export class Client extends Emitter<ClientEvents> {
	public socket!: Socket | null;
	public framer!: Framer | null;
	public options: ClientOptions;
	private tickTimer?: NodeJS.Timeout;
	private connectionTimeout?: NodeJS.Timeout;
	private requestInterval?: NodeJS.Timeout;
	public serverAddress!: Address | null;

	public status = Status.Disconnected;

	constructor(options: Partial<ClientOptions> = defaultClientOptions) {
		super();
		this.options = { ...defaultClientOptions, ...options };
		this.maxListeners = 60;
	}

	public initSocket() {
		try {
			this.socket = createSocket("udp4");
			this.framer = new Framer(this);

			this.remove("tick", () => this.framer?.tick());
			this.on("tick", () => this.framer?.tick());

			this.socket.removeAllListeners();
			this.socket.on("message", (payload, rinfo) => {
				this.framer?.incomingMessage(payload, rinfo);
			});

			this.socket.on("error", (err) => {
				Logger.error(`[Client] Socket error: ${err}`);
			});

			Logger.disabled = this.options.loggerDisabled;
		} catch (error) {
			Logger.error(`Failed to create socket: ${error}`);
		}
	}

	public async ping(): Promise<Advertisement> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("Failed to ping, timed out."));
			}, this.options.timeout);

			this.once("unconnected-pong", (packet: UnconnectedPong) => {
				clearTimeout(timeout);
				resolve(fromString(packet.message));
			});

			const unconnectedPing = new UnconnectedPing();
			unconnectedPing.guid = this.options.clientId;
			unconnectedPing.clientTimestamp = BigInt(Date.now());
			this.send(unconnectedPing.serialize());
		});
	}

	public async connect(): Promise<Advertisement | null> {
		if (this.status === Status.Connecting) {
			throw new Error("Connection attempt already in progress");
		}
		if (this.status === Status.Connected) {
			throw new Error("Already connected");
		}

		this.status = Status.Connecting;
		this.initSocket();
		this.tickTimer = setInterval(() => this.emit("tick"), TICK_INTERVAL);

		let advertisement: Advertisement | null = null;
		const pongHandler = (packet: UnconnectedPong) => {
			advertisement = fromString(packet.message);
		};
		this.once("unconnected-pong", pongHandler);

		const ping = new UnconnectedPing();
		ping.guid = this.options.clientId;
		ping.clientTimestamp = BigInt(Date.now());
		this.send(ping.serialize());

		return new Promise((resolve, reject) => {
			let isResolved = false;
			let currentStage = 0; // 0: request-one, 1: request-two, 2: completed

			this.connectionTimeout = setTimeout(() => {
				if (!isResolved) {
					isResolved = true;
					this.disconnect();
					reject(new Error("Connection timed out"));
				}
			}, this.options.timeout);

			const requestOne = new OpenConnectionRequestOne();
			requestOne.mtu = this.options.mtuSize;
			requestOne.protocol = this.options.protocolVersion;

			this.once("open-connection-reply-one", () => {
				currentStage = 1;
				Logger.debug("[Client] Received OpenConnectionReplyOne, sending OpenConnectionRequestTwo");
				if (this.requestInterval) clearInterval(this.requestInterval);
			});

			this.once("open-connection-reply-two", (packet: OpenConnectionReplyTwo) => {
				const mtu = packet.mtu;
				if (mtu < 400 || mtu > 1500) {
					if (!isResolved) {
						isResolved = true;
						this.disconnect();
						reject(new Error(`Invalid MTU size: ${mtu}`));
					}
					return;
				}
				currentStage = 2;
				Logger.debug(`[Client] Received OpenConnectionReplyTwo with MTU: ${mtu}`);
			});

			this.once("new-incoming-connection", () => {
				if (!isResolved) {
					isResolved = true;
					this.status = Status.Connected;
					this.emit("connect");

					if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
					if (this.requestInterval) clearInterval(this.requestInterval);

					resolve(advertisement);
				}
			});

			this.once("error", (error) => {
				if (!isResolved) {
					isResolved = true;
					this.disconnect();
					reject(error);
				}
			});

			this.emit("open-connection-request-one", requestOne);
			this.send(requestOne.serialize());

			this.requestInterval = setInterval(() => {
				if (!isResolved && currentStage === 0) {
					Logger.debug("[Client] Resending OpenConnectionRequestOne");
					this.send(requestOne.serialize());
				}
			}, REQUEST_INTERVAL);
		});
	}

	public sendFrame(frame: Frame, priority: Priority): void {
		try {
			if (!this.framer) {
				Logger.error("[Client] Cannot send frame: framer is null");
				return;
			}
			this.framer.sendFrame(frame, priority);
		} catch (error) {
			Logger.error("[Client] Failed to send frame", error);
		}
	}

	public frameAndSend(payload: Buffer, priority: Priority): void {
		const frame = new Frame();
		frame.payload = payload;
		frame.orderChannel = 0;
		this.sendFrame(frame, priority);
	}

	public send(buffer: Buffer): void {
		if (this.status === Status.Disconnected) {
			Logger.warn("[Client] Attempting to send packet while disconnected");
			return;
		}

		if (!this.socket) {
			Logger.error("[Client] Cannot send packet: socket is null");
			return;
		}

		Logger.debug(
			`[Client] Sending packet ${buffer[0]}, ${buffer.length} bytes to ${this.options.address}:${this.options.port}`,
		);

		try {
			this.socket.send(
				buffer,
				0,
				buffer.length,
				this.options.port,
				this.options.address,
				(err) => {
					if (err) {
						Logger.error("[Client] Failed to send packet", err);
					}
				},
			);
		} catch (error) {
			Logger.error("[Client] Failed to send packet", error as Error);
		}
	}

	public disconnect(): Promise<void> {
		return new Promise<void>((resolve) => {
			if (this.status === Status.Disconnected) {
				resolve();
				return;
			}

			const wasConnected = this.status === Status.Connected;
			this.status = Status.Disconnected;

			if (this.tickTimer) clearInterval(this.tickTimer);
			if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
			if (this.requestInterval) clearInterval(this.requestInterval);

			if (this.socket) {
				if (wasConnected) {
					const disconnect = new DisconnectionNotification();
					this.socket.send(disconnect.serialize(), 0, disconnect.serialize().length, this.options.port, this.options.address);
				}
				this.socket.close();
				this.socket = null;
			}

			this.framer = null;
			resolve();
		});
	}
}
