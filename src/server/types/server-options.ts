import { getRandomGuid } from "../../client";

export type RaknetServerOptions = {
	port: number;
	address: string;
	guid: bigint;
	motd: string;
	maxConnections: number;
	tickRate: number;
	mtu: number;
	enableServerLogs: boolean;
};

export const defaultRaknetServerOptions: RaknetServerOptions = {
	port: 19132,
	address: "0.0.0.0",
	guid: getRandomGuid(),
	motd: "SanctumTerra",
	maxConnections: 100,
	tickRate: 20,
	mtu: 1492,
	enableServerLogs: true,
};
