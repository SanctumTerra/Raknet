import EventEmitter from "events";
import dgram from "dgram";
import { Address, Magic, Packet, type Status } from "@serenityjs/raknet";
import { Receiver } from "./receiver";
import { Sender } from "./sender";
import { OpenFirstConnectionRequest, UnconnectedPing } from "./packets";
import { error } from "console";
import { Logger } from "../vendor/Logger";

class RakNetClient extends EventEmitter {
    public socket: dgram.Socket;

    private ticker: NodeJS.Timer;
    public receiver!: Receiver;
    public sender!: Sender;

    private id!: bigint;
    private address!: string;
    private port!: number;
    public status!: Status;
    public protocol: number;
    public mtu: number = 1024;
    public debug: boolean = false;

    constructor(protocol: number = 11, debug: boolean = false) { 
        super();
        this.protocol = protocol;
        this.debug = debug;
        this.socket = dgram.createSocket("udp4");
        this.ticker = setInterval(() => { this.emit("tick") }, 50);
        this.id = BigInt(Math.floor(Math.random() * 9007199254740991));
    }

    public async connect(address: string, port: number): Promise<void> {
        this.port = port;
        this.address = address;
        this.receiver = new Receiver(this);
        this.sender = new Sender(this);
        this.socket.on("error", (error) => { console.error(error) })
        this.socket.on("message", (msg) => { this.receiver.incomingMessage(msg) });
        // this.ping();


        const packet = new OpenFirstConnectionRequest()
        packet.magic = new Magic();
        /* Buffer.from(
            "\0\xFF\xFF\0\xFE\xFE\xFE\xFE\xFD\xFD\xFD\xFD4Vx",
            "binary"
        );
        */
        packet.protocol = this.protocol;
        packet.mtu = 1024 - 36;
        const serializedPacket = packet.serialize(); 
        this.send(serializedPacket);
    }

    public ping(): void { 
        const magic = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');
        const ping = new UnconnectedPing();
        ping.timestamp = BigInt(Date.now());
        ping.magic = magic;
        ping.client = BigInt(this.id);
        this.send(ping.serialize());
    }

    public async close(): Promise<void> {
        await this.socket.close();
    }

    public send(packet: Buffer) {
        if(this.debug) Logger.debug(`§3Sending packet §e${packet[0]} §3to §6${this.address}:${this.port}`);
        this.socket.send(packet, 0, packet.length, this.port, this.address, (err) => {
          if (err) {
            console.error('Error sending packet:', err);
          }
        });
    }

    public getAddress(): Address {
        return new Address(this.socket.address().address, this.socket.address().port, 4);
    }

    public getId(): bigint {
        return this.id;
    }
}

export { RakNetClient }