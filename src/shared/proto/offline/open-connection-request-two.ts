import {
	BinaryStream,
	Int16,
	Int64,
	Int32,
	Uint8,
	Bool,
} from "@serenityjs/binarystream";
import { Packets } from "../enums";
import { Address, Magic } from "../types";

export class OpenConnectionRequestTwo extends BinaryStream {
	public address!: Address;
	public mtu!: number;
	public guid!: bigint;
	public cookie!: number | null;

	public serialize(): Buffer {
		Uint8.write(this, Packets.OpenConnectionRequest2);
		Magic.write(this);
		if (this.cookie != null) {
			Int32.write(this, this.cookie);
			Bool.write(this, true); //Not sure about this (https://minecraft.wiki/w/RakNet#Open_Connection_Reply_2)
		}
		Address.write(this, this.address);
		Int16.write(this, this.mtu);
		Int64.write(this, this.guid);
		return this.getBuffer();
	}

	public deserialize(): OpenConnectionRequestTwo {
		Uint8.read(this);
		Magic.read(this);
		//TODO:If server uses security need to Deserialize cookie
		//But this implemntion doesnt seem to use cookies
		//https://minecraft.wiki/w/RakNet#Open_Connection_Request_2
		this.address = Address.read(this);
		this.mtu = Int16.read(this);
		this.guid = Int64.read(this);
		return this;
	}
}
