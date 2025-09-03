import {
	type Ack,
	Address,
	ConnectedPing,
	ConnectedPong,
	ConnectionRequest,
	ConnectionRequestAccepted,
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
	private session: NetworkSession;

	constructor(
		private server: Server,
		private rinfo: RemoteInfo,
		private mtu: number,
		private guid: bigint,
	) {
		super();
		this.session = new NetworkSession(this.mtu);
		this.session.send = this.send.bind(this);
		this.session.handle = this.onMessage.bind(this);
	}

	public onTick(tick: number) {
		this.session.onTick(tick);
	}

	public onFrameSet(frameSet: FrameSet) {
		this.session.onFrameSet(frameSet);
	}

	public getAddress(): RemoteInfo {
		return this.rinfo;
	}

	public onMessage(data: Buffer) {
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
				this.server.emit("disconnect", this);
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
