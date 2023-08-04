import type { ExportIndirectEntry, ExportIndirectStarEntry, ExportStarEntry, ModuleRequestEntry } from "./module/binding.js";
import type { ModuleController, ModuleExports, ModuleNamespace } from "./module.js";

/** @internal */
export interface ModuleDeclaration {
	readonly body: ModuleBody;
	readonly meta: ImportMeta;
	readonly importAssertions: Record<string, string>;
	readonly usesDynamicImport: boolean;
	readonly indirectExportEntries: ReadonlyMap<string, {
		readonly moduleRequest: LoadedModuleRequestEntry;
		readonly binding: ExportIndirectEntry | ExportIndirectStarEntry;
	}>;
	readonly starExportEntries: readonly {
		readonly moduleRequest: LoadedModuleRequestEntry;
		readonly binding: ExportStarEntry;
	}[];
	readonly loadedModules: readonly LoadedModuleRequestEntry[];
}

/** @internal */
export type ModuleBody = ModuleBodySync | ModuleBodyAsync;

type DynamicImport = (specifier: string, importAssertions?: Record<string, string>) => Promise<ModuleNamespace>;

interface ModuleBodySync {
	async: false;
	execute: (meta: ImportMeta, dynamicImport: DynamicImport) => Generator<ModuleBodyScope, void, ModuleExports>;
}

interface ModuleBodyAsync {
	async: true;
	execute: (
		meta: ImportMeta,
		dynamicImport: DynamicImport,
		accepts: (scope: ModuleBodyScope) => void,
	) => AsyncGenerator<ModuleBodyScope, void, ModuleExports>;
}

/** @internal */
export type ModuleBodyScope = [
	replace: (this: void, exports: ModuleExports) => void,
	/** [[LocalExportEntries]] */
	exports: ModuleExports,
];

/** @internal */
export interface LoadedModuleRequestEntry extends ModuleRequestEntry {
	readonly controller: () => ModuleController;
}
