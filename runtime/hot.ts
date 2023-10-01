import type { ReloadableModuleInstance } from "./instance.js";
import assert from "node:assert/strict";
import Fn from "dynohot/functional";
import { ReloadableModuleController } from "./controller.js";
import { type ModuleController, ModuleStatus } from "./module.js";
import { makeRelative, plural } from "./utility.js";

// Prior art:
// https://webpack.js.org/api/hot-module-replacement
// https://github.com/FredKSchott/esm-hmr
// https://vitejs.dev/guide/api-hmr.html
// https://github.com/rixo/rollup-plugin-hot#api

/** @internal */
export let didDynamicImport: (instance: ReloadableModuleInstance, controller: ModuleController) => void;
/** @internal */
export let dispose: (instance: ReloadableModuleInstance) => Promise<Data>;
/** @internal */
export let isAccepted: (instance: ReloadableModuleInstance, modules: readonly ReloadableModuleController[]) => boolean;
/** @internal */
export let isAcceptedSelf: (instance: ReloadableModuleInstance) => boolean;
/** @internal */
export let isDeclined: (instance: ReloadableModuleInstance) => boolean;
/** @internal */
export let isInvalidated: (instance: ReloadableModuleInstance) => boolean;
/** @internal */
export let prune: (instance: ReloadableModuleInstance) => Promise<void>;
/** @internal */
export let tryAccept: (instance: ReloadableModuleInstance, modules: readonly ReloadableModuleController[]) => Promise<boolean>;
/** @internal */
export let tryAcceptSelf: (instance: ReloadableModuleInstance, self: () => ModuleNamespace) => Promise<boolean>;

/** @internal */
export type Data = Record<keyof any, unknown>;

// Duplicated here to make copying the .d.ts file easier
type ModuleNamespace = Record<string, unknown>;

type LocalModuleEntry = {
	found: true;
	module: ReloadableModuleController;
	specifier: string;
} | {
	found: false;
	module: undefined | null;
	specifier: string;
};

function selectHot(instance: ReloadableModuleInstance) {
	assert(instance.state.status !== ModuleStatus.new);
	return instance.state.environment.hot;
}

export class Hot<Data extends Record<keyof any, unknown> = Record<keyof any, unknown>> {
	/**
	 * This is the `data` object passed to the `dispose` handler of the previous `Hot` instance.
	 * You can use this to stash references like an HTTP server or database connection for the
	 * next instance of your module.
	 */
	readonly data?: Data | undefined;

