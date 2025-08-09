type ClientOptions = {
	address: string;
	port: number;
	protocolVersion: number;
	mtuSize: number;
	clientId: bigint;
	debug: boolean;
	timeout: number;
	loggerDisabled: boolean;
};

const defaultClientOptions: ClientOptions = {
	address: "127.0.0.1",
	port: 19132,
	protocolVersion: 11,
	mtuSize: 1492,
	clientId: BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
	debug: false,
	timeout: 10000,
	loggerDisabled: false,
};

export { defaultClientOptions, type ClientOptions };
