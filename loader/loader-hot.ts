import type { MessagePort } from "node:worker_threads";

/**
 * This is visible to other loaders, in the `load` hook. It has nothing to do with
 * `import.meta.hot`. If you are writing a loader you can tweak the behavior of modules with this
 * object.
 *
 * I was going to call it `MetaHot` which is pretty much exactly what this is, but that is confusing
 * with `import.meta.hot`.
 */
export class LoaderHot {
	readonly #port;
	readonly #url;

	/** @internal */
	constructor(url: string, port: MessagePort) {
		this.#port = port;
		this.#url = url;
	}

	invalidate() {
		this.#port.postMessage(this.#url);
	}
}

declare module "module" {
	interface LoadHookContext {
		/**
		 * `dynohot` loader-hot instance.
		 */
		hot?: LoaderHot;
	}
}
