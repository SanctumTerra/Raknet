import { Bool, Long } from "@serenityjs/binarystream";
import { Create, Serialize } from "../decorators";
import { Packet } from "../enums";
import { BasePacket } from "./base-packet";

@Create(Packet.ConnectionRequest)
export class ConnectionRequest extends BasePacket {
	@Serialize(Long) public clientGuid!: bigint;
	@Serialize(Long) public timestamp!: bigint;
	@Serialize(Bool) public useSecurity!: boolean;
}
