import type { NodePath, Visitor } from "@babel/traverse";
import assert from "node:assert/strict";
import { parse, types as t } from "@babel/core";
// @ts-expect-error
import syntaxImportAttributes from "@babel/plugin-syntax-import-attributes";
import convertSourceMap from "convert-source-map";
import Fn from "dynohot/functional";
import { type BindingEntry, BindingType } from "dynohot/runtime/binding";
import { generate, makeRootPath, traverse } from "./babel-shim.js";

const makeLocalGetter = (localName: string, exportName: string) =>
	t.objectProperty(
		t.identifier(exportName),
		t.arrowFunctionExpression([], t.identifier(localName)));

const extractName = (node: t.Identifier | t.StringLiteral) =>
	t.isStringLiteral(node) ? node.value : node.name;

interface ImportEntry {
	identifier: string;
	importSpecifier: string;
	specifier: string;
	bindings: BindingEntry[];
}

export function transformModuleSource(
	filename: string,
	importAssertions: Record<string, string>,
	sourceText: string,
	sourceMap: unknown,
) {
	const file = function() {
		try {
			const file = parse(sourceText, {
				babelrc: false,
				configFile: false,
				filename,
				retainLines: true,
				sourceType: "module",
				plugins: [
					[ syntaxImportAttributes, { deprecatedAssertSyntax: true } ],
				],
			});
			assert.ok(file);
			return file;
		} finally {
			// nb: Babel has uncharacteristically poor hygiene here and assigns `Error.prepareStackTrace`
			// when you invoke `parse` and doesn't even bother to put it back. This causes nodejs's source
			// map feature to bail out and show plain source files.
			// In nodejs v20.0+ loaders run in a separate context, so it isn't an issue there, but otherwise
			// source maps just won't work.
			// https://github.com/babel/babel/blob/74b5ac21d0fb516ecc8d8375cc75b4446b6c9735/packages/babel-core/src/errors/rewrite-stack-trace.ts#L140
			delete Error.prepareStackTrace;
		}
	}();

	// Run transformation
	const path = makeRootPath(file);
	const state = transformProgram(path);

	// Generate new source code from modified AST
	const result = generate(file, {
		filename: filename.replace(/(\..+?|)$/, ".hot$1"),
		retainLines: true,
		sourceMaps: true,
		// @ts-expect-error
		inputSourceMap: sourceMap,
	});

	// Generate source map comment
	const sourceMapComment = result.map ? convertSourceMap.fromObject(result.map).toComment() : "";

	// Make import declarations
	const importRuntime = 'import { acquire } from "hot:runtime";';
	const imports = Fn.join(Fn.map(
		state.importDeclarations,
		declaration =>
			`import ${declaration.identifier} from ${JSON.stringify(declaration.importSpecifier)};`,
	), "\n");
	// `ModuleBody`
	const body = `{ async: ${state.usesTopLevelAwait}, execute }`;
	// nb: We omit `import.meta` in the case the module doesn't use it at all. No
	// telling if this is actually important to the runtime environment but it seemed
	// important enough to make it into the compartments proposal:
	// https://github.com/tc39/proposal-compartments/blob/7e60fdbce66ef2d97370007afeb807192c653333/1-static-analysis.md#design-rationales
	const importMeta = state.usesImportMeta ? "import.meta" : "null";
	// `LoadedModuleRequestEntry`
	const requestEntries = `[ ${Fn.join(Fn.map(
		state.importDeclarations,
		declaration => {
			const bindings = JSON.stringify(declaration.bindings);
			const specifier = JSON.stringify(declaration.specifier);
			return `{ controller: ${declaration.identifier}, specifier: ${specifier}, bindings: ${bindings} }`;
		},
	), ", ")} ]`;
	const loader = `module().load(${body}, ${importMeta}, ${state.usesDynamicImport}, "module", ${JSON.stringify(importAssertions)}, ${requestEntries});`;

	// Build final module source
	return `${result.code}\n${sourceMapComment}\n${importRuntime}\n${imports}\n${loader}\n`;
}

