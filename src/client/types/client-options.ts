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

export const generateGuid = (): bigint =>
	BigInt(Math.floor(Date.now() + Math.random() * 10000000));

export const createDefaultClientOptions = (): ClientOptions => ({
	mtu: 1492,
	address: "127.0.0.1",
	port: 19132,
	guid: generateGuid(),
	tickRate: 20,
	pingRate: 40,
	timeout: 30000,
});
