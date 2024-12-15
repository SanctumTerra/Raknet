export function measureExecutionTime(
	_target: unknown,
	propertyKey: string,
	descriptor: PropertyDescriptor,
) {
	const originalMethod = descriptor.value;

	descriptor.value = async function (...args: unknown[]) {
		const start = performance.now();
		const result = await originalMethod.apply(this, args);
		const end = performance.now();
		const duration = end - start;

		if ((this as unknown as { options?: { debug?: boolean } }).options?.debug) {
			console.log(`${propertyKey} execution time: ${duration.toFixed(2)}ms`);
		}

		return result;
	};

	return descriptor;
}
