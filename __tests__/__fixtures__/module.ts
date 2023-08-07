import type { Context, Script } from "node:vm";
import assert from "node:assert/strict";
import { SourceTextModule, createContext } from "node:vm";
import * as jest from "@jest/globals";
import { transformModuleSource } from "../../loader/transform.js";
import * as adapter from "../../runtime/adapter.js";
import * as reloadable from "../../runtime/controller.js";
import { ReloadableModuleController } from "../../runtime/controller.js";

let count = 0;
const modules = new Map<string, TestModule>();

interface Environment {
	readonly context: Context;
	readonly runtime: SourceTextModule;
}

/** @internal */
export class TestModule {
	private environment: Environment | undefined;
	private vm: SourceTextModule & {
		environment: Environment;
		evaluated?: boolean;
		namespace: Record<string, any>;
	} | undefined;

	private readonly url = `test:///module${count++}`;

	constructor(
		private source: () => string,
	) {
		modules.set(this.url, this);
	}

	get global() {
		assert(this.environment !== undefined);
		return this.environment.context;
	}

	get namespace() {
		assert(this.vm !== undefined);
		const controller: ReloadableModuleController = this.vm.namespace.default();
		const instance = controller.select();
		return instance.moduleNamespace()();
	}

	async dispatch() {
		assert.equal(this.environment, undefined);
		const context = createContext();
		this.environment = { context } as Environment;
		// @ts-expect-error
		this.environment.runtime = TestModule.makeRuntime(this.environment);
		const vm = this.instantiate(this.environment);
		await vm.link(TestModule.link);
		await vm.evaluate();
		const controller: ReloadableModuleController = vm.namespace.default();
		await controller.main();
	}

	releaseUpdate() {
		assert(this.vm !== undefined);
		const controller: ReloadableModuleController = this.vm.namespace.default();
		return controller.application.requestUpdateResult();
	}

	async update(source?: () => string) {
		assert(this.environment !== undefined);
		assert(this.vm !== undefined);
		if (source) {
			this.source = source;
		}
		this.vm = undefined;
		const vm = this.instantiate(this.environment);
		vm.evaluated = true;
		await vm.link(TestModule.link);
		await vm.evaluate();
	}

	toString() {
		return JSON.stringify(this.url);
	}

	private instantiate(environment: Environment) {
		if (this.vm === undefined) {
			const source =
				transformModuleSource(this.url, {}, this.source(), undefined) +
				`export default function module() { return acquire(${JSON.stringify(this.url)}); }\n`;
			this.vm = new SourceTextModule(source, {
				context: environment.context,
				identifier: this.url,
				// @ts-expect-error
				importModuleDynamically: TestModule.dynamicImport,
				initializeImportMeta: (meta: Record<string, any>) => {
					meta.url = this.url;
				},
			}) as NonNullable<typeof this.vm>;
			// @ts-expect-error
			this.vm.environment = this.environment = environment;
			return this.vm;
		} else {
			assert(this.environment === environment);
			return this.vm;
		}
	}

	private static makeRuntime(environment: Environment) {
		const runtime = new SourceTextModule(
			`const [ Jest, Adapter, Reloadable ] = await Promise.all([
				import("@jest/globals"),
				import("hot:test/adapter"),
				import("hot:test/reloadable"),
			]);
			export const acquire = Reloadable.makeAcquire((specifier, assertions) => import(specifier, assertions));
			export const adapter = Adapter.adapter;
			globalThis.expect = Jest.expect;\n`, {
				context: environment.context,
				// @ts-expect-error
				importModuleDynamically: TestModule.dynamicImport,
			});
		// @ts-expect-error
		runtime.environment = environment;
		return runtime;
	}

	private static link(this: void, specifier: string, referencingModule: SourceTextModule) {
		switch (specifier) {
			case "hot:runtime": {
				// @ts-expect-error
				const environment: Environment = referencingModule.environment;
				return environment.runtime;
			}
			default:
				if (specifier.startsWith("hot:module?")) {
					const url = new URL(specifier);
					const moduleURL = url.searchParams.get("specifier");
					assert(moduleURL !== null);
					const module = modules.get(moduleURL);
					assert(module !== undefined);
					// @ts-expect-error
					return module.instantiate(referencingModule.environment);
				} else {
					throw new Error(`Unexpected specifier: ${specifier}`);
				}
		}
	}

	private static async dynamicImport(this: void, specifier: string, referencingModule: Script) {
		switch (specifier) {
			case "hot:test/adapter": return adapter;
			case "hot:test/reloadable": return reloadable;
			case "@jest/globals": return jest;
			default:
				if (specifier.startsWith("hot:import?")) {
					const url = new URL(specifier);
					const moduleURL = url.searchParams.get("specifier");
					assert(moduleURL !== null);
					const module = modules.get(moduleURL);
					assert(module !== undefined);
					// @ts-expect-error
					const vm = module.instantiate(referencingModule.environment);
					if (vm.evaluated === undefined) {
						await vm.link(TestModule.link);
						await vm.evaluate();
					}
					return vm;
				} else {
					throw new Error(`Unexpected specifier: ${specifier}`);
				}
		}
	}
}
