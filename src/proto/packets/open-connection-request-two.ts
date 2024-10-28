import { BasePacket } from "./base-packet";
import { Packet } from "../enums";
import { Create, Serialize } from "../decorators";
import { Uint16, Uint64 } from "@serenityjs/binarystream";
import { Address, Magic } from "./types";

@Create(Packet.OpenConnectionRequestTwo)
export class OpenConnectionRequestTwo extends BasePacket {
	@Serialize(Magic) public magic!: Buffer;
	@Serialize(Address) public address!: Address;
	@Serialize(Uint16) public mtu!: number;
	@Serialize(Uint64) public clientGuid!: bigint;
}
