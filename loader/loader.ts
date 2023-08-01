import type { NodeLoad, NodeResolve } from "./node-loader.js";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
// @ts-expect-error
import convertSourceMap from "convert-source-map";
import Fn from "dynohot/functional";
import { transformModuleSource } from "./transform.js";

const self = new URL(import.meta.url);
const ignoreString = self.searchParams.get("ignore");
const ignorePattern = ignoreString === null ? /[/\\]node_modules[/\\]/ : new RegExp(ignoreString);

const root = String(new URL("..", import.meta.url));
const runtimeURL = `${root}/runtime/runtime.js`;

function extractImportAssertions(params: URLSearchParams) {
	const entries = Array.from(Fn.transform(
		Fn.filter(params, entry => entry[0] === "with"),
		entry => new URLSearchParams(entry[1])));
	entries.sort(Fn.mappedPrimitiveComparator(entry => entry[0]));
	return Object.fromEntries(entries);
}

const makeAdapterModule = (url: string, importAssertions: Record<string, string>) =>
	`import * as namespace from ${JSON.stringify(url)} assert ${JSON.stringify(importAssertions)};\n` +
	"import { adapter } from \"hot:runtime\";\n" +
	"const module = adapter(import.meta, namespace);\n" +
	"export default function() { return module; }\n";

/**
 * Resolvers are ~allowed~ to return promises, but actually they shouldn't. nodejs accidentally
 * locked themselves into a promise-based API but then the `import.meta.resolve` specification
 * changed to be synchronous. So they work around it with some horrific `Atomics.wait` thing which
 * hard locks the thread until the promise resolves.
 *
 * This utility is used to detect a promise from an underlying loader and `then` it, or just execute
 * the callback synchronously.
 */
function maybeThen<Type, Result>(
	maybePromise: MaybePromiseLike<Type>,
	then: (value: Type) => Result,
): MaybePromiseLike<Awaited<Result>> {
	// For the life of me, I can't figure out how to type this. `maybePromise` should probably also
	// include `& { then?: never }` and maybe the primitives, but that causes other problems.
	// @ts-expect-error
	if (typeof maybePromise.then === "function") {
		// @ts-expect-error
		return maybePromise.then(then);
	} else {
		// @ts-expect-error
		return then(maybePromise);
	}
}

/** @internal */
export const resolve: NodeResolve = (specifier, context, nextResolve) => {
	// Forward root module to "hot:main"
	if (context.parentURL === undefined) {
		return maybeThen(nextResolve(specifier, context), result => ({
			url: `hot:main?url=${encodeURIComponent(result.url)}`,
		}));
	}
	// [static imports] Convert "hot:module?specifier=..." to "hot:module?url=..."
	if (specifier.startsWith("hot:module?")) {
		assert(context.parentURL.startsWith("hot:main?") || context.parentURL.startsWith("hot:module?"));
		const parentURL = new URL(context.parentURL);
		const parentModuleURL = parentURL.searchParams.get("url");
		assert(parentModuleURL !== null);
		const resolutionURL = new URL(specifier);
		const resolutionSpecifier = resolutionURL.searchParams.get("specifier");
		assert(resolutionSpecifier !== null);
		const importAssertions = extractImportAssertions(resolutionURL.searchParams);
		return maybeThen(
			nextResolve(resolutionSpecifier, {
				...context,
				parentURL: parentModuleURL,
				importAssertions,
			}),
			result => {
				const params = new URLSearchParams([
					[ "url", result.url ],
					...Fn.filter(resolutionURL.searchParams, entry => entry[0] === "with"),
				]);
				return {
					...result,
					importAssertions: {},
					url: `hot:module?${String(params)}`,
				};
			});
	// [dynamic import] Convert "hot:module?specifier=..." to "hot:module?url=..."
	} else if (specifier.startsWith("hot:import?")) {
		const resolutionURL = new URL(specifier);
		const resolutionSpecifier = resolutionURL.searchParams.get("specifier");
		assert(resolutionSpecifier !== null);
		const parentModuleURL = resolutionURL.searchParams.get("parent");
		assert(parentModuleURL !== null);
		const importAssertions = extractImportAssertions(resolutionURL.searchParams);
		return maybeThen(
			nextResolve(resolutionSpecifier, {
				...context,
				parentURL: parentModuleURL,
				importAssertions,
			}),
			result => {
				const params = new URLSearchParams([
					[ "url", result.url ],
					...Fn.filter(resolutionURL.searchParams, entry => entry[0] === "with"),
				]);
				return {
					...result,
					importAssertions: {},
					url: `hot:module?${String(params)}`,
				};
			});
	// [file watcher] Convert "hot:reload?url=..." to "hot:module?url=..."
	} else if (specifier.startsWith("hot:reload?")) {
		const resolutionURL = new URL(specifier);
		const resolution = resolutionURL.searchParams.get("url");
		assert(resolution !== null);
		const version = resolutionURL.searchParams.get("version");
		assert(version !== null);
		const params = new URLSearchParams([
			[ "url", resolution ],
			[ "version", version ],
			...Fn.filter(resolutionURL.searchParams, entry => entry[0] === "with"),
		]);
		return {
			shortCircuit: true,
			format: "module",
			url: `hot:module?${String(params)}`,
		};
	}
	// Pass through requests for the runtime
	if (specifier === "hot:runtime") {
		return {
			shortCircuit: true,
			format: "module",
			url: runtimeURL,
		};
	}
	// This import graph has bailed from the "hot:" scheme and is just forwarded to the host.
	return nextResolve(specifier, context);
};

/** @internal */
export const load: NodeLoad = (urlString, context, nextLoad) => {
	if (urlString.startsWith("hot:")) {
		const url = new URL(urlString);
		switch (url.pathname) {
			case "adapter": {
				const importAssertions = extractImportAssertions(url.searchParams);
				const moduleURL = url.searchParams.get("url");
				assert(moduleURL);
				return {
					shortCircuit: true,
					format: "module",
					source: makeAdapterModule(moduleURL, importAssertions),
				};
			}

			case "main": {
				const moduleURL = url.searchParams.get("url");
				assert(moduleURL);
				const controllerSpecifier = `hot:module?specifier=${encodeURIComponent(moduleURL)}`;
				return {
					shortCircuit: true,
					format: "module",
					source:
						`import controller from ${JSON.stringify(controllerSpecifier)};\n` +
						"await controller().main();\n",
				};
			}

			case "module": return async function() {
				const moduleURL = url.searchParams.get("url");
				assert(moduleURL);
				const importAssertions = extractImportAssertions(url.searchParams);
				const result = await nextLoad(moduleURL, { ...context, importAssertions });
				if (result.format === "module" && !ignorePattern.test(moduleURL)) {
					const sourceText = typeof result.source === "string"
						? result.source
						: Buffer.from(result.source).toString("utf8");
					const sourceMap = await async function() {
						try {
							const map = await convertSourceMap.fromMapFileSource(
								sourceText,
								(fileName: string) => fs.readFile(new URL(fileName, moduleURL), "utf8"));
							return map?.toObject();
						} catch {}
					}();
					transformModuleSource(moduleURL, importAssertions, sourceText, sourceMap);
					return {
						...result,
						responseURL: moduleURL,
						source: transformModuleSource(moduleURL, importAssertions, sourceText, sourceMap),
					};
				} else {
					return {
						format: "module",
						source: makeAdapterModule(moduleURL, importAssertions),
					};
				}
			}();

			default:
				throw new Error(`Unknown 'hot:' URL '${urlString}'`);
		}
	}

	// Fallback
	return nextLoad(urlString, context);
};
