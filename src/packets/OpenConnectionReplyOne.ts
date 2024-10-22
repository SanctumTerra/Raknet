import {
	Bool,
	Endianness,
	Long,
	Short,
	Uint16,
	Uint64,
} from "@serenityjs/binarystream";
import {
	BasePacket,
	Magic,
	Packet,
	Proto,
	Serialize,
} from "@serenityjs/raknet";

@Proto(Packet.OpenConnectionReply1)
class OpenConnectionReplyOne extends BasePacket {
	@Serialize(Magic) public magic!: Buffer;
	@Serialize(Uint64, Endianness.Big) public guid!: bigint;
	@Serialize(Bool) public security!: boolean;
	@Serialize(Uint16, Endianness.Big) public mtu!: number;
}

export { OpenConnectionReplyOne };
