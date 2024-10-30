import type { RemoteInfo } from "node:dgram";
import { Address } from "./address";

import { DataType } from "./data-type";
import type { BinaryStream } from "@serenityjs/binarystream";

export class SystemAddress extends DataType {
	static count = 0;

	public static fromIdentifier(identifier: RemoteInfo): Address {
		return new Address(identifier.address, identifier.port, 4);
	}

	public static read(stream: BinaryStream): Array<Address> {
		const addresses: Array<Address> = [];
		try {
			for (let index = 0; index < 10; index++) {
				const address = Address.read(stream);
				addresses.push(address);
			}
		} catch (error) {
			console.error('Error reading system addresses:', error);
		}
		return addresses;
	}

	public static write(stream: BinaryStream): void {
		const addresses: Array<Address> = [
			new Address("127.0.0.1", 0, 4),
		];
		const count = SystemAddress.count === 0 ? 10 : SystemAddress.count;
		
		for (let index = 0; index < count; index++) {
			Address.write(
				stream,
				addresses[index] || new Address("0.0.0.0", 0, 4),
			);
		}
	}
}
