import { BinaryStream, Int64, String16, Uint8 } from "@serenityjs/binarystream";
import { Magic } from "../types";
import { Packets } from "../enums";

export class UnconnectedPong extends BinaryStream {
	public timestamp!: bigint; // Int64
	public guid!: bigint; // Int64
	public message!: string; // String16

	public serialize(): Buffer {
		Uint8.write(this, Packets.UnconnectedPong);
		Int64.write(this, this.timestamp);
		Int64.write(this, this.guid);
		Magic.write(this);
		String16.write(this, this.message);
		return this.getBuffer();
	}

	public deserialize(): UnconnectedPong {
		Uint8.read(this);
		this.timestamp = Int64.read(this);
		this.guid = Int64.read(this);
		Magic.read(this);
		this.message = String16.read(this);
		return this;
	}
}
