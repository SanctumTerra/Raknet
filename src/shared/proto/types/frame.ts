import {
	type BinaryStream,
	Endianness,
	Uint16,
	Uint24,
	Uint32,
	Uint8,
} from "@serenityjs/binarystream";
import { Reliability } from "../enums";

export const SplitFlag = 0x10;
export class Frame {
	public reliability!: Reliability;
	public reliableFrameIndex!: number;
	public sequenceFrameIndex!: number;
	public orderedFrameIndex!: number;
	public orderChannel!: number;
	public splitFrameIndex!: number;
	public splitSize!: number;
	public splitId!: number;
	public payload!: Buffer;

	static write(stream: BinaryStream, frames: Array<Frame>) {
		for (const frame of frames) {
			const isReliable = frame.isReliable();
			const isSequenced = frame.isSequenced();
			const isOrdered = frame.isOrdered();
			const isSplit = frame.isSplit();

			const reliability = (frame.reliability << 5) | (isSplit ? SplitFlag : 0);
			const little = { endian: Endianness.Little };

			Uint8.write(stream, reliability);
			Uint16.write(stream, frame.payload.byteLength << 3);
			if (isReliable) Uint24.write(stream, frame.reliableFrameIndex, little);
			if (isSequenced) Uint24.write(stream, frame.sequenceFrameIndex, little);
			if (isOrdered) {
				Uint24.write(stream, frame.orderedFrameIndex, little);
				Uint8.write(stream, frame.orderChannel);
			}
			if (isSplit) {
				Uint32.write(stream, frame.splitSize);
				Uint16.write(stream, frame.splitId);
				Uint32.write(stream, frame.splitFrameIndex);
			}
			stream.write(frame.payload);
		}
	}

	static read(stream: BinaryStream): Array<Frame> {
		const frames: Array<Frame> = [];

		while (!stream.feof()) {
			const frame = new Frame();
			const header = Uint8.read(stream);
			const reliability = (header & 0xe0) >> 5;
			const split = (header & SplitFlag) !== 0;
			const length = Math.ceil(Uint16.read(stream) / 8);
			frame.reliability = reliability as Reliability;
			const little = { endian: Endianness.Little };
			const isReliable = frame.isReliable();
			const isSequenced = frame.isSequenced();
			const isOrdered = frame.isOrdered();

			if (isReliable) frame.reliableFrameIndex = Uint24.read(stream, little);
			if (isSequenced) frame.sequenceFrameIndex = Uint24.read(stream, little);
			if (isOrdered) {
				frame.orderedFrameIndex = Uint24.read(stream, little);
				frame.orderChannel = Uint8.read(stream);
			}
			if (split) {
				frame.splitSize = Uint32.read(stream);
				frame.splitId = Uint16.read(stream);
				frame.splitFrameIndex = Uint32.read(stream);
			}

			frame.payload = stream.read(length);
			frames.push(frame);
		}

		return frames;
	}

	public isSplit(): boolean {
		return this.splitSize > 0;
	}

	public isReliable(): boolean {
		const values = [
			Reliability.Reliable,
			Reliability.ReliableOrdered,
			Reliability.ReliableSequenced,
			Reliability.ReliableWithAckReceipt,
			Reliability.ReliableOrderedWithAckReceipt,
		];

		return values.includes(this.reliability);
	}

	public isSequenced(): boolean {
		const values = [
			Reliability.ReliableSequenced,
			Reliability.UnreliableSequenced,
		];

		return values.includes(this.reliability);
	}

	public isOrdered(): boolean {
		const values = [
			Reliability.UnreliableSequenced,
			Reliability.ReliableOrdered,
			Reliability.ReliableSequenced,
			Reliability.ReliableOrderedWithAckReceipt,
		];

		return values.includes(this.reliability);
	}

	public isOrderExclusive(): boolean {
		const values = [
			Reliability.ReliableOrdered,
			Reliability.ReliableOrderedWithAckReceipt,
		];

		return values.includes(this.reliability);
	}

	public getByteLength(): number {
		return (
			3 +
			this.payload.byteLength +
			(this.isReliable() ? 3 : 0) +
			(this.isSequenced() ? 3 : 0) +
			(this.isOrdered() ? 4 : 0) +
			(this.isSplit() ? 10 : 0)
		);
	}
}
