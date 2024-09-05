import { Ack, Address, Bitflags, Frame, FrameSet, Nack, OpenConnectionReply1, Packet, Priority, Reliability, Status, UnconnectedPing } from "@serenityjs/raknet";
import { RakNetClient } from "./raknet-client";
import { Logger } from "../vendor/Logger";
import { BinaryStream } from "@serenityjs/binarystream";
import { ConnectedPing, ConnectedPong, ConnectionRequest, ConnectionRequestAccepted, NewIncomingConnection, OpenConnectionFirstReply, OpenConnectionSecondReply, OpenConnectionSecondRequest, OpenFirstConnectionRequest } from "./packets";

const magic = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');

class Receiver {
    private lastInputSequence: number = -1;
    private receivedFrameSequences: Set<number> = new Set();
    private lostFrameSequences: Set<number> = new Set();
    private inputHighestSequenceIndex: number[] = new Array(64).fill(0);
    private inputOrderIndex: number[] = new Array(64).fill(0);

    protected inputOrderingQueue: Map<number, Map<number, Frame>> = new Map();
    protected readonly fragmentsQueue: Map<number, Map<number, Frame>> = new Map();

    private raknet: RakNetClient;

    constructor(raknet: RakNetClient) {
        this.raknet = raknet;
        for (let index = 0; index < 64; index++) {
            this.inputOrderingQueue.set(index, new Map());
        }

        this.raknet.on("tick", () => {
            this.tick();
        });
    }

    public incomingMessage(buffer: Buffer) {
        const packetId = buffer.readUint8();
        const ignore = [132, 192, 128];
        if (this.raknet.debug) if (!ignore.includes(packetId)) Logger.debug("Received Packet ID " + packetId);

        switch (packetId) {
            case Bitflags.Valid:
                this.handleFrameSet(buffer);
                break;
            case Packet.OpenConnectionReply1:
                this.handleOpenConnectionRequest2(buffer);
                break;
            case Packet.OpenConnectionReply2:
                this.handleOpenConnectionRequest();
                break;
            default:
                this.otherPackets(buffer);
                if (this.raknet.debug) Logger.debug('Received unknown packet ' + packetId);
        }
    }

