import { Address, SystemAddress } from "./types";

import { Long } from "@serenityjs/binarystream";
import { Create, Serialize } from "../decorators";
import { Packet } from "../enums";
import { BasePacket } from "./base-packet";

@Create(Packet.NewIncomingConnection)
export class NewIncomingConnection extends BasePacket {
	@Serialize(Address) public serverAddress!: Address;
	@Serialize(SystemAddress) public internalAddresses: Address[] = [];
	@Serialize(Long) public incomingTimestamp!: bigint;
	@Serialize(Long) public serverTimestamp!: bigint;
}
