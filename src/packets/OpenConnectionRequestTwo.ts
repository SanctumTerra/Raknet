import {
	Endianness,
	Long,
	Short,
	Uint16,
	Uint32,
	Uint64,
} from "@serenityjs/binarystream";
import {
	Address,
	BasePacket,
	Magic,
	Packet,
	Proto,
	Serialize,
} from "@serenityjs/raknet";

@Proto(Packet.OpenConnectionRequest2)
class OpenConnectionRequestTwo extends BasePacket {
	@Serialize(Magic) public magic!: Magic;
	@Serialize(Address) public address!: Address;
	@Serialize(Uint16, Endianness.Big) public mtu!: number;
	@Serialize(Long, Endianness.Big) public client!: bigint;
}

export { OpenConnectionRequestTwo };
