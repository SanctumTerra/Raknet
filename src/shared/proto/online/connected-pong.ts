import { BinaryStream, Int64, Uint8 } from "@serenityjs/binarystream";
import { Packets } from "../enums";

export class ConnectedPong extends BinaryStream {
	public pingTimestamp!: bigint; // Int64
	public pongTimestamp!: bigint; // Int64

	public serialize(): Buffer {
		Uint8.write(this, Packets.ConnectedPing);
		Int64.write(this, this.pingTimestamp);
		Int64.write(this, this.pongTimestamp);
		return this.getBuffer();
	}

	public deserialize(): ConnectedPong {
		Uint8.read(this);
		this.pingTimestamp = Int64.read(this);
		this.pongTimestamp = Int64.read(this);
		return this;
	}
}
