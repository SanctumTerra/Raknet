import { Uint64, Uint8 } from "@serenityjs/binarystream";
import {
	BasePacket,
	Magic,
	Packet,
	Proto,
	Serialize,
} from "@serenityjs/raknet";

@Proto(Packet.IncompatibleProtocolVersion)
class IncompatibleProtocolVersion extends BasePacket {
	@Serialize(Uint8) public protocol!: number;
	@Serialize(Magic) public magic!: Magic;
	@Serialize(Uint64) public guid!: bigint;
}

export { IncompatibleProtocolVersion };
