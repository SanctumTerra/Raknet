import { Long, String16 } from "@serenityjs/binarystream";
import {
	BasePacket,
	Magic,
	Packet,
	Proto,
	Serialize,
} from "@serenityjs/raknet";

@Proto(Packet.UnconnectedPong)
class UnconnectedPong extends BasePacket {
	@Serialize(Long) public timestamp!: bigint;
	@Serialize(Long) public guid!: bigint;
	@Serialize(Magic) public magic!: Buffer;
	@Serialize(String16) public message!: string;
}

export { UnconnectedPong };