    public otherPackets(buffer: Buffer) {
        const packetId = buffer.readUint8() & 0xf0;
        switch (packetId) {
            case Bitflags.Valid:
                this.handleFrameSet(buffer);
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

    public handleOpenConnectionRequest2(buffer: Buffer) {
        const reply2 = new OpenConnectionFirstReply(buffer).deserialize();
        const pak = new OpenConnectionSecondRequest();
        pak.mtu = 1024;
        pak.client = this.raknet.getId();
        pak.magic = reply2.magic;
        pak.address = new Address(this.raknet.socket.address().address, this.raknet.socket.address().port, 4);
        this.raknet.send(pak.serialize());
    }

    public handleOpenConnectionRequest() {
        const packet = new ConnectionRequest();
        packet.client = BigInt(this.raknet.getId());
        packet.timestamp = BigInt(Date.now());
        packet.security = false;
        const frame = new Frame();
        frame.reliability = Reliability.Reliable;
        frame.orderChannel = 0;
        frame.payload = packet.serialize();
        this.raknet.sender.sendFrame(frame, Priority.Immediate);
    }

    public sendConnectionPacket() {
        const packet = new OpenFirstConnectionRequest();
        packet.magic = Buffer.from(
            "\0\xFF\xFF\0\xFE\xFE\xFE\xFE\xFD\xFD\xFD\xFD4Vx",
            "binary"
        );
        packet.protocol = this.raknet.protocol;
        packet.mtu = 1024 - 36;
        const serializedPacket = packet.serialize();
        this.raknet.send(serializedPacket);
    }

    public sendUnconnectedPing() {
        const packet = new UnconnectedPing();
        packet.timestamp = BigInt(Date.now());
        packet.magic = magic;
        packet.client = BigInt(this.raknet.getId());
        this.raknet.send(packet.serialize());
    }

    private tick() {
        if (this.receivedFrameSequences.size > 0) {
            const ack = new Ack();
            ack.sequences = [...this.receivedFrameSequences];
            for (const sequence of this.receivedFrameSequences)
                this.receivedFrameSequences.delete(sequence);
            this.send(ack.serialize());
        }

        if (this.lostFrameSequences.size > 0) {
            const nack = new Nack();
            nack.sequences = [...this.lostFrameSequences];
            for (const sequence of this.lostFrameSequences)
                this.lostFrameSequences.delete(sequence);
            this.send(nack.serialize());
        }
    }

    public send(buffer: Buffer): void {
        this.raknet.send(buffer);
    }

    handleFrameSet(buffer: Buffer): void {
        const frameSet = new FrameSet(buffer).deserialize();

        if (this.receivedFrameSequences.has(frameSet.sequence)) {
            if (this.raknet.debug) Logger.debug(`Received duplicate frameset ${frameSet.sequence}`);
            return;
        }
        this.lostFrameSequences.delete(frameSet.sequence);

        if (frameSet.sequence < this.lastInputSequence || frameSet.sequence === this.lastInputSequence) {
            if (this.raknet.debug) Logger.debug(`Received out of order frameset ${frameSet.sequence}!`);
            return;
        }

        this.receivedFrameSequences.add(frameSet.sequence);
        const diff = frameSet.sequence - this.lastInputSequence;

        if (diff !== 1) {
            for (
                let index = this.lastInputSequence + 1;
                index < frameSet.sequence;
                index++
            ) {
                if (!this.receivedFrameSequences.has(index)) {
                    this.lostFrameSequences.add(index);
                }
            }
        }
        this.lastInputSequence = frameSet.sequence;

        for (const frame of frameSet.frames) {
            this.handleFrame(frame);
        }
    }

    private handleFrame(frame: Frame): void {
        if (this.raknet.debug) Logger.debug(`Handling frame: reliability=${frame.reliability}, orderIndex=${frame.orderIndex}, sequenceIndex=${frame.sequenceIndex}`);

        if (frame.isSplit()) {
            this.handleFragment(frame);
        } else if (frame.isSequenced()) {
            this.handleSequenced(frame);
        } else if (frame.isOrdered()) {
            this.handleOrdered(frame);
        } else {
            this.processFrame(frame);
        }
    }

    private processFrame(frame: Frame): void {
        const header = frame.payload[0] as number;

        switch (header) {
            case Packet.ConnectionRequestAccepted:
                this.handleConnectionRequestAccepted(frame);
                break;
            case Packet.ConnectedPing:
                this.handleConnectedPing(frame.payload);
                break;
            default:
                this.raknet.emit("encapsulated", frame);
                break;
        }
    }

    private handleFragment(frame: Frame): void {
        if (this.raknet.debug) Logger.debug(`Handling fragment: splitId=${frame.splitId}, splitIndex=${frame.splitIndex}, splitSize=${frame.splitSize}`);

        if (!this.fragmentsQueue.has(frame.splitId)) {
            this.fragmentsQueue.set(frame.splitId, new Map());
        }

        const fragment = this.fragmentsQueue.get(frame.splitId);
        if (!fragment) return;

        fragment.set(frame.splitIndex, frame);

        if (fragment.size === frame.splitSize) {
            if (this.raknet.debug) Logger.debug(`Reassembling complete frame from fragments: splitId=${frame.splitId}`);
            this.reassembleAndProcessFragment(frame, fragment);
        }
    }

    private reassembleAndProcessFragment(frame: Frame, fragment: Map<number, Frame>): void {
        const stream = new BinaryStream();
        for (let index = 0; index < fragment.size; index++) {
            const sframe = fragment.get(index);
            if (sframe) {
                stream.writeBuffer(sframe.payload);
            } else {
                Logger.error(`Missing fragment at index ${index} for splitId=${frame.splitId}`);
                return;
            }
        }

        const reassembledFrame = new Frame();
        reassembledFrame.reliability = frame.reliability;
        reassembledFrame.reliableIndex = frame.reliableIndex;
        reassembledFrame.sequenceIndex = frame.sequenceIndex;
        reassembledFrame.orderIndex = frame.orderIndex;
        reassembledFrame.orderChannel = frame.orderChannel;
        reassembledFrame.payload = stream.getBuffer();

        this.fragmentsQueue.delete(frame.splitId);
        this.handleFrame(reassembledFrame);
    }

    private handleSequenced(frame: Frame): void {
        const currentHighestSequence = this.inputHighestSequenceIndex[frame.orderChannel];
        if (this.raknet.debug) Logger.debug(`Handling sequenced frame: sequenceIndex=${frame.sequenceIndex}, currentHighest=${currentHighestSequence}`);

        if (frame.sequenceIndex > currentHighestSequence) {
            this.inputHighestSequenceIndex[frame.orderChannel] = frame.sequenceIndex;
            this.processFrame(frame);
        } else {
            if (this.raknet.debug) Logger.debug(`Discarding old sequenced frame: ${frame.sequenceIndex}`);
        }
    }

    private handleOrdered(frame: Frame): void {
        if (this.raknet.debug) Logger.debug(`Handling ordered frame: orderIndex=${frame.orderIndex}, channel=${frame.orderChannel}`);

        const expectedOrderIndex = this.inputOrderIndex[frame.orderChannel];
        const outOfOrderQueue = this.inputOrderingQueue.get(frame.orderChannel) as Map<number, Frame>;

        if (frame.orderIndex === expectedOrderIndex) {
            this.processOrderedFrames(frame, outOfOrderQueue);
        } else if (frame.orderIndex > expectedOrderIndex) {
            if (this.raknet.debug) Logger.debug(`Queuing out-of-order frame: ${frame.orderIndex}`);
            outOfOrderQueue.set(frame.orderIndex, frame);
        } else {
            if (this.raknet.debug) Logger.debug(`Discarding old frame: ${frame.orderIndex}`);
        }
    }

    private processOrderedFrames(frame: Frame, outOfOrderQueue: Map<number, Frame>): void {
        this.processFrame(frame);
        this.inputOrderIndex[frame.orderChannel]++;

        let nextOrderIndex = this.inputOrderIndex[frame.orderChannel];
        while (outOfOrderQueue.has(nextOrderIndex)) {
            const nextFrame = outOfOrderQueue.get(nextOrderIndex);
            if (nextFrame) {
                if (this.raknet.debug) Logger.debug(`Processing queued frame: ${nextOrderIndex}`);
                this.processFrame(nextFrame);
                outOfOrderQueue.delete(nextOrderIndex);
                this.inputOrderIndex[frame.orderChannel]++;
                nextOrderIndex++;
            }
        }
    }

    private handleConnectedPing(buffer: Buffer): void {
        const packet = new ConnectedPing(buffer);
        const deserializedPacket = packet.deserialize();

        const pong = new ConnectedPong();
        pong.pingTime = deserializedPacket.timestamp;
        pong.pongTime = BigInt(Date.now());

        const frame = new Frame();
        frame.reliability = Reliability.Unreliable;
        frame.orderChannel = 0;
        frame.payload = pong.serialize();

        this.raknet.sender.sendFrame(frame, Priority.Immediate);
    }

    handleConnectionRequestAcceptedTwo(frame: Frame) {
        let des = new ConnectionRequestAccepted(frame.payload).deserialize();

        let packet = new NewIncomingConnection();
        packet.internalAddresses = new Array<Address>(10).fill(new Address('0.0.0.0', 0, 4));
        packet.serverAddress = des.address;
        packet.incomingTimestamp = BigInt(Date.now());
        packet.serverTimestamp = des.timestamp;
        return packet;
    }

    private handleConnectionRequestAccepted(frame: Frame): void {
        let des;
        let packet;

        try {
            const IncomingPacket = new ConnectionRequestAccepted(frame.payload);
            des = IncomingPacket.deserialize();

            packet = new NewIncomingConnection();
            packet.internalAddresses = new Array<Address>(10).fill(new Address('0.0.0.0', 0, 4));
            packet.serverAddress = new Address(des.address.address, des.address.port, 4);
            packet.incomingTimestamp = BigInt(Date.now());
            packet.serverTimestamp = des.timestamp;
        } catch (error) {
            packet = this.handleConnectionRequestAcceptedTwo(frame);
        }

        if (!packet) {
            console.error('Failed to deserialize IncomingPacket!');
            return;
        }

        const sendFrame = new Frame();
        sendFrame.reliability = Reliability.ReliableOrdered;
        sendFrame.orderChannel = 0;
        sendFrame.payload = packet.serialize();

        if (!sendFrame.payload) {
            console.error('Failed to serialize the packet!');
            return;
        }

        this.raknet.status = Status.Connected;
        this.raknet.sender.sendFrame(sendFrame, Priority.Immediate);
        void this.raknet.emit("connect", {});
    }
}

export { Receiver };