function transformProgram(program: NodePath<t.Program>) {
	const exportedGetters = t.objectExpression([]);
	const importDeclarations: ImportEntry[] = [];
	const importedBindings = new Map<string, {
		bindings: BindingEntry[];
		exportName: string | null;
	}>();
	const specifierToBindings = new Map<string, BindingEntry[]>();

	interface ModuleRequestNode {
		assertions?: t.ImportAttribute[] | null;
		attributes?: t.ImportAttribute[] | null;
		source?: t.StringLiteral | null;
	}

	const acquireModuleRequestBindings = (moduleRequest: ModuleRequestNode) => {
		assert(moduleRequest.source);
		// Convert import assertions into `with` URL search parameters. That way the underlying
		// loader can pass forward the assertions, but the runtime imports will be plain.
		const attributes = moduleRequest.attributes ?? moduleRequest.assertions ?? [];
		const specifier = moduleRequest.source.value;
		const params = new URLSearchParams([
			[ "specifier", specifier ],
			...Fn.map(
				attributes, assertion => [
					"with",
					String(new URLSearchParams([ [ extractName(assertion.key), extractName(assertion.value) ] ])),
				]),
		] as [ string, string ][]);
		const importSpecifier = `hot:module?${String(params)}`;
		return specifierToBindings.get(importSpecifier) ?? function() {
			const localName = `_${specifier.replaceAll(/[^A-Za-z0-9_$]/g, "_")}`;
			const bindings: BindingEntry[] = [];
			specifierToBindings.set(importSpecifier, bindings);
			importDeclarations.push({
				bindings,
				identifier: localName,
				importSpecifier,
				specifier,
			});
			return bindings;
		}();
	};

	// First step is to process import statements. These are rewritten to pass the requested
	// bindings to the runtime module controller. This is done first so that later we know which
	// names are re-exports. Since exports and imports can only occur at the top level there is no
	// need for a recursive visitor, just looping over the top-level statements is sufficient.
	for (const statement of program.get("body")) {
		if (statement.isImportDeclaration()) {
			// import identifier from "specifier";
			const bindings = acquireModuleRequestBindings(statement.node);
			for (const specifier of statement.node.specifiers) {
				if (t.isImportDefaultSpecifier(specifier)) {
					importedBindings.set(specifier.local.name, { exportName: "default", bindings });
					bindings.push({
						type: BindingType.import,
						name: "default",
						...specifier.local.name !== "default" && {
							as: specifier.local.name,
						},
					});
				} else if (t.isImportSpecifier(specifier)) {
					const exportName = extractName(specifier.imported);
					importedBindings.set(specifier.local.name, { exportName, bindings });
					bindings.push({
						type: BindingType.import,
						name: exportName,
						...specifier.local.name !== "default" && {
							as: specifier.local.name,
						},
					});
				} else {
					assert(t.isImportNamespaceSpecifier(specifier));
					importedBindings.set(specifier.local.name, { exportName: null, bindings });
					bindings.push({
						type: BindingType.importStar,
						as: specifier.local.name,
					});
				}
			}
			statement.remove();
		}
	}

	// Now we walk the program statements again and process exports.
	for (const statement of program.get("body")) {
		if (statement.isExportAllDeclaration()) {
			// export * from "specifier";
			const bindings = acquireModuleRequestBindings(statement.node);
			bindings.push({ type: BindingType.exportStar });
			statement.remove();

		} else if (statement.isExportDefaultDeclaration()) {
			// export default expression;
			const declaration = statement.get("declaration");
			if (declaration.isClassDeclaration() || declaration.isFunctionDeclaration()) {
				if (declaration.node.id == null) {
					// Default exported classes and function declarations don't require a
					// name. When we strip the `export` keyword this violates a bunch of
					// invariants. We will give these declarations names.
					declaration.node.id = program.scope.generateUidIdentifier("default");
					program.scope.registerDeclaration(declaration);
				}
				// Add binding to this declaration by name
				exportedGetters.properties.push(makeLocalGetter(declaration.node.id.name, "default"));
				statement.replaceWith(declaration);
			} else {
				const indirectExport = declaration.isIdentifier() ? importedBindings.get(declaration.node.name) : undefined;
				if (indirectExport === undefined) {
					// This is an export by value. Care must be taken to avoid exporting a live
					// binding to an underlying expression.
					assert(declaration.isExpression());
					const id = program.scope.generateUid("default");
					const next = statement.replaceWith(
						t.variableDeclaration("const", [
							t.variableDeclarator(t.identifier(id), declaration.node),
						]));
					program.scope.registerDeclaration(next[0]);
					exportedGetters.properties.push(makeLocalGetter(id, "default"));
				} else {
					// This is actually a re-export of an existing import
					if (indirectExport.exportName === null) {
						// import * as foo from "bar";
						// export default foo;
						indirectExport.bindings.push({
							type: BindingType.indirectStarExport,
							as: "default",
						});
					} else {
						// import foo from "bar";
						// export default foo;
						indirectExport.bindings.push({
							type: BindingType.indirectExport,
							name: indirectExport.exportName,
							as: "default",
						});
					}
					statement.remove();
				}
			}

		} else if (statement.isExportNamedDeclaration()) {
			if (statement.node.source) {
				// export ... from "specifier";
				assert(!statement.node.declaration);
				const bindings = acquireModuleRequestBindings(statement.node);
				for (const specifier of statement.node.specifiers) {
					if (t.isExportSpecifier(specifier)) {
						const { exported, local } = specifier;
						const exportedName = extractName(exported);
						bindings.push({
							type: BindingType.indirectExport,
							name: local.name,
							...exportedName !== local.name && {
								as: exportedName,
							},
						});
					} else {
						assert(t.isExportNamespaceSpecifier(specifier));
						const { exported } = specifier;
						const exportedName = extractName(exported);
						bindings.push({
							type: BindingType.indirectStarExport,
							as: exportedName,
						});
					}
				}
				statement.remove();
				continue;
			}

			// export { identifier };
			for (const specifier of statement.node.specifiers) {
				if (t.isExportSpecifier(specifier)) {
					const { exported, local } = specifier;
					const exportName = extractName(exported);
					const indirectExport = importedBindings.get(local.name);
					if (indirectExport === undefined) {
						exportedGetters.properties.push(makeLocalGetter(local.name, exportName));
					} else if (indirectExport.exportName === null) {
						// import * as foo from "bar";
						// export { foo };
						indirectExport.bindings.push({
							type: BindingType.indirectStarExport,
							as: exportName,
						});
					} else {
						// import foo from "bar";
						// export { foo };
						indirectExport.bindings.push({
							type: BindingType.indirectExport,
							name: indirectExport.exportName,
							...exportName !== indirectExport.exportName && {
								as: exportName,
							},
						});
					}
				}
			}

			// export function identifier() {}
			const { declaration } = statement.node;
			if (declaration) {
				if (t.isClassDeclaration(declaration) || t.isFunctionDeclaration(declaration)) {
					const name = declaration.id!.name;
					exportedGetters.properties.push(makeLocalGetter(name, name));
				} else if (t.isVariableDeclaration(declaration)) {
					const { declarations } = declaration;
					for (const declaration of declarations) {
						for (const localName of Object.keys(t.getOuterBindingIdentifiers(declaration))) {
							exportedGetters.properties.push(makeLocalGetter(localName, localName));
						}
					}
				}
				statement.replaceWith(declaration);
			} else {
				statement.remove();
			}
		}
	}

	// Now run the recursive visitor which replaces all runtime-managed references with getters.
	// While we're in there we will also look for dynamic imports and top-level awaits.
	const holderName = program.scope.generateUid("$");
	const importDynamicName = program.scope.generateUid("import");
	const importMetaName = program.scope.generateUid("meta");
	const acceptName = program.scope.generateUid("accept");
	const visitorState: VisitorState = {
		holderName,
		importedLocalNames: new Set(importedBindings.keys()),
		importDynamicName,
		importMetaName,
		program,
		usesDynamicImport: false,
		usesImportMeta: false,
		usesTopLevelAwait: false,
	};
	traverse(program.node, importToGetterVisitor, program.scope, visitorState);

	// Finally, assemble a new body with the re-written imports, import descriptors, runtime-defined
	// default export, and module body generator
	program.node.body = [
		t.functionDeclaration(
			t.identifier("execute"),
			[
				t.identifier(importMetaName),
				t.identifier(importDynamicName),
				...visitorState.usesTopLevelAwait ? [ t.identifier(acceptName) ] : [],
			],
			t.blockStatement([
				t.variableDeclaration("let", [
					t.variableDeclarator(
						t.identifier(holderName),
						t.yieldExpression(function() {
							const scope = t.arrayExpression([
								t.arrowFunctionExpression(
									[ t.identifier("next") ],
									t.blockStatement([
										t.expressionStatement(
											t.assignmentExpression("=", t.identifier(holderName), t.identifier("next"))),
									])),
								exportedGetters,
							]);
							if (visitorState.usesTopLevelAwait) {
								return t.callExpression(t.identifier(acceptName), [ scope ]);
							} else {
								return scope;
							}
						}())),
				]),
				...program.node.body,
			]),
			true,
			visitorState.usesTopLevelAwait),
	];

	return {
		importDeclarations,
		usesDynamicImport: visitorState.usesDynamicImport,
		usesImportMeta: visitorState.usesImportMeta,
		usesTopLevelAwait: visitorState.usesTopLevelAwait,
	};
}

