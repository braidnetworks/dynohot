import type { ModuleDeclaration } from "./declaration.js";
import type { AbstractModuleInstance, ModuleController, ModuleExports, Resolution, SelectModuleInstance } from "./module.js";
import type { TraverseCyclicState } from "./traverse.js";
import assert from "node:assert/strict";
import Fn from "dynohot/functional";
import { ReloadableModuleController } from "./controller.js";
import { Hot, didDynamicImport } from "./hot.js";
import { BindingType } from "./module/binding.js";
import { initializeEnvironment } from "./module/initialize.js";
import { ModuleStatus } from "./module.js";
import { moduleNamespacePropertyDescriptor } from "./utility.js";

type ModuleState =
	ModuleStateNew |
	ModuleStateLinking |
	ModuleStateLinked |
	ModuleStateEvaluating |
	ModuleStateEvaluatingAsync |
	ModuleStateEvaluated;

interface ModuleStateNew {
	readonly status: ModuleStatus.new;
}

interface ModuleStateLinking {
	readonly status: ModuleStatus.linking;
	readonly continuation: ModuleContinuation;
	readonly environment: ModuleEnvironment;
}

interface ModuleStateLinked {
	readonly status: ModuleStatus.linked;
	readonly continuation: ModuleContinuation;
	readonly environment: ModuleEnvironment;
	readonly imports: ModuleExports;
}

interface ModuleStateEvaluating {
	readonly status: ModuleStatus.evaluating;
	readonly environment: ModuleEnvironment;
}

interface ModuleStateEvaluatingAsync {
	readonly status: ModuleStatus.evaluatingAsync;
	readonly environment: ModuleEnvironment;
	readonly completion: Promise<void>;
}

interface ModuleStateEvaluated {
	readonly status: ModuleStatus.evaluated;
	readonly environment: ModuleEnvironment;
	readonly evaluationError?: { error: unknown };
}

interface ModuleEnvironment {
	readonly exports: ModuleExports;
	readonly hot: Hot;
	readonly replace: (this: void, imports: ModuleExports) => void;
}

type ModuleContinuation =
	ModuleContinuationSync |
	ModuleContinuationAsync;

interface ModuleContinuationSync {
	readonly async: false;
	readonly iterator: Iterator<unknown, void, ModuleExports>;
}

interface ModuleContinuationAsync {
	readonly async: true;
	readonly iterator: AsyncIterator<unknown, void, ModuleExports>;
}

/** @internal */
export class ReloadableModuleInstance implements AbstractModuleInstance {
	readonly reloadable = true;

	dynamicImports: ReloadableModuleController[] = [];
	state: ModuleState = { status: ModuleStatus.new };
	traversalState: TraverseCyclicState | undefined;
	visitation = 0;
	private namespace: (() => Record<string, unknown>) | undefined;

	constructor(
		private readonly controller: ReloadableModuleController,
		public readonly declaration: ModuleDeclaration,
	) {}

	clone() {
		return new ReloadableModuleInstance(this.controller, this.declaration);
	}

	async instantiate(data?: unknown) {
		if (this.state.status === ModuleStatus.new) {
			const hot = new Hot(this.controller, this.declaration.usesDynamicImport, data);
			const importMeta = Object.assign(Object.create(this.declaration.meta), { dynoHot: hot, hot });
			const dynamicImport = this.dynamicImport.bind(this);
			const { continuation, result } = await (async () => {
				if (this.declaration.body.async) {
					const iterator = this.declaration.body.execute(importMeta, dynamicImport);
					const result = await iterator.next();
					const continuation = { async: true, iterator } as const;
					return { continuation, result } as const;
				} else {
					const iterator = this.declaration.body.execute(importMeta, dynamicImport);
					const result = iterator.next();
					const continuation = { async: false, iterator } as const;
					return { continuation, result } as const;
				}
			})();
			assert.equal(result.done, false);
			const [ replace, exports ] = result.value;
			this.state = {
				status: ModuleStatus.linking,
				continuation,
				environment: { exports, hot, replace },
			};
		}
	}

