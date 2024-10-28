import { Endianness } from "@serenityjs/binarystream";

import type { ValidTypes } from "../types";
import type { BasePacket, DataType } from "../packets";

export function Serialize(
	type: ValidTypes,
	endian: Endianness | boolean = Endianness.Big,
	parameter?: string,
) {
	if (!type) throw new Error("@Serialize() must be given a type.");
	return (target: object, propertyKey: string) => {
		const properties = Reflect.getMetadata("properties", target) || [];
		properties.push({ name: propertyKey, type, endian, parameter });
		Reflect.defineMetadata("properties", properties, target);
	};
}
