import { Endianness, Uint64 } from "@serenityjs/binarystream";
import { Create, Serialize } from "../decorators";
import { Packet } from "../enums";
import { BasePacket } from "./base-packet";
import { Magic } from "./types";

@Create(Packet.UnconnectedPing)
export class UnconnectedPing extends BasePacket {
	@Serialize(Uint64) public clientTimestamp!: bigint;
	@Serialize(Magic) public magic!: Buffer;
	@Serialize(Uint64) public guid!: bigint;
}
