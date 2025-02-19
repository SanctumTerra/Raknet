import { Emitter } from "@serenityjs/emitter";
import type { ClientEvents } from "./client-events";
import { type RemoteInfo, type Socket, createSocket } from "node:dgram";
import { Framer } from "./framer";
import {
	Ack,
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
import { type ClientOptions, defaultClientOptions } from "./client-options";
import { Logger } from "../utils";
import { Frameset } from "../proto/packets/frameset";

const TICK_INTERVAL = 50;
const REQUEST_INTERVAL = 50;

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
				this.framer?.incommingMessage(payload, rinfo);
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

	public async connect(): Promise<Advertisement> {
		if (this.status === Status.Connecting) {
			throw new Error("Connection attempt already in progress");
		}
		if (this.status === Status.Connected) {
			throw new Error("Already connected");
		}

		this.status = Status.Connecting;
		this.initSocket();

		this.tickTimer = setInterval(() => this.emit("tick"), TICK_INTERVAL);

		try {
			const advertisement = await this.ping();
			if (!advertisement) throw new Error("Failed to get server advertisement");

			return new Promise((resolve, reject) => {
				let isResolved = false;
				let shouldContinueSending = true;

				const cleanup = () => {
					if (this.connectionTimeout) {
						clearTimeout(this.connectionTimeout);
						this.connectionTimeout = undefined;
					}
					if (this.requestInterval) {
						clearInterval(this.requestInterval);
						this.requestInterval = undefined;
					}
					if (!isResolved) {
						Logger.error("Could not resolve connection.");
						this.cleanup();
					}
				};

				this.connectionTimeout = setTimeout(() => {
					cleanup();
					reject(new Error("Connection timed out"));
				}, this.options.timeout);

				const request = new OpenConnectionRequestOne();
				request.mtu = this.options.mtuSize;
				request.protocol = this.options.protocolVersion;

				this.once(
					"open-connection-reply-two",
					(packet: OpenConnectionReplyTwo) => {
						const mtu = packet.mtu;
						if (mtu > 400 && mtu < 1500) {
							shouldContinueSending = false;
						} else {
							cleanup();
							reject(new Error(`Invalid MTU size: ${mtu}`));
						}
					},
				);

				this.emit("open-connection-request-one", request);
				this.send(request.serialize());

				this.requestInterval = setInterval(() => {
					if (!isResolved && shouldContinueSending) {
						this.send(request.serialize());
					}
				}, REQUEST_INTERVAL);

				this.once("new-incoming-connection", () => {
					if (!isResolved) {
						isResolved = true;
						this.emit("connect", advertisement);
						this.status = Status.Connected;
						cleanup();
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

	private cleanupSocket() {
		if (!this.socket) return;
		try {
			this.socket.removeAllListeners();
			Logger.cleanup();
			if (this.status === Status.Connected) {
				const disconnect = new DisconnectionNotification();
				this.socket.send(
					disconnect.serialize(),
					0,
					disconnect.serialize().length,
					this.options.port,
					this.options.address,
				);
			}

			const stateSymbol = Symbol.for("state symbol");
			const socketWithState = this.socket as unknown as {
				[key: symbol]: { handle: { close: () => void } | null };
			};
			const state = socketWithState[stateSymbol];
			if (state?.handle) {
				state.handle.close();
				state.handle = null;
			}

			this.socket.close(() => {
				console.log("socket closed");
				this.socket?.removeAllListeners();
			});

			// (this.socket as { _handle?: unknown })._handle = undefined;
		} catch (err) {
			Logger.error("[Client] Error during socket cleanup", err as Error);
			try {
				const stateSymbol = Symbol.for("state symbol");
				const socketWithState = this.socket as unknown as {
					[key: symbol]: { handle: { close: () => void } | null };
				};
				const state = socketWithState[stateSymbol];
				if (state?.handle) {
					state.handle.close();
					state.handle = null;
				}
			} catch (_) {}
			this.socket = null;
		}
	}

	private cleanupFramer() {
		if (!this.framer) return;
		(this.framer as { _events?: unknown })._events = undefined;
		(this.framer as { _eventsCount?: unknown })._eventsCount = undefined;
		this.framer = null;
	}

	public cleanup(): void {
		if (this.status === Status.Disconnected) return;

		Logger.debug("[Client] Cleaning up connection and resources");
		const wasConnected = this.status === Status.Connected;
		this.status = Status.Disconnecting;

		this.remove("tick", () => this.framer?.tick());

		if (this.tickTimer) {
			clearInterval(this.tickTimer);
			this.tickTimer = undefined;
		}
		if (this.connectionTimeout) {
			clearTimeout(this.connectionTimeout);
			this.connectionTimeout = undefined;
		}
		if (this.requestInterval) {
			clearInterval(this.requestInterval);
			this.requestInterval = undefined;
		}

		this.removeAll();
		this.removeAllAfter();
		this.removeAllBefore();

		this.cleanupSocket();
		this.cleanupFramer();

		this.serverAddress = null;
		(this as { _events?: unknown })._events = undefined;
		(this as { _eventsCount?: unknown })._eventsCount = undefined;
		this.status = Status.Disconnected;

		Logger.debug("[Client] Cleanup complete");
		Logger.cleanup();
	}

	public disconnect(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (this.status === Status.Disconnected) {
				resolve();
				return;
			}

			const cleanupTimeout = setTimeout(() => {
				Logger.warn("[Client] Disconnect timeout reached, forcing cleanup");
				try {
					this.cleanup();
					resolve();
				} catch (error) {
					reject(error);
				}
			}, 5000);

			try {
				setImmediate(() => {
					try {
						this.cleanup();
						clearTimeout(cleanupTimeout);
						resolve();
					} catch (error) {
						clearTimeout(cleanupTimeout);
						reject(error);
					}
				});
			} catch (error) {
				clearTimeout(cleanupTimeout);
				reject(error);
			}
		});
	}
}
