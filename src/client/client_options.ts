type ClientOptions = {
	address: string;
	port: number;
	mtuSize: number;
	debug: boolean;
	timeout: number;
};

const defaultClientOptions: ClientOptions = {
	address: "127.0.0.1",
	port: 19132,
	mtuSize: 1492,
	debug: false,
	timeout: 5000,
};

export { type ClientOptions, defaultClientOptions };
