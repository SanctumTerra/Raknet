import { Uint8 } from "@serenityjs/binarystream";
import {
	BasePacket,
	Magic,
	MTU,
	Packet,
	Proto,
	Serialize,
} from "@serenityjs/raknet";

@Proto(Packet.OpenConnectionRequest1)
class OpenConnectionRequestOne extends BasePacket {
	@Serialize(Magic) public magic!: Buffer;
	@Serialize(Uint8) public protocol!: number;
	@Serialize(MTU) public mtu!: number;
}

export { OpenConnectionRequestOne };
