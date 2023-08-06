import type { LoadedModuleRequestEntry, ModuleBody, ModuleDeclaration } from "./declaration.js";
import type { Hot } from "./hot.js";
import type { BindingEntry, ExportIndirectEntry, ExportIndirectStarEntry, ExportStarEntry } from "./module/binding.js";
import type{ AbstractModuleController, ModuleNamespace, SelectModuleInstance } from "./module.js";
import type { TraverseCyclicState } from "./traverse.js";
import assert from "node:assert/strict";
import Fn from "dynohot/functional";
import { dispose, isAccepted, isAcceptedSelf, isDeclined, isInvalidated, prune, tryAccept, tryAcceptSelf } from "./hot.js";
import { ReloadableModuleInstance } from "./instance.js";
import { BindingType } from "./module/binding.js";
import { ModuleStatus } from "./module.js";
import { traverseBreadthFirst, traverseDepthFirst } from "./traverse.js";
import { debounceAsync, debounceTimer, discriminatedTypePredicate, evictModule } from "./utility.js";
import { FileWatcher } from "./watcher.js";

/** @internal */
export function makeAcquire(dynamicImport: DynamicImport) {
	const application: Application = {
		dynamicImport,
		requestUpdate: defaultRequestUpdate,
		requestUpdateResult: defaultRequestUpdateResult,
	};
	const modules = new Map<string, ReloadableModuleController>();
	return function acquire(url: string) {
		return modules.get(url) ?? function() {
			const module = new ReloadableModuleController(application, url);
			modules.set(url, module);
			return module;
		}();
	};
}

function defaultRequestUpdate() {
	console.error("[hot] Update requested before fully loaded.");
	return Promise.resolve();
}

// eslint-disable-next-line @typescript-eslint/require-await
async function defaultRequestUpdateResult(): Promise<never> {
	throw new Error("Not fully loaded.");
}

interface Application {
	dynamicImport: DynamicImport;
	requestUpdate: () => Promise<void>;
	requestUpdateResult: () => Promise<UpdateResult>;
}

type DynamicImport = (specifier: string, importAssertions?: Record<string, string>) => Promise<ModuleNamespace>;

/** @internal */
export enum UpdateStatus {
	success = "success",
	declined = "declined",
	evaluationFailure = "evaluationError",
	linkError = "linkError",
	unaccepted = "unaccepted",
	unacceptedEvaluation = "unacceptedEvaluation",
}

type UpdateResult =
	undefined |
	UpdateSuccess |
	UpdateDeclined |
	UpdateUnaccepted |
	UpdateEvaluationError |
	UpdateLinkError;

interface UpdateSuccess {
	type: UpdateStatus.success | UpdateStatus.unacceptedEvaluation;
	stats: () => UpdateStats;
}

interface UpdateDeclined {
	type: UpdateStatus.declined;
	declined: readonly ReloadableModuleController[];
}

interface UpdateUnaccepted {
	type: UpdateStatus.unaccepted;
}

interface UpdateEvaluationError {
	type: UpdateStatus.evaluationFailure;
	error: unknown;
	stats: () => UpdateStats;
}

interface UpdateLinkError {
	type: UpdateStatus.linkError;
	error: unknown;
}

interface UpdateStats {
	duration: number;
	loads: number;
	reevaluations: number;
}

function logUpdate(update: UpdateResult) {
	if (update === undefined) {
		return;
	}
	const plural = (word: string, count: number) => `${word}${count === 1 ? "" : "s"}`;
	switch (update.type) {
		case UpdateStatus.declined:
			console.error(`[hot] A pending update was explicitly declined:\n${update.declined.map(module => `- ${module.location}`).join("\n")}`);
			break;

		case UpdateStatus.evaluationFailure: {
			const { duration, loads, reevaluations } = update.stats();
			const ms = Math.round(duration);
			console.error(`[hot] Loaded ${loads} new ${plural("module", loads)}, reevaluated ${reevaluations} existing ${plural("module", reevaluations)} in ${ms}ms.`);
			console.error("[hot] Caught evaluation error:", update.error);
			break;
		}

		case UpdateStatus.linkError:
			console.error("[hot] Caught link error:", update.error);
			break;

		case UpdateStatus.success: {
			const { duration, loads, reevaluations } = update.stats();
			const ms = Math.round(duration);
			console.error(`[hot] Loaded ${loads} new ${plural("module", loads)}, reevaluated ${reevaluations} existing ${plural("module", reevaluations)} in ${ms}ms.`);
			break;
		}

		case UpdateStatus.unaccepted:
			console.error("[hot] A pending update was not accepted, and reached the root module.");
			break;

		case UpdateStatus.unacceptedEvaluation: {
			const { duration, loads, reevaluations } = update.stats();
			const ms = Math.round(duration);
			console.error(`[hot] Loaded ${loads} new ${plural("module", loads)}, reevaluated ${reevaluations} existing ${plural("module", reevaluations)} in ${ms}ms.`);
			console.error("[hot] Unaccepted update reached the root module. The application should be restarted!");
			break;
		}

	}
}

