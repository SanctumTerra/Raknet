import type {
	Byte,
	Bool,
	Uint8,
	Uint16,
	Uint24,
	Uint32,
	Uint64,
	Int8,
	Int16,
	Int24,
	Int32,
	Int64,
	Short,
	UShort,
	Long,
	ULong,
	VarInt,
	ZigZag,
	VarLong,
	ZigZong,
	Float32,
	Float64,
	String16,
	String32,
	VarString,
	Uuid,
} from "@serenityjs/binarystream";
import type { DataType } from "../packets/types/data-type";
import type { CompoundTag } from "@serenityjs/nbt";

export type ValidTypes =
	| typeof CompoundTag // For @serenityjs/protocol
	| typeof DataType
	| typeof Bool
	| typeof Byte
	| typeof Float32
	| typeof Float64
	| typeof Int8
	| typeof Int16
	| typeof Int24
	| typeof Int32
	| typeof Int64
	| typeof Long
	| typeof Short
	| typeof String16
	| typeof String32
	| typeof Uint8
	| typeof Uint16
	| typeof Uint24
	| typeof Uint32
	| typeof Uint64
	| typeof ULong
	| typeof UShort
	| typeof Uuid
	| typeof VarInt
	| typeof VarLong
	| typeof VarString
	| typeof ZigZag
	| typeof ZigZong;
	