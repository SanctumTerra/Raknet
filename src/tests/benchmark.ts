import "reflect-metadata";
import { Client } from "../client/client";
import { Logger } from "../utils";

interface Stats {
	total: number;
	average: number;
	median: number;
	min: number;
	max: number;
	stdDev: number;
}

function calculateStats(times: number[]): Stats {
	const total = times.length;
	const average = times.reduce((a, b) => a + b, 0) / total;
	const sorted = [...times].sort((a, b) => a - b);
	const median = sorted[Math.floor(total / 2)];
	const min = sorted[0];
	const max = sorted[total - 1];
	const variance = times.reduce((a, b) => a + (b - average) ** 2, 0) / total;
	const stdDev = Math.sqrt(variance);

	return { total, average, median, min, max, stdDev };
}

function formatStats(stats: Stats): string[] {
	return [
		"\nBenchmark Results:",
		"=================",
		`Total Connections: ${stats.total}`,
		`Average Time: ${stats.average.toFixed(2)}ms`,
		`Median Time: ${stats.median.toFixed(2)}ms`,
		`Min Time: ${stats.min.toFixed(2)}ms`,
		`Max Time: ${stats.max.toFixed(2)}ms`,
		`Standard Deviation: ${stats.stdDev.toFixed(2)}ms`,
	];
}

async function runConnection(index: number): Promise<number> {
	const client = new Client();
	const start = performance.now();

	try {
		await client.connect();
		const duration = performance.now() - start;

		if (client.socket) {
			client.socket.removeAllListeners();
			client.socket.close();
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		return duration;
	} catch (error) {
		if (client.socket) {
			client.socket.removeAllListeners();
			client.socket.close();
		}
		throw error;
	}
}

async function runBenchmark(iterations = 10): Promise<void> {
	const times: number[] = [];

	for (let i = 0; i < iterations; i++) {
		try {
			const duration = await runConnection(i);
			Logger.debug(`Connection ${i + 1}: ${duration.toFixed(2)}ms`);
			times.push(duration);
			await new Promise((resolve) => setTimeout(resolve, 500));
		} catch (error) {
			Logger.error(`Connection ${i + 1} failed:`, error as Error);
		}
	}

	const stats = calculateStats(times);
	for (const line of formatStats(stats)) {
		console.log(line);
	}
}

runBenchmark().catch((error) => {
	Logger.error("Benchmark failed:", error);
	process.exit(1);
});
