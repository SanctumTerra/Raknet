type ClientOptions = {
	address: string;
	port: number;
	protocolVersion: number;
	mtuSize: number;
	clientId: bigint;
	debug: boolean;
	timeout: number;
};

const defaultClientOptions: ClientOptions = {
	address: "127.0.0.1",
	port: 19132,
	protocolVersion: 11,
	mtuSize: 1492,
	clientId: BigInt(Math.floor(Math.random() * 1000000000000000000)),
	debug: false,
	timeout: 5000,
};

export { type ClientOptions, defaultClientOptions };
