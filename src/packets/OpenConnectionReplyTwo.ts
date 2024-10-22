import { Bool, Long, Short } from "@serenityjs/binarystream";
import {
	Address,
	BasePacket,
	Magic,
	Packet,
	Proto,
	Serialize,
} from "@serenityjs/raknet";

@Proto(Packet.OpenConnectionReply2)
class OpenConnectionReplyTwo extends BasePacket {
	@Serialize(Magic) public magic!: Magic;
	@Serialize(Long) public guid!: bigint;
	@Serialize(Address) public address!: Address;
	@Serialize(Short) public mtu!: number;
	@Serialize(Bool) public encryption!: boolean;
}

export { OpenConnectionReplyTwo };
