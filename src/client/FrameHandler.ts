import { Ack, Address, ConnectedPing, ConnectedPong, ConnectionRequestAccepted, Frame, FrameSet, Nack, Packet, Priority, Reliability, Status } from "@serenityjs/raknet";
import { RakNetClient } from "./RaknetClient";
import { OhMyNewIncommingConnection } from "../packets/raknet/OhMyNewIncommingConnection";
import { BinaryStream } from "@serenityjs/binarystream";
import { Logger } from "../utils/Logger";
import { OhMyConnectionRequestAccepted } from "../packets/raknet/OhMyConnectionRequestAccepted";


export class FrameHandler {
    private lastInputSequence: number = -1;
    private receivedFrameSequences: Set<number> = new Set();
    private lostFrameSequences: Set<number> = new Set();
    private inputHighestSequenceIndex: number[] = new Array(64).fill(0);
    private inputOrderIndex: number[] = new Array(64).fill(0);

    protected inputOrderingQueue: Map<number, Map<number, Frame>> = new Map();
	protected readonly fragmentsQueue: Map<number, Map<number, Frame>> =
		new Map();

    private raknet: RakNetClient;	


    constructor(raknet: RakNetClient) {
        this.raknet = raknet;
		for (let index = 0; index < 64; index++) {
			this.inputOrderingQueue.set(index, new Map());
		}

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
        Logger.debug(`Handling frame: reliability=${frame.reliability}, orderIndex=${frame.orderIndex}, sequenceIndex=${frame.sequenceIndex}`);
    
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
        Logger.debug(`Handling fragment: splitId=${frame.splitId}, splitIndex=${frame.splitIndex}, splitSize=${frame.splitSize}`);
    
        if (!this.fragmentsQueue.has(frame.splitId)) {
            this.fragmentsQueue.set(frame.splitId, new Map());
        }
    
        const fragment = this.fragmentsQueue.get(frame.splitId);
        if (!fragment) return;
    
        fragment.set(frame.splitIndex, frame);
    
        if (fragment.size === frame.splitSize) {
            Logger.debug(`Reassembling complete frame from fragments: splitId=${frame.splitId}`);
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
        Logger.debug(`Handling sequenced frame: sequenceIndex=${frame.sequenceIndex}, currentHighest=${currentHighestSequence}`);
    
        if (frame.sequenceIndex > currentHighestSequence) {
            this.inputHighestSequenceIndex[frame.orderChannel] = frame.sequenceIndex;
            this.processFrame(frame);
        } else {
            Logger.debug(`Discarding old sequenced frame: ${frame.sequenceIndex}`);
        }
    }

    private handleOrdered(frame: Frame): void {
        Logger.debug(`Handling ordered frame: orderIndex=${frame.orderIndex}, channel=${frame.orderChannel}`);
    
        const expectedOrderIndex = this.inputOrderIndex[frame.orderChannel];
        const outOfOrderQueue = this.inputOrderingQueue.get(frame.orderChannel) as Map<number, Frame>;
    
        if (frame.orderIndex === expectedOrderIndex) {
            this.processOrderedFrames(frame, outOfOrderQueue);
        } else if (frame.orderIndex > expectedOrderIndex) {
            Logger.debug(`Queuing out-of-order frame: ${frame.orderIndex}`);
            outOfOrderQueue.set(frame.orderIndex, frame);
        } else {
            Logger.debug(`Discarding old frame: ${frame.orderIndex}`);
        }
    }

    private processOrderedFrames(frame: Frame, outOfOrderQueue: Map<number, Frame>): void {
        this.processFrame(frame);
        this.inputOrderIndex[frame.orderChannel]++;
    
        let nextOrderIndex = this.inputOrderIndex[frame.orderChannel];
        while (outOfOrderQueue.has(nextOrderIndex)) {
            const nextFrame = outOfOrderQueue.get(nextOrderIndex);
            if (nextFrame) {
                Logger.debug(`Processing queued frame: ${nextOrderIndex}`);
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
        pong.pingTimestamp = deserializedPacket.timestamp;
        pong.timestamp = BigInt(Date.now());

        const frame = new Frame();
        frame.reliability = Reliability.Unreliable;
        frame.orderChannel = 0;
        frame.payload = pong.serialize();
        
        this.raknet.queue.sendFrame(frame, Priority.Immediate);
    }

    handleConnectionRequestAcceptedTwo(frame: Frame){
        let des = new OhMyConnectionRequestAccepted(frame.payload).deserialize();

        let packet = new OhMyNewIncommingConnection();
            packet.internalAddress = new Array<Address>()
            for (let i = 0; i < 10; i++) {
                packet.internalAddress[i] = new Address('0.0.0.0', 0, 4);
            }
            packet.serverAddress = des.serverAddress
            packet.incomingTimestamp = BigInt(Date.now());
            packet.serverTimestamp = des.serverTimestamp; 
        return packet;
    }

    private handleConnectionRequestAccepted(frame: Frame): void {
        let des;

        let packet;

        try {
            const IncomingPacket = new ConnectionRequestAccepted(frame.payload);
            des = IncomingPacket.deserialize();

            packet = new OhMyNewIncommingConnection();
            packet.internalAddress = new Array<Address>()
            for (let i = 0; i < 10; i++) {
                packet.internalAddress[i] = new Address('0.0.0.0', 0, 4);
            }
            packet.serverAddress = new Address(des.address.address, des.address.port, 4);
            packet.incomingTimestamp = BigInt(Date.now());
            packet.serverTimestamp = des.timestamp; 
        } catch(error){
            packet = this.handleConnectionRequestAcceptedTwo(frame);
        }

        if (!packet) {
            console.error('Failed to deserialize IncomingPacket!');
            return;
        }
        console.log('packet ', packet)
        

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

