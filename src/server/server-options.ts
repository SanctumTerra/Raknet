export type Gamemode = "Survival" | "Creative" | "Adventure" | "Spectator";

type ServerOptions = {
	port: number;
	host: string;
	guid: bigint;
	motd: string;
	protocol: number;
	version: string;
	maxConnections: number;
	levelName: string;
	mtu: number;
	connectionTimeout: number;
	blockTime: number;
	/**
	 * How many ticks per second the server runs
	 */
	tickRate: number;
	/**
	 * How many packets per second the server can handle from a specific address (does not include the port)
	 */
	maxPacketsPerSecond: number;
	loggerDisabled: boolean;
};

const defaultOptions: ServerOptions = {
	port: 19132,
	host: "0.0.0.0",
	guid: BigInt(Math.floor(Math.random() * 0xffffffffffffffff)),
	motd: "§rSanctumTerra Server§r",
	levelName: "World§r",
	protocol: 11,
	version: "1.21.50",
	maxConnections: 60,
	mtu: 1492,
	connectionTimeout: 12000, // 12 seconds
	tickRate: 20,
	blockTime: 30000, // 30 seconds
	maxPacketsPerSecond: 500,
	loggerDisabled: false,
};

export { type ServerOptions, defaultOptions };
