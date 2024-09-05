import { Long, Short } from "@serenityjs/binarystream";
import { Address, BasePacket, Magic, Packet, Proto, Serialize } from "@serenityjs/raknet";

@Proto(Packet.OpenConnectionRequest2)
class OpenConnectionSecondRequest extends BasePacket {
    @Serialize(Magic) public magic!: Buffer;
	@Serialize(Address) public address!: Address;
	@Serialize(Short) public mtu!: number;
	@Serialize(Long) public client!: bigint;
} 

export { OpenConnectionSecondRequest }