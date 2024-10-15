import { Long } from "@serenityjs/binarystream";
import {
	BasePacket,
	Magic,
	Packet,
	Proto,
	Serialize,
} from "@serenityjs/raknet";

@Proto(Packet.UnconnectedPing)
class UnconnectedPing extends BasePacket {
	@Serialize(Long) public timestamp!: bigint;
	@Serialize(Magic) public magic!: Magic;
	@Serialize(Long) public client!: bigint;
}

export { UnconnectedPing };
