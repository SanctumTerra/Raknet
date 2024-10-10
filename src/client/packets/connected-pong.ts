import { Long } from "@serenityjs/binarystream";
import { BasePacket, Packet, Proto, Serialize } from "@serenityjs/raknet";

@Proto(Packet.ConnectedPong)
class ConnectedPong extends BasePacket {
	@Serialize(Long) public pingTime!: bigint;
	@Serialize(Long) public pongTime!: bigint;
}

export { ConnectedPong };
