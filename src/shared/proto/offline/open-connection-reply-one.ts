import {
	BinaryStream,
	Bool,
	Int16,
	Int64,
	Uint8,
} from "@serenityjs/binarystream";
import { Packets } from "../enums";
import { Magic, MTU } from "../types";

export class OpenConnectionReplyOne extends BinaryStream {
	public guid!: bigint;
	public security!: boolean;
	public mtu!: number;

	public serialize(): Buffer {
		Uint8.write(this, Packets.OpenConnectionReply1);
		Magic.write(this);
		Int64.write(this, this.guid);
		Bool.write(this, this.security);
		Int16.write(this, this.mtu);
		return this.getBuffer();
	}

	public deserialize(): OpenConnectionReplyOne {
		Uint8.read(this);
		Magic.read(this);
		this.guid = Int64.read(this);
		this.security = Bool.read(this);
		this.mtu = Int16.read(this);
		return this;
	}
}