	link(select: SelectModuleInstance) {
		assert(this.state.status !== ModuleStatus.new);
		if (this.state.status === ModuleStatus.linking) {
			const bindings = initializeEnvironment(
				this.declaration.loadedModules,
				entry => {
					const module = entry.controller().select(select);
					assert(
						module.state.status === ModuleStatus.linking ||
						module.state.status === ModuleStatus.linked ||
						module.state.status === ModuleStatus.evaluated ||
						module.state.status === ModuleStatus.evaluatingAsync);
					return module.moduleNamespace(select);
				},
				(entry, exportName) => {
					const module = entry.controller().select(select);
					assert(
						module.state.status === ModuleStatus.linking ||
						module.state.status === ModuleStatus.linked ||
						module.state.status === ModuleStatus.evaluated ||
						module.state.status === ModuleStatus.evaluatingAsync);
					return module.resolveExport(exportName, select);
				});
			this.state = {
				status: ModuleStatus.linked,
				continuation: this.state.continuation,
				environment: this.state.environment,
				imports: Object.fromEntries(bindings),
			};
		}
	}

	evaluate() {
		switch (this.state.status) {
			case ModuleStatus.linked: {
				const { continuation, imports } = this.state;
				if (continuation.async) {
					return (async () => {
						assert.equal(this.state.status, ModuleStatus.linked);
						const completion = async function() {
							// nb: Wait for next microtask so `state` gets set
							// eslint-disable-next-line @typescript-eslint/await-thenable
							await undefined;
							const next = await continuation.iterator.next(imports);
							assert(next.done);
						}();
						this.state = {
							status: ModuleStatus.evaluatingAsync,
							environment: this.state.environment,
							completion,
						};
						try {
							await completion;
							this.state = {
								status: ModuleStatus.evaluated,
								environment: this.state.environment,
							};
						} catch (error) {
							this.state = {
								status: ModuleStatus.evaluated,
								environment: this.state.environment,
								evaluationError: { error },
							};
							throw error;
						}
					})();
				} else {
					try {
						this.state = {
							status: ModuleStatus.evaluating,
							environment: this.state.environment,
						};
						const next = continuation.iterator.next(imports);
						assert(next.done);
						this.state = {
							status: ModuleStatus.evaluated,
							environment: this.state.environment,
						};
					} catch (error) {
						this.state = {
							status: ModuleStatus.evaluated,
							environment: this.state.environment,
							evaluationError: { error },
						};
						throw error;
					}
				}
				return;
			}

			case ModuleStatus.evaluated:
				if (this.state.evaluationError) {
					throw this.state.evaluationError.error;
				}
				return;

			case ModuleStatus.evaluatingAsync:
				return this.state.completion;

			default: assert.fail();
		}
	}

	relink(cycleNodes: readonly ReloadableModuleController[], select: SelectModuleInstance) {
		const nodes = [ ...Fn.map(cycleNodes, node => node.select(select)), this ];
		for (const node of nodes) {
			assert(node.state.status === ModuleStatus.evaluated);
			node.namespace = undefined;
		}
		for (const node of nodes) {
			assert(node.state.status === ModuleStatus.evaluated);
			const bindings = initializeEnvironment(
				node.declaration.loadedModules,
				entry => {
					const module = entry.controller().select(select);
					assert(
						module.state.status === ModuleStatus.evaluated ||
						module.state.status === ModuleStatus.evaluatingAsync);
					return module.moduleNamespace(select);
				},
				(entry, exportName) => {
					const module = entry.controller().select(select);
					assert(
						module.state.status === ModuleStatus.evaluated ||
						module.state.status === ModuleStatus.evaluatingAsync);
					return module.resolveExport(exportName, select);
				});
			node.state.environment.replace(Object.fromEntries(bindings));
		}
	}

