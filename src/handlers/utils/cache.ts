import { Cacheable } from "cacheable";

// Create a singleton cache instance
const cache = new Cacheable({
	ttl: "1h", // 1 hour default TTL
	stats: true, // Enable statistics
});

/**
 * Gets a value from the cache
 */
export async function get<T>(
	namespace: string,
	key: string,
): Promise<T | null> {
	try {
		const value = await cache.get(`${namespace}:${key}`);
		return value as T | null;
	} catch (error) {
		console.error(`Error getting cache for namespace ${namespace}:`, error);
		return null;
	}
}

/**
 * Sets a value in the cache
 */
export async function set<T>(
	namespace: string,
	key: string,
	value: T,
	ttl?: string | number,
): Promise<void> {
	try {
		await cache.set(`${namespace}:${key}`, value, ttl);
	} catch (error) {
		console.error(`Error setting cache for namespace ${namespace}:`, error);
	}
}

/**
 * Gets a value from cache or computes it if not found
 */
export async function getOrSet<T>(
	namespace: string,
	key: string,
	fn: () => Promise<T>,
	ttl?: string | number,
): Promise<T> {
	try {
		const result = await cache.getOrSet(`${namespace}:${key}`, fn, {
			ttl: ttl || "1h",
		});
		if (result === undefined) {
			return fn();
		}
		return result as T;
	} catch (error) {
		console.error(`Error in getOrSet for namespace ${namespace}:`, error);
		return fn(); // Fallback to computing the value
	}
}

/**
 * Wraps a function with caching
 */
export function wrap<Args extends unknown[], T>(
	namespace: string,
	fn: (...args: Args) => Promise<T>,
	ttl?: string | number,
): (...args: Args) => Promise<T> {
	const wrappedFn = cache.wrap(fn, {
		ttl: ttl || "1h",
		keyPrefix: namespace,
	});

	return async (...args: Args): Promise<T> => {
		try {
			return await wrappedFn(...args);
		} catch (error) {
			console.error(
				`Error in wrapped function for namespace ${namespace}:`,
				error,
			);
			throw error;
		}
	};
}

/**
 * Deletes a value from the cache
 */
export async function del(namespace: string, key: string): Promise<void> {
	try {
		await cache.delete(`${namespace}:${key}`);
	} catch (error) {
		console.error(
			`Error deleting key from cache for namespace ${namespace}:`,
			error,
		);
	}
}

/**
 * Clears all values for a namespace
 */
export async function clear(namespace: string): Promise<void> {
	try {
		const pattern = `${namespace}:*`;
		const keys = (await cache.getMany([pattern])) as string[];
		if (keys?.length > 0) {
			await cache.deleteMany(keys);
		}
	} catch (error) {
		console.error(`Error clearing cache for namespace ${namespace}:`, error);
	}
}
