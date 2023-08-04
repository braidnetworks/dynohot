import type { ReloadableModuleInstance } from "./instance.js";
import assert from "node:assert/strict";
import Fn from "dynohot/functional";
import { ReloadableModuleController } from "./controller.js";
import { type ModuleController, ModuleStatus } from "./module.js";

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

// Duplicated here to make copying the .d.ts file easier
type Data = Record<keyof any, any>;
type ModuleNamespace = Record<string, unknown>;

type LocalModuleEntry = {
	found: true;
	module: ReloadableModuleController;
} | {
	found: false;
	module: undefined | null;
	specifier: string;
};

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

function selectHot(instance: ReloadableModuleInstance) {
	assert(instance.state.status !== ModuleStatus.new);
	return instance.state.environment.hot;
}

export class Hot {
	#accepts: {
		callback: ((modules: readonly ModuleNamespace[]) => Promise<void> | void) | undefined;
		localEntries: readonly LocalModuleEntry[];
	}[] = [];

	#acceptsSelf: ((self: ModuleNamespace) => Promise<boolean>)[] = [];
	#declined = false;
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
		didDynamicImport = (instance, controller) => selectHot(instance).#dynamicImports.add(controller);
		dispose = async instance => {
			const data = {};
			await dispatchCheckHandled(selectHot(instance).#dispose, async callback => {
				await callback(data);
				return true;
			});
			return data;
		};
		isAccepted = (instance, modules) => {
			const hot = selectHot(instance);
			if (hot.#invalidated) {
				return false;
			} else {
				const acceptedModules = new Set(Fn.transform(hot.#accepts, accepts => {
					const acceptedModules = accepts.localEntries.map(entry =>
						entry.found ? entry.module : hot.#module.lookupSpecifier(hot, entry.specifier));
					if (acceptedModules.every(module => module != null)) {
						return acceptedModules as ReloadableModuleController[];
					} else {
						return [];
					}
				}));
				return modules.every(module => acceptedModules.has(module));
			}
		};
		isAcceptedSelf = instance => {
			const hot = selectHot(instance);
			return !hot.#invalidated && hot.#acceptsSelf.length > 0;
		};
		isDeclined = instance => selectHot(instance).#declined;
		isInvalidated = instance => selectHot(instance).#invalidated;
		prune = async instance => {
			await dispatchCheckHandled(selectHot(instance).#prune, async callback => {
				await callback();
				return true;
			});
		};
		tryAccept = async (instance, modules) => {
			const hot = selectHot(instance);
			if (hot.#invalidated as boolean) {
				return false;
			} else {
				const acceptedHandlers = Array.from(Fn.filter(Fn.map(hot.#accepts, accepts => {
					const acceptedModules = accepts.localEntries.map(entry =>
						entry.found ? entry.module : hot.#module.lookupSpecifier(hot, entry.specifier));
					if (acceptedModules.every(module => module != null)) {
						return {
							callback: accepts.callback,
							modules: acceptedModules as ReloadableModuleController[],
						};
					}
				})));
				const acceptedModules = new Set(Fn.transform(acceptedHandlers, handler => handler.modules));
				if (modules.every(module => acceptedModules.has(module))) {
					for (const handler of acceptedHandlers) {
						if (handler.callback && modules.some(module => handler.modules.includes(module))) {
							const namespaces = handler.modules.map(module => module.select().moduleNamespace()());
							await handler.callback(namespaces);
							if (hot.#invalidated) {
								return false;
							}
						}
					}
				}
				return true;
			}
		};
		tryAcceptSelf = async (instance, self) => {
			const hot = selectHot(instance);
			return !hot.#invalidated && dispatchCheckHandled(hot.#acceptsSelf, callback => callback(self()));
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
				const module = this.#module.lookupSpecifier(this, specifier);
				if (module == null) {
					return { found: false, module, specifier };
				} else {
					return { found: true, module };
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
		this.#declined = true;
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
		void this.#module.application.requestUpdate();
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
