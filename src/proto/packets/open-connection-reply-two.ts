import { Bool, Long, Uint16 } from "@serenityjs/binarystream";
import { Create, Serialize } from "../decorators";
import { Packet } from "../enums";
import { BasePacket } from "./base-packet";
import { Address, Magic } from "./types";

@Create(Packet.OpenConnectionReplyTwo)
export class OpenConnectionReplyTwo extends BasePacket {
	@Serialize(Magic) public magic!: Magic;
	@Serialize(Long) public serverGuid!: bigint;
	@Serialize(Address) public clientAddress!: Address;
	@Serialize(Uint16) public mtu!: number;
	@Serialize(Bool) public encryptionEnabled!: boolean;
}
