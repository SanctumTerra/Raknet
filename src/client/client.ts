import { Emitter } from "@serenityjs/emitter";
import type { ClientEvents } from "./client-evens";
import { type RemoteInfo, type Socket, createSocket} from "node:dgram";
import { Framer } from "./framer";
import { Ack, Address, type Advertisement, ConnectionRequest, type Frame, fromString, OpenConnectionReplyOne, OpenConnectionReplyTwo, OpenConnectionRequestOne, OpenConnectionRequestTwo, Packet, Priority, UnconnectedPing, UnconnectedPong } from "../proto";
import { type ClientOptions, defaultClientOptions } from "./client-options";
import { Logger } from "../utils";
import { Frameset } from "../proto/packets/frameset";

export 
class Client extends Emitter<ClientEvents> {
    public socket!: Socket;
    public framer!: Framer;
    public options: ClientOptions;
    private timer!: NodeJS.Timeout;
	private timeout!: NodeJS.Timeout;
    public serverAddress!: Address;

    private waitingForReplyTwo = false;
    private waitingForReplyOne = false;

    constructor(options: Partial<ClientOptions> = defaultClientOptions) {
        super();
        this.options = { ...defaultClientOptions, ...options };
    }

    public initSocket() { 
        try {
            this.socket = createSocket("udp4");
            this.framer = new Framer(this);
            this.socket.on("message", this.onMessage.bind(this));
        } catch (error) {
            Logger.error(`Failed to create socket: ${error}`);
        }
    }

    public async ping() : Promise<Advertisement | null> { 
        return new Promise((resolve) => {
            this.on("unconnected-pong", (packet) => {
                resolve(fromString(packet.message));
            });
            setTimeout(() => {
                resolve(null);
            }, this.options.timeout);

            const unconnectedPing = new UnconnectedPing();
            unconnectedPing.guid = this.options.clientId;
            unconnectedPing.clientTimestamp = BigInt(Date.now());
            this.send(unconnectedPing.serialize());
        });
    }

    public async connect() : Promise<Advertisement> {
        this.initSocket();
        this.timer = setInterval(() => {
            this.emit("tick");
        }, 50);
        const request = new OpenConnectionRequestOne();
        request.mtu = this.options.mtuSize;
        request.protocol = this.options.protocolVersion;
        this.emit("open-connection-request-one", request);
        const advertisement = await this.ping();
        return new Promise((resolve, reject) => {
			if(this.timeout) clearInterval(this.timeout);
            this.timeout = setTimeout(() => {
                this.removeAll();
                this.socket.removeAllListeners();
                this.socket.close();
                clearInterval(this.timer);
                clearInterval(this.timeout);
                reject(new Error("Failed to connect, timed out."));
            }, this.options.timeout);
            this.once("ack", (packet) => {
                if(advertisement) { 
					clearInterval(this.timeout);
					resolve(advertisement);
				}
            });
            this.waitForReply1();
            this.send(request.serialize());
        });
    }

    public sendFrame(frame: Frame, priority: Priority): void {
        this.framer.sendFrame(frame, priority);
    }

    public send(buffer: Buffer) {
        if(this.options.debug) Logger.debug(`Sending ${buffer[0]}, ${buffer.length} bytes to ${this.options.address}:${this.options.port}`);
        this.socket.send(buffer, 0, buffer.length, this.options.port, this.options.address);
    }

    private waitForReply2() { 
        if(this.waitingForReplyTwo) return;
        this.waitingForReplyTwo = true;
        const timeout = setTimeout(() => {
            this.waitingForReplyTwo = false;
            if(this.options.debug) Logger.debug("Failed to receive OpenConnectionReplyTwo");
            this.connect();
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
            if(this.options.debug) Logger.debug(`Received packet ${packetId} from ${rinfo.address}:${rinfo.port}`);
            switch(packetId) {
                case Packet.Ack: {
                    const packet = new Ack(msg).deserialize();
                    // this.emit("ack", packet);
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
                    this.serverAddress = new Address(rinfo.address, rinfo.port, rinfo.family === "IPv4" ? 4 : 6);
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
                    const conReq = new ConnectionRequest();
                    conReq.clientGuid = this.options.clientId;
                    conReq.timestamp = BigInt(Date.now());
                    conReq.useSecurity = false;
                    this.emit("connection-request", conReq);
                    this.framer.frameAndSend(conReq.serialize(), Priority.Immediate);
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
            Logger.error(`Failed to handle packet: ${error}`);
        }
    }

    private waitForReply1() {
        if(this.waitingForReplyOne) return;
        this.waitingForReplyOne = true;
        const timeout = setTimeout(() => {
            this.waitingForReplyOne = false;
            if(this.options.debug) Logger.debug("Failed to receive OpenConnectionReplyOne");
            this.connect();
        }, 500);
        this.once("open-connection-reply-one", () => {
            clearTimeout(timeout);
            this.waitingForReplyOne = false;
        });
    }
}
