import { type BinaryStream, Endianness } from "@serenityjs/binarystream";
import { DataType } from "./data-type";

const buff = Buffer.from("00ffff00fefefefefdfdfdfd12345678", "hex");

export class Magic extends DataType {
	public static read(stream: BinaryStream): Buffer {
		return stream.readBuffer(buff.length);
	}

	public static write(stream: BinaryStream): void {
		stream.writeBuffer(buff);
	}
}
