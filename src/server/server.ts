import Emitter from "@serenityjs/emitter";
import type { ServerEvents } from "./server-events";
import { type ServerOptions, defaultOptions } from "./server-options";
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import {
	Address,
	AdvertisementToString,
	ConnectionRequest,
	Flags,
	Frameset,
	IncompatibleProtocolVersion,
	OpenConnectionReplyOne,
	OpenConnectionReplyTwo,
	OpenConnectionRequestOne,
	OpenConnectionRequestTwo,
	Packet,
	UnconnectedPing,
	UnconnectedPong,
} from "../proto";
import { Logger } from "../utils";
import { Connection } from "./connection";

class Server extends Emitter<ServerEvents> {
	public options: ServerOptions;
	public connectionTimes: Map<string, number> = new Map();
	private socket: Socket;
	private connections: Map<string, Connection> = new Map();
	private timer!: NodeJS.Timeout;
	private tickCount = 0;

	private blockedConnections: Map<string, number> = new Map();
	private packetsPerSecond: Map<string, number> = new Map();

	private readonly validFlagsMask = Flags.Valid;

	constructor(options: Partial<ServerOptions>) {
		super();
		this.options = { ...defaultOptions, ...options };
		this.socket = createSocket("udp4");
		Logger.disabled = this.options.loggerDisabled;
	}

	public async start() {
		this.socket.bind(this.options.port, this.options.host);
		this.socket.on("message", (message, remote) => {
			this.handle(message, remote);
		});

		Logger.info(`Server started on ${this.options.host}:${this.options.port}`);
		this.tick();
	}

	public tick() {
		this.tickCount++;
		for (const connection of this.connections.values()) {
			connection.tick();
		}

		const currentTime = Date.now();

		// Check every 1s
		if (this.tickCount % this.options.tickRate === 0) {
			for (const [addr, blockTime] of this.blockedConnections) {
				if (blockTime < currentTime) {
					Logger.warn(`Unblocking ${addr} for excessive packets`);
					this.blockedConnections.delete(addr);
				}
			}
			this.packetsPerSecond.clear();
		}

		this.timer = setTimeout(() => this.tick(), 1000 / this.options.tickRate);
	}

	public send(message: Buffer, remote: RemoteInfo) {
		this.socket.send(message, 0, message.length, remote.port, remote.address);
	}

	public async handle(message: Buffer, remote: RemoteInfo) {
		let packetId = message[0];
		if ((packetId & 0xf0) === 0x80) packetId = 0x80;
		const remoteAddr = remote.address;
		if (this.blockedConnections.has(remoteAddr)) {
			return;
		}

		const currentPackets = (this.packetsPerSecond.get(remoteAddr) ?? 0) + 1;
		this.packetsPerSecond.set(remoteAddr, currentPackets);

		if (currentPackets > this.options.maxPacketsPerSecond) {
			const blockUntil = Date.now() + this.options.blockTime;
			this.blockedConnections.set(remoteAddr, blockUntil);
			Logger.warn(
				`Blocking ${remoteAddr} for ${this.options.blockTime}ms for excessive packets`,
			);
			return;
		}

		const connectionKey = `${remoteAddr}:${remote.port}`;
		const connection = this.connections.get(connectionKey);

		if ((packetId & this.validFlagsMask) !== 0) {
			if (connection) {
				connection.handle(message);
			}
			return;
		}

		if ((packetId & this.validFlagsMask) === 0 && connection) {
			Logger.debug(
				`Received Offline packet from ${connectionKey} while being connected`,
			);
			return;
		}

		switch (packetId) {
			case Packet.UnconnectedPing: {
				const ping = new UnconnectedPing(message).deserialize();
				const pong = new UnconnectedPong();
				pong.serverGuid = this.options.guid;
				pong.serverTimestamp = BigInt(Date.now());
				pong.message = AdvertisementToString({
					type: "MCPE",
					gamemode: "Survival",
					maxPlayers: this.options.maxConnections,
					playerCount: this.connections.size,
					protocol: this.options.protocol,
					serverName: this.options.levelName,
					version: this.options.version,
					serverGUID: Number(this.options.guid),
					message: this.options.motd,
				});
				this.socket.send(pong.serialize(), remote.port, remote.address);
				break;
			}
			case Packet.OpenConnectionRequestOne: {
				if (!this.connectionTimes.has(`${remote.address}:${remote.port}`)) {
					this.connectionTimes.set(
						`${remote.address}:${remote.port}`,
						Date.now(),
					);
				}

				const request = new OpenConnectionRequestOne(message).deserialize();
				Logger.debug(
					`Received OpenConnectionRequestOne from ${remote.address}:${remote.port} with mtu ${request.mtu}`,
				);
				if (request.protocol !== this.options.protocol) {
					Logger.warn(
						`Client ${remote.address}:${remote.port} tried to connect with invalid protocol ${request.protocol}`,
					);
					const incompatible = new IncompatibleProtocolVersion();
					incompatible.protocol = this.options.protocol;
					incompatible.guid = this.options.guid;
					this.socket.send(
						incompatible.serialize(),
						remote.port,
						remote.address,
					);
					break;
				}

				Logger.debug(
					`Sending OpenConnectionReplyOne to ${remote.address}:${remote.port} with mtu ${this.options.mtu}`,
				);
				const reply = new OpenConnectionReplyOne();
				reply.mtu = this.options.mtu;
				reply.serverGuid = this.options.guid;
				reply.serverHasSecurity = false;
				this.socket.send(reply.serialize(), remote.port, remote.address);
				break;
			}
			case Packet.OpenConnectionRequestTwo: {
				const request = new OpenConnectionRequestTwo(message).deserialize();
				Logger.debug(
					`Received OpenConnectionRequestTwo from ${remote.address}:${remote.port} with mtu ${request.mtu}`,
				);
				const reply = new OpenConnectionReplyTwo();
				reply.mtu = this.options.mtu;
				reply.clientAddress = Address.fromIdentifier(remote);
				reply.encryptionEnabled = false;
				reply.serverGuid = this.options.guid;
				this.socket.send(reply.serialize(), remote.port, remote.address);
				const connection = new Connection(
					this,
					remote,
					request.clientGuid,
					request.mtu,
				);
				this.connections.set(`${remote.address}:${remote.port}`, connection);
				break;
			}
			default: {
				// 0x80 is FrameSet with no connection so we must ignore it
				if (packetId === 0x80) return;
				Logger.info(`Received unknown packet: ${packetId}`);
			}
		}
	}

	public deleteConnection(address: string) {
		const connection = this.connections.get(address);
		if (connection) {
			this.emit("closeConnection", connection);
		}
		this.connections.delete(address);
		this.connectionTimes.delete(address);
	}

	public close() {
		clearTimeout(this.timer);
		for (const connection of this.connections.values()) {
			connection.disconnect();
		}
		// just wait for all connections to disconnect
		setTimeout(() => {
			this.socket.close();
		}, 200);
	}
}

export { Server };