	async dynamicImport(specifier: string, importAssertions?: Record<string, string>) {
		assert(
			this.state.status === ModuleStatus.evaluating ||
			this.state.status === ModuleStatus.evaluatingAsync ||
			this.state.status === ModuleStatus.evaluated);
		const specifierParams = new URLSearchParams([
			[ "parent", this.declaration.meta.url ],
			[ "specifier", specifier ],
			...Fn.map(
				Object.entries(importAssertions ?? {}),
				([ key, value ]) => [ "with", String(new URLSearchParams([ [ key, value ] ])) ]),
		] as Iterable<[ string, string ]>);
		const { default: acquire } = await import(`hot:import?${String(specifierParams)}`);
		const controller: ModuleController = acquire();
		didDynamicImport(this.state.environment.hot, controller);
		if (controller.reloadable) {
			this.dynamicImports.push(controller);
			if (!await controller.dispatch()) {
				await controller.requestUpdate(false);
			}
			const instance = controller.select(ReloadableModuleController.selectCurrent);
			return instance.moduleNamespace(ReloadableModuleController.selectCurrent)();
		} else {
			return controller.moduleNamespace()();
		}
	}

	async dispose() {
		switch (this.state.status) {
			case ModuleStatus.linked:
			case ModuleStatus.linking: {
				const continuation = this.state.continuation;
				if (continuation.async) {
					await continuation.iterator.return?.();
				} else {
					continuation.iterator.return?.();
				}
				break;
			}

			default:
		}
		this.state = { status: ModuleStatus.new };
	}

	// 10.4.6.12 ModuleNamespaceCreate ( module, exports )
	// 16.2.1.6.2 GetExportedNames ( [ exportStarSet ] )
	// 16.2.1.10 GetModuleNamespace ( module )
	moduleNamespace(select: SelectModuleInstance) {
		if (!this.namespace) {
			assert(this.state.status !== ModuleStatus.new);
			const namespace = Object.create(null);
			this.namespace ??= () => namespace;
			const ambiguousNames = new Set<string>();
			const resolutions = new Map<string, () => unknown>();
			const seen = new Set<ReloadableModuleInstance>();
			(function traverse(instance: ReloadableModuleInstance) {
				if (!seen.has(instance)) {
					seen.add(instance);
					assert(instance.state.status !== ModuleStatus.new);
					for (const [ name, resolution ] of Object.entries(instance.state.environment.exports)) {
						if (name !== "default") {
							const previousResolution = resolutions.get(name);
							if (previousResolution === undefined) {
								resolutions.set(name, resolution);
							} else if (previousResolution !== resolution) {
								ambiguousNames.add(name);
							}
						}
					}
					for (const entry of instance.declaration.indirectExportEntries.values()) {
						const instance = entry.moduleRequest.controller().select(select);
						if (entry.binding.type === BindingType.indirectExport) {
							const resolution = instance.resolveExport(entry.binding.name, select);
							assert(resolution != null);
							resolutions.set(entry.binding.as ?? entry.binding.name, resolution);
						} else {
							assert.equal(entry.binding.type, BindingType.indirectStarExport);
							resolutions.set(entry.binding.as, instance.moduleNamespace(select));
						}
					}
					for (const entry of instance.declaration.starExportEntries) {
						const instance = entry.moduleRequest.controller().select(select);
						if (instance.reloadable) {
							traverse(instance);
						}
					}
				}
			})(this);
			const thisDefault = this.state.environment.exports.default;
			if (thisDefault) {
				resolutions.set("default", thisDefault);
			}
			const unambiguousResolutions = Array.from(
				Fn.filter(resolutions, ([ name ]) => !ambiguousNames.has(name)));
			unambiguousResolutions.sort(Fn.mappedPrimitiveComparator(([ name ]) => name));
			Object.defineProperties(
				namespace,
				Object.fromEntries(Fn.map(
					unambiguousResolutions,
					([ name, get ]) => [ name, { ...moduleNamespacePropertyDescriptor, get } ])));
			Object.freeze(namespace);
		}
		return this.namespace;
	}

