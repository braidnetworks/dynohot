import type { LoadedModuleRequestEntry, ModuleBody, ModuleDeclaration } from "./declaration.js";
import type { BindingEntry, ExportIndirectEntry, ExportIndirectStarEntry, ExportStarEntry } from "./module/binding.js";
import type{ AbstractModuleController, ModuleNamespace } from "./module.js";
import assert from "node:assert/strict";
import Fn from "dynohot/functional";
import { dispose, isAccepted, isAcceptedSelf, isDeclined, isInvalidated, prune, tryAccept, tryAcceptSelf } from "./hot.js";
import { ReloadableModuleInstance } from "./instance.js";
import { BindingType } from "./module/binding.js";
import { ModuleStatus } from "./module.js";
import { makeTraversalState, traverseBreadthFirst, traverseDepthFirst } from "./traverse.js";
import { debounceAsync, debounceTimer, discriminatedTypePredicate, evictModule, iterateWithRollback, makeRelative, plural } from "./utility.js";
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
	chain: readonly InvalidationChain[];
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

interface InvalidationChain {
	modules: readonly ReloadableModuleController[];
	next: readonly InvalidationChain[] | undefined;
}

function logUpdate(update: UpdateResult) {
	if (update === undefined) {
		return;
	}
	switch (update.type) {
		case UpdateStatus.declined:
			console.error(`[hot] A pending update was explicitly declined:\n${update.declined.map(module => `- ${makeRelative(module.url)}`).join("\n")}`);
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

		case UpdateStatus.unaccepted: {
			// Nice:
			// https://stackoverflow.com/questions/4965335/how-to-print-binary-tree-diagram-in-java/8948691#8948691
			const logChain = (chain: InvalidationChain, prefix = "", childrenPrefix = "") => {
				console.error(`  ${prefix}[${chain.modules.map(module => makeRelative(module.url)).join(", ")}]`);
				if (chain.next !== undefined) {
					for (const [ ii, child ] of chain.next.entries()) {
						if (ii === chain.next.length - 1) {
							logChain(child, `${childrenPrefix}└─ `, `${childrenPrefix}   `);
						} else {
							logChain(child, `${childrenPrefix}├─ `, `${childrenPrefix}│  `);
						}
					}
				}
			};
			console.error("[hot] A pending update was not accepted, and reached the root module:");
			for (const chain of update.chain) {
				logChain(chain);
			}
			break;
		}

		case UpdateStatus.unacceptedEvaluation: {
			const { duration, loads, reevaluations } = update.stats();
			const ms = Math.round(duration);
			console.error(`[hot] Loaded ${loads} new ${plural("module", loads)}, reevaluated ${reevaluations} existing ${plural("module", reevaluations)} in ${ms}ms.`);
			console.error("[hot] Unaccepted update reached the root module. The application should be restarted!");
			break;
		}

	}
}

/** @internal */
export class ReloadableModuleController implements AbstractModuleController {
	readonly reloadable = true;

	private current: ReloadableModuleInstance | undefined;
	private pending: ReloadableModuleInstance | undefined;
	private previous: ReloadableModuleInstance | undefined;
	private staging: ReloadableModuleInstance | undefined;
	private temporary: ReloadableModuleInstance | undefined;
	private traversal = makeTraversalState();
	private visitIndex = 0;
	private version = 0;

