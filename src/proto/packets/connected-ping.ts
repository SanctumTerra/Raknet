import { Long } from "@serenityjs/binarystream";
import { Create, Serialize } from "../decorators";
import { Packet } from "../enums";
import { BasePacket } from "./base-packet";

@Create(Packet.ConnectedPing)
export class ConnectedPing extends BasePacket {
	@Serialize(Long) public timestamp!: bigint;
}
