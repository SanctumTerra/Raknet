import { Ack, Address, ConnectedPing, ConnectedPong, ConnectionRequestAccepted, Frame, FrameSet, Nack, Packet, Priority, Reliability, Status } from "@serenityjs/raknet";
import { RakNetClient } from "./RaknetClient";
import { OhMyNewIncommingConnection } from "../packets/raknet/OhMyNewIncommingConnection";
import { BinaryStream } from "@serenityjs/binarystream";
import { Logger } from "../utils/Logger";

export class Queue<T> {
    private elements: T[] = [];

    enqueue(element: T): void {
        this.elements.push(element);
    }

    dequeue(): T | undefined {
        return this.elements.shift();
    }

    peek(): T | undefined {
        return this.elements[0];
    }

    isEmpty(): boolean {
        return this.elements.length === 0;
    }

    size(): number {
        return this.elements.length;
    }
}

export class FrameHandler {
    private fragmentedPackets: Map<number, Map<number, Frame>> = new Map();
    private reliablePackets: Map<number, Frame> = new Map();
    private orderedPackets: Map<number, Map<number, Frame>> = new Map();
    private highestSequence: number = -1;
    private lastInputSequence: number = -1;
    private receivedFrameSequences: Set<number> = new Set();
    private lostFrameSequences: Set<number> = new Set();
    private inputHighestSequenceIndex: number[] = new Array(32).fill(0);
    private inputOrderIndex: number[] = new Array(32).fill(0);

    private frameQueue: Queue<Frame> = new Queue<Frame>();

    private raknet: RakNetClient;	


    constructor(raknet: RakNetClient) {
        this.raknet = raknet;
        this.raknet.on("tick", () => {
            this.tick();
        })
    }


    tick(){
		if (this.receivedFrameSequences.size > 0) {
			const ack = new Ack();
			ack.sequences = [...this.receivedFrameSequences].map((x) => {
				this.receivedFrameSequences.delete(x);
				return x;
			});
			this.send(ack.serialize());
		}

        if (this.lostFrameSequences.size > 0) {
			const pk = new Nack();
			pk.sequences = [...this.lostFrameSequences].map((x) => {
				this.lostFrameSequences.delete(x);
				return x;
			});
			this.send(pk.serialize());
		}
    }

	public send(buffer: Buffer): void {
		this.raknet.send(buffer);
	}

    handleFrameSet(buffer: Buffer): void {
        const frameSet = new FrameSet(buffer).deserialize();
        if (frameSet.sequence <= this.highestSequence) {
            Logger.debug(`Ignoring old or duplicate FrameSet: ${frameSet.sequence}`);
            return;
        }

        this.receivedFrameSequences.add(frameSet.sequence);
        const diff = frameSet.sequence - this.lastInputSequence;

        if (diff !== 1) {
            for (let index = this.lastInputSequence + 1; index < frameSet.sequence; index++) {
                if (!this.receivedFrameSequences.has(index)) {
                    this.lostFrameSequences.add(index);
                }
            }
        }

        this.lastInputSequence = frameSet.sequence;
        this.highestSequence = frameSet.sequence;

        for (const frame of frameSet.frames) {
            this.frameQueue.enqueue(frame);
        }

        this.processQueuedFrames();
    }

    private handleFrame(frame: Frame): void {
        if (frame.isFragmented()) {
            this.handleFragmentedFrame(frame);
        } else if (frame.isSequenced()) {
            this.handleSequencedFrame(frame);
        } else if (frame.isOrdered()) {
            this.handleOrderedFrame(frame);
        } else if (frame.isReliable()) {
            this.handleReliableFrame(frame);
        } else {
            this.processFrame(frame);
        }
    }

