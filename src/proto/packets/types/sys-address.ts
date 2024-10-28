import type { RemoteInfo } from "node:dgram";
import { Address } from "./address";

import { DataType } from "./data-type";
import type { BinaryStream } from "@serenityjs/binarystream";

export class SystemAddress extends DataType {
	public static fromIdentifier(identifier: RemoteInfo): Address {
		return new Address(identifier.address, identifier.port, 4);
	}

	public static read(stream: BinaryStream): Array<Address> {
		const addresses: Array<Address> = [];
		for (let index = 0; index < 20; index++) {
			const address = Address.read(stream);
			addresses.push(address);
		}
		return addresses;
	}

	public static write(stream: BinaryStream): void {
		const addresses: Array<Address> = [
			{ address: "127.0.0.1", port: 0, version: 4 },
		];
		for (let index = 0; index < 20; index++) {
			Address.write(
				stream,
				addresses[index] || { address: "0.0.0.0", port: 0, version: 4 },
			);
		}
	}
}
