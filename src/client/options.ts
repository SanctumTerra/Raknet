import { MAX_MTU_SIZE } from "@serenityjs/raknet";
import type { Socket } from "node:dgram";

type Options = {
	protocol: number;
	host: string;
	port: number;
	guid: bigint;
	mtu: number;
	debug: boolean;
	/** Timeout in ms default is 5000 aka 5 seconds */
	timeout: number;
	socket?: Socket;
};

const defaultOptions: Options = {
	protocol: 11,
	host: "0.0.0.0",
	port: 19132,
	guid: BigInt(Math.floor(Math.random() * 9007199254740991)),
	mtu: 1492,
	debug: false,
	timeout: 10000,
	socket: undefined,
};

export type { Options };
export { defaultOptions };