	#accepts: {
		callback: ((modules: readonly ModuleNamespace[]) => Promise<void> | void) | undefined;
		localEntries: readonly LocalModuleEntry[];
	}[] = [];

	#acceptsSelf: ((self: () => ModuleNamespace) => MaybePromise<void>)[] = [];
	#declined = false;
	// dispose & prune
	#destructors: ((data: Data, prune?: boolean) => Promise<void> | void)[] = [];
	#dynamicImports = new Set<ModuleController>();
	#instance: ReloadableModuleInstance;
	#invalidated = false;
	#module;
	#usesDynamicImport;

	constructor(
		module: unknown,
		instance: unknown,
		usesDynamicImport: boolean,
		data?: Data,
	) {
		this.#module = module as ReloadableModuleController;
		this.#instance = instance as ReloadableModuleInstance;
		this.#usesDynamicImport = usesDynamicImport;
		this.data = data;
		Object.freeze(this);
	}

	static {
		didDynamicImport = (instance, controller) => {
			const hot = selectHot(instance);
			if (hot !== null) {
				hot.#dynamicImports.add(controller);
			}
		};
		dispose = async instance => {
			const data = {};
			const hot = selectHot(instance);
			if (hot !== null) {
				for (const callback of Fn.reverse(hot.#destructors)) {
					await callback(data);
				}
			}
			return data;
		};
		isAccepted = (instance, modules) => {
			const hot = selectHot(instance);
			if (hot !== null && hot.#invalidated) {
				return false;
			} else {
				const imports = new Set(instance.iterateDependencies());
				const acceptedModules = new Set(Fn.transform(hot === null ? [] : hot.#accepts, accepts => {
					const acceptedModules = accepts.localEntries.map(entry =>
						entry.found ? entry.module : instance.lookupSpecifier(entry.specifier));
					if (acceptedModules.every(module => module != null)) {
						return acceptedModules as ReloadableModuleController[];
					} else {
						if (hot !== null) {
							const specifiers = Array.from(Fn.transform(
								acceptedModules.entries(),
								function*([ ii, module ]) {
									if (module == null) {
										yield accepts.localEntries[ii]!.specifier;
									}
								}));
							console.error(`[hot] Warning: ${plural("specifier", specifiers.length)} ${specifiers.map(specifier => JSON.stringify(specifier)).join(", ")} from ${makeRelative(hot.#module.url)} could not be resolved.`);
							if (accepts.localEntries.length > 1) {
								console.error(`[hot] The entire accept group of: ${accepts.localEntries.map(entry => JSON.stringify(entry.specifier)).join(", ")} will be ignored.`);
							}
						}
						return [];
					}
				}));
				return modules.every(module => !imports.has(module) || acceptedModules.has(module));
			}
		};
		isAcceptedSelf = instance => {
			const hot = selectHot(instance);
			return hot !== null && hot.#acceptsSelf.length > 0;
		};
		isDeclined = instance => {
			const hot = selectHot(instance);
			return hot !== null && hot.#declined;
		};
		isInvalidated = instance => {
			const hot = selectHot(instance);
			return hot !== null && hot.#invalidated;
		};
		prune = async instance => {
			const data = {};
			const hot = selectHot(instance);
			if (hot !== null) {
				for (const callback of Fn.reverse(hot.#destructors)) {
					await callback(data, true);
				}
			}
		};
		tryAccept = async (instance, modules) => {
			const hot = selectHot(instance);
			if (hot !== null && hot.#invalidated) {
				return false;
			} else {
				const imports = new Set(instance.iterateDependencies());
				const acceptedHandlers = Array.from(Fn.filter(Fn.map(hot === null ? [] : hot.#accepts, accepts => {
					const acceptedModules = accepts.localEntries.map(entry =>
						entry.found ? entry.module : instance.lookupSpecifier(entry.specifier));
					if (acceptedModules.every(module => module != null)) {
						return {
							callback: accepts.callback,
							modules: acceptedModules as ReloadableModuleController[],
						};
					}
				})));
				const acceptedModules = new Set(Fn.transform(acceptedHandlers, handler => handler.modules));
				if (!modules.every(module => !imports.has(module) || acceptedModules.has(module))) {
					return false;
				}
				for (const handler of acceptedHandlers) {
					if (handler.callback && modules.some(module => handler.modules.includes(module))) {
						const namespaces = handler.modules.map(module => module.select().moduleNamespace()());
						await handler.callback(namespaces);
						if (hot !== null && hot.#invalidated) {
							return false;
						}
					}
				}
				return true;
			}
		};
		tryAcceptSelf = async (instance, self) => {
			const hot = selectHot(instance);
			if (hot === null || hot.#acceptsSelf.length === 0) {
				return false;
			} else {
				for (const callback of hot.#acceptsSelf) {
					await callback(self);
				}
				return true;
			}
		};
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
			const localEntries: LocalModuleEntry[] = arg1.map(specifier => {
				const module = this.#instance.lookupSpecifier(specifier);
				if (module == null) {
					return { found: false, module, specifier };
				} else {
					return { found: true, module, specifier };
				}
			});
			const callback = arg2 as ((dependency: readonly ModuleNamespace[]) => Promise<void> | void) | undefined;
			assert(callback === undefined || typeof callback === "function");
			for (const [ ii, descriptor ] of localEntries.entries()) {
				if (!descriptor.found) {
					if (!this.#usesDynamicImport) {
						console.trace(`[hot] ${arg1[ii]} was not imported by this module`);
					} else if (descriptor.module === null) {
						console.trace(`[hot] ${arg1[ii]} is not a reloadable module`);
					}
				}
			}
			this.#accepts.push({ localEntries, callback });
		} else {
			const callback = arg1 as ((self: ModuleNamespace) => Promise<void> | void) | undefined;
			this.#acceptsSelf.push(async self => {
				await callback?.(self());
			});
		}
	}

	/**
	 * Mark this module as not-updatable. If this module needs to be updated then the update will
	 * fail.
	 */
	decline() {
		this.#declined = true;
	}

	/**
	 * Register a callback which is invoked when this module instance is disposed. The callback
	 * receives a parameter `data` which can be used to store arbitrary data. The same `data` object
	 * will be passed to the next instance via `import.meta.hot.data`.
	 */
	dispose(onDispose: (data: Data) => Promise<void> | void) {
		assert.ok(typeof onDispose === "function");
		this.#destructors.push(data => onDispose(data));
	}

	/**
	 * Mark this module as invalidated. If an update is in progress then this will cancel a
	 * self-accept. If an update is not in progress then one will be scheduled.
	 */
	invalidate() {
		this.#invalidated = true;
		void this.#module.application.requestUpdate();
	}

	/**
	 * Similar to `dispose`, but this is invoked when the module is removed from the dependency
	 * graph entirely.
	 */
	prune(onPrune: () => Promise<void> | void) {
		this.#destructors.push((data, prune) => {
			if (prune) {
				return onPrune();
			}
		});
	}
}

Object.freeze(Hot.prototype);
