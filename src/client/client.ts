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
	DisconnectMessage,
} from "../shared";
import type { ClientEvents } from "./types";
import {
	type ClientOptions,
	defaultClientOptions,
} from "./types/client-options";
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import { Logger } from "../shared";
import { connect as netConnect, type Socket as NetSocket } from "node:net";
import { lookup } from "node:dns/promises";

export class Client extends EventEmitter<ClientEvents> {
	private static readonly MTU_VALUES = [1492, 1400, 1028, 1200, 576];
	private static readonly MTU_RETRY_INTERVAL = 500;
	private static readonly STALE_TIMEOUT_MS = 10000; // 10 seconds without pong = stale
	private static readonly PING_INTERVAL_TICKS = 100; // Send connected ping every ~2 seconds at 50 tick rate

	public options: ClientOptions;
	private socket: Socket;
	private interval: NodeJS.Timeout | null;
	private status: ConnectionStatus;
	public tick: number;
	private session: NetworkSession;
	private gotReply1 = false;

	private proxySocket: NetSocket | null = null;
	private proxyRelayHost: string | null = null;
	private proxyRelayPort: number | null = null;
	private resolvedAddress: string | null = null;
	private proxyReady = false;

	private lastPongTime: number = Date.now();
	private isDisconnected = false;

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

	private async setupProxy(): Promise<void> {
		if (!this.options.proxy) return;

		const proxy = this.options.proxy;
		const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(this.options.address);

		if (!isIPv4) {
			const result = await lookup(this.options.address, 4);
			this.resolvedAddress = result.address;
		} else {
			this.resolvedAddress = this.options.address;
		}

		return new Promise((resolve, reject) => {
			const socket = netConnect(proxy.port, proxy.host, () => {
				const authMethods =
					proxy.userId && proxy.password ? [0x00, 0x02] : [0x00];
				socket.write(Buffer.from([0x05, authMethods.length, ...authMethods]));
			});

			let state: "greeting" | "auth" | "request" | "done" = "greeting";

			socket.on("data", (data: Buffer) => {
				if (state === "greeting") {
					if (data[0] !== 0x05) {
						reject(new Error("Invalid SOCKS5 response"));
						socket.destroy();
						return;
					}

					const method = data[1];
					if (method === 0x02 && proxy.userId && proxy.password) {
						const userBuf = Buffer.from(proxy.userId, "utf8");
						const passBuf = Buffer.from(proxy.password, "utf8");
						socket.write(
							Buffer.concat([
								Buffer.from([0x01, userBuf.length]),
								userBuf,
								Buffer.from([passBuf.length]),
								passBuf,
							]),
						);
						state = "auth";
					} else if (method === 0x00) {
						socket.write(this.buildUdpAssociateRequest());
						state = "request";
					} else {
						reject(new Error("SOCKS5 auth method not supported"));
						socket.destroy();
					}
				} else if (state === "auth") {
					if (data[1] !== 0x00) {
						reject(new Error("SOCKS5 authentication failed"));
						socket.destroy();
						return;
					}
					socket.write(this.buildUdpAssociateRequest());
					state = "request";
				} else if (state === "request") {
					if (data[0] !== 0x05 || data[1] !== 0x00) {
						reject(new Error(`SOCKS5 UDP ASSOCIATE failed: ${data[1]}`));
						socket.destroy();
						return;
					}

					const relay = this.parseRelayAddress(data);
					if (!relay) {
						reject(new Error("Failed to parse relay address"));
						socket.destroy();
						return;
					}

					this.proxySocket = socket;
					this.proxyRelayHost =
						relay.host === "0.0.0.0"
							? (this.resolvedAddress ?? proxy.host)
							: relay.host;
					this.proxyRelayPort = relay.port;
					this.proxyReady = true;
					state = "done";
					resolve();
				}
			});

			socket.on("close", () => {
				if (state !== "done") {
					reject(new Error("SOCKS5 connection closed unexpectedly"));
				} else {
					this.proxySocket = null;
					this.proxyRelayHost = null;
					this.proxyRelayPort = null;
				}
			});

			socket.on("error", (err: Error) => {
				reject(new Error(`SOCKS5 proxy error: ${err.message}`));
			});
		});
	}

