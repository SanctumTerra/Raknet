import { Ack, Address, ConnectedPing, ConnectedPong, ConnectionRequestAccepted, Frame, FrameSet, Nack, Packet, Priority, Reliability, Status } from "@serenityjs/raknet";
import { RakNetClient } from "./RaknetClient";
import { OhMyNewIncommingConnection } from "../packets/raknet/OhMyNewIncommingConnection";
import { BinaryStream } from "@serenityjs/binarystream";
import { Logger } from "../utils/Logger";


export class FrameHandler {
    private lastInputSequence: number = -1;
    private receivedFrameSequences: Set<number> = new Set();
    private lostFrameSequences: Set<number> = new Set();
    private inputHighestSequenceIndex: number[] = new Array(32).fill(0);
    private inputOrderIndex: number[] = new Array(32).fill(0);

    protected inputOrderingQueue: Map<number, Map<number, Frame>> = new Map();
	protected readonly fragmentsQueue: Map<number, Map<number, Frame>> =
		new Map();

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
            return Logger.debug(`Received duplicate frameset ${frameSet.sequence}`);
        }
        this.lostFrameSequences.delete(frameSet.sequence);

        if (
			frameSet.sequence < this.lastInputSequence || frameSet.sequence === this.lastInputSequence
		) {
            Logger.debug(`Received out of order frameset ${frameSet.sequence}!`)
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

        this.lastInputSequence = frameSet.sequence;

		for (const frame of frameSet.frames) {
			this.handleFrame(frame);
		}
    }

    private handleFrame(frame: Frame): void {
        if (frame.isSplit()) return this.handleFragment(frame);
        else if (frame.isSequenced()) return this.handleSequenced(frame);
        else if (frame.isOrdered()) this.handleOrdered(frame); 
        else this.processFrame(frame);        
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
        if (this.fragmentsQueue.has(frame.splitId)) {
            const fragment = this.fragmentsQueue.get(frame.splitId);
			if (!fragment) return;
            fragment.set(frame.splitIndex, frame);
            if (fragment.size === frame.splitSize) {
                const stream = new BinaryStream();
				for (let index = 0; index < fragment.size; index++) {
					const sframe = fragment.get(index) as Frame;
					stream.writeBuffer(sframe.payload);
				}

                const nframe = new Frame();
                nframe.reliability = frame.reliability;
                nframe.reliableIndex = frame.reliableIndex;
                nframe.sequenceIndex = frame.sequenceIndex;
                nframe.orderIndex = frame.orderIndex;
                nframe.orderChannel = frame.orderChannel;
                nframe.payload = stream.getBuffer();
                this.fragmentsQueue.delete(frame.splitId);
                return this.handleFrame(nframe);
            }
        } else {
			this.fragmentsQueue.set(
				frame.splitId,
				new Map([[frame.splitIndex, frame]])
			);
		}
    }

    private handleSequenced(frame: Frame): void {
        if (
            frame.sequenceIndex <
                (this.inputHighestSequenceIndex[frame.orderChannel] as number) ||
            frame.orderIndex < (this.inputOrderIndex[frame.orderChannel] as number)
        ) {
            return Logger.debug(
                `Recieved out of order frame ${frame.sequenceIndex}!`
            );
        }
        this.inputHighestSequenceIndex[frame.orderChannel] =
            frame.sequenceIndex + 1;
        return this.processFrame(frame);
    }

    private handleOrdered(frame: Frame): void {
        if (frame.orderIndex === this.inputOrderIndex[frame.orderChannel]) {
            this.inputHighestSequenceIndex[frame.orderChannel] = 0;
            this.inputOrderIndex[frame.orderChannel] = frame.orderIndex + 1;
            this.processFrame(frame);
            let index = this.inputOrderIndex[frame.orderChannel] as number;
            const outOfOrderQueue = this.inputOrderingQueue.get(
                frame.orderChannel
            ) as Map<number, Frame>;
            for (; outOfOrderQueue.has(index); index++) {
                const frame = outOfOrderQueue.get(index);
                if (!frame) break;
                this.processFrame(frame);
                outOfOrderQueue.delete(index);
            }
            this.inputOrderingQueue.set(frame.orderChannel, outOfOrderQueue);
            this.inputOrderIndex[frame.orderChannel] = index;
        } else if (
            frame.orderIndex > (this.inputOrderIndex[frame.orderChannel] as number)
        ) {
            const unordered = this.inputOrderingQueue.get(frame.orderChannel);
            if (!unordered) return;
            unordered.set(frame.orderIndex, frame);
        } else {
			return this.processFrame(frame);
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

