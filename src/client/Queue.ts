import { Frame, FrameSet, Priority } from '@serenityjs/raknet';
import { RakNetClient} from './RaknetClient';

export class Queue {
	public outputBackupQueue = new Map<number, Array<Frame>>();
	public outputOrderIndex: Array<number>;
	public outputSequenceIndex: Array<number>;
	public outputFrameQueue: FrameSet;
	public outputSequence = 0;
	public outputReliableIndex = 0;
	public outputFragmentIndex = 0;
	public mtu: number = 1492;

	constructor(private client: RakNetClient) {
		this.outputFrameQueue = new FrameSet();
		this.outputFrameQueue.frames = [];
		this.outputOrderIndex = Array.from<number>({ length: 32 }).fill(0);
		this.outputSequenceIndex = Array.from<number>({ length: 32 }).fill(0);
	}
	
	/**
	 * Sends a frame to the connection.
	 *
	 * @param frame - The frame to send
	 * @param priority - The priority of the frame
	 */
	public sendFrame(frame: Frame, priority: Priority): void {
		if (frame.isSequenced()) {
			frame.orderIndex = this.outputOrderIndex[frame.orderChannel] as number;
			frame.sequenceIndex = (this.outputSequenceIndex[frame.orderChannel] as number)++;
		} else if (frame.isOrderExclusive()) {
			frame.orderIndex = (this.outputOrderIndex[frame.orderChannel] as number)++;
			this.outputSequenceIndex[frame.orderChannel] = 0;
		}
	
		frame.reliableIndex = this.outputReliableIndex++;
	
		const maxSize = this.mtu - 6 - 23;
		if (frame.payload.byteLength > maxSize) {
			const buffer = Buffer.from(frame.payload);
			const fragmentId = this.outputFragmentIndex++ % 65_536;
	
			for (let index = 0; index < buffer.byteLength; index += maxSize) {
				if (index !== 0) frame.reliableIndex = this.outputReliableIndex++;
				
				frame.payload = buffer.subarray(index, index + maxSize);
				frame.fragmentIndex = index / maxSize;
				frame.fragmentId = fragmentId;
				frame.fragmentSize = Math.ceil(buffer.byteLength / maxSize);
				
				this.addFrameToQueue(frame, priority || Priority.Normal);
			}
		} else {
			this.addFrameToQueue(frame, priority);
		}
	}


	private addFrameToQueue(frame: Frame, priority: Priority): void {
		let length = 4;
		for (const queuedFrame of this.outputFrameQueue.frames) {
			length += queuedFrame.getByteLength();
		}
	
		if (length + frame.getByteLength() > this.mtu - 36) {
			this.sendFrameQueue();
		}
	
		this.outputFrameQueue.frames.push(frame);
	
		if (priority === Priority.Immediate) {
			this.sendFrameQueue();
		}
	}

	/**
	 * Sends the output frame queue
	 */
	public sendFrameQueue(): void {
		if (this.outputFrameQueue.frames.length > 0) {
			this.outputFrameQueue.sequence = this.outputSequence++;	
			this.sendFrameSet(this.outputFrameQueue);
			this.outputFrameQueue = new FrameSet();
			this.outputFrameQueue.frames = [];
		}
	}

	/**
	 * Sends a frame set to the connection
	 * @param frameset The frame set
	 */
	private sendFrameSet(frameset: FrameSet): void {
        this.client.send(frameset.serialize());
		this.outputBackupQueue.set(
			frameset.sequence,
			frameset.frames.filter((frame) => frame.isReliable()),
		);
	}
}
