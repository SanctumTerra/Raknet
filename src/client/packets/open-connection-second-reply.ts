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
class OpenConnectionSecondReply extends BasePacket {
	@Serialize(Magic) public magic!: Buffer;
	@Serialize(Long) public guid!: bigint;
	@Serialize(Address) public address!: Address;
	@Serialize(Short) public mtu!: number;
	@Serialize(Bool) public encryption!: boolean;
}

export { OpenConnectionSecondReply };
