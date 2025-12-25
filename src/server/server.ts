import {
	Ack,
	Address,
	EventEmitter,
	FrameSet,
	Logger,
	OpenConnectionReplyOne,
	OpenConnectionReplyTwo,
	OpenConnectionRequestTwo,
	Packets,
	UnconnectedPong,
} from "../shared";
import { Connection } from "./connection";
import {
	type Advertisement,
	AdvertisementToString,
	type RaknetServerEvents,
	type RaknetServerOptions,
	defaultRaknetServerOptions,
} from "./types";
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";

export class Server extends EventEmitter<RaknetServerEvents> {
	private socket: Socket;
	public readonly options: RaknetServerOptions;
	public advertisement: Advertisement;
	private connections: Map<string, Connection>;
	private tickCount: number;
	private tickInterval: NodeJS.Timeout;

	constructor(options: Partial<RaknetServerOptions> = {}) {
		super();
		this.socket = createSocket("udp4");
		this.options = { ...defaultRaknetServerOptions, ...options };
		this.connections = new Map();
		this.advertisement = {
			gamemode: "Survival",
			guid: this.options.guid,
			maxPlayers: this.options.maxConnections,
			message: this.options.motd,
			playerCount: this.connections.size,
			version: "0",
			protocol: 0,
			serverName: "SanctumTerra Server",
			type: "MCPE",
		};
		this.tickCount = 0;
		this.tickInterval = setInterval(
			this.tick.bind(this),
			1000 / this.options.tickRate,
		);
	}

	public tick() {
		for (const connection of this.connections.values()) {
			connection.onTick(this.tickCount);
		}
		this.tickCount++;
	}

	public listen() {
		this.socket.bind(this.options.port, this.options.address, () => {
			this.emit("listening");
			if (this.options.enableServerLogs) {
				Logger.info(
					`Server listening on ${this.options.address}:${this.options.port}`,
				);
			}
		});
		this.socket.on("message", this.onMessage.bind(this));
		this.on("disconnect", this.onDisconnect.bind(this));
	}

	private onDisconnect(connection: Connection, executedByServer = false) {
		const address = connection.getAddress();
		this.connections.delete(`${address.address}:${address.port}`);
		this.advertisement.playerCount = this.connections.size;
		if (executedByServer) {
			this.emit("disconnect", connection);
		}
		if (this.options.enableServerLogs) {
			Logger.info(`Client disconnected ${address.address}:${address.port}`);
		}
	}

	private onMessage(message: Buffer, rinfo: RemoteInfo) {
		let id = message[0];
		const isOnline = (id & 0xf0) === 0x80;
		if (isOnline) id = 0x80;

		switch (id) {
			case Packets.UnconnectedPing: {
				console.log("Received Ping! from: ", rinfo.address);
				const pong = new UnconnectedPong();
				pong.guid = this.options.guid;
				pong.message = AdvertisementToString(this.advertisement);
				pong.timestamp = BigInt(Date.now());
				this.send(pong.serialize(), rinfo.address, rinfo.port);
				break;
			}
			case Packets.OpenConnectionRequest1: {
				const reply = new OpenConnectionReplyOne();
				reply.guid = this.options.guid;
				reply.mtu = this.options.mtu;
				reply.security = false;
				this.send(reply.serialize(), rinfo.address, rinfo.port);
				break;
			}
			case Packets.OpenConnectionRequest2: {
				const request = new OpenConnectionRequestTwo(message).deserialize();
				const reply = new OpenConnectionReplyTwo();
				reply.address = new Address("0.0.0.0", 0, 4);
				reply.encryptionEnabled = false;
				reply.guid = this.options.guid;
				reply.mtu = this.options.mtu;
				const connection = new Connection(
					this,
					rinfo,
					request.mtu,
					request.guid,
				);
				this.connections.set(`${rinfo.address}:${rinfo.port}`, connection);
				this.send(reply.serialize(), rinfo.address, rinfo.port);
				break;
			}
			case Packets.FrameSet: {
				const frameSet = new FrameSet(message).deserialize();
				const connection = this.connections.get(
					`${rinfo.address}:${rinfo.port}`,
				);
				if (!connection) {
					break;
				}
				connection.onFrameSet(frameSet);
				break;
			}
			case Packets.Ack: {
				const connection = this.connections.get(
					`${rinfo.address}:${rinfo.port}`,
				);
				if (!connection) {
					break;
				}
				connection.onAck(new Ack(message).deserialize());
				break;
			}
			case Packets.Nack: {
				const connection = this.connections.get(
					`${rinfo.address}:${rinfo.port}`,
				);
				if (!connection) {
					break;
				}
				connection.onNack(new Ack(message).deserialize());
				break;
			}
			default: {
				Logger.warn(`Unknown packet type ${id}`);
				break;
			}
		}
	}

	public send(buffer: Buffer, address: string, port: number) {
		this.socket.send(buffer, port, address);
	}
}
