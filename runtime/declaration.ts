import type { ExportIndirectEntry, ExportIndirectStarEntry, ExportStarEntry, ModuleRequestEntry } from "./binding.js";
import type { ModuleController, ModuleExports, ModuleNamespace } from "./module.js";
import type { Format } from "dynohot/node-loader";

/** @internal */
export interface ModuleDeclaration {
	readonly body: ModuleBody;
	readonly meta: ImportMeta | null;
	readonly format: Format;
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
	execute: (meta: ImportMeta | null, dynamicImport: DynamicImport) => Generator<ModuleBodyYields, void, ModuleExports>;
}

interface ModuleBodyAsync {
	async: true;
	execute: (
		meta: ImportMeta | null,
		dynamicImport: DynamicImport,
	) => AsyncGenerator<ModuleBodyYields, void, ModuleExports>;
}

/** @internal */
export type ModuleBodyYields = [ ModuleBodyImportsReplace, ModuleExports ] | undefined;

/** @internal */
export type ModuleBodyYieldScope = [ ModuleBodyImportsReplace, ModuleExports ];

/** @internal */
export type ModuleBodyImportsReplace = (this: void, exports: ModuleExports) => void;

/** @internal */
export interface LoadedModuleRequestEntry extends ModuleRequestEntry {
	readonly controller: () => ModuleController;
}
