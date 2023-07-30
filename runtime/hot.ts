import type { ReloadableModuleController } from "./controller.js";
import type { ModuleController } from "./module.js";
import assert from "node:assert/strict";
import { requestUpdate } from "./controller.js";

// Prior art:
// https://webpack.js.org/api/hot-module-replacement
// https://github.com/FredKSchott/esm-hmr
// https://vitejs.dev/guide/api-hmr.html
// https://github.com/rixo/rollup-plugin-hot#api

/** @internal */
export let didDynamicImport: (hot: Hot, controller: ModuleController) => void;
/** @internal */
export let dispose: (hot: Hot) => Promise<Data>;
/** @internal */
export let isInvalidated: (hot: Hot) => boolean;
/** @internal */
export let prune: (hot: Hot) => Promise<void>;
/** @internal */
export let tryAccept: (hot: Hot, modules: readonly ModuleUpdateEntry[]) => Promise<boolean>;
/** @internal */
export let tryAcceptSelf: (hot: Hot, self: () => ModuleNamespace) => Promise<boolean>;

// Duplicated here to make copying the .d.ts file easier
type Data = Record<keyof any, any>;
type ModuleNamespace = Record<string, unknown>;

interface ModuleUpdateEntry {
	controller: ReloadableModuleController;
	namespace: () => ModuleNamespace;
	updated: boolean;
}

async function dispatchCheckHandled<Type>(
	array: readonly Type[],
	predicate: (value: Type) => Promise<boolean>,
) {
	if (array.length === 0) {
		return false;
	}
	for (const value of array) {
		if (!await predicate(value)) {
			return false;
		}
	}
	return true;
}

export class Hot {
	#accepts: ((entries: readonly ModuleUpdateEntry[]) => Promise<boolean>)[] = [];
	#acceptsSelf: ((self: ModuleNamespace) => Promise<boolean>)[] = [];
	#dispose: ((data: Data) => Promise<void> | void)[] = [];
	#dynamicImports = new Set<ModuleController>();
	#invalidated = false;
	#module;
	#prune: (() => Promise<void> | void)[] = [];
	#usesDynamicImport;

	constructor(
		module: unknown,
		usesDynamicImport: boolean,
		public readonly data?: unknown,
	) {
		this.#module = module as ReloadableModuleController;
		this.#usesDynamicImport = usesDynamicImport;
		Object.freeze(this);
	}

	static {
		didDynamicImport = (hot, controller) => hot.#dynamicImports.add(controller);
		dispose = async hot => {
			const data = {};
			await dispatchCheckHandled(hot.#dispose, async callback => {
				await callback(data);
				return true;
			});
			return data;
		};
		isInvalidated = hot => hot.#invalidated;
		prune = async hot => {
			await dispatchCheckHandled(hot.#prune, async callback => {
				await callback();
				return true;
			});
		};
		tryAccept = async (hot, modules) =>
			!hot.#invalidated &&
			dispatchCheckHandled(hot.#accepts, callback => callback(modules));
		tryAcceptSelf = async (hot, self) =>
			!hot.#invalidated &&
			dispatchCheckHandled(hot.#acceptsSelf, callback => callback(self()));
	}

	/**
	 * Accept updates for this module. When any unaccepted dependencies are updated this module will
	 * be reevaluated without notifying any dependents.
	 */
	accept(onUpdate?: (self: ModuleNamespace) => Promise<void> | void): void;

	/**
	 * Accept updates for the given import specifier.
	 */
	accept(specifier: string, onUpdate?: (dependency: ModuleNamespace) => Promise<void> | void): void;

	/**
	 * Accept updates for the given import specifiers.
	 */
	accept<const Specifiers extends readonly string[]>(
		specifiers: Specifiers,
		onUpdate?: (dependencies: { [Specifier in keyof Specifiers]: ModuleNamespace }) => Promise<void> | void
	): void;

	accept(
		arg1?: string | ((self: ModuleNamespace) => Promise<void> | void) | readonly string[],
		arg2?: ((dependency: ModuleNamespace) => Promise<void> | void) | ((dependencies: ModuleNamespace[]) => Promise<void> | void),
	) {
		if (typeof arg1 === "string") {
			const callback = arg2 as ((dependency: ModuleNamespace) => Promise<void> | void) | undefined;
			assert(callback === undefined || typeof callback === "function");
			this.accept([ arg1 ], async modules => {
				await callback?.(modules[0]);
			});
		} else if (Array.isArray(arg1)) {
			const controllers = arg1.map(specifier => this.#module.lookupSpecifier(this, specifier));
			const callback = arg2 as ((dependency: readonly ModuleNamespace[]) => Promise<void> | void) | undefined;
			assert(callback === undefined || typeof callback === "function");
			for (const [ ii, controller ] of controllers.entries()) {
				if (controller === undefined && !this.#usesDynamicImport) {
					console.error(`[hot] ${arg1[ii]} was not imported by this module`);
				} else if (controller === null) {
					console.error(`[hot] ${arg1[ii]} is not a reloadable module`);
				}
			}
			this.#accepts.push(async entries => {
				const updates = controllers.map(controller => entries.find(entry => entry.controller === controller));
				if (updates.some(update => update === undefined)) {
					return false;
				} else if (updates.every(update => !update!.updated)) {
					return true;
				} else {
					const modules = updates.map(update => update!.namespace());
					await callback?.(modules);
					return !this.#invalidated;
				}
			});
		} else {
			const callback = arg1 as ((self: ModuleNamespace) => Promise<void> | void) | undefined;
			this.#acceptsSelf.push(async self => {
				await callback?.(self);
				return !this.#invalidated;
			});
		}
	}

	/**
	 * Mark this module as not-updatable. If this module needs to be updated then the update will
	 * fail.
	 */
	decline() {
		console.error("[hot] `decline()` is not yet implemented");
	}

	/**
	 * Register a callback which is invoked when this module instance is disposed. The callback
	 * receives a parameter `data` which can be used to store arbitrary data. The same `data` object
	 * will be passed to the next instance via `import.meta.hot.data`.
	 */
	dispose(onDispose: (data: Data) => Promise<void> | void) {
		assert(typeof onDispose === "function");
		this.#dispose.push(onDispose);
	}

	/**
	 * Mark this module as invalidated. If an update is in progress then this will cancel a
	 * self-accept. If an update is not in progress then one will be scheduled.
	 */
	invalidate() {
		this.#invalidated = true;
		requestUpdate();
	}

	/**
	 * Similar to `dispose`, but this is invoked when the module is removed from the dependency
	 * graph entirely.
	 */
	prune(callback: () => Promise<void> | void) {
		this.#prune.push(callback);
	}
}

Object.freeze(Hot.prototype);
