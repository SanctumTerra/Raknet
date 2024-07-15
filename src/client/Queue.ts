import { DGRAM_HEADER_SIZE, DGRAM_MTU_OVERHEAD, Frame, FrameSet, Priority, RaknetEvents, Status } from '@serenityjs/raknet';
import { RakNetClient} from './RaknetClient';

export class Queue {
	public outputOrderIndex: Array<number>;
	public outputSequenceIndex: Array<number>;
	public outputFrameQueue: FrameSet;
	public mtu: number = 1024;

	protected outputSequence = 0;
	protected outputsplitIndex = 0;
	protected outputReliableIndex = 0;
	protected outputFrames = new Set<Frame>();
	public outputBackup = new Map<number, Array<Frame>>();

	protected client: RakNetClient;

	constructor(client: RakNetClient) {
		this.client = client;
		this.outputFrameQueue = new FrameSet();
		this.outputFrameQueue.frames = [];
		this.outputOrderIndex = Array.from<number>({ length: 32 }).fill(0);
		this.outputSequenceIndex = Array.from<number>({ length: 32 }).fill(0);

		this.client.on("tick", () => {
			this.onTick()
		})
	}

	public onTick(): void {
		if (
			this.client.status === Status.Disconnecting ||
			this.client.status === Status.Disconnected
		)
		return;

		return this.sendQueue(this.outputFrames.size);
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
			frame.sequenceIndex = (this.outputSequenceIndex[
				frame.orderChannel
			] as number)++;
		} else if (frame.isOrdered()) {
			frame.orderIndex = (this.outputOrderIndex[
				frame.orderChannel
			] as number)++;
			this.outputSequenceIndex[frame.orderChannel] = 0;
		}
		const maxSize = this.mtu - 36;
		const splitSize = Math.ceil(frame.payload.byteLength / maxSize);

		if (frame.payload.byteLength > maxSize) {
			const splitId = this.outputsplitIndex++ % 65_536;
			for (let index = 0; index < frame.payload.byteLength; index += maxSize) {
				const nframe = new Frame();

				if (frame.isReliable())
					nframe.reliableIndex = this.outputReliableIndex++;
					nframe.sequenceIndex = frame.sequenceIndex;
					nframe.orderIndex = frame.orderIndex;
					nframe.orderChannel = frame.orderChannel;
					nframe.reliability = frame.reliability;
					nframe.payload = frame.payload.subarray(index, index + maxSize);
					nframe.splitIndex = index / maxSize;
					nframe.splitId = splitId;
					nframe.splitSize = splitSize;
					this.queueFrame(nframe, priority);
			}
		} else {
			if (frame.isReliable()) frame.reliableIndex = this.outputReliableIndex++;
			return this.queueFrame(frame, priority);
		}
	}

	private queueFrame(frame: Frame, priority: Priority): void {
		let length = DGRAM_HEADER_SIZE;
		for (const frame of this.outputFrames) length += frame.getByteLength();
		if (length + frame.getByteLength() > this.mtu - DGRAM_MTU_OVERHEAD)
			this.sendQueue(this.outputFrames.size);
		this.outputFrames.add(frame);
		if (priority === Priority.Immediate) return this.sendQueue(1);
	}

	public sendQueue(amount: number): void {
		if (this.outputFrames.size === 0) return;
		const frameset = new FrameSet();
		frameset.sequence = this.outputSequence++;
		frameset.frames = [...this.outputFrames].slice(0, amount);
		this.outputBackup.set(frameset.sequence, frameset.frames);
		for (const frame of frameset.frames) this.outputFrames.delete(frame);
		return this.client.send(frameset.serialize());
	}
}
