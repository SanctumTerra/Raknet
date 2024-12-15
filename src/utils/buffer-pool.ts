const pools = new Map<number, Buffer[]>();
const MAX_POOL_SIZE = 1000;

export const BufferPool = {
	acquire(size: number): Buffer {
		const pool = pools.get(size) || [];
		return pool.pop() || Buffer.allocUnsafe(size);
	},

	release(buffer: Buffer): void {
		const size = buffer.length;
		let pool = pools.get(size);

		if (!pool) {
			pool = [];
			pools.set(size, pool);
		}

		if (pool.length < MAX_POOL_SIZE) {
			pool.push(buffer);
		}
	},
};
