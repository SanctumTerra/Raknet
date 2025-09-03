import {
	BinaryStream,
	Bool,
	Int16,
	Int64,
	Uint8,
} from "@serenityjs/binarystream";
import { Address, Magic } from "../types";
import { Packets } from "../enums";

export class OpenConnectionReplyTwo extends BinaryStream {
	public guid!: bigint;
	public address!: Address;
	public mtu!: number;
	public encryptionEnabled!: boolean;

	public serialize(): Buffer {
		Uint8.write(this, Packets.OpenConnectionReply2);
		Magic.write(this);
		Int64.write(this, this.guid);
		Address.write(this, this.address);
		Int16.write(this, this.mtu);
		Bool.write(this, this.encryptionEnabled);
		return this.getBuffer();
	}

	public deserialize(): OpenConnectionReplyTwo {
		Uint8.read(this);
		Magic.read(this);
		this.guid = Int64.read(this);
		this.address = Address.read(this);
		this.mtu = Int16.read(this);
		this.encryptionEnabled = Bool.read(this);
		return this;
	}
}
