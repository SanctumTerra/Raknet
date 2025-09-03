import {
	BinaryStream,
	Endianness,
	Uint24,
	Uint8,
} from "@serenityjs/binarystream";
import { Frame } from "../types";
import { Packets } from "../enums";

export class FrameSet extends BinaryStream {
	public sequence!: number;
	public frames: Array<Frame> = [];

	public serialize(): Buffer {
		Uint8.write(this, Packets.FrameSet);
		Uint24.write(this, this.sequence, { endian: Endianness.Little });
		Frame.write(this, this.frames);
		return this.getBuffer();
	}

	public deserialize(): FrameSet {
		Uint8.read(this);
		this.sequence = Uint24.read(this, { endian: Endianness.Little });
		this.frames = Frame.read(this);
		return this;
	}
}
