import type { BinaryStream } from "@serenityjs/binarystream";
import { DataType } from "./data-type";

export class MTU extends DataType {
	private static readonly UDP_HEADER_SIZE = 28;
	private static readonly MTU_SIZES = [1492, 1200, 576];

	public static read(stream: BinaryStream): number {
		return stream.readUint16();
	}

	public static write(stream: BinaryStream, mtu: number): void {
		const mtuPaddingSize =
			mtu - stream.getBuffer().length - MTU.UDP_HEADER_SIZE;
		if (mtuPaddingSize > 0) {
			stream.writeBuffer(Buffer.alloc(mtuPaddingSize, 0x00));
		}
	}
}
