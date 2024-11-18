import Emitter from "@serenityjs/emitter";
import { type ClientOptions, defaultClientOptions } from "./client_options";
import type { ClientEvents } from "./client-events";
import { RaknetClient as RakSocket } from "@sanctumterra/rs-rak-client";
import {
	Ack,
	ConnectedPing,
	ConnectedPong,
	ConnectionRequest,
	ConnectionRequestAccepted,
	Frameset,
	Nack,
	NewIncomingConnection,
	Packet,
	UnconnectedPing,
	UnconnectedPong,
} from "../proto";

export class Client extends Emitter<ClientEvents> {
	private rakSocket: RakSocket;

	public options: ClientOptions;
	public ticker!: NodeJS.Timeout;
	public tick = 0;
	private advertisement!: string;

	constructor(options: Partial<ClientOptions>) {
		super();
		this.options = { ...defaultClientOptions, ...options };
		this.rakSocket = new RakSocket(
			this.options.address,
			this.options.port,
			this.options.mtuSize,
		);
	}

	public async connect(): Promise<string> {
		this.rakSocket.connect();
		this.ticker = setInterval(() => {
			this.rakSocket.tick();
			this.handleData(this.rakSocket.receive());
			this.tick++;
		}, 50);
		await this.ping();
		return new Promise((resolve, reject) => {
			this.once("ack", () => {
				resolve(this.advertisement);
			});
		});
	}

	public async ping(): Promise<string> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				cleanup();
				reject(new Error("Ping timeout"));
			}, 5000);

			const pongHandler = (pong: UnconnectedPong) => {
				this.advertisement = pong.message;
				cleanup();
				resolve(pong.message);
			};

			const cleanup = () => {
				clearTimeout(timeout);
				this.remove("unconnected-pong", pongHandler);
			};

			this.rakSocket.ping();

			this.once("unconnected-pong", pongHandler);
		});
	}

	public frameAndSend(buffer: Buffer) {
		this.rakSocket.frameAndSend(buffer);
	}

	private handleData(data: Buffer) {
		if (!data || data.length === 0) {
			// console.log("Received empty data buffer");
			return;
		}

		let packetId = data[0];
		if ((packetId & 0xf0) === 0x80) packetId = 0x80;

		switch (packetId) {
			case Packet.Ack: {
				const ack = new Ack(data).deserialize();
				this.emit("ack", ack);
				break;
			}
			case Packet.FrameSet: {
				const frameset = new Frameset(data).deserialize();
				this.emit("frameset", frameset);
				break;
			}
			case Packet.ConnectedPing: {
				const connectedPing = new ConnectedPing(data).deserialize();
				this.emit("connected-ping", connectedPing);
				break;
			}
			case Packet.ConnectionRequest: {
				const connectionRequest = new ConnectionRequest(data).deserialize();
				this.emit("connection-request", connectionRequest);
				break;
			}
			case Packet.NewIncomingConnection: {
				const newIncomingConnection = new NewIncomingConnection(
					data,
				).deserialize();
				this.emit("new-incoming-connection", newIncomingConnection);
				break;
			}
			case Packet.UnconnectedPing: {
				const unconnectedPing = new UnconnectedPing(data).deserialize();
				this.emit("unconnected-ping", unconnectedPing);
				break;
			}
			case Packet.UnconnectedPong: {
				const unconnectedPong = new UnconnectedPong(data).deserialize();
				this.emit("unconnected-pong", unconnectedPong);
				break;
			}
			case Packet.Nack: {
				const nack = new Nack(data).deserialize();
				this.emit("nack", nack);
				break;
			}
			case Packet.ConnectedPong: {
				const connectedPong = new ConnectedPong(data).deserialize();
				this.emit("connected-pong", connectedPong);
				break;
			}
			case Packet.ConnectionRequestAccepted: {
				const connectionRequestAccepted = new ConnectionRequestAccepted(
					data,
				).deserialize();
				this.emit("connection-request-accepted", connectionRequestAccepted);
				break;
			}
		}
	}
}
