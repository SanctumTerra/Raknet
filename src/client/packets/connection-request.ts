import { Bool, Long } from "@serenityjs/binarystream";
import { BasePacket, Packet, Proto, Serialize } from "@serenityjs/raknet";

@Proto(Packet.ConnectionRequest)
class ConnectionRequest extends BasePacket {
    @Serialize(Long) public client!: bigint;
	@Serialize(Long) public timestamp!: bigint;
    @Serialize(Bool) public security!: boolean;
}

export { ConnectionRequest };