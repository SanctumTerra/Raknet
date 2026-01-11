import { Uint64 } from "@serenityjs/binarystream";

export type ProxyOptions = {
	host: string;
	port: number;
	userId?: string;
	password?: string;
};

export type ClientOptions = {
	mtu: number;
	address: string;
	port: number;
	guid: bigint;
	tickRate: number;
	pingRate: number;
	timeout: number;
	proxy?: ProxyOptions;
};
export const getRandomGuid = () =>
	BigInt(Math.floor(Date.now() + Math.random() * 10000000));

export const defaultClientOptions: ClientOptions = {
	mtu: 1492,
	address: "127.0.0.1",
	port: 19132,
	guid: getRandomGuid(),
	tickRate: 20,
	pingRate: 40,
	timeout: 30000,
};
