import type { LoadedModuleRequestEntry, ModuleBody, ModuleDeclaration } from "./declaration.js";
import type { Hot } from "./hot.js";
import type { BindingEntry, ExportIndirectEntry, ExportIndirectStarEntry, ExportStarEntry } from "./module/binding.js";
import type{ AbstractModuleController, SelectModuleInstance } from "./module.js";
import type { TraverseCyclicState } from "./traverse.js";
import assert from "node:assert/strict";
import Fn from "dynohot/functional";
import { dispose, isInvalidated, prune, tryAccept, tryAcceptSelf } from "./hot.js";
import { ReloadableModuleInstance } from "./instance.js";
import { BindingType } from "./module/binding.js";
import { ModuleStatus } from "./module.js";
import { traverseBreadthFirst, traverseDepthFirst } from "./traverse.js";
import { debounceAsync, debounceTimer, discriminatedTypePredicate, evictModule } from "./utility.js";
import { FileWatcher } from "./watcher.js";

let root: ReloadableModuleController | null = null;
const modules = new Map<string, ReloadableModuleController>();

/** @internal */
export const requestUpdate = debounceTimer(100, debounceAsync(async () => {
	assert(root !== null);
	await ReloadableModuleController.requestUpdate();
}));

function makeIterateReloadableControllers(select: SelectModuleInstance) {
	return function*(controller: ReloadableModuleController) {
		for (const child of controller.select(select).declaration.loadedModules) {
			const instance = child.controller();
			if (instance.reloadable) {
				yield instance;
			}
		}
	};
}

function makeIterateReloadableInstances(select: SelectModuleInstance) {
	return function*(instance: ReloadableModuleInstance) {
		for (const child of instance.declaration.loadedModules) {
			const instance = child.controller();
			if (instance.reloadable) {
				yield instance.select(select);
			}
		}
	};
}

/** @internal */
export class ReloadableModuleController implements AbstractModuleController {
	private current: ReloadableModuleInstance | null = null;
	private pending: ReloadableModuleInstance | null = null;
	private previous: ReloadableModuleInstance | null = null;
	private staging: ReloadableModuleInstance | null = null;
	private temporary: ReloadableModuleInstance | null = null;
	private version = 0;
	readonly reloadable = true;
	traversalState: TraverseCyclicState | undefined;
	visitation = 0;

	static selectCurrent = (controller: ReloadableModuleController) => controller.current;

	private static readonly iterateCurrent = makeIterateReloadableControllers(ReloadableModuleController.selectCurrent);
	private static readonly iteratePending = makeIterateReloadableControllers(controller => controller.pending);
	private static readonly iterateTemporary = makeIterateReloadableControllers(controller => controller.temporary);

	constructor(
		private readonly url: string,
	) {
		const watcher = new FileWatcher();
		watcher.watch(url, () => {
			void (async () => {
				const instance = this.staging ?? this.current;
				assert(instance !== null);
				const { importAssertions } = instance.declaration;
				const params = new URLSearchParams([
					[ "url", url ],
					[ "version", String(++this.version) ],
					...Fn.map(
						Object.entries(importAssertions),
						([ key, value ]) => [ "with", String(new URLSearchParams([ [ key, value ] ])) ]),
				] as Iterable<[ string, string ]>);
				await import(`hot:reload?${String(params)}`);
				requestUpdate();
			})();
		});
	}

	static acquire(url: string) {
		return modules.get(url) ?? function() {
			const module = new ReloadableModuleController(url);
			modules.set(url, module);
			return module;
		}();
	}

	async main(this: ReloadableModuleController) {
		// Memoize the root module.
		assert.equal(root, null);
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		root = this;

		// Dispatch the module
		await this.dispatch();
	}

