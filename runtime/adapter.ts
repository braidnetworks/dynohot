import type { AbstractModuleController, AbstractModuleInstance, ModuleNamespace, ResolvedBinding } from "./module.js";
import assert from "node:assert/strict";
import Fn from "dynohot/functional";
import { ModuleStatus } from "./module.js";

/**
 * This is the adapter which delegates to an underlying non-swappable module. This is used for
 * built-in modules, CommonJS modules, WASM modules (for now?), or modules which otherwise refer
 * some other opaque "Abstract Module Record".
 * @internal
 */
export class AdapterModuleController implements AbstractModuleController, AbstractModuleInstance {
	private readonly namespace: ResolvedBinding<ModuleNamespace>;
	private readonly resolutions: ReadonlyMap<string | null, () => unknown>;
	private readonly url;
	readonly reloadable = false;
	readonly state = { status: ModuleStatus.evaluated };

	constructor(
		meta: ImportMeta,
		namespace: Record<string, unknown>,
	) {
		// Extract the URL of the underlying module
		const url = new URL(meta.url);
		const realURL = url.searchParams.get("url");
		assert.notEqual(realURL, null);
		this.url = realURL;

		// Memoize resolved exports to maintain equality of the resolution. Note that this will fail
		// under some corner cases like:
		//
		//     commonjs.cjs:
		//     export * from "node:fs"`;
		//
		//     module.mjs:
		//     export * from "node:fs"`;
		//     export * from "./commonjs.cjs";
		//
		// In this case, module.mjs will not export anything from "node:fs" because the bindings
		// will be seen as ambiguous.
		this.resolutions = new Map<string | null, ResolvedBinding>(
			Fn.map(Object.keys(namespace), key => [ key, () => namespace[key] ]));
		this.namespace = () => namespace;
	}

	// No-op, in the case this is from `hot:main`
	main() {
		console.warn(`'${this.url}' is not ESM; hot module reloading is disabled`);
	}

	moduleNamespace() {
		return this.namespace;
	}

	resolveExport(exportName: string | null) {
		return this.resolutions.get(exportName) ?? null;
	}

	select() {
		return this;
	}
}
