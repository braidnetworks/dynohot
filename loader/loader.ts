import type { InitializeHook, LoadHook, ModuleFormat, ResolveFnOutput, ResolveHook } from "node:module";
import type { MessagePort } from "node:worker_threads";
import * as assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import * as fs from "node:fs/promises";
import { mappedPrimitiveComparator } from "@braidai/lang/comparator";
import { Fn } from "@braidai/lang/functional";
import convertSourceMap from "convert-source-map";
import { maybeThen } from "dynohot/runtime/utility";
import { LoaderHot } from "./loader-hot.js";
import { transformModuleSource } from "./transform.js";

export type { Hot } from "dynohot/runtime/hot";

type ImportAttributes = Record<string, string>;

/** @internal */
export interface LoaderParameters {
	ignore?: RegExp;
	port: MessagePort;
	silent?: boolean;
}

let ignorePattern: RegExp;
let port: MessagePort;
let runtimeURL: string;

/** @internal */
export const initialize: InitializeHook<LoaderParameters> = options => {
	port = options.port;
	ignorePattern = options.ignore ?? /[/\\]node_modules[/\\]/;
	const root = String(new URL("..", new URL(import.meta.url)));
	runtimeURL = `${root}runtime/runtime.js?${String(new URLSearchParams({
		...options.silent ? { silent: "" } : {},
	}))}`;
};

function extractImportAttributes(params: URLSearchParams): ImportAttributes {
	const entries = Array.from(Fn.transform(
		Fn.filter(params, entry => entry[0] === "with"),
		entry => new URLSearchParams(entry[1])));
	entries.sort(mappedPrimitiveComparator(entry => entry[0]));
	return Object.fromEntries(entries);
}

// 16.14.0 >= version < 18.20.0
const deprecatedAssertSyntax = /^(?:16|17|18\.1?[0-9]\.)/.test(process.versions.node);

const makeAdapterModule = (url: string, importAttributes: ImportAttributes) => {
	const encodedURL = JSON.stringify(url);
	return (
	// eslint-disable-next-line @stylistic/indent
`import * as namespace from ${encodedURL} ${deprecatedAssertSyntax ? "assert" : "with"} ${JSON.stringify(importAttributes)};
import { adapter } from "hot:runtime";
const module = adapter(${encodedURL}, namespace);
export default function() { return module; };\n`
	);
};

const makeJsonModule = (url: string, json: string, importAttributes: ImportAttributes) =>
// eslint-disable-next-line @stylistic/indent
`import { acquire } from "hot:runtime";
function* execute() {
	yield [ () => {}, { default: () => json } ];
	yield;
	const json = JSON.parse(${JSON.stringify(json)});
}
export default function module() {
	return acquire(${JSON.stringify(url)}, execute);
}
module().load({ async: false, execute }, null, false, "json", ${JSON.stringify(importAttributes)}, []);\n`;

const makeReloadableModule = async (url: string, source: string, importAttributes: ImportAttributes) => {
	const sourceMap = await async function(): Promise<unknown> {
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
	// eslint-disable-next-line @stylistic/indent
`${transformModuleSource(url, importAttributes, source, sourceMap)}
import { acquire } from "hot:runtime";
export default function module() { return acquire(${JSON.stringify(url)}); }\n`
	);
};

function asString(sourceText: any) {
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

// nb: Copy/pasted into runtime
function encodeLimited(content: string) {
	return content.replace(/[#%?]/g, char => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

function decodeLimited(encoded: string) {
	return encoded.replace(/%[0-9a-f]+/g, code => String.fromCharCode(parseInt(code.slice(1), 16)));
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
	// [static imports] Convert "hot:static?specifier=..." to "hot:module:file://..."
	if (specifier.startsWith("hot:static?")) {
		assert.ok(context.parentURL.startsWith("hot:main?") || context.parentURL.startsWith("hot:module:"));
		const parentURL = new URL(context.parentURL);
		const parentModuleURL =
			context.parentURL.startsWith("hot:main?")
				? parentURL.searchParams.get("url") ?? ""
				: parentURL.pathname.replace("module:", "");
		assert.ok(parentModuleURL !== "");
		const resolutionURL = new URL(specifier);
		const resolutionSpecifier = resolutionURL.searchParams.get("specifier");
		assert.ok(resolutionSpecifier !== null);
		const importAttributes = extractImportAttributes(resolutionURL.searchParams);
		return maybeThen(function*() {
			const result: ResolveFnOutput = yield nextResolve(resolutionSpecifier, {
				...context,
				parentURL: parentModuleURL,
				[deprecatedAssertSyntax ? "importAssertions" : "importAttributes"]: importAttributes,
			});
			const params = new URLSearchParams(Fn.filter(resolutionURL.searchParams, entry => entry[0] === "with"));
			return {
				...result,
				[deprecatedAssertSyntax ? "importAssertions" : "importAttributes"]: {},
				url: `hot:module:${encodeLimited(result.url)}?${String(params)}`,
			};
		});

	// [dynamic import] Convert "hot:dynamic?specifier=..." to "hot:module:file://..."
	} else if (specifier.startsWith("hot:dynamic?")) {
		const resolutionURL = new URL(specifier);
		const resolutionSpecifier = resolutionURL.searchParams.get("specifier");
		assert.ok(resolutionSpecifier !== null);
		const parentModuleURL = resolutionURL.searchParams.get("parent");
		assert.ok(parentModuleURL !== null);
		const importAttributes = extractImportAttributes(resolutionURL.searchParams);
		return maybeThen(function*() {
			const result: ResolveFnOutput = yield nextResolve(resolutionSpecifier, {
				...context,
				parentURL: parentModuleURL,
				[deprecatedAssertSyntax ? "importAssertions" : "importAttributes"]: importAttributes,
			});
			const params = new URLSearchParams(Fn.filter(resolutionURL.searchParams, entry => entry[0] === "with"));
			return {
				...result,
				[deprecatedAssertSyntax ? "importAssertions" : "importAttributes"]: {},
				url: `hot:module:${encodeLimited(result.url)}?${String(params)}`,
			};
		});

	// [file watcher] Convert "hot:reload?url=..." to "hot:module:file://..."
	} else if (specifier.startsWith("hot:reload?")) {
		const resolutionURL = new URL(specifier);
		const resolution = resolutionURL.searchParams.get("url");
		assert.ok(resolution !== null);
		const version = resolutionURL.searchParams.get("version");
		assert.ok(version !== null);
		const format = resolutionURL.searchParams.get("format") as ModuleFormat | null;
		assert.ok(format !== null);
		const params = new URLSearchParams([
			[ "version", version ],
			...Fn.filter(resolutionURL.searchParams, entry => entry[0] === "with"),
		]);
		return {
			shortCircuit: true,
			format,
			url: `hot:module:${encodeLimited(resolution)}?${String(params)}`,
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
	const parentURL = function() {
		if (context.parentURL.startsWith("hot:module:")) {
			const parentURL = new URL(context.parentURL);
			return parentURL.pathname.replace("module:", "");
		} else {
			return context.parentURL;
		}
	}();
	return nextResolve(specifier, {
		...context,
		parentURL,
	});
};

/** @internal */
export const load: LoadHook = (urlString, context, nextLoad) => {
	if (urlString.startsWith("hot:")) {
		const url = new URL(urlString);
		const pathname = url.pathname;
		switch (pathname.split(":", 1)[0]) {
			case "adapter": {
				const importAttributes = extractImportAttributes(url.searchParams);
				const moduleURL = url.searchParams.get("url");
				assert.ok(moduleURL !== null);
				return {
					shortCircuit: true,
					format: "module",
					source: makeAdapterModule(moduleURL, importAttributes),
				};
			}

			case "main": {
				const moduleURL = url.searchParams.get("url");
				assert.ok(moduleURL !== null);
				const controllerSpecifier = `hot:static?specifier=${encodeURIComponent(moduleURL)}`;
				return {
					shortCircuit: true,
					format: "module",
					source:
						`import controller from ${JSON.stringify(controllerSpecifier)};\n` +
						"await controller().main();\n",
				};
			}

			case "module": return async function() {
				const moduleURL = decodeLimited(pathname.replace("module:", ""));
				assert.notStrictEqual(moduleURL, "");
				const importAttributes = extractImportAttributes(url.searchParams);
				const hot = new LoaderHot(moduleURL, port);
				const result = await nextLoad(moduleURL, {
					...context,
					hot,
					[deprecatedAssertSyntax ? "importAssertions" : "importAttributes"]: importAttributes,
				});
				if (!ignorePattern.test(moduleURL)) {
					if (result.format === "module") {
						const source = await makeReloadableModule(moduleURL, asString(result.source), importAttributes);
						return { ...result, source };
					} else if (result.format === "json") {
						return {
							...result,
							format: "module",
							source: makeJsonModule(moduleURL, asString(result.source), importAttributes),
						};
					}
				}

				// Otherwise this is an adapter module
				return {
					format: "module",
					source: makeAdapterModule(moduleURL, importAttributes),
				};
			}();

			default:
				throw new Error(`Unknown 'hot:' URL '${urlString}'`);
		}
	}

	// Fallback
	return nextLoad(urlString, context);
};
