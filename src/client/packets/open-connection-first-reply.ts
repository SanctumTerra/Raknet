import { Bool, Long, Short } from "@serenityjs/binarystream";
import { BasePacket, Magic, Packet, Proto, Serialize } from "@serenityjs/raknet";

@Proto(Packet.OpenConnectionReply1)
class OpenConnectionFirstReply extends BasePacket { 
	@Serialize(Magic) public magic!: Buffer;
    @Serialize(Long) public guid!: bigint;
    @Serialize(Bool) public security!: boolean;
	@Serialize(Short) public mtu!: number;
}

export { OpenConnectionFirstReply }