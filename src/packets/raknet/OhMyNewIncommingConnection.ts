import "reflect-metadata"

import { Proto } from "../proto";
import { Serialize } from "../serialize";
import { Address, BasePacket, Packet, SystemAddress } from "@serenityjs/raknet";
import { Long } from "@serenityjs/binarystream";

@Proto(Packet.NewIncomingConnection)
class OhMyNewIncommingConnection extends BasePacket {
	/**
	 * the server adress of the reply.
	 */
	@Serialize(Address) public serverAddress!: Address;

	/**
	 * unknown what this is used for.
	 */
	@Serialize(SystemAddress) public internalAddress!: Array<Address>;

	/**
	 * The incoming timestamp of the reply.
	 */
	@Serialize(Long) public incomingTimestamp!: bigint;

	/**
	 * The server timestamp of the reply.
	 */
	@Serialize(Long) public serverTimestamp!: bigint;
}

export {OhMyNewIncommingConnection}