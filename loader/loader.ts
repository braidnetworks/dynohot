import type { LoadHook, ModuleFormat, ResolveFnOutput, ResolveHook } from "node:module";
import * as assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import * as fs from "node:fs/promises";
import convertSourceMap from "convert-source-map";
import Fn from "dynohot/functional";
import { maybeThen } from "dynohot/runtime/utility";
import { transformModuleSource } from "./transform.js";

export type { Hot } from "dynohot/hot";

const self = new URL(import.meta.url);
const ignoreString = self.searchParams.get("ignore");
const ignorePattern = ignoreString === null ? /[/\\]node_modules[/\\]/ : new RegExp(ignoreString);

const root = String(new URL("..", self));
const runtimeURL = `${root}runtime/runtime.js?${String(self.searchParams)}`;

type ImportAssertions = Record<string, string>;

function extractImportAssertions(params: URLSearchParams): ImportAssertions {
	const entries = Array.from(Fn.transform(
		Fn.filter(params, entry => entry[0] === "with"),
		entry => new URLSearchParams(entry[1])));
	entries.sort(Fn.mappedPrimitiveComparator(entry => entry[0]));
	return Object.fromEntries(entries);
}

const makeAdapterModule = (url: string, importAssertions: ImportAssertions) => {
	const encodedURL = JSON.stringify(url);
	return (
	// eslint-disable-next-line @stylistic/indent
`import * as namespace from ${encodedURL} assert ${JSON.stringify(importAssertions)};
import { adapter } from "hot:runtime";
const module = adapter(${encodedURL}, namespace);
export default function() { return module; };\n`
	);
};

const makeJsonModule = (url: string, json: string, importAssertions: ImportAssertions) =>
// eslint-disable-next-line @stylistic/indent
`import { acquire } from "hot:runtime"
function* execute() {
	yield [ () => {}, { default: () => json } ];
	yield;
	const json = JSON.parse(${JSON.stringify(json)});
}
export default function module() {
	return acquire(${JSON.stringify(url)}, execute);
}
module().load({ async: false, execute }, null, false, "json", ${JSON.stringify(importAssertions)}, []);\n`;

const makeReloadableModule = async (url: string, source: string, importAssertions: ImportAssertions) => {
	const sourceMap = await async function() {
		try {
			const map = convertSourceMap.fromComment(source);
			return map.toObject();
		} catch {}
		try {
			const map = await convertSourceMap.fromMapFileSource(
				source,
				(fileName: string) => fs.readFile(new URL(fileName, url), "utf8"));
			return map?.toObject();
		} catch {}
	}();
	// Loaders earlier in the chain are allowed to overwrite `responseURL`, which is fine, but we
	// need to notate this in the runtime. `responseURL` can be anything, doesn't have to be unique,
	// and is observable via `import.meta.url` and stack traces [unless there is a source map]. On
	// the other hand, `moduleURL` uniquely identifies an instance of a module, and is used as the
	// `parentURL` in the resolve callback. We will "burn in" `moduleURL` into the transformed
	// source as a post-transformation process.
	return (
		`${transformModuleSource(url, importAssertions, source, sourceMap)}
import { acquire } from "hot:runtime";
export default function module() { return acquire(${JSON.stringify(url)}); }\n`
	);
};

function asString(sourceText: ArrayBuffer | Uint8Array | string | undefined) {
	if (sourceText instanceof Buffer) {
		return sourceText.toString("utf8");
	} else if (typeof sourceText === "string") {
		return sourceText;
	} else if (sourceText === undefined) {
		return "";
	} else {
		return Buffer.from(sourceText).toString("utf8");
	}
}

/** @internal */
export const resolve: ResolveHook = (specifier, context, nextResolve) => {
	// Forward root module to "hot:main"
	if (context.parentURL === undefined) {
		return maybeThen(function*() {
			const result: ResolveFnOutput = yield nextResolve(specifier, context);
			return {
				url: `hot:main?url=${encodeURIComponent(result.url)}`,
			};
		});
	}
	// [static imports] Convert "hot:module?specifier=..." to "hot:module?url=..."
	if (specifier.startsWith("hot:module?")) {
		assert.ok(context.parentURL.startsWith("hot:main?") || context.parentURL.startsWith("hot:module?"));
		const parentURL = new URL(context.parentURL);
		const parentModuleURL = parentURL.searchParams.get("url");
		assert.ok(parentModuleURL !== null);
		const resolutionURL = new URL(specifier);
		const resolutionSpecifier = resolutionURL.searchParams.get("specifier");
		assert.ok(resolutionSpecifier !== null);
		const importAssertions = extractImportAssertions(resolutionURL.searchParams);
		return maybeThen(function*() {
			const result: ResolveFnOutput = yield nextResolve(resolutionSpecifier, {
				...context,
				parentURL: parentModuleURL,
				importAssertions,
			});
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
		assert.ok(resolutionSpecifier !== null);
		const parentModuleURL = resolutionURL.searchParams.get("parent");
		assert.ok(parentModuleURL !== null);
		const importAssertions = extractImportAssertions(resolutionURL.searchParams);
		return maybeThen(function*() {
			const result: ResolveFnOutput = yield nextResolve(resolutionSpecifier, {
				...context,
				parentURL: parentModuleURL,
				importAssertions,
			});
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
		assert.ok(resolution !== null);
		const version = resolutionURL.searchParams.get("version");
		assert.ok(version !== null);
		const format = resolutionURL.searchParams.get("format") as ModuleFormat | null;
		assert.ok(format !== null);
		const params = new URLSearchParams([
			[ "url", resolution ],
			[ "version", version ],
			...Fn.filter(resolutionURL.searchParams, entry => entry[0] === "with"),
		]);
		return {
			shortCircuit: true,
			format,
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
export const load: LoadHook = (urlString, context, nextLoad) => {
	if (urlString.startsWith("hot:")) {
		const url = new URL(urlString);
		switch (url.pathname) {
			case "adapter": {
				const importAssertions = extractImportAssertions(url.searchParams);
				const moduleURL = url.searchParams.get("url");
				assert.ok(moduleURL);
				return {
					shortCircuit: true,
					format: "module",
					source: makeAdapterModule(moduleURL, importAssertions),
				};
			}

			case "main": {
				const moduleURL = url.searchParams.get("url");
				assert.ok(moduleURL);
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
				assert.ok(moduleURL);
				const importAssertions = extractImportAssertions(url.searchParams);
				const result = await nextLoad(moduleURL, {
					...context,
					importAssertions,
				});
				if (!ignorePattern.test(moduleURL)) {
					if (result.format === "module") {
						const source = await makeReloadableModule(moduleURL, asString(result.source), importAssertions);
						return { ...result, source };
					} else if (result.format === "json") {
						return {
							...result,
							format: "module",
							source: makeJsonModule(moduleURL, asString(result.source), importAssertions),
						};
					}
				}

				// Otherwise this is an adapter module
				return {
					format: "module",
					source: makeAdapterModule(moduleURL, importAssertions),
				};
			}();

			default:
				throw new Error(`Unknown 'hot:' URL '${urlString}'`);
		}
	}

	// Fallback
	return nextLoad(urlString, context);
};
