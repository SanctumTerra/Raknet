import { 
    Ack,
    Address, 
    MAX_MTU_SIZE, 
    DGRAM_MTU_OVERHEAD, 
    Frame, 
    Nack, 
    OpenConnectionReply1, 
    OpenConnectionRequest1, 
    OpenConnectionRequest2, 
    Packet, 
    Priority, 
    Reliability, 
    UnconnectedPing,
    Bitflags
} from "@serenityjs/raknet";
import { RakNetClient } from "./RaknetClient";
import { FrameHandler } from "./FrameHandler";
import { NewConnectionRequest } from "../packets/raknet/NewConnectionRequest";
import { Logger } from "../utils/Logger";

const magic = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');

export  class PacketHandler {
    public framehandler: FrameHandler;

	constructor(private client: RakNetClient) {
        this.framehandler = new FrameHandler(this.client);
    }

    public handleIncoming(buffer: Buffer){
        const packetId = buffer.readUint8();
        const ignore = [132, 192, 128]
        if(!ignore.includes(packetId)) Logger.debug("Received Packet ID " + packetId)

        switch (packetId) {
            case Bitflags.Valid+44: 
                this.framehandler.handleFrameSet(buffer);
            break;
            case Packet.OpenConnectionReply1:
                this.handleOpenConnectionRequest2(buffer);
                break;
            case Packet.OpenConnectionReply2:
                this.handleOpenConnectionRequest();
                break;
            default:
                this.otherPackets(buffer)
                Logger.debug('Received unknown packet ' + packetId);
        }
    }

    public otherPackets(buffer: Buffer){
        const packetId = buffer.readUint8() & 0xf0;
        switch (packetId) {
            case Bitflags.Valid:
                this.framehandler.handleFrameSet(buffer);
                break;
            case Packet.Ack:
                //this.ack(buffer);
                break;
            case Packet.Nack:
                //Logger.debug(new Nack(buffer).deserialize());
                break;
            default:
                break;
        }
    }



    public handleOpenConnectionRequest2(buffer: Buffer){
        const reply2 = new OpenConnectionReply1(buffer).deserialize();
        const pak = new OpenConnectionRequest2();
        pak.mtu = 1024;
        pak.client = this.client.id;
        pak.magic = reply2.magic;
        pak.address = new Address(this.client.socket.address().address, this.client.socket.address().port, 4);
        this.client.send(pak.serialize())
    }

    public handleOpenConnectionRequest(){
        const packet = new NewConnectionRequest();
		packet.client = BigInt(this.client.id);
		packet.timestamp = BigInt(Date.now());
        packet.security = false;
		const frame = new Frame();
		frame.reliability = Reliability.Reliable;
		frame.orderChannel = 0;
		frame.payload = packet.serialize();
		this.client.queue.sendFrame(frame, Priority.Immediate);
    }



    public sendConnectionPacket() {
        const packet = new OpenConnectionRequest1();
        packet.magic = Buffer.from(
            "\0\xFF\xFF\0\xFE\xFE\xFE\xFE\xFD\xFD\xFD\xFD4Vx",
            "binary"
        );
        packet.protocol = this.client.protocol;
        packet.mtu = 1024-DGRAM_MTU_OVERHEAD;
        const serializedPacket = packet.serialize(); 
        this.client.send(serializedPacket);
    }

    public sendUnconnectedPing(){
        const packet = new UnconnectedPing();
        packet.timestamp = BigInt(Date.now());
        packet.magic = magic;
        packet.client = BigInt(this.client.id);
        this.client.send(packet.serialize());
    }

}
