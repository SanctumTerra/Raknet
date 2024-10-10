import { Long } from "@serenityjs/binarystream";
import { BasePacket, Packet, Proto, Serialize } from "@serenityjs/raknet";

@Proto(Packet.ConnectedPing)
class ConnectedPing extends BasePacket {
	@Serialize(Long) public timestamp!: bigint;
}

export { ConnectedPing };
