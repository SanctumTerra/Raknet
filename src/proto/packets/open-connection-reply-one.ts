import { BasePacket } from "./base-packet";
import { Packet } from "../enums";
import { Create, Serialize } from "../decorators";
import {
	Bool,
	Endianness,
	Long,
	Short,
	Uint16,
	Uint32,
	Uint64,
	Uint8,
} from "@serenityjs/binarystream";
import { Magic } from "./types";

@Create(Packet.OpenConnectionReplyOne)
export class OpenConnectionReplyOne extends BasePacket {
	@Serialize(Magic) public magic!: Buffer;
	@Serialize(Long) public serverGuid!: bigint;
	@Serialize(Bool) public serverHasSecurity!: boolean;
	@Serialize(Uint16) public mtu!: number;
}
