import { Long } from "@serenityjs/binarystream";
import { BasePacket, Address, SystemAddress, Serialize, Packet, Proto } from "@serenityjs/raknet";

@Proto(Packet.NewIncomingConnection)
class NewIncomingConnection extends BasePacket {
    @Serialize(Address) public serverAddress!: Address;
	@Serialize(SystemAddress) public internalAddresses: Address[] = [];
	@Serialize(Long) public incomingTimestamp!: bigint;
	@Serialize(Long) public serverTimestamp!: bigint;
} 

export { NewIncomingConnection };