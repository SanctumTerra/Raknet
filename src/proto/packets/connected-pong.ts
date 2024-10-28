import { Long } from "@serenityjs/binarystream";
import { Create, Serialize } from "../decorators";
import { Packet } from "../enums";
import { BasePacket } from "./base-packet";

@Create(Packet.ConnectedPong)
export class ConnectedPong extends BasePacket {
	@Serialize(Long) public pingTime!: bigint;
	@Serialize(Long) public pongTime!: bigint;
}
