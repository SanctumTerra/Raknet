import { type BinaryStream, Endianness } from "@serenityjs/binarystream";
import { Reliability } from "../../enums/reliability";
import { DataType } from "./data-type";
import { Flags } from "../../enums";

export class Frame extends DataType {
	public reliability!: Reliability;
	public reliableFrameIndex!: number;
	public sequenceFrameIndex!: number;
	public orderedFrameIndex!: number;
	public orderChannel!: number;
	public splitFrameIndex!: number;
	public splitCount!: number;
	public splitId!: number;
	public payload!: Buffer;

	public static read(stream: BinaryStream): Frame[] {
		const frames: Frame[] = [];

		while (!stream.cursorAtEnd()) {
			const frame = new Frame();
			const flags = stream.readUint8();
			frame.reliability = (flags & 0xe0) >> 5;
			const split = (flags & Flags.Split) !== 0;
			const length = Math.ceil(stream.readUint16() / 8);

			if (frame.isReliable)
				frame.reliableFrameIndex = stream.readUint24(Endianness.Little);
			if (frame.isSequenced)
				frame.sequenceFrameIndex = stream.readUint24(Endianness.Little);
			if (frame.isOrdered) {
				frame.orderedFrameIndex = stream.readUint24(Endianness.Little);
				frame.orderChannel = stream.readUint8();
			}
			if (split) {
				frame.splitCount = stream.readUint32();
				frame.splitId = stream.readUint16();
				frame.splitFrameIndex = stream.readUint32();
			}
			frame.payload = stream.readBuffer(length);
			frames.push(frame);
		}
		return frames;
	}

	public static write(stream: BinaryStream, value: Array<Frame>): void {
		for (const frame of value) {
			stream.writeUint8(
				(frame.reliability << 5) | (frame.isSplit ? Flags.Split : 0),
			);
			stream.writeUint16(frame.payload.byteLength << 3);
			if (frame.isReliable)
				stream.writeUint24(frame.reliableFrameIndex, Endianness.Little);
			if (frame.isSequenced)
				stream.writeUint24(frame.sequenceFrameIndex, Endianness.Little);
			if (frame.isOrdered) {
				stream.writeUint24(frame.orderedFrameIndex, Endianness.Little);
				stream.writeUint8(frame.orderChannel);
			}
			if (frame.isSplit) {
				stream.writeUint32(frame.splitCount);
				stream.writeUint16(frame.splitId);
				stream.writeUint32(frame.splitFrameIndex);
			}
			stream.writeBuffer(frame.payload);
		}
	}

	public getByteLength(): number {
		return (
			3 +
			this.payload.byteLength +
			(this.isSplit ? 10 : 0) +
			(this.isReliable ? 3 : 0) +
			(this.isSequenced ? 3 : 0) +
			(this.isOrdered ? 4 : 0)
		);
	}

	get isReliable(): boolean {
		return (
			this.reliability === Reliability.Reliable ||
			this.reliability === Reliability.ReliableOrdered ||
			this.reliability === Reliability.ReliableSequenced ||
			this.reliability === Reliability.ReliableWithAckReceipt ||
			this.reliability === Reliability.ReliableOrderedWithAckReceipt
		);
	}

	get isSequenced(): boolean {
		return (
			this.reliability === Reliability.UnreliableSequenced ||
			this.reliability === Reliability.ReliableSequenced
		);
	}

	get isOrdered(): boolean {
		return (
			this.reliability === Reliability.ReliableOrdered ||
			this.reliability === Reliability.ReliableOrderedWithAckReceipt
		);
	}

	get isOrderedExclusive(): boolean {
		return (
			this.reliability === Reliability.ReliableOrdered ||
			this.reliability === Reliability.ReliableOrderedWithAckReceipt
		);
	}

	get isSplit(): boolean {
		return this.splitCount > 0;
	}
}