	// 16.2.1.6.3 ResolveExport ( exportName [ , resolveSet ] )
	resolveExport(exportName: string, select: SelectModuleInstance): Resolution {
		// 1. Assert: module.[[Status]] is not new.
		assert(this.state.status !== ModuleStatus.new);
		// 2. If resolveSet is not present, set resolveSet to a new empty List.
		// 3. For each Record { [[Module]], [[ExportName]] } r of resolveSet, do

		// TODO: Finish this. `resolveSet` is responsible for detecting unresolved circular
		// imports. For well-typed code it isn't a problem
		const resolveSet = new Map<ReloadableModuleInstance, Set<any>>();
		let imports = resolveSet.get(this);
		if (imports === undefined) {
			imports = new Set();
			resolveSet.set(this, imports);
		} else {
			// a. If module and r.[[Module]] are the same Module Record and SameValue(exportName, r.
			//    [[ExportName]]) is true, then
			// eslint-disable-next-line no-lonely-if
			if (imports.has(exportName)) {
				// i. Assert: This is a circular import request.
				// ii. Return null.
				return null;
			}
		}
		// 4. Append the Record { [[Module]]: module, [[ExportName]]: exportName } to resolveSet.
		imports.add(exportName);
		// 5. For each ExportEntry Record e of module.[[LocalExportEntries]], do
		const localExport = this.state.environment.exports[exportName];
		if (localExport !== undefined && Object.hasOwn(this.state.environment.exports, exportName)) {
			// a. If SameValue(exportName, e.[[ExportName]]) is true, then
			//   i. Assert: module provides the direct binding for this export.
			//   ii. Return ResolvedBinding Record { [[Module]]: module, [[BindingName]]: e.
			//       [[LocalName]] }.
			return localExport;
		}
		// 6. For each ExportEntry Record e of module.[[IndirectExportEntries]], do
		const indirectExport = this.declaration.indirectExportEntries.get(exportName);
		if (indirectExport) {
			// a. If SameValue(exportName, e.[[ExportName]]) is true, then
			//   i. Let importedModule be GetImportedModule(module, e.[[ModuleRequest]]).
			const importedModule = indirectExport.moduleRequest.controller().select(select);
			//   ii. If e.[[ImportName]] is all, then
			if (indirectExport.binding.type === BindingType.indirectStarExport) {
				// 1. Assert: module does not provide the direct binding for this export.
				// 2. Return ResolvedBinding Record { [[Module]]: importedModule, [[BindingName]]:
				//    namespace }.
				return importedModule.moduleNamespace(select);
			// iii. Else,
			} else {
				// 1. Assert: module imports a specific binding for this export.
				// 2. Return importedModule.ResolveExport(e.[[ImportName]], resolveSet).
				return importedModule.resolveExport(indirectExport.binding.name, select);
			}
		}
		// 7. If SameValue(exportName, "default") is true, then
		if (exportName === "default") {
			// a. Assert: A default export was not explicitly defined by this module.
			// b. Return null.
			// c. NOTE: A default export cannot be provided by an export * from "mod" declaration.
			return null;
		}
		// 8. Let starResolution be null.
		let starResolution: Resolution = null;
		// 9. For each ExportEntry Record e of module.[[StarExportEntries]], do
		for (const exportEntry of this.declaration.starExportEntries) {
			// a. Let importedModule be GetImportedModule(module, e.[[ModuleRequest]]).
			const importedModule = exportEntry.moduleRequest.controller().select(select);
			// b. Let resolution be importedModule.ResolveExport(exportName, resolveSet).
			const resolution = importedModule.resolveExport(exportName, select);
			// c. If resolution is ambiguous, return ambiguous.
			if (resolution === undefined) {
				return undefined;
			}
			// d. If resolution is not null, then
			if (resolution !== null) {
				// i. Assert: resolution is a ResolvedBinding Record.
				// ii. If starResolution is null, set starResolution to resolution.
				if (starResolution === null) {
					starResolution = resolution;
				// iii. Else,
				} else {
					// 1. Assert: There is more than one * import that includes the requested name.
					// 2. If resolution.[[Module]] and starResolution.[[Module]] are not the same
					//    Module Record, return ambiguous.
					// 3. If resolution.[[BindingName]] is not starResolution.[[BindingName]] and
					//    either resolution.[[BindingName]] or starResolution.[[BindingName]] is
					//    namespace, return ambiguous.
					// 4. If resolution.[[BindingName]] is a String, starResolution.[[BindingName]]
					//    is a String, and SameValue(resolution.[[BindingName]], starResolution.
					//    [[BindingName]]) is false, return ambiguous.
					// eslint-disable-next-line no-lonely-if
					if (starResolution !== resolution) {
						return undefined;
					}
				}
			}
		}
		// 10. Return starResolution.
		return starResolution;
	}
}
