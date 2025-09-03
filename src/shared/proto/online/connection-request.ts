import { BinaryStream, Bool, Int64, Uint8 } from "@serenityjs/binarystream";
import { Packets } from "../enums";

export class ConnectionRequest extends BinaryStream {
	public guid!: bigint; // Int64
	public timestamp!: bigint; // Int64
	public useSecurity!: boolean; // Bool

	public serialize(): Buffer {
		Uint8.write(this, Packets.ConnectionRequest);
		Int64.write(this, this.guid);
		Int64.write(this, this.timestamp);
		Bool.write(this, this.useSecurity);
		return this.getBuffer();
	}

	public deserialize(): ConnectionRequest {
		Uint8.read(this);
		this.timestamp = Int64.read(this);
		this.guid = Int64.read(this);
		this.useSecurity = Bool.read(this);
		return this;
	}
}
