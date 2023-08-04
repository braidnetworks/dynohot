import assert from "node:assert";
import { createRequire } from "node:module";

/** @internal */
export const moduleNamespacePropertyDescriptor = {
	configurable: false,
	enumerable: true,
} satisfies Partial<PropertyDescriptor>;

/** @internal */
export function debounceAsync<Result>(fn: () => Promise<Result>) {
	let pending: Promise<Result> | undefined;
	let running: Promise<Result> | undefined;
	async function dispatch() {
		try {
			// eslint-disable-next-line @typescript-eslint/await-thenable
			await undefined;
			return await fn();
		} finally {
			running = undefined;
		}
	}
	return async () => {
		if (running) {
			return pending ??= async function() {
				await running;
				return dispatch();
			}();
		} else {
			return running = dispatch();
		}
	};
}

/** @internal */
export function debounceTimer<Result>(ms: number, fn: () => MaybePromise<Result>) {
	let completion: WithResolvers<Result> | undefined;
	let timer: NodeJS.Timeout | undefined;
	return () => {
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			void async function() {
				assert(completion !== undefined);
				try {
					completion.resolve(await fn());
					timer = undefined;
				} catch (error) {
					completion.reject(error);
				}
			}();
		}, ms);
		timer.unref();
		completion = withResolvers<Result>();
		return completion.promise;
	};
}

/**
 * Evicts the given module URL from nodejs's internal module cache. `--expose-internals` must be
 * used to enable this. It might improve memory leakage, but probably not really.
 * @internal
 */
export const evictModule = function() {
	try {
		const require = createRequire(import.meta.url);
		const loader = require("internal/process/esm_loader");
		const { moduleMap } = loader.esmLoader;
		if (moduleMap) {
			return (url: string) => {
				if (moduleMap.has(url)) {
					moduleMap.delete(url);
					return true;
				} else {
					return false;
				}
			};
		}
	} catch {}
}();

/** @internal */
export function discriminatedTypePredicate<Type extends { type: unknown }, Check extends Type>(type: Check["type"]) {
	return (node: Type): node is Check => node.type === type;
}

/** @internal */
export interface WithResolvers<Type> {
	readonly promise: Promise<Type>;
	readonly resolve: (value: Type) => void;
	readonly reject: (reason: unknown) => void;
}

// https://github.com/tc39/proposal-promise-with-resolvers
/** @internal */
export function withResolvers<Type>() {
	let resolve: (value: Type) => void;
	let reject: (reason: unknown) => void;
	const promise = new Promise<Type>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve: resolve!, reject: reject! } as WithResolvers<Type>;
}