function iterateReloadables(select: SelectModuleInstance) {
	return function*(controller: ReloadableModuleController) {
		for (const child of controller.select(select).declaration.loadedModules) {
			const instance = child.controller();
			if (instance.reloadable) {
				yield instance;
			}
		}
	};
}

function iterateReloadablesWithDynamics(select: SelectModuleInstance) {
	return function*(controller: ReloadableModuleController) {
		const instance = controller.select(select);
		for (const entry of instance.declaration.loadedModules) {
			const controller = entry.controller();
			if (controller.reloadable) {
				yield controller;
			}
		}
		yield* Fn.map(instance.dynamicImports, entry => entry.controller);
	};
}

function iterateReloadableInstances(select: SelectModuleInstance) {
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
	private wasSelfAccepted: boolean | undefined;
	private current: ReloadableModuleInstance | undefined;
	private pending: ReloadableModuleInstance | undefined;
	private previous: ReloadableModuleInstance | undefined;
	private staging: ReloadableModuleInstance | undefined;
	private temporary: ReloadableModuleInstance | undefined;
	private version = 0;
	/** This is the physical location of the module, as seen by the loader chain */
	readonly location;
	/** This is the resolutionURL as specified by the loader chain, seen by `import.meta.url` */
	readonly url;
	readonly reloadable = true;
	traversalState: TraverseCyclicState | undefined;
	visitation = 0;

	static selectCurrent = (controller: ReloadableModuleController) => controller.current;

	private static readonly iterateCurrent = iterateReloadables(controller => controller.current);
	private static readonly iteratePending = iterateReloadables(controller => controller.pending);
	private static readonly iterateTemporary = iterateReloadables(controller => controller.temporary);

	constructor(
		public readonly application: Application,
		public readonly bodyURL: string,
	) {
		const parsedURL = new URL(bodyURL);
		this.location = parsedURL.searchParams.get("hot") ?? bodyURL;
		parsedURL.searchParams.delete("hot");
		this.url = String(parsedURL);

		const watcher = new FileWatcher();
		watcher.watch(this.location, () => {
			void (async () => {
				const instance = this.staging ?? this.current;
				assert(instance !== undefined);
				const { importAssertions } = instance.declaration;
				const params = new URLSearchParams([
					[ "url", this.location ],
					[ "version", String(++this.version) ],
					...Fn.map(
						Object.entries(importAssertions),
						([ key, value ]) => [ "with", String(new URLSearchParams([ [ key, value ] ])) ]),
				] as Iterable<[ string, string ]>);
				await import(`hot:reload?${String(params)}`);
				void this.application.requestUpdate();
			})();
		});
	}

	async main(this: ReloadableModuleController) {
		// Bind `requestUpdate` to the root module
		assert.equal(this.application.requestUpdate, defaultRequestUpdate);
		this.application.requestUpdate = debounceTimer(100, debounceAsync(async () => {
			const update = await this.requestUpdate();
			logUpdate(update);
		}));
		this.application.requestUpdateResult = () => this.requestUpdate();

		// Dispatch the module
		await this.dispatch();
	}

	async dispatch(this: ReloadableModuleController) {
		if (this.current as ReloadableModuleInstance | undefined === undefined) {
			// Promote `staging` to `current`, and instantiate all reloadable modules.
			traverseBreadthFirst(
				this,
				iterateReloadables(controller => controller.current ?? controller.staging),
				controller => {
					if (controller.current === undefined) {
						const { staging } = controller;
						assert(staging !== undefined);
						controller.current = staging;
						controller.staging = undefined;
					}
					controller.current.instantiate();
				});

			// Perform initial linkage
			assert(this.current !== undefined);
			traverseDepthFirst(
				this.current,
				iterateReloadableInstances(ReloadableModuleController.selectCurrent),
				node => node.link(ReloadableModuleController.selectCurrent));

			// Perform initial evaluation
			await traverseDepthFirst(
				this.current,
				iterateReloadableInstances(ReloadableModuleController.selectCurrent),
				node => node.evaluate());
		}
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
					[ "url", this.bodyURL ],
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
				if (instance !== undefined) {
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
			const controller = function() {
				const entry = instance.declaration.loadedModules.find(entry => entry.specifier === specifier);
				if (entry === undefined) {
					const dynamicImport = instance.dynamicImports.find(entry => entry.specifier === specifier);
					return dynamicImport?.controller;
				} else {
					return entry.controller();
				}
			}();
			if (controller) {
				if (controller.reloadable) {
					return controller;
				} else {
					return null;
				}
			}
		}
	}

	select(select = ReloadableModuleController.selectCurrent) {
		const instance = select(this);
		assert(instance);
		return instance;
	}

	private async requestUpdate(): Promise<UpdateResult> {
		let loads = 0;
		let reevaluations = 0;
		const timeStarted = performance.now();
		const stats = (): UpdateStats => ({
			loads,
			reevaluations,
			duration: performance.now() - timeStarted,
		});

		// Collect dynamic imports and set up initial `pending` and `previous` state. Dynamic
		// imports are traversed first, then the primary graph is traversed.
		const dynamicImports = new Set<ReloadableModuleController>();
		const previousControllers: ReloadableModuleController[] = [];
		traverseBreadthFirst(this, iterateReloadablesWithDynamics(controller => controller.current), node => {
			// Update controller pending state
			assert(node.current !== undefined);
			assert.equal(node.pending, undefined);
			assert.equal(node.previous, undefined);
			node.pending = node.staging ?? node.current;
			node.previous = node.current;
			// Memoize all traversed controllers
			previousControllers.push(node);
			// Add dynamic imports to the graph
			for (const entry of node.current.dynamicImports) {
				dynamicImports.add(entry.controller);
			}
		});

		// Iterate dynamic imported roots in reverse order. This kind of works, but I don't think it
		// is actually sound.
		const dispatchRoots = new Set(Fn.reverse(Array.from(dynamicImports)));
		dispatchRoots.add(this);

		// Check for updates, that the updates are potentially accepted, and maybe clone `pending`
		// for evaluation if we know a module isn't accepted.
		let hasUpdate = false as boolean;
		let hasUpdatedCode = false as boolean;
		const declined: ReloadableModuleController[] = [];
		for (const dispatchRoot of dispatchRoots) {
			traverseDepthFirst(dispatchRoot, ReloadableModuleController.iteratePending, {
				join(cycleRoot, cycleNodes) {
					assert(cycleRoot.current !== undefined);
					assert(cycleNodes.every(node => node.current !== undefined));
					// If this node and all cycle nodes have no updated code then we will check if any
					// dependencies were updated
					const nodes = [ ...cycleNodes, cycleRoot ];
					if (nodes.every(node => !isInvalidated(node.current!) && node.current === node.pending)) {
						// First check if any dependency of any cycle node was updated
						const hasUpdatedDependencies = Fn.some(Fn.transform(
							nodes,
							node => Fn.map(
								iterateReloadablesWithDynamics(controller => controller.pending)(node),
								dependency => dependency.current !== dependency.pending && !dependency.wasSelfAccepted)));
						if (hasUpdatedDependencies) {
							// Dependencies updated, check if they are accepted. Only non-cycle
							// nodes are allowed to accept.
							if (cycleNodes.length === 0) {
								const updatedControllers = Array.from(Fn.filter(
									iterateReloadablesWithDynamics(controller => controller.pending)(cycleRoot),
									dependency => {
										assert(dependency.current !== undefined);
										return dependency.pending !== dependency.current && !dependency.wasSelfAccepted;
									}));
								if (isAccepted(cycleRoot.current, updatedControllers)) {
									return;
								}
							}
						} else {
							// No updates
							return;
						}
					}
					// An update is definitely required
					for (const node of nodes) {
						if (isDeclined(node.current!)) {
							declined.push(node);
						} else {
							hasUpdate = true;
							if (node.current === node.pending) {
								node.pending = node.pending!.clone();
							} else {
								hasUpdatedCode = true;
							}
						}
					}
					if (cycleNodes.length === 0) {
						cycleRoot.wasSelfAccepted = isAcceptedSelf(cycleRoot.current);
					}
				},
			});
		}

		let rollBack = false;
		try {
			if (declined.length > 0) {
				rollBack = true;
				return { type: UpdateStatus.declined, declined };
			} else if (this.current !== this.pending && !this.wasSelfAccepted) {
				rollBack = true;
				return { type: UpdateStatus.unaccepted };
			} else if (!hasUpdate) {
				rollBack = true;
				return undefined;
			}
			// If the update contains new code then we need to make sure it will link. Normally the
			// graph will link and then evaluate, but when dispatching a hot update a module is
			// allowed to invalidate itself. So, we're not really sure which bindings will end up
			// where. This step ensures that a linkage error doesn't cause the whole graph to throw
			// an error.
			if (hasUpdatedCode) {
				for (const dispatchRoot of dispatchRoots) {
					// Instantiate temporary module instances
					const nodes: ReloadableModuleController[] = [];
					traverseBreadthFirst(dispatchRoot, ReloadableModuleController.iteratePending, node => {
						assert.equal(node.temporary, undefined);
						nodes.push(node);
						node.temporary = node.select(controller => controller.pending).clone();
						node.temporary.instantiate();
					});
					try {
						// Attempt to link
						traverseDepthFirst(dispatchRoot, ReloadableModuleController.iterateTemporary, node => {
							assert(node.temporary !== undefined);
							node.temporary.link(controller => controller.temporary);
						});
					} finally {
						// Cleanup temporary instances
						for (const node of nodes) {
							const { temporary } = node;
							node.temporary = undefined;
							temporary?.destroy();
						}
					}
				}
			}

		} catch (error: any) {
			rollBack = true;
			return { type: UpdateStatus.linkError, error };

		} finally {
			if (rollBack) {
				for (const controller of previousControllers) {
					assert(controller.pending !== undefined);
					if (controller.pending !== controller.current) {
						controller.pending.destroy();
					}
					controller.wasSelfAccepted = undefined;
					controller.pending = undefined;
					controller.previous = undefined;
				}
			}
		}

		// Dispatch the update. This performs link & evaluate at the same time. The evaluation order
		// of this routine is different than the original evaluation. In the original evaluation,
		// non-cyclic dependencies will be evaluated in between modules which form a cycle. Here,
		// cycles will be evaluated together. This shouldn't be a problem in all but the most
		// pathological of cases.
		try {
			// `this` should be evaluated after dynamic imports
			dispatchRoots.delete(this);
			dispatchRoots.add(this);
			// Link & evaluate, update `current`, and remove `pending`. This loop very closely
			// mirrors the original invocation to `traverseDepthFirst` above.
			for (const dispatchRoot of dispatchRoots) {
				await traverseDepthFirst(dispatchRoot, iterateReloadables(controller => controller.pending ?? controller.current), {
					join: async (cycleRoot, cycleNodes) => {
						assert(cycleRoot.current !== undefined);
						assert(cycleNodes.every(node => node.current !== undefined));
						if (cycleRoot.pending === undefined) {
							// This node is imported by a dynamic import and was already visited
							assert(cycleNodes.every(node => node.pending === undefined));
							return;
						} else {
							assert(cycleNodes.every(node => node.pending !== undefined));
						}
						// If this node and all cycle nodes are current then we will check if any
						// dependencies were updated
						const nodes = [ ...cycleNodes, cycleRoot ];
						if (nodes.every(node => node.pending === node.current)) {
							// First check if any dependency of any cycle node was updated
							const hasUpdatedDependencies = Fn.some(Fn.transform(
								nodes,
								node => Fn.map(
									iterateReloadablesWithDynamics(controller => controller.pending)(node),
									dependency => dependency.previous !== dependency.current && !dependency.wasSelfAccepted)));
							if (hasUpdatedDependencies) {
								// Dependencies updated, check if they are accepted. Only non-cycle
								// nodes are allowed to accept.
								if (cycleNodes.length === 0) {
									const updatedModules = Array.from(Fn.filter(
										iterateReloadablesWithDynamics(controller => controller.pending)(cycleRoot),
										dependency => {
											assert(dependency.current !== undefined);
											return dependency.previous !== dependency.current && !dependency.wasSelfAccepted;
										}));
									cycleRoot.current.relink(cycleNodes, ReloadableModuleController.selectCurrent);
									if (await tryAccept(cycleRoot.current, updatedModules)) {
										assert.equal(cycleRoot.current, cycleRoot.pending);
										cycleRoot.pending = undefined;
										return;
									}
								}
							} else {
								// No updates
								for (const node of nodes) {
									assert.equal(node.current, node.pending);
									node.pending = undefined;
								}
								return;
							}
						}
						// This node needs to be replaced.
						// Instantiate
						for (const node of nodes) {
							assert(node.current !== undefined && node.pending !== undefined);
							if (
								node.current.state.status === ModuleStatus.linked ||
								node.current.state.status === ModuleStatus.evaluating ||
								node.current.state.status === ModuleStatus.evaluatingAsync
							) {
								try {
									await node.current.state.completion.promise;
								} catch {}
							}
							const data = await dispose(node.current);
							if (node.current === node.pending) {
								node.current = node.current.clone();
							} else {
								node.current = node.pending;
							}
							node.pending = undefined;
							node.current.instantiate(data);
						}
						// Link
						for (const node of nodes) {
							assert(node.current !== undefined);
							node.current.link(ReloadableModuleController.selectCurrent);
						}
						// Evaluate
						for (let ii = 0; ii < nodes.length; ++ii) {
							const node = nodes[ii]!;
							assert(node.current !== undefined);
							assert(node.previous !== undefined);
							try {
								if (node.current.declaration === node.previous.declaration) {
									++reevaluations;
								} else {
									++loads;
								}
								await node.current.evaluate();
								if (node.current === node.staging) {
									node.staging = undefined;
								}
							} catch (error) {
								node.current.destroy();
								node.current = node.previous;
								for (let jj = ii + 1; jj < nodes.length; ++jj) {
									const node = nodes[jj]!;
									const instance = node.current;
									assert(instance !== undefined);
									assert(instance.state.status === ModuleStatus.linked);
									instance.destroy();
									node.current = node.previous;
								}
								throw error;
							}
						}
						// Try self-accept
						if (cycleNodes.length === 0) {
							const namespace = () => cycleRoot.current!.moduleNamespace()();
							assert(cycleRoot.previous !== undefined);
							cycleRoot.wasSelfAccepted = await tryAcceptSelf(cycleRoot.previous, namespace);
						}
					},
				});
			}

			// Some kind of success
			const unacceptedRoot = this.current !== this.previous && !this.wasSelfAccepted;
			return {
				type: unacceptedRoot ? UpdateStatus.unacceptedEvaluation : UpdateStatus.success,
				stats,
			};

		} catch (error) {
			// Re-link everything to ensure consistent internal state. Also, throw away pending
			// instances.
			traverseDepthFirst(this, iterateReloadablesWithDynamics(controller => controller.current), {
				join: (cycleRoot, cycleNodes) => {
					assert(cycleRoot.current !== undefined);
					cycleRoot.current.relink(cycleNodes, ReloadableModuleController.selectCurrent);
					for (const node of [ ...cycleNodes, cycleRoot ]) {
						if (node.pending !== undefined) {
							if (node.pending !== node.current) {
								node.pending.destroy();
							}
							node.pending = undefined;
						}
					}
				},
			});
			return { type: UpdateStatus.evaluationFailure, error, stats };

		} finally {
			// Dispose old modules
			const currentControllers = new Set<ReloadableModuleController>();
			const destroyInstances: ReloadableModuleInstance[] = [];
			traverseBreadthFirst(this, iterateReloadablesWithDynamics(controller => controller.current), controller => {
				currentControllers.add(controller);
				assert(controller.pending === undefined);
				if (
					controller.previous !== undefined &&
					controller.previous !== controller.current
				) {
					destroyInstances.push(controller.previous);
				}
				controller.previous = undefined;
				controller.wasSelfAccepted = undefined;
			});
			await Fn.mapAwait(destroyInstances, instance => instance.destroy());
			// nb: This will prune and destroy lazily loaded dynamic modules.
			for (const controller of previousControllers) {
				if (!currentControllers.has(controller)) {
					assert(controller.current !== undefined);
					await prune(controller.current);
					controller.current.destroy();
					// Move the instance to staging to setup for `dispatch` in case it's re-imported
					controller.staging = controller.current;
					controller.current = undefined;
					controller.previous = undefined;
					controller.wasSelfAccepted = undefined;
				}
			}
		}
	}
}
