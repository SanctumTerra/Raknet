import { Client } from "../client";
import { Logger } from "../shared/logger";

async function runBenchmark(iterations: number): Promise<void> {
	Logger.info(
		`§bStarting connection benchmark for ${iterations} iterations...§r`,
	);
	const connectionTimes: number[] = [];

	for (let i = 0; i < iterations; i++) {
		const time: number = Date.now();

		const client = new Client({});
		client.on("unconnectedPong", (packet) => {
			Logger.debug("unconnectedPong packet:", packet);
		});
		const connectionPromise: Promise<number> = new Promise((resolve) => {
			client.on("connect", () => {
				const time2: number = Date.now();
				const timeDiff: number = time2 - time;
				Logger.info(
					`§aConnection attempt ${i + 1}/${iterations}: Connected in ${timeDiff}ms§r`,
				);
				resolve(timeDiff);
			});
		});

		client.connect();

		const connectionTime: number = await connectionPromise;
		connectionTimes.push(connectionTime);
	}

	Logger.warn("\n§e--- Benchmark Results ---§r");
	Logger.info("All Connection Times:", connectionTimes);

	const totalTime: number = connectionTimes.reduce(
		(sum, time) => sum + time,
		0,
	);
	const averageTime: number = totalTime / iterations;
	Logger.info(
		`Average connection time over ${iterations} attempts: §d${averageTime.toFixed(2)}ms§r`,
	);
}

runBenchmark(10);
