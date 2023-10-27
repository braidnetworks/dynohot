import type { Context, SourceTextModuleOptions } from "node:vm";
import * as assert from "node:assert/strict";
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
	readonly pending: TestModule[];
	readonly runtime: SourceTextModule;
	readonly top: TestModule;
}

interface HotInstanceSourceModuleOptions extends SourceTextModuleOptions {
	readonly environment: Environment;
}

class HotInstanceSourceModule extends SourceTextModule {
	declare readonly namespace: {
		default: () => ReloadableModuleController;
	};

	readonly environment: Environment;
	readonly evaluated = false;

	constructor(source: string, options: HotInstanceSourceModuleOptions) {
		const { environment, ...rest } = options;
		super(source, rest);
		this.environment = environment;
	}
}

/** @internal */
export class TestModule {
	private environment: Environment | undefined;
	private vm: HotInstanceSourceModule | undefined;
	private readonly url = `test:///module${++count}`;

	constructor(
		private source: () => string,
	) {
		modules.set(this.url, this);
	}

	get global() {
		assert.ok(this.environment !== undefined);
		return this.environment.context;
	}

	get namespace() {
		assert.ok(this.vm !== undefined);
		const controller = this.vm.namespace.default();
		const instance = controller.select();
		return instance.moduleNamespace()();
	}

	async dispatch() {
		assert.equal(this.environment, undefined);
		const context = createContext();
		const environment: Partial<Environment> = {
			context,
			pending: [],
			top: this,
		};
		// @ts-expect-error
		environment.runtime = TestModule.makeRuntime(environment as Environment);
		const vm = this.instantiate(environment as Environment);
		await this.linkAndEvaluate();
		await vm.namespace.default().main();
	}

	async releaseUpdate() {
		assert.ok(this.vm !== undefined);
		assert.ok(this.environment !== undefined);
		const updates = this.environment.pending.splice(0);
		for (const update of updates) {
			assert.ok(update.vm !== undefined);
			update.vm = undefined;
			update.instantiate(this.environment);
			await update.linkAndEvaluate();
		}
		return this.vm.namespace.default().application.requestUpdateResult();
	}

	update(source?: () => string) {
		assert.ok(this.environment !== undefined);
		if (source) {
			this.source = source;
		}
		this.environment.pending.push(this);
	}

	toString() {
		return JSON.stringify(this.url);
	}

	private instantiate(environment: Environment): HotInstanceSourceModule {
		if (this.vm === undefined) {
			assert.ok(this.environment === undefined || this.environment === environment);
			this.environment = environment;
			const source =
				transformModuleSource(this.url, {}, this.source(), undefined) +
				'import { acquire } from "hot:runtime";' +
				`export default function module() { return acquire(${JSON.stringify(this.url)}); }\n`;
			return this.vm = new HotInstanceSourceModule(source, {
				context: environment.context,
				environment,
				identifier: this.url,
				// @ts-expect-error
				importModuleDynamically: TestModule.dynamicImport.bind(undefined, environment),
				initializeImportMeta: meta => {
					meta.url = this.url;
				},
			});
		} else {
			assert.ok(this.environment === environment);
			return this.vm;
		}
	}

	private async linkAndEvaluate() {
		assert.ok(this.environment !== undefined);
		assert.ok(this.vm !== undefined);
		if (this.vm.status === "unlinked") {
			await this.vm.link(TestModule.link.bind(undefined, this.environment));
			await this.vm.evaluate();
		}
	}

	private static makeRuntime(environment: Environment) {
		return new SourceTextModule(
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
				importModuleDynamically: TestModule.dynamicImport.bind(undefined, environment),
			});
	}

	private static link(this: void, environment: Environment, specifier: string) {
		switch (specifier) {
			case "hot:runtime": return environment.runtime;
			default:
				if (specifier.startsWith("hot:module?")) {
					const url = new URL(specifier);
					const moduleURL = url.searchParams.get("specifier");
					assert.ok(moduleURL !== null);
					const module = modules.get(moduleURL);
					assert.ok(module !== undefined);
					return module.instantiate(environment);
				} else {
					throw new Error(`Unexpected specifier: ${specifier}`);
				}
		}
	}

	private static async dynamicImport(this: void, environment: Environment, specifier: string) {
		switch (specifier) {
			case "hot:test/adapter": return adapter;
			case "hot:test/reloadable": return reloadable;
			case "@jest/globals": return jest;
			default:
				if (specifier.startsWith("hot:import?")) {
					const url = new URL(specifier);
					const moduleURL = url.searchParams.get("specifier");
					assert.ok(moduleURL !== null);
					const module = modules.get(moduleURL);
					assert.ok(module !== undefined);
					const vm = module.instantiate(environment);
					await module.linkAndEvaluate();
					return vm;
				} else {
					throw new Error(`Unexpected specifier: ${specifier}`);
				}
		}
	}
}
