import { BinaryStream, Endianness } from "@serenityjs/binarystream";
import { Create } from "../decorators";
import { Packet } from "../enums";
import { BasePacket } from "./base-packet";

/**
 * Thanks SerenityJS
 */
@Create(Packet.Ack)
export class Ack extends BasePacket {
	public sequences: Array<number> = [];
	public override serialize(): Buffer {
		this.writeUint8(Ack.id);
		const stream = new BinaryStream();
		this.sequences.sort((a, b) => a - b);
		const count = this.sequences.length;
		let records = 0;

		if (count > 0) {
			let cursor = 1;
			let start = this.sequences[0] as number;
			let last = this.sequences[0] as number;

			while (cursor < count) {
				const current = this.sequences[cursor++] as number;
				const diff = current - last;
				if (diff === 1) {
					last = current;
				} else if (diff > 1) {
					if (start === last) {
						stream.writeBool(true); // single?
						stream.writeUint24(start, Endianness.Little);
						start = last = current;
					} else {
						stream.writeBool(false); // single?
						stream.writeUint24(start, Endianness.Little);
						stream.writeUint24(last, Endianness.Little);
						start = last = current;
					}
					++records;
				}
			}

			// last iteration
			if (start === last) {
				stream.writeBool(true); // single?
				stream.writeUint24(start, Endianness.Little);
			} else {
				stream.writeBool(false); // single?
				stream.writeUint24(start, Endianness.Little);
				stream.writeUint24(last, Endianness.Little);
			}
			++records;
		}
		this.writeUShort(records);
		this.writeBuffer(stream.getBuffer());
		return this.getBuffer();
	}

	public override deserialize(): this {
		this.readUint8();
		this.sequences = [];
		const recordCount = this.readUShort();
		for (let index = 0; index < recordCount; index++) {
			const range = this.readBool(); // False for range, True for no range
			if (range) {
				this.sequences.push(this.readUint24(Endianness.Little));
			} else {
				const start = this.readUint24(Endianness.Little);
				const end = this.readUint24(Endianness.Little);
				for (let index = start; index <= end; index++) {
					this.sequences.push(index);
				}
			}
		}

		return this;
	}
}