	constructor(
		public readonly application: Application,
		public readonly url: string,
	) {
		const watcher = new FileWatcher();
		watcher.watch(this.url, () => {
			void (async () => {
				const instance = this.staging ?? this.current;
				assert(instance !== undefined);
				const { importAssertions } = instance.declaration;
				const params = new URLSearchParams([
					[ "url", this.url ],
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
		if (this.current === undefined) {
			// Place `current` from `staging` if it's not set up, instantiate all reloadable
			// modules, and perform link.
			traverseDepthFirst(
				this,
				node => node.traversal,
				(node, traversal) => {
					node.traversal = traversal;
					if (node.current === undefined) {
						const staging = node.select(controller => controller.staging);
						node.current = staging;
						node.current.instantiate();
					}
					return node.iterate();
				},
				(nodes): undefined => {
					const withRollback = iterateWithRollback(nodes, nodes => {
						for (const node of nodes) {
							if (node.select().unlink()) {
								node.current = undefined;
							}
						}
					});
					for (const node of withRollback) {
						node.select().link();
					}
				},
				pendingNodes => {
					for (const node of pendingNodes) {
						if (node.select().unlink()) {
							node.current = undefined;
						}
					}
				});

			// Evaluate
			await traverseDepthFirst(
				this,
				node => node.traversal,
				(node, traversal) => {
					node.traversal = traversal;
					return node.iterate();
				},
				async nodes => {
					for (const node of nodes) {
						const current = node.select();
						if (current === node.staging) {
							node.staging = undefined;
						}
						await current.evaluate();
					}
				});
		}
	}

	// Invoked from transformed module source
	load(
		body: ModuleBody,
		meta: ImportMeta | null,
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

	select(select = ReloadableModuleController.selectCurrent) {
		const instance = select(this);
		assert(instance);
		return instance;
	}

	private *iterate(select = ReloadableModuleController.selectCurrent) {
		for (const child of this.select(select).declaration.loadedModules) {
			const controller = child.controller();
			if (controller.reloadable) {
				yield controller;
			}
		}
	}

	private *iterateWithDynamics(
		select = ReloadableModuleController.selectCurrent,
		selectDynamic = ReloadableModuleController.selectCurrent,
	) {
		yield* this.iterate(select);
		const instance = this.select(selectDynamic);
		yield* Fn.map(instance.dynamicImports, entry => entry.controller);
	}

	private async requestUpdate(this: ReloadableModuleController): Promise<UpdateResult> {

		// Set up statistics tracking
		let loads = 0;
		let reevaluations = 0;
		const timeStarted = performance.now();
		const stats = (): UpdateStats => ({
			loads,
			reevaluations,
			duration: performance.now() - timeStarted,
		});

		// Dispatch "dry run" to see if it is possible to accept this update. Also mark `previous`
		// and `pending`.
		interface DryRunResult {
			forwardResults: readonly DryRunResult[];
			declined: readonly ReloadableModuleController[];
			invalidated: readonly ReloadableModuleController[];
			hasDecline: boolean;
			hasNewCode: boolean;
			needsDispatch: boolean;
		}
		const previousControllers: ReloadableModuleController[] = [];
		const initialResult = traverseDepthFirst(
			this,
			node => node.traversal,
			(node, traversal) => {
				node.traversal = traversal;
				return node.iterateWithDynamics();
			},
			(cycleNodes, forwardResults: readonly DryRunResult[]): DryRunResult => {
				let needsDispatch = false;
				let hasNewCode = false;
				const forwardUpdates = Array.from(Fn.concat(Fn.map(forwardResults, result => result.invalidated)));
				const invalidated = Array.from(Fn.filter(cycleNodes, node => {
					previousControllers.push(node);
					const current = node.select();
					node.pending = current;
					node.previous = current;
					if (node.staging !== undefined) {
						node.pending = node.staging;
						hasNewCode = true;
					}
					if (
						node.staging !== undefined ||
						isInvalidated(current) ||
						!isAccepted(current, forwardUpdates)
					) {
						needsDispatch = true;
						return !isAcceptedSelf(current);
					}
				}));
				const declined = Array.from(Fn.filter(invalidated, node => isDeclined(node.select())));
				const hasDecline = declined.length > 0 || Fn.some(forwardResults, result => result.hasDecline);
				needsDispatch ||= Fn.some(forwardResults, result => result.needsDispatch);
				hasNewCode ||= Fn.some(forwardResults, result => result.hasNewCode);
				return { forwardResults, declined, invalidated, hasDecline, hasNewCode, needsDispatch };
			});

		// Rollback routine which undoes the above traversal.
		const rollback = () => {
			for (const controller of previousControllers) {
				controller.pending = undefined;
				controller.previous = undefined;
			}
		};

		// Check result
		if (!initialResult.needsDispatch) {
			rollback();
			return undefined;
		} else if (initialResult.hasDecline) {
			rollback();
			const declined = Array.from(function *traverse(result): Iterable<ReloadableModuleController> {
				yield* result.declined;
				yield* Fn.transform(result.forwardResults, traverse);
			}(initialResult));
			return { type: UpdateStatus.declined, declined };
		} else if (initialResult.invalidated.length > 0) {
			// Tracing invalidations is actually pretty cumbersome because we need to compare cyclic
			// groups with the actual import entries to get something parsable by a human.
			const chain = Array.from(function *traverse(result): Iterable<InvalidationChain> {
				const importedModules = new Set(Fn.transform(result.invalidated, function*(controller) {
					const current = controller.select();
					yield* current.iterateDependencies();
				}));
				const importedInvalidations = Array.from(Fn.transform(result.forwardResults, function*(result) {
					const invalidatedImports = result.invalidated.filter(controller => importedModules.has(controller));
					if (invalidatedImports.length > 0) {
						yield* traverse(result);
					}
				}));
				yield {
					modules: result.invalidated,
					next: importedInvalidations.length > 0 ? importedInvalidations : undefined,
				};
			}(initialResult));
			rollback();
			return { type: UpdateStatus.unaccepted, chain };
		}

		// If the update contains new code then we need to make sure it will link. Normally the
		// graph will link and then evaluate, but when dispatching a hot update a module is allowed
		// to invalidate itself. So, we're not really sure which bindings will end up where. This
		// step ensures that a linkage error doesn't cause the whole graph to throw an error.
		if (initialResult.hasNewCode) {
			const instantiated: ReloadableModuleController[] = [];
			try {
				traverseDepthFirst(
					this,
					node => node.traversal,
					(node, traversal) => {
						node.traversal = traversal;
						return node.iterateWithDynamics(
							controller => controller.pending,
							controller => controller.previous);
					},
					(cycleNodes, forwardResults: readonly boolean[]) => {
						let hasUpdate = Fn.some(forwardResults);
						if (!hasUpdate) {
							for (const node of cycleNodes) {
								const current = node.select();
								const pending = node.select(controller => controller.pending);
								if (current !== pending) {
									hasUpdate = true;
									break;
								}
							}
						}
						if (hasUpdate) {
							for (const node of cycleNodes) {
								const pending = node.select(controller => controller.pending);
								node.temporary = pending.clone();
								node.temporary.instantiate();
								instantiated.push(node);
							}
							for (const node of cycleNodes) {
								const temporary = node.select(controller => controller.temporary);
								temporary.link(controller => controller.temporary ?? controller.pending);
							}
						}
						return hasUpdate;
					});

			} catch (error) {
				rollback();
				return { type: UpdateStatus.linkError, error };

			} finally {
				for (const node of instantiated) {
					node.select(controller => controller.temporary).unlink();
					node.temporary = undefined;
				}
			}
		}

		// Dispatch link & evaluate
		try {
			interface RunResult {
				forwardResults: readonly RunResult[];
				invalidated: readonly ReloadableModuleController[];
				treeDidUpdate: boolean;
			}
			await traverseDepthFirst(
				this,
				node => node.traversal,
				(node, traversal) => {
					node.traversal = traversal;
					return node.iterateWithDynamics(
						controller => controller.staging ?? controller.current,
						controller => controller.previous);
				},
				async (cycleNodes, forwardResults: readonly RunResult[]): Promise<RunResult> => {
					let needsUpdate = false;
					// Check update due to new code
					for (const node of cycleNodes) {
						if (node.staging !== undefined) {
							needsUpdate = true;
							break;
						}
					}
					// Relink and check update due to invalidated dependencies
					const treeDidUpdate = Fn.some(forwardResults, result => result.treeDidUpdate);
					if (treeDidUpdate && !needsUpdate) {
						const forwardUpdates = Array.from(Fn.concat(Fn.map(forwardResults, result => result.invalidated)));
						for (const node of cycleNodes) {
							const current = node.select();
							current.relink();
							if (!await tryAccept(node.select(), forwardUpdates)) {
								needsUpdate = true;
								break;
							}
						}
					}
					if (!needsUpdate) {
						for (const node of cycleNodes) {
							assert.equal(node.current, node.pending);
							node.pending = undefined;
						}
						return { forwardResults, treeDidUpdate, invalidated: [] };
					}
					// These nodes need to be replaced.
					// 1) Instantiate
					for (const node of cycleNodes) {
						const current = node.select();
						const pending = node.select(controller => controller.pending);
						const data = await dispose(current);
						if (current === pending) {
							node.current = current.clone();
						} else {
							node.current = pending;
						}
						node.current.instantiate(data);
					}
					// 2) Link
					for (const node of cycleNodes) {
						node.select().link();
					}
					// 3) Evaluate
					const withRollback = iterateWithRollback(cycleNodes, nodes => {
						for (const node of nodes) {
							const current = node.select();
							assert(current.state.status === ModuleStatus.evaluated);
							if (current.state.evaluationError !== undefined) {
								node.current = node.previous;
							}
						}
					});
					for (const node of withRollback) {
						const current = node.select();
						const previous = node.select(controller => controller.previous);
						if (current.declaration === previous.declaration) {
							++reevaluations;
						} else {
							++loads;
						}
						await current.evaluate();
						node.pending = undefined;
						if (current === node.staging) {
							node.staging = undefined;
						}
					}
					// Try self-accept
					const invalidated: ReloadableModuleController[] = [];
					for (const node of cycleNodes) {
						const current = node.select();
						const previous = node.select(controller => controller.previous);
						const namespace = () => current.moduleNamespace()();
						if (!await tryAcceptSelf(previous, namespace)) {
							invalidated.push(node);
						}
					}
					return { forwardResults, invalidated, treeDidUpdate: true };
				});

		} catch (error) {
			// Re-link everything to ensure consistent internal state. Also, throw away pending
			// instances.
			traverseDepthFirst(
				this,
				node => node.traversal,
				(node, traversal) => {
					node.traversal = traversal;
					if (node.pending !== undefined) {
						node.pending.unlink();
						node.pending = undefined;
					}
					return node.iterateWithDynamics();
				},
				(cycleNodes): undefined => {
					for (const node of cycleNodes) {
						const current = node.select();
						current.relink();
					}
				});
			return { type: UpdateStatus.evaluationFailure, error, stats };

		} finally {
			// Dispose old modules
			const currentControllers = new Set<ReloadableModuleController>();
			traverseBreadthFirst(
				this,
				node => node.visitIndex,
				(node, visitIndex) => {
					node.visitIndex = visitIndex;
					return node.iterateWithDynamics();
				},
				node => {
					currentControllers.add(node);
					assert(node.pending === undefined);
					node.previous = undefined;
				});
			for (const controller of previousControllers) {
				if (!currentControllers.has(controller)) {
					const current = controller.select();
					await prune(current);
					// Move the instance to staging to setup for `dispatch` in case it's re-imported
					controller.staging = current.clone();
					controller.current = undefined;
					controller.previous = undefined;
				}
			}
		}

		return {
			type: UpdateStatus.success,
			stats,
		};
	}

	private static selectCurrent(this: void, controller: ReloadableModuleController) {
		return controller.current;
	}
}