    private processFrame(frame: Frame): void {
        const header = (frame.payload[0] as number);
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

    private processQueuedFrames(): void {
        while (!this.frameQueue.isEmpty()) {
            const frame = this.frameQueue.dequeue();
            if (frame) {
                try {
                    this.handleFrame(frame);
                } catch (error) {
                    Logger.error(`Error processing frame: ${error}`);
                }
            }
        }
    }

    private handleFragmentedFrame(frame: Frame): void {
        if (!this.fragmentedPackets.has(frame.fragmentId)) {
            this.fragmentedPackets.set(frame.fragmentId, new Map());
        }
        const fragments = this.fragmentedPackets.get(frame.fragmentId)!;
        fragments.set(frame.fragmentIndex, frame);

        if (fragments.size === frame.fragmentSize) {
            const stream = new BinaryStream();
            for (let index = 0; index < fragments.size; index++) {
                const fragment = fragments.get(index)!;
                stream.writeBuffer(fragment.payload);
            }
            const reassembledFrame = new Frame();
            Object.assign(reassembledFrame, frame);
            reassembledFrame.payload = stream.getBuffer();
            reassembledFrame.fragmentSize = 0;
            this.fragmentedPackets.delete(frame.fragmentId);
            this.handleFrame(reassembledFrame);
        }
    }

    private handleSequencedFrame(frame: Frame): void {
        if (
            frame.sequenceIndex < this.inputHighestSequenceIndex[frame.orderChannel] ||
            frame.orderIndex < this.inputOrderIndex[frame.orderChannel]
        ) {
            return Logger.debug(`Received out of order frame ${frame.sequenceIndex}`);
        }
        this.inputHighestSequenceIndex[frame.orderChannel] = frame.sequenceIndex + 1;
        this.processFrame(frame);
    }

    private handleOrderedFrame(frame: Frame): void {
        if (frame.orderIndex === this.inputOrderIndex[frame.orderChannel]) {
            this.inputHighestSequenceIndex[frame.orderChannel] = 0;
            this.inputOrderIndex[frame.orderChannel] = frame.orderIndex + 1;
            this.processFrame(frame);

            let index = this.inputOrderIndex[frame.orderChannel];
            const outOfOrderQueue = this.orderedPackets.get(frame.orderChannel) || new Map();
            while (outOfOrderQueue.has(index)) {
                const nextFrame = outOfOrderQueue.get(index)!;
                this.processFrame(nextFrame);
                outOfOrderQueue.delete(index);
                index++;
            }
            this.orderedPackets.set(frame.orderChannel, outOfOrderQueue);
            this.inputOrderIndex[frame.orderChannel] = index;
        } else if (frame.orderIndex > this.inputOrderIndex[frame.orderChannel]) {
            const outOfOrderQueue = this.orderedPackets.get(frame.orderChannel) || new Map();
            outOfOrderQueue.set(frame.orderIndex, frame);
            this.orderedPackets.set(frame.orderChannel, outOfOrderQueue);
        }
    }

    private handleReliableFrame(frame: Frame): void {
        if (frame.reliableIndex > (this.reliablePackets.size > 0 ? Math.max(...this.reliablePackets.keys()) : -1)) {
            this.reliablePackets.set(frame.reliableIndex, frame);
            this.processReliableFrames();
        }
    }

    private processReliableFrames(): void {
        const sortedReliableIndexes = Array.from(this.reliablePackets.keys()).sort((a, b) => a - b);
        for (const index of sortedReliableIndexes) {
            const frame = this.reliablePackets.get(index)!;
            this.processFrame(frame);
            this.reliablePackets.delete(index);
        }
    }

    private handleConnectedPing(buffer: Buffer): void {
        const packet = new ConnectedPing(buffer);
        const deserializedPacket = packet.deserialize();
            
        const pong = new ConnectedPong();
        pong.pingTimestamp = deserializedPacket.timestamp;
        pong.timestamp = BigInt(Date.now());

        const frame = new Frame();
        frame.reliability = Reliability.Unreliable;
        frame.orderChannel = 0;
        frame.payload = pong.serialize();
        
        this.raknet.queue.sendFrame(frame, Priority.Immediate);
    }

    private handleConnectionRequestAccepted(frame: Frame): void {
        const IncomingPacket = new ConnectionRequestAccepted(frame.payload);
        const des = IncomingPacket.deserialize();
        if (!des) {
            console.error('Failed to deserialize IncomingPacket!');
            return;
        }

        const packet = new OhMyNewIncommingConnection();
        packet.internalAddress = new Array<Address>()
        for (let i = 0; i < 10; i++) {
            packet.internalAddress[i] = new Address('0.0.0.0', 0, 4);
        }
        packet.serverAddress = new Address(des.address.address, des.address.port, 4);
        packet.incomingTimestamp = BigInt(Date.now());
        packet.serverTimestamp = des.timestamp; 

        const sendFrame = new Frame();
        sendFrame.reliability = Reliability.ReliableOrdered;
        sendFrame.orderChannel = 0;
        sendFrame.payload = packet.serialize();
        if (!frame.payload) {
            console.error('Failed to serialize the packet!');
            return;
        }
        this.raknet.status = Status.Connected;

        this.raknet.queue.sendFrame(sendFrame, Priority.Immediate);
        void this.raknet.emit("connect", {});
    }
}