	async dispatch(this: ReloadableModuleController) {
		if (this.current as any === null) {
			// Promote `staging` to `current`, and instantiate all reloadable modules.
			await traverseBreadthFirst(
				this,
				makeIterateReloadableControllers(controller => controller.current ?? controller.staging),
				controller => {
					if (controller.current === null) {
						const { staging } = controller;
						assert(staging);
						controller.current = staging;
						controller.staging = null;
					}
					return controller.current.instantiate();
				});

			// Perform initial linkage
			assert(this.current !== null);
			traverseDepthFirst(
				this.current,
				makeIterateReloadableInstances(ReloadableModuleController.selectCurrent),
				node => node.link(ReloadableModuleController.selectCurrent));

			// Perform initial evaluation
			await traverseDepthFirst(
				this.current,
				makeIterateReloadableInstances(ReloadableModuleController.selectCurrent),
				node => node.evaluate());
		}
		return undefined;
	}

	// Invoked from transformed module source
	load(
		body: ModuleBody,
		meta: ImportMeta,
		usesDynamicImport: boolean,
		importAssertions: Record<string, string>,
		loadedModules: readonly LoadedModuleRequestEntry[],
	) {
		if (evictModule) {
			// Experimental module eviction
			if (this.version !== 0) {
				const backingModuleParams = new URLSearchParams([
					[ "url", this.url ],
					[ "version", String(this.version) ],
					...Object.entries(importAssertions).map(
						([ key, value ]) => [ "with", String(new URLSearchParams([ [ key, value ] ])) ]),
				] as Iterable<[ string, string ]>);
				const backingModuleURL = `hot:module?${String(backingModuleParams)}`;
				evictModule(backingModuleURL);
			}
		}
		const declaration: ModuleDeclaration = {
			body,
			meta,
			importAssertions,
			usesDynamicImport,
			loadedModules,
			// TODO: Check name collisions statically. Not a big deal for well-typed code.
			indirectExportEntries: new Map(function*() {
				const predicate = Fn.somePredicate<BindingEntry, ExportIndirectEntry | ExportIndirectStarEntry>([
					discriminatedTypePredicate(BindingType.indirectExport),
					discriminatedTypePredicate(BindingType.indirectStarExport),
				]);
				for (const moduleRequest of loadedModules) {
					for (const binding of Fn.filter(moduleRequest.bindings, predicate)) {
						const as = binding.type === BindingType.indirectStarExport ? binding.as : binding.as ?? binding.name;
						yield [ as, { moduleRequest, binding } ];
					}
				}
			}()),
			starExportEntries: Array.from(function*() {
				const exportStarPredicate = discriminatedTypePredicate<BindingEntry, ExportStarEntry>(BindingType.exportStar);
				for (const moduleRequest of loadedModules) {
					for (const binding of Fn.filter(moduleRequest.bindings, exportStarPredicate)) {
						yield { moduleRequest, binding };
					}
				}
			}()),
		};
		this.staging = new ReloadableModuleInstance(this, declaration);
	}

	lookupSpecifier(hot: Hot, specifier: string) {
		const select = ((): SelectModuleInstance | undefined => {
			const check = (select: SelectModuleInstance) => {
				const instance = select(this);
				if (instance !== null) {
					if (
						instance.state.status !== ModuleStatus.new &&
						instance.state.environment.hot === hot
					) {
						return select;
					}
				}
			};
			return check(ReloadableModuleController.selectCurrent) ?? check(controller => controller.pending);
		})();
		if (select !== undefined) {
			const instance = this.select(select);
			const entry = instance.declaration.loadedModules.find(entry => entry.specifier === specifier);
			const controller = entry?.controller();
			if (controller) {
				if (controller.reloadable) {
					return controller;
				} else {
					return null;
				}
			}
		}
	}

	select(select: SelectModuleInstance) {
		const instance = select(this);
		assert(instance);
		return instance;
	}

