import { BinaryStream, Int64, Uint8 } from "@serenityjs/binarystream";
import { Packets } from "../enums";
import { Magic } from "../types";

export class UnconnectedPing extends BinaryStream {
	public timestamp!: bigint; // Int64
	public guid!: bigint; // Int64

	public serialize(): Buffer {
		Uint8.write(this, Packets.UnconnectedPing);
		Int64.write(this, this.timestamp);
		Magic.write(this);
		Int64.write(this, this.guid);
		return this.getBuffer();
	}

	public deserialize(): UnconnectedPing {
		Uint8.read(this);
		this.timestamp = Int64.read(this);
		Magic.read(this);
		this.guid = Int64.read(this);
		return this;
	}
}