	private buildUdpAssociateRequest(): Buffer {
		return Buffer.from([0x05, 0x03, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
	}

	private parseRelayAddress(
		data: Buffer,
	): { host: string; port: number } | null {
		const atyp = data[3];

		if (atyp === 0x01) {
			return {
				host: `${data[4]}.${data[5]}.${data[6]}.${data[7]}`,
				port: data.readUInt16BE(8),
			};
		}

		if (atyp === 0x03) {
			const len = data[4] ?? 0;
			return {
				host: data.subarray(5, 5 + len).toString("utf8"),
				port: data.readUInt16BE(5 + len),
			};
		}

		return null;
	}

	private createSocks5UdpHeader(host: string, port: number): Buffer {
		const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

		if (isIPv4) {
			const header = Buffer.alloc(10);
			header.writeUInt16BE(0, 0);
			header.writeUInt8(0, 2);
			header.writeUInt8(1, 3);
			const parts = host.split(".").map(Number);
			header.writeUInt8(parts[0] ?? 0, 4);
			header.writeUInt8(parts[1] ?? 0, 5);
			header.writeUInt8(parts[2] ?? 0, 6);
			header.writeUInt8(parts[3] ?? 0, 7);
			header.writeUInt16BE(port, 8);
			return header;
		}

		const domainBuffer = Buffer.from(host, "utf8");
		const header = Buffer.alloc(7 + domainBuffer.length);
		header.writeUInt16BE(0, 0);
		header.writeUInt8(0, 2);
		header.writeUInt8(3, 3);
		header.writeUInt8(domainBuffer.length, 4);
		domainBuffer.copy(header, 5);
		header.writeUInt16BE(port, 5 + domainBuffer.length);
		return header;
	}

	private parseSocks5UdpHeader(
		data: Buffer,
	): { host: string; port: number; dataOffset: number } | null {
		if (data.length < 10) return null;

		const atyp = data.readUInt8(3);

		if (atyp === 1) {
			return {
				host: `${data.readUInt8(4)}.${data.readUInt8(5)}.${data.readUInt8(6)}.${data.readUInt8(7)}`,
				port: data.readUInt16BE(8),
				dataOffset: 10,
			};
		}

		if (atyp === 3) {
			const domainLen = data.readUInt8(4);
			return {
				host: data.subarray(5, 5 + domainLen).toString("utf8"),
				port: data.readUInt16BE(5 + domainLen),
				dataOffset: 7 + domainLen,
			};
		}

		return null;
	}

	public async connect(): Promise<void> {
		if (this.options.proxy) {
			await this.setupProxy();
		}

		this.status = ConnectionStatus.Connecting;
		this.gotReply1 = false;

		return new Promise((resolve, reject) => {
			let mtuIndex = 0;
			let retryTimeout: NodeJS.Timeout | null = null;

			const sendRequest = () => {
				if (mtuIndex >= Client.MTU_VALUES.length) {
					reject(new Error("Connection timed out, all MTU values exhausted"));
					return;
				}

				const mtu = Client.MTU_VALUES[mtuIndex];
				if (!mtu) throw new Error("MTU value is undefined");

				const request = new OpenConnectionRequestOne();
				request.mtu = mtu;
				request.protocol = 11;
				this.send(request.serialize());

				retryTimeout = setTimeout(() => {
					if (!this.gotReply1) {
						mtuIndex++;
						sendRequest();
					}
				}, Client.MTU_RETRY_INTERVAL);
			};

			const timeout = setTimeout(() => {
				if (retryTimeout) clearTimeout(retryTimeout);
				reject(new Error("Connection timed out"));
			}, this.options.timeout);

			this.once("connect", () => {
				clearTimeout(timeout);
				if (retryTimeout) clearTimeout(retryTimeout);
				resolve();
			});

			sendRequest();
		});
	}

	public onTick(): void {
		const isDisconnected = this.status === ConnectionStatus.Disconnected;
		const isDisconnecting = this.status === ConnectionStatus.Disconnecting;
		const isConnected = this.status === ConnectionStatus.Connected;

		const canPing = isDisconnected && this.tick % this.options.pingRate === 0;
		if (canPing && (!this.options.proxy || this.proxyReady)) this.ping();

		// Send connected pings and check for stale connection when connected
		if (isConnected) {
			// Send connected ping periodically
			if (this.tick % Client.PING_INTERVAL_TICKS === 0) {
				this.sendConnectedPing();
			}

			// Check for stale connection
			const timeSinceLastPong = Date.now() - this.lastPongTime;
			if (timeSinceLastPong > Client.STALE_TIMEOUT_MS) {
				this.handleDisconnect("Connection timed out (stale)");
				return;
			}
		}

		if (!isDisconnecting || !isDisconnected) {
			this.session.onTick(this.tick);
		}
		this.tick++;
	}

	private sendConnectedPing(): void {
		const ping = new ConnectedPing();
		ping.timestamp = BigInt(Date.now());
		this.frameAndSend(ping.serialize(), Priority.High);
	}

	private handleDisconnect(reason: string): void {
		if (this.isDisconnected) return;
		this.isDisconnected = true;
		this.status = ConnectionStatus.Disconnected;
		this.emit("disconnect", reason);
		this.cleanup();
	}

	private cleanup(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
		try {
			this.socket.close();
		} catch {
			// Socket may already be closed
		}
		if (this.proxySocket) {
			this.proxySocket.destroy();
			this.proxySocket = null;
		}
	}

	public onMessage(data: Buffer, rinfo: RemoteInfo): void {
		let actualData = data;

		if (this.proxyRelayHost && this.proxyRelayPort) {
			const parsed = this.parseSocks5UdpHeader(data);
			if (parsed) {
				actualData = data.subarray(parsed.dataOffset);
			}
		}

		let id = actualData[0];
		const isOnline = (id & 0xf0) === 0x80;
		if (isOnline) id = 0x80;

		switch (id) {
			case Packets.UnconnectedPong: {
				const pong = new UnconnectedPong(actualData).deserialize();
				this.emit("unconnectedPong", pong);
				break;
			}
			case Packets.OpenConnectionReply1: {
				this.gotReply1 = true;
				const reply = new OpenConnectionReplyOne(actualData).deserialize();
				const request = new OpenConnectionRequestTwo();
				request.address = Address.fromIdentifier(rinfo);
				request.mtu = reply.mtu;
				request.guid = this.options.guid;
				request.cookie = reply.cookie;
				request.clientSupportsecurity = false;
				this.send(request.serialize());
				break;
			}
			case Packets.OpenConnectionReply2: {
				const reply2 = new OpenConnectionReplyTwo(actualData).deserialize();
				// Update session MTU with the negotiated value from server
				this.session.mtu = reply2.mtu;
				const request = new ConnectionRequest();
				request.guid = this.options.guid;
				request.timestamp = BigInt(Date.now());
				this.frameAndSend(request.serialize(), Priority.High);
				break;
			}
			case Packets.FrameSet: {
				const frameSet = new FrameSet(actualData).deserialize();
				this.session.onFrameSet(frameSet);
				break;
			}
			case Packets.Ack: {
				const ack = new Ack(actualData).deserialize();
				this.session.onAck(ack);
				break;
			}
			case Packets.Nack: {
				const nack = new Ack(actualData).deserialize();
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
				this.lastPongTime = Date.now();
				break;
			}
			case Packets.ConnectedPing: {
				const ping = new ConnectedPing(data).deserialize();
				const pong = new ConnectedPong();
				pong.pingTimestamp = ping.timestamp;
				pong.pongTimestamp = BigInt(Date.now());
				this.frameAndSend(pong.serialize(), Priority.High);
				break;
			}
			case Packets.Disconnect: {
				this.handleDisconnect("Server disconnected");
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
				this.status = ConnectionStatus.Connected;
				this.lastPongTime = Date.now(); // Reset stale timer on connect
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
		this.send(ping.serialize());
	}

	public send(data: Buffer): void {
		if (this.proxyRelayHost && this.proxyRelayPort) {
			const destAddr = this.resolvedAddress || this.options.address;
			const header = this.createSocks5UdpHeader(destAddr, this.options.port);
			const packet = Buffer.concat([header, data]);
			this.socket.send(packet, this.proxyRelayPort, this.proxyRelayHost);
		} else {
			this.socket.send(data, this.options.port, this.options.address);
		}
	}

	public disconnect(): void {
		if (this.isDisconnected) return;

		// Send disconnect packet to server if connected
		if (this.status === ConnectionStatus.Connected) {
			const disconnect = new DisconnectMessage();
			this.frameAndSend(disconnect.serialize(), Priority.High);
		}

		this.handleDisconnect("Client disconnected");
	}
}
