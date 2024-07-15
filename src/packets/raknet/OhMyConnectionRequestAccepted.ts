import { Proto } from "../proto";
import { Serialize } from "../serialize";
import { Address, BasePacket, Packet, SystemAddress } from "@serenityjs/raknet";
import { Long, String16, String32 } from "@serenityjs/binarystream";

@Proto(Packet.ConnectionRequestAccepted)
class OhMyConnectionRequestAccepted extends BasePacket {
	/**
	 * the server adress of the reply.
	 */
	@Serialize(Address) public serverAddress!: Address;
    
	/**
	 * unknown what this is used for.
	 */
	@Serialize(Address) public internalAddress!: Address;

	/**
	 * The incoming timestamp of the reply.
	 */
	@Serialize(Long) public incomingTimestamp!: bigint;

	/**
	 * The server timestamp of the reply.
	 */
	@Serialize(Long) public serverTimestamp!: bigint;
}

export { OhMyConnectionRequestAccepted }