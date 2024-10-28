import { String16, Uint64 } from "@serenityjs/binarystream";
import { Create, Serialize } from "../decorators";
import { Packet } from "../enums";
import { BasePacket } from "./base-packet";
import { Magic } from "./types";

@Create(Packet.UnconnectedPong)
export class UnconnectedPong extends BasePacket {
	@Serialize(Uint64) public serverTimestamp!: bigint;
	@Serialize(Uint64) public serverGuid!: bigint;
	@Serialize(Magic) public magic!: Buffer;
	@Serialize(String16) public message!: string;
}
