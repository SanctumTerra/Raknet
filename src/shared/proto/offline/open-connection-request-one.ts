import { BinaryStream, Uint8 } from "@serenityjs/binarystream";
import { Packets } from "../enums";
import { Magic, MTU } from "../types";

export class OpenConnectionRequestOne extends BinaryStream {
	public protocol!: number;
	public mtu!: number;

	public serialize(): Buffer {
		Uint8.write(this, Packets.OpenConnectionRequest1);
		Magic.write(this);
		Uint8.write(this, this.protocol);
		MTU.write(this, this.mtu);
		return this.getBuffer();
	}

	public deserialize(): OpenConnectionRequestOne {
		Uint8.read(this);
		Magic.read(this);
		this.protocol = Uint8.read(this);
		this.mtu = MTU.read(this);
		return this;
	}
}