interface VisitorState {
	readonly importedLocalNames: ReadonlySet<string>;
	readonly holderName: string;
	readonly importDynamicName: string;
	readonly importMetaName: string;
	readonly program: NodePath<t.Program>;
	usesDynamicImport: boolean;
	usesImportMeta: boolean;
	usesTopLevelAwait: boolean;
}

const importToGetterVisitor: Visitor<VisitorState> = {
	// Look for top-level await
	AwaitExpression(path) {
		if (!this.usesTopLevelAwait && path.scope.getFunctionParent() === null) {
			this.usesTopLevelAwait = true;
		}
	},

	ForAwaitStatement(path) {
		if (!this.usesTopLevelAwait && path.scope.getFunctionParent() === null) {
			this.usesTopLevelAwait = true;
		}
	},

	// Look for dynamic imports
	CallExpression(path) {
		if (t.isImport(path.node.callee)) {
			this.usesDynamicImport = true;
			path.get("callee").replaceWith(t.identifier(this.importDynamicName));
		}
	},

	// Replace `import.meta`
	MetaProperty(path) {
		if (path.node.meta.name === "import" && path.node.property.name === "meta") {
			path.replaceWith(t.identifier(this.importMetaName));
			this.usesImportMeta = true;
		}
	},

	// Replace imported bindings
	Identifier(path) {
		const localName = path.node.name;
		if (this.importedLocalNames.has(localName)) {
			const bindingScope = path.scope.getBinding(localName)?.scope;
			if (bindingScope === undefined) {
				path.replaceWith(t.callExpression(
					t.memberExpression(t.identifier(this.holderName), path.node),
					[]));
				path.skip();
			}
		}
	},

	ClassMethod(path) {
		if (!path.node.computed) {
			path.skipKey("key");
		}
	},

	ClassProperty(path) {
		if (!path.node.computed) {
			path.skipKey("key");
		}
	},

	LabeledStatement(path) {
		path.skipKey("label");
	},

	MemberExpression(path) {
		if (!path.node.computed) {
			path.skipKey("property");
		}
	},

	ObjectMethod(path) {
		if (!path.node.computed) {
			path.skipKey("key");
		}
	},

	ObjectProperty(path) {
		if (!path.node.computed && t.isIdentifier(path.node.key)) {
			if (path.node.shorthand) {
				const localName = path.node.key.name;
				if (this.importedLocalNames.has(localName)) {
					const bindingScope = path.scope.getBinding(localName)?.scope;
					if (bindingScope === undefined) {
						path.replaceWith(t.objectProperty(
							path.node.key,
							t.callExpression(
								t.memberExpression(t.identifier(this.holderName), t.identifier(localName)),
								[])));
					}
				}
			}
			path.skipKey("key");
		}
	},
};
