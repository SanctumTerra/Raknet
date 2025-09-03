import type { BinaryStream } from "@serenityjs/binarystream";

export class MTU {
	static write(stream: BinaryStream, mtu: number) {
		stream.write(Buffer.alloc(mtu - stream.getBuffer().length));
	}

	static read(stream: BinaryStream): number {
		return stream.buffer.byteLength;
	}

	nothingItJustIgnoresANoStaticClassLint() {}
}
