import { Long, Short } from "@serenityjs/binarystream";
import { Create, Serialize } from "../decorators";
import { Packet } from "../enums";
import { BasePacket } from "./base-packet";
import { Address, SystemAddress } from "./types";

@Create(Packet.ConnectionRequestAccepted)
export class ConnectionRequestAccepted extends BasePacket {
	@Serialize(Address) public address!: Address;
	@Serialize(Short) public systemIndex!: number;
	@Serialize(SystemAddress) public systemAddresses!: Address[];
	@Serialize(Long) public requestTimestamp!: bigint;
	@Serialize(Long) public timestamp!: bigint;
}
