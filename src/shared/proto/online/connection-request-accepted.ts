import {
	BinaryStream,
	Int16,
	Int64,
	Uint16,
	Uint8,
} from "@serenityjs/binarystream";
import { Packets } from "../enums";
import { Address } from "../types";

export class ConnectionRequestAccepted extends BinaryStream {
	public address!: Address; // Address
	public systemIndex!: number; // Int16
	public addresses!: Array<Address>; // Array<Address>
	public requestTimestamp!: bigint; // Int64
	public timestamp!: bigint; // Int64

	public serialize(): Buffer {
		Uint8.write(this, Packets.ConnectionRequestAccepted);
		Address.write(this, this.address);
		Uint16.write(this, this.systemIndex);
		for (let i = 0; i < this.addresses.length; i++) {
			Address.write(this, this.addresses[i]);
		}
		Int64.write(this, this.requestTimestamp);
		Int64.write(this, this.timestamp);
		return this.getBuffer();
	}

	public deserialize(): ConnectionRequestAccepted {
		Uint8.read(this);
		this.address = Address.read(this);

		this.systemIndex = Uint16.read(this);
		this.addresses = [];

		for (let i = 0; i < 20; i++) {
			this.addresses.push(Address.read(this));
		}

		this.requestTimestamp = Int64.read(this);
		this.timestamp = Int64.read(this);
		return this;
	}
}
