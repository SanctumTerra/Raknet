import { Byte, Endianness, Uint8 } from "@serenityjs/binarystream";
import { Create, Serialize } from "../decorators";
import { Packet } from "../enums";
import { BasePacket } from "./base-packet";
import { Magic, MTU } from "./types";

@Create(Packet.OpenConnectionRequestOne)
export class OpenConnectionRequestOne extends BasePacket {
	@Serialize(Magic) public magic!: Buffer;
	@Serialize(Uint8) public protocol!: number;
	@Serialize(MTU) public mtu!: number;
}
