import {
	type Ack,
	Address,
	ConnectedPing,
	ConnectedPong,
	ConnectionRequest,
	ConnectionRequestAccepted,
	DisconnectMessage,
	EventEmitter,
	type Frame,
	type FrameSet,
	Logger,
	NetworkSession,
	Packets,
	Priority,
} from "../shared";
import type { Server } from "./server";
import type { RemoteInfo } from "node:dgram";
import type { ConnectionEvents } from "./types";

export class Connection extends EventEmitter<ConnectionEvents> {
	private static readonly STALE_TIMEOUT_MS = 10000; // 10 seconds without activity = stale
	private static readonly PING_INTERVAL_TICKS = 100; // Send ping every ~2 seconds at 50 tick rate

	private session: NetworkSession;
	private lastActivityTime: number = Date.now();
	private isDisconnected = false;

	constructor(
		private server: Server,
		private rinfo: RemoteInfo,
		private mtu: number,
		private guid: bigint,
	) {
		super();
		this.session = new NetworkSession(
			this.mtu,
			this.server.options.enableServerLogs,
		);
		this.session.send = this.send.bind(this);
		this.session.handle = this.onMessage.bind(this);
	}

	public onTick(tick: number) {
		if (this.isDisconnected) return;

		// Check for stale connection
		const timeSinceLastActivity = Date.now() - this.lastActivityTime;
		if (timeSinceLastActivity > Connection.STALE_TIMEOUT_MS) {
			this.disconnect("Connection timed out (stale)");
			return;
		}

		// Send connected ping periodically
		if (tick % Connection.PING_INTERVAL_TICKS === 0) {
			const ping = new ConnectedPing();
			ping.timestamp = BigInt(Date.now());
			this.session.frameAndSend(ping.serialize(), Priority.High);
		}

		this.session.onTick();
	}

	public disconnect(reason = "Disconnected"): void {
		if (this.isDisconnected) return;
		this.isDisconnected = true;

		// Send disconnect packet to client
		const disconnect = new DisconnectMessage();
		this.session.frameAndSend(disconnect.serialize(), Priority.High);

		// Emit disconnect event with reason
		this.server.emit("disconnect", { connection: this, reason });
	}

	public isStale(): boolean {
		return this.isDisconnected;
	}

	public onFrameSet(frameSet: FrameSet) {
		this.lastActivityTime = Date.now();
		this.session.onFrameSet(frameSet);
	}

	public getAddress(): RemoteInfo {
		return this.rinfo;
	}

	public onMessage(data: Buffer) {
		this.lastActivityTime = Date.now();
		const id = data[0];

		switch (id) {
			case Packets.ConnectionRequest: {
				const request = new ConnectionRequest(data).deserialize();

				const accepted = new ConnectionRequestAccepted();
				accepted.address = new Address(
					this.rinfo.address,
					this.rinfo.port,
					this.rinfo.family === "IPv4" ? 4 : 6,
				);
				// 20 addresses
				accepted.addresses = Array<Address>().fill(
					new Address("0.0.0.0", this.server.options.port, 4),
					0,
					20,
				);

				accepted.requestTimestamp = request.timestamp;
				accepted.systemIndex = 0;
				accepted.timestamp = BigInt(Date.now());
				this.session.frameAndSend(accepted.serialize(), Priority.High);
				break;
			}
			case Packets.NewIncomingConnection: {
				this.server.emit("connect", this);
				break;
			}
			case Packets.Disconnect: {
				this.isDisconnected = true;
				this.server.emit("disconnect", {
					connection: this,
					reason: "Client disconnected",
				});
				break;
			}
			case Packets.ConnectedPing: {
				const ping = new ConnectedPing(data).deserialize();
				const pong = new ConnectedPong();
				pong.pingTimestamp = ping.timestamp;
				pong.pongTimestamp = BigInt(Date.now());
				this.session.frameAndSend(pong.serialize(), Priority.High);
				break;
			}
			case Packets.ConnectedPong: {
				// Pong received, activity time already updated above
				break;
			}
			case 254: {
				this.emit("encapsulated", data);
				break;
			}
			default: {
				Logger.warn(`Unknown packet received ${id} - `, data.slice(0, 25));
				break;
			}
		}
	}

	public onAck(message: Ack) {
		this.session.onAck(message);
	}

	/** Nack Packet is same as Ack just different id's and we do not care about the ids. */
	public onNack(message: Ack) {
		this.session.onNack(message);
	}

	public sendFrame(frame: Frame, priority: Priority = Priority.High) {
		this.session.sendFrame(frame, priority);
	}

	public frameAndSend(payload: Buffer, priority: Priority = Priority.High) {
		this.session.frameAndSend(payload, priority);
	}

	public send(data: Buffer) {
		this.server.send(data, this.rinfo.address, this.rinfo.port);
	}
}