	static async requestUpdate() {
		assert(root !== null);

		// Check for loaded updates and assign `pending`
		let hasUpdate = false;
		let hasUpdatedCode = false;
		const previousControllers: ReloadableModuleController[] = [];
		traverseBreadthFirst(root, ReloadableModuleController.iterateCurrent, controller => {
			assert(controller.current !== null);
			assert(controller.current.state.status !== ModuleStatus.new);
			assert.equal(controller.pending, null);
			assert.equal(controller.previous, null);
			previousControllers.push(controller);
			controller.previous = controller.current;
			if (controller.staging) {
				controller.pending = controller.staging;
				hasUpdate = true;
				hasUpdatedCode = true;
			} else if (isInvalidated(controller.current.state.environment.hot)) {
				controller.pending = controller.current.clone();
				hasUpdate = true;
			} else {
				controller.pending = controller.current;
			}
		});

		// Roll back if there's no update
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (!hasUpdate) {
			traverseBreadthFirst(root, ReloadableModuleController.iteratePending, controller => {
				assert.notEqual(controller.pending, null);
				controller.pending = null;
				controller.previous = null;
			});
			return;
		}

		// If the update contains new code then we need to make sure it will link. Normally the
		// graph will link and then evaluate, but when dispatching a hot update a module is allowed
		// to invalidate itself. So, we're not really sure which bindings will end up where. This
		// step ensures that a linkage error doesn't cause the whole graph to throw an error.
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (hasUpdatedCode) {
			// Instantiate temporary module instances
			await traverseBreadthFirst(root, ReloadableModuleController.iteratePending, controller => {
				assert(controller.pending !== null);
				assert.equal(controller.temporary, null);
				controller.temporary = controller.pending.clone();
				return controller.temporary.instantiate();
			});
			try {
				// Attempt to link
				traverseDepthFirst(root, ReloadableModuleController.iterateTemporary, controller => {
					assert(controller.temporary !== null);
					controller.temporary.link(controller => controller.temporary);
				});
			} catch (error: any) {
				// Roll back
				console.error(`[hot] Caught link error: ${error.message}`);
				await traverseBreadthFirst(root, ReloadableModuleController.iteratePending, controller => {
					const { pending } = controller;
					assert(pending !== null);
					controller.pending = null;
					return pending.dispose();
				});
				return;
			} finally {
				// Cleanup temporary instances
				await traverseBreadthFirst(root, ReloadableModuleController.iterateTemporary, controller => {
					const { temporary } = controller;
					controller.temporary = null;
					return temporary?.dispose();
				});
			}
		}

		// Dispatch the update. This performs link & evaluate at the same time. The evaluation order
		// of this routine is different than the original evaluation. In the original evaluation,
		// non-cyclic dependencies will be evaluated in between modules which form a cycle. Here,
		// cycles will be evaluated together. This shouldn't be a problem in all but the most
		// pathological of cases.
		const disposeInstances: ReloadableModuleInstance[] = [];
		let reevaluations = 0;
		let loads = 0;
		try {
			await traverseDepthFirst(root, ReloadableModuleController.iteratePending, {
				join: async (node, cycleNodes) => {
					assert(node.current !== null);
					assert(node.current.state.status !== ModuleStatus.new);
					const nodes = [ ...cycleNodes, node ];
					// If this node and all cycle nodes are current then we will check if any
					// dependencies were updated
					if (nodes.every(node => node.pending === node.current)) {
						// First check if any dependency of any cycle node was updated. Only non-cycle
						// nodes are allowed to accept updates.
						const hasUpdatedDependencies = Fn.some(Fn.transform(
							nodes,
							node => Fn.map(
								ReloadableModuleController.iteratePending(node),
								dependency => dependency.previous !== dependency.current)));
						if (!hasUpdatedDependencies) {
							for (const node of nodes) {
								node.pending = null;
							}
							return;
						}
						if (cycleNodes.length === 0) {
							const result = Array.from(Fn.map(
								ReloadableModuleController.iteratePending(node),
								dependency => {
									assert(dependency.current !== null);
									const namespace = () =>
										dependency.current!.moduleNamespace(ReloadableModuleController.selectCurrent)();
									const updated = dependency.previous !== dependency.current;
									return { controller: dependency, namespace, updated };
								}));
							assert(node.pending !== null);
							node.current.relink(cycleNodes, ReloadableModuleController.selectCurrent);
							if (
								result.every(({ updated }) => !updated) ||
								await tryAccept(node.current.state.environment.hot, result)
							) {
								node.pending = null;
								return;
							}
						}
					}
					// This node needs to be replaced.
					// Instantiate
					for (const node of nodes) {
						assert(node.current !== null && node.pending !== null);
						assert(node.current.state.status !== ModuleStatus.new);
						const data = dispose(node.current.state.environment.hot);
						if (node.current === node.pending) {
							++reevaluations;
							node.current = node.current.clone();
						} else {
							++loads;
							node.current = node.pending;
						}
						node.pending = null;
						await node.current.instantiate(data);
					}
					// Link
					for (const node of nodes) {
						assert(node.current !== null);
						node.current.link(ReloadableModuleController.selectCurrent);
					}
					// Evaluate
					for (let ii = 0; ii < nodes.length; ++ii) {
						const node = nodes[ii]!;
						assert(node.current !== null);
						try {
							await node.current.evaluate();
							if (node.current === node.staging) {
								node.staging = null;
							}
						} catch (error) {
							await node.current.dispose();
							node.current = node.previous;
							for (let jj = ii + 1; jj < nodes.length; ++jj) {
								const node = nodes[jj]!;
								const instance = node.current;
								assert(instance !== null);
								assert(instance.state.status === ModuleStatus.linked);
								await instance.dispose();
								node.current = node.previous;
							}
							throw error;
						}
					}
					// Try self-accept
					if (cycleNodes.length === 0) {
						const namespace = () => node.current!.moduleNamespace(ReloadableModuleController.selectCurrent)();
						if (await tryAcceptSelf(node.current.state.environment.hot, namespace)) {
							// If the module accepted itself we set `previous` to `current` so
							// dependents don't reevaluate
							assert(node.previous !== null);
							disposeInstances.push(node.previous);
							node.previous = node.current;
						}
					}
				},
			});

		} catch (error) {
			// Re-link everything to ensure consistent internal state
			await traverseDepthFirst(root, ReloadableModuleController.iterateCurrent, {
				join: async (node, cycleNodes) => {
					assert(node.current !== null);
					node.current.relink(cycleNodes, ReloadableModuleController.selectCurrent);
					const nodes = [ ...cycleNodes, node ];
					for (const node of nodes) {
						if (node.pending !== null) {
							if (node.pending !== node.current) {
								await node.pending.dispose();
							}
							node.pending = null;
						}
					}
				},
			});
			console.error("[hot] Caught error during an update.");
			console.error(error);

		} finally {
			// Dispose old modules
			const nonAcceptedRoot = root.current !== root.previous;
			const currentControllers = new Set<ReloadableModuleController>();
			traverseBreadthFirst(root, ReloadableModuleController.iterateCurrent, controller => {
				currentControllers.add(controller);
				assert(controller.pending === null);
				assert(controller.previous !== null);
				if (controller.previous !== controller.current) {
					disposeInstances.push(controller.previous);
				}
				controller.previous = null;
			});
			await Fn.mapAwait(disposeInstances, instance => instance.dispose());
			for (const controller of previousControllers) {
				if (!currentControllers.has(controller)) {
					assert(controller.current !== null);
					assert(controller.current.state.status === ModuleStatus.evaluated);
					await controller.current.dispose();
					await prune(controller.current.state.environment.hot);
				}
			}
			const plural = (word: string, count: number) => `${word}${count === 1 ? "" : "s"}`;
			console.error(`[hot] Loaded ${loads} new ${plural("module", loads)}, reevaluated ${reevaluations} existing ${plural("module", reevaluations)}.`);
			if (nonAcceptedRoot) {
				console.error("[hot] Unaccepted update reached the root module. The application should be restarted!");
			}
		}
	}
}
