import { EventEmitter } from "node:events";
import { defaultOptions, type Options } from "./options";
import { createSocket, type Socket } from "node:dgram";
import { Sender } from "./sender";
import Emitter from "@serenityjs/emitter";
import type { ClientEvents } from "./client-events";
import { Receiver } from "./receiver";
import type { Advertisement } from "./types/Advertisement";
import { Priority, Status } from "@serenityjs/raknet";
import { Disconnect } from "./packets";

class Client extends Emitter<ClientEvents> {
	public options: Options;
	public tick = 0;
	public socket: Socket;
	public status: Status = Status.Disconnected;
	public receiver: Receiver;
	public sender: Sender;

	private ticker!: NodeJS.Timer;

	constructor(options: Partial<Options> = {}) {
		super();
		this.options = { ...defaultOptions, ...options };
		this.socket = createSocket("udp4");
		this.receiver = new Receiver(this, this.socket);
		this.sender = new Sender(this);
	}

	public async connect(): Promise<Advertisement> {
		this.ticker = setInterval(() => {
			this.tick++;
			this.emit("tick");
		}, 50);
		this.tick++; 
		this.status = Status.Connecting;
		const advertisement = await this.ping();
		await Sender.connect(this);
		this.emit("connect");
		return advertisement;
	}

	public ping(): Promise<Advertisement> {
		return Sender.ping(this);
	}

	public send(packet: Buffer) {
		this.socket.send([packet], this.options.port, this.options.host);
	}

	public close() {
		this.emit("close");
		this.socket.close();
		clearInterval(this.ticker);
	}

	public disconnect() {
		const packet = new Disconnect();
		this.sender.frameAndSend(packet.serialize(), Priority.Immediate);
		this.on("ack", () => {
			this.close();
		});
	}
}

export { Client };
