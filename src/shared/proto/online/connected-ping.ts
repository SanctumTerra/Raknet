import { BinaryStream, Int64, Uint8 } from "@serenityjs/binarystream";
import { Packets } from "../enums";

export class ConnectedPing extends BinaryStream {
	public timestamp!: bigint; // Int64

	public serialize(): Buffer {
		Uint8.write(this, Packets.ConnectedPong);
		Int64.write(this, this.timestamp);
		return this.getBuffer();
	}

	public deserialize(): ConnectedPing {
		Uint8.read(this);
		this.timestamp = Int64.read(this);
		return this;
	}
}
