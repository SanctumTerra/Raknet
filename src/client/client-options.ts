type ClientOptions = {
	address: string;
	port: number;
	protocolVersion: number;
	mtuSize: number;
	clientId: bigint;
	debug: boolean;
	timeout: number;
	maxFrameQueueSize: number;
	fragmentTimeout: number;
	enableBufferPooling: boolean;
	gcInterval: number;
	socketBufferMultiplier: number;
	tickInterval: number;
	connectionRetryInterval: number;
	initialConnectionTimeout: number;
	batchSize: number;
	maxPipelineStages: number;
	fastPathEnabled: boolean;
};

const defaultClientOptions: ClientOptions = {
	address: "127.0.0.1",
	port: 19132,
	protocolVersion: 11,
	mtuSize: 1492,
	clientId: BigInt(Math.floor(Math.random() * 1000000000000000000)),
	debug: false,
	timeout: 3000,
	maxFrameQueueSize: 1000,
	fragmentTimeout: 10000,
	enableBufferPooling: true,
	gcInterval: 60000,
	socketBufferMultiplier: 2048,
	tickInterval: 8,
	connectionRetryInterval: 100,
	initialConnectionTimeout: 800,
	batchSize: 16,
	maxPipelineStages: 2,
	fastPathEnabled: true,
};

export { type ClientOptions, defaultClientOptions };
