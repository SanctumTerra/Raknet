import { Long, Short } from "@serenityjs/binarystream";
import { Address, BasePacket, Packet, Proto, Serialize, SystemAddress } from "@serenityjs/raknet";

@Proto(Packet.ConnectionRequestAccepted)
class ConnectionRequestAccepted extends BasePacket { 
	@Serialize(Address) public address!: Address;
	@Serialize(Short) public systemIndex!: number;
	@Serialize(SystemAddress) public systemAddresses!: Address[];
	@Serialize(Long) public requestTimestamp!: bigint;
	@Serialize(Long) public timestamp!: bigint;
}  

export { ConnectionRequestAccepted };