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

export class Client extends Emitter<ClientEvents> {
	public socket!: Socket;
	public framer!: Framer;
	public options: ClientOptions;
	private timer!: NodeJS.Timeout;
	private timeout!: NodeJS.Timeout;
	public serverAddress!: Address;

	private waitingForReplyTwo = false;
	private waitingForReplyOne = false;

	private isConnecting = false;

	constructor(options: Partial<ClientOptions> = defaultClientOptions) {
		super();
		this.options = { ...defaultClientOptions, ...options };
		this.maxListeners = 20;
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
		if (this.isConnecting) {
			throw new Error("Connection attempt already in progress");
		}

		try {
			this.isConnecting = true;
			this.initSocket();
			this.timer = setInterval(() => {
				this.emit("tick");
			}, 50);

			const request = new OpenConnectionRequestOne();
			request.mtu = this.options.mtuSize;
			request.protocol = this.options.protocolVersion;

			let connectionAttempts = 0;
			const maxAttempts = 3;
			let isResolved = false;

			const advertisement = await this.ping();

			return new Promise((resolve, reject) => {
				const attemptConnection = () => {
					if (isResolved) return;

					if (connectionAttempts >= maxAttempts) {
						this.cleanup();
						reject(new Error("Connection timed out"));
						return;
					}

					connectionAttempts++;
					if (this.options.debug)
						Logger.debug(
							`Sending OpenConnectionRequestOne attempt ${connectionAttempts}/${maxAttempts}`,
						);
					this.emit("open-connection-request-one", request);
					this.send(request.serialize());

					setTimeout(attemptConnection, 2000);
				};

				this.onceAfter("new-incoming-connection", (packet) => {
					if (advertisement && !isResolved) {
						isResolved = true;
						this.emit("connect");
						this.isConnecting = false;
						resolve(advertisement);
					}
				});

				this.once("open-connection-reply-one", () => {
					if (this.options.debug)
						Logger.debug("Received OpenConnectionReplyOne");
				});

				attemptConnection();
			});
		} catch (error) {
			this.isConnecting = false;
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

	private waitForReply2() {
		if (this.waitingForReplyTwo) return;
		this.waitingForReplyTwo = true;
		const timeout = setTimeout(() => {
			this.waitingForReplyTwo = false;
			if (this.options.debug)
				Logger.debug("Failed to receive OpenConnectionReplyTwo");
			console.error("Failed to receive OpenConnectionReplyTwo");
			this.cleanup();
		}, 500);
		this.on("open-connection-reply-two", () => {
			clearTimeout(timeout);
			this.waitingForReplyTwo = false;
		});
	}

	private onMessage(msg: Buffer, rinfo: RemoteInfo) {
		try {
			let packetId = msg.readUint8();
			if ((msg[0] & 0xf0) === 0x80) packetId = 0x80;
			if (this.options.debug)
				Logger.debug(
					`Received packet ${packetId} from ${rinfo.address}:${rinfo.port}`,
				);
			switch (packetId) {
				case Packet.Ack: {
					const packet = new Ack(msg).deserialize();
					this.emit("ack", packet);
					break;
				}
				case Packet.UnconnectedPong: {
					const packet = new UnconnectedPong(msg).deserialize();
					this.emit("unconnected-pong", packet);
					break;
				}
				case Packet.OpenConnectionReplyOne: {
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
					this.waitForReply2();
					this.emit("open-connection-request-two", request);
					this.send(request.serialize());
					break;
				}
				case Packet.OpenConnectionReplyTwo: {
					const packet = new OpenConnectionReplyTwo(msg).deserialize();
					this.emit("open-connection-reply-two", packet);
					this.options.mtuSize = packet.mtu;

					const conReq = new ConnectionRequest();
					conReq.clientGuid = this.options.clientId;
					conReq.timestamp = BigInt(Date.now());
					conReq.useSecurity = false;

					let connectionAttempts = 0;
					const maxAttempts = 5;
					const connectionInterval = setInterval(() => {
						if (connectionAttempts >= maxAttempts) {
							clearInterval(connectionInterval);
							this.cleanup();
							this.emit("error", new Error("Connection request timed out"));
							return;
						}

						if (this.options.debug)
							Logger.debug(
								`Sending ConnectionRequest attempt ${connectionAttempts + 1}/${maxAttempts}`,
							);
						this.emit("connection-request", conReq);
						this.framer.frameAndSend(conReq.serialize(), Priority.Immediate);
						connectionAttempts++;
					}, 1000);

					this.once("new-incoming-connection", () => {
						if (this.options.debug)
							Logger.debug(
								"Received new incoming connection, clearing connection request interval",
							);
						clearInterval(connectionInterval);
					});

					break;
				}
				case Packet.FrameSet: {
					const frameset = new Frameset(msg).deserialize();
					this.emit("frameset", frameset);
					this.framer.handle(frameset);
					break;
				}
			}
		} catch (error) {
			Logger.error("Failed to handle packet", { error: error as Error });
		}
	}

	private waitForReply1() {
		if (this.waitingForReplyOne) return;
		this.waitingForReplyOne = true;

		this.once("open-connection-reply-one", () => {
			if (this.options.debug) Logger.debug("Received OpenConnectionReplyOne");
			this.waitingForReplyOne = false;
		});
	}

	private cleanup(): void {
		this.removeAll();
		this.socket.removeAllListeners();
		this.socket.close();
		clearInterval(this.timer);
		clearTimeout(this.timeout);
		this.isConnecting = false;
	}
}
