import { Long, Uint8 } from "@serenityjs/binarystream";
import { Create, Serialize } from "../decorators";
import { Packet } from "../enums";
import { BasePacket } from "./base-packet";
import { Magic } from "./types";

@Create(Packet.IncompatibleProtocolVersion)
export class IncompatibleProtocolVersion extends BasePacket {
	@Serialize(Uint8) protocol!: number;
	@Serialize(Magic) magic!: Magic;
	@Serialize(Long) guid!: bigint;
}
