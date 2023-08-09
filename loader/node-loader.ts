import type { MessagePort } from "node:worker_threads";

// https://nodejs.org/api/esm.html#resolvespecifier-context-nextresolve
interface ResolveContext {
	/** Export conditions of the relevant `package.json` */
	conditions: string[];

	/** An object whose key-value pairs represent the assertions for the module to import */
	importAssertions: Record<string, string>;

	/** The module importing this one, or undefined if this is the Node.js entry point */
	parentURL: string | undefined;
}

type Format = "builtin" | "commonjs" | "json" | "module" | "wasm";

interface ResolveResult {
	/** A hint to the load hook (it might be ignored) */
	format?: Format | null | undefined;

	/** The import assertions to use when caching the module (optional; if excluded the input will be used) */
	importAssertions?: Record<string, string>;

	/** A signal that this hook intends to terminate the chain of resolve hooks. Default: false */
	shortCircuit?: boolean | undefined;

	/** The absolute URL to which this input resolves */
	url: string;
}

type NextResolve = (specifier: string, context: ResolveContext) => MaybePromiseLike<ResolveResult>;

export type NodeResolve = (specifier: string, context: ResolveContext, nextResolve: NextResolve) => MaybePromiseLike<ResolveResult>;

// https://nodejs.org/api/esm.html#loadurl-context-nextload
interface LoadContext {
	/** Export conditions of the relevant `package.json` */
	conditions: string[];

	/** The format optionally supplied by the resolve hook chain */
	format?: Format | null | undefined;

	importAssertions: Record<string, string>;
}

interface LoadResult {
	format: Format;
	/** Undocumented: Changes the parsed module's filename */
	responseURL?: string | undefined;
	/** A signal that this hook intends to terminate the chain of resolve hooks. Default: false */
	shortCircuit?: boolean | undefined;
	/** The source for Node.js to evaluate */
	source: string | ArrayBuffer | Uint8Array;
}

type NextLoad = (urlString: string, context: LoadContext) => MaybePromiseLike<LoadResult>;

export type NodeLoad = (urlString: string, context: LoadContext, nextLoad: NextLoad) => MaybePromiseLike<LoadResult>;

interface GlobalPreloadContext {
	port: MessagePort;
}

// https://nodejs.org/api/esm.html#globalpreload
export type NodeGlobalPreload = (context: GlobalPreloadContext) => string;
