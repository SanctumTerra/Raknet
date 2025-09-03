import type { BinaryStream } from "@serenityjs/binarystream";

const magic: Buffer = Buffer.from("00ffff00fefefefefdfdfdfd12345678", "hex");

export class Magic {
	static write(stream: BinaryStream) {
		stream.write(magic);
	}

	static read(stream: BinaryStream): Buffer {
		const readMagic = stream.read(16);
		return readMagic;
	}

	nothingItJustIgnoresANoStaticClassLint() {}
}
