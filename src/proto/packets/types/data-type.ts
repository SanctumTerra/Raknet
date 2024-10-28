import { type BinaryStream, Endianness } from "@serenityjs/binarystream";

export class DataType {
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	// biome-ignore lint/complexity/noUselessConstructor: <explanation>
	public constructor(..._arguments_: Array<unknown>) {}

	/**
	 * Reads the data type from the stream.
	 * @param _stream - The stream to read from.
	 * @param _endian - The endianness of the data.
	 * @param _parameter - The parameter to read.
	 * @returns The read data.
	 */
	public static read(
		_stream: BinaryStream,
		_endian = Endianness.Big,
		_parameter?: unknown,
	): unknown {
		return;
	}

	/**
	 * Writes the data type to the stream.
	 * @param _stream - The stream to write to.
	 * @param _value - The value to write.
	 * @param _endian - The endianness of the data.
	 * @param _parameter - The parameter to write.
	 */
	public static write(
		_stream: BinaryStream,
		_value: unknown,
		_endian = Endianness.Big,
		_parameter?: unknown,
	): void {
		return;
	}
}
