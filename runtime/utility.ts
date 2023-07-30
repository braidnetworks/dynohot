import { createRequire } from "node:module";

/** @internal */
export const moduleNamespacePropertyDescriptor = {
	configurable: false,
	enumerable: true,
} satisfies Partial<PropertyDescriptor>;

/** @internal */
export function debounceAsync(fn: () => Promise<void>) {
	let pending = false;
	let running = false;
	return () => {
		if (running) {
			pending = true;
			return;
		}
		running = true;
		void async function() {
			try {
				await fn();
			} finally {
				running = false;
				if (pending) {
					pending = false;
					await fn();
				}
			}
		}();
	};
}

/** @internal */
export function debounceTimer(ms: number, fn: () => void) {
	let timer: NodeJS.Timeout | undefined;
	return () => {
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(fn, ms);
		timer.unref();
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
