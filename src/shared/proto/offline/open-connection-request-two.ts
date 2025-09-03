import { BinaryStream, Int16, Int64, Uint8 } from "@serenityjs/binarystream";
import { Packets } from "../enums";
import { Address, Magic } from "../types";

export class OpenConnectionRequestTwo extends BinaryStream {
	public address!: Address;
	public mtu!: number;
	public guid!: bigint;

	public serialize(): Buffer {
		Uint8.write(this, Packets.OpenConnectionRequest2);
		Magic.write(this);
		Address.write(this, this.address);
		Int16.write(this, this.mtu);
		Int64.write(this, this.guid);
		return this.getBuffer();
	}

	public deserialize(): OpenConnectionRequestTwo {
		Uint8.read(this);
		Magic.read(this);
		this.address = Address.read(this);
		this.mtu = Int16.read(this);
		this.guid = Int64.read(this);
		return this;
	}
}
