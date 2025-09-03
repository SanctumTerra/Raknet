import { BinaryStream, Int64, Uint8 } from "@serenityjs/binarystream";
import { Packets } from "../enums";
import { Address } from "../types";

export class NewIncomingConnection extends BinaryStream {
	public address!: Address; // Address
	public internalAddress!: Address; // Internal Address
	public incomingTimestamp!: bigint; // Int64
	public serverTimestamp!: bigint; // Int64

	public serialize(): Buffer {
		Uint8.write(this, Packets.NewIncomingConnection);
		Address.write(this, this.address);
		for (let i = 0; i < 10; i++) {
			Address.write(this, this.internalAddress);
		}
		Int64.write(this, this.incomingTimestamp);
		Int64.write(this, this.serverTimestamp);
		return this.getBuffer();
	}

	public deserialize(): NewIncomingConnection {
		Uint8.read(this);
		this.address = Address.read(this);
		for (let i = 0; i < 10; i++) {
			this.internalAddress = Address.read(this);
		}
		this.incomingTimestamp = Int64.read(this);
		this.serverTimestamp = Int64.read(this);
		return this;
	}
}
