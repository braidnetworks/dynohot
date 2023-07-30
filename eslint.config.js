import babelParser from "@babel/eslint-parser";
import js from "@eslint/js";
import typeScriptPlugin from "@typescript-eslint/eslint-plugin";
import typeScriptParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import globals from "globals";

// @ts-check
/** @typedef {import("eslint").Linter.FlatConfig} FlatConfig */
/** @typedef {import("eslint").Linter.RulesRecord} RulesRecord */

/** @type {RulesRecord} */
const rules = {
	// Generic good practices and style
	"array-bracket-newline": [ "warn", "consistent" ],
	"array-bracket-spacing": [ "warn", "always" ],
	"arrow-body-style": "warn",
	"array-callback-return": "warn",
	"arrow-parens": [ "warn", "as-needed" ],
	"arrow-spacing": "warn",
	"block-scoped-var": "warn",
	"block-spacing": "warn",
	"brace-style": [ "warn", "1tbs", { allowSingleLine: true } ],
	"comma-dangle": [ "warn", "always-multiline" ],
	"comma-spacing": "warn",
	"comma-style": "warn",
	"computed-property-spacing": "warn",
	curly: [ "warn", "multi-line", "consistent" ],
	"dot-location": [ "warn", "property" ],
	"dot-notation": "warn",
	"eol-last": "warn",
	eqeqeq: [ "warn", "smart" ],
	"func-call-spacing": "warn",
	"func-name-matching": "warn",
	"generator-star-spacing": [ "warn", { anonymous: "neither", before: true, after: false } ],
	"id-denylist": [ "warn", "xxx", "foo", "bar" ],
	indent: [ "warn", "tab", { SwitchCase: 1, flatTernaryExpressions: true } ],
	"key-spacing": [ "warn", { mode: "strict" } ],
	"keyword-spacing": "warn",
	"linebreak-style": "warn",
	"lines-between-class-members": [ "warn", "always", { exceptAfterSingleLine: true } ],
	"logical-assignment-operators": [ "warn", "always", { enforceForIfStatements: true } ],
	"new-parens": "warn",
	"no-array-constructor": "warn",
	"no-caller": "warn",
	"no-cond-assign": [ "warn", "except-parens" ],
	"no-constant-binary-expression": "warn",
	"no-constant-condition": [ "warn", { checkLoops: false } ],
	"no-constructor-return": "error",
	"no-empty": [ "warn", { allowEmptyCatch: true } ],
	"no-eval": "warn",
	"no-extend-native": "warn",
	"no-extra-bind": "warn",
	"no-extra-label": "warn",
	"no-floating-decimal": "warn",
	"no-implied-eval": "warn",
	"no-iterator": "warn",
	"no-label-var": "warn",
	"no-labels": [ "warn", { allowLoop: true, allowSwitch: true } ],
	"no-lone-blocks": "warn",
	"no-lonely-if": "warn",
	"no-mixed-operators": [ "warn", {
		allowSamePrecedence: false,
		groups: [
			[ "&", "|", "^", "~", "<<", ">>", ">>>" ],
			[ "==", "!=", "===", "!==", ">", ">=", "<", "<=" ],
			[ "&&", "||" ],
			[ "in", "instanceof" ],
		],
	} ],
	"no-multi-spaces": "warn",
	"no-multi-str": "warn",
	"no-multiple-empty-lines": [ "warn", { max: 1, maxEOF: 0 } ],
	"no-native-reassign": "warn",
	"no-negated-condition": "warn",
	"no-negated-in-lhs": "warn",
	"no-new-func": "warn",
	"no-new-object": "warn",
	"no-new-wrappers": "warn",
	"no-new": "warn",
	"no-octal-escape": "warn",
	"no-param-reassign": "warn",
	"no-promise-executor-return": "warn",
	"no-return-await": "warn",
	"no-script-url": "warn",
	"no-self-compare": "warn",
	"no-sequences": "warn",
	"no-tabs": [ "warn", { allowIndentationTabs: true } ],
	"no-template-curly-in-string": "warn",
	"no-throw-literal": "warn",
	"no-trailing-spaces": "warn",
	"no-undef-init": "warn",
	"no-unreachable-loop": "warn",
	"no-unused-expressions": [ "warn", {
		allowShortCircuit: true,
		allowTernary: true,
		allowTaggedTemplates: true,
	} ],
	"no-unused-vars": [ "warn", {
		argsIgnorePattern: "^_",
		caughtErrors: "all",
		ignoreRestSiblings: true,
	} ],
	"no-use-before-define": [ "warn", {
		functions: false,
		classes: false,
		variables: false,
	} ],
	"no-useless-call": "warn",
	"no-useless-computed-key": "warn",
	"no-useless-concat": "warn",
	"no-useless-constructor": "warn",
	"no-useless-rename": [ "warn", {
		ignoreDestructuring: false,
		ignoreImport: false,
		ignoreExport: false,
	} ],
	"no-useless-return": "warn",
	"no-whitespace-before-property": "warn",
	"nonblock-statement-body-position": "warn",
	"object-curly-newline": [ "warn", { consistent: true } ],
	"object-curly-spacing": [ "warn", "always" ],
	"object-shorthand": [ "warn", "always" ],
	"one-var-declaration-per-line": "warn",
	"operator-assignment": "warn",
	"operator-linebreak": [ "warn", "after", {
		overrides: {
			"?": "before",
			":": "ignore",
			"||": "ignore",
			"&&": "ignore",
		},
	} ],
	"padding-line-between-statements": "warn",
	"prefer-arrow-callback": [ "warn", { allowNamedFunctions: true } ],
	"prefer-const": [ "warn", { destructuring: "all" } ],
	"prefer-destructuring": [ "warn", { array: false } ],
	"prefer-exponentiation-operator": "warn",
	"prefer-numeric-literals": "warn",
	"prefer-object-spread": "warn",
	"prefer-promise-reject-errors": "warn",
	"prefer-regex-literals": "warn",
	"quote-props": [ "warn", "as-needed" ],
	quotes: [ "warn", "double", { avoidEscape: true } ],
	radix: "warn",
	"rest-spread-spacing": [ "warn", "never" ],
	semi: [ "warn", "always" ],
	"semi-spacing": "warn",
	"semi-style": "warn",
	"sort-imports": [ "warn", { ignoreDeclarationSort: true } ],
	"space-before-blocks": "warn",
	"space-infix-ops": "warn",
	"space-unary-ops": "warn",
	"space-before-function-paren": [ "warn", {
		anonymous: "never",
		named: "never",
	} ],
	"space-in-parens": "warn",
	strict: [ "warn", "never" ],
	"switch-colon-spacing": "warn",
	"symbol-description": "warn",
	"template-curly-spacing": "warn",
	"template-tag-spacing": "warn",
	"yield-star-spacing": "warn",
	yoda: "warn",
	"unicode-bom": [ "warn", "never" ],

	// https://github.com/benmosher/eslint-plugin-import/tree/master/docs/rules
	"import/extensions": [ "warn", "ignorePackages" ],
	"import/first": "warn",
	"import/newline-after-import": "warn",
	"import/no-anonymous-default-export": "warn",
	// Same as `no-duplicate-imports`, but offers an autofix
	"import/no-duplicates": "warn",
	"import/order": [ "warn", {
		alphabetize: {
			order: "asc",
		},
		groups: [
			"type",
			"builtin",
			"external",
			"parent",
			"sibling",
			"index",
		],
		pathGroupsExcludedImportTypes: [ "type" ],
	} ],
};

/** @type {RulesRecord} */
const typeScriptRules = acceptTypeScriptRules({
	// These functions have sufficient type checks
	"array-callback-return": "off",
	// Obviated by ts(2845)
	"use-isnan": "off",

	// Turn down the strictness
	"@typescript-eslint/no-explicit-any": "off",
	"@typescript-eslint/no-non-null-assertion": "off",

	// TypeScript rules which supersede an eslint rule
	"@typescript-eslint/brace-style": [ "warn", "1tbs", { allowSingleLine: true } ],
	"@typescript-eslint/comma-dangle": [ "warn", "always-multiline" ],
	"@typescript-eslint/comma-spacing": "warn",
	"@typescript-eslint/func-call-spacing": "warn",
	// https://github.com/typescript-eslint/typescript-eslint/issues/1824
	"@typescript-eslint/indent": [ "warn", "tab", {
		SwitchCase: 1,
		flatTernaryExpressions: true,
		ignoredNodes: [
			"CallExpression[typeParameters]",
			"TSTypeParameterInstantiation",
		],
	} ],
	"@typescript-eslint/keyword-spacing": "warn",
	"@typescript-eslint/naming-convention": [ "warn", {
		format: [ "PascalCase" ],
		selector: "typeLike",
	} ],
	"@typescript-eslint/no-extra-parens": [ "warn", "all", {
		nestedBinaryExpressions: false,
	} ],
	"@typescript-eslint/no-unused-expressions": [ "warn", {
		allowShortCircuit: true,
		allowTernary: true,
		allowTaggedTemplates: true,
	} ],
	"@typescript-eslint/no-unused-vars": [ "warn", {
		argsIgnorePattern: "^_",
		caughtErrors: "all",
		ignoreRestSiblings: true,
	} ],
	"@typescript-eslint/no-use-before-define": [ "warn", {
		classes: false,
		functions: false,
		variables: false,
	} ],
	"@typescript-eslint/object-curly-spacing": [ "warn", "always" ],
	"@typescript-eslint/quotes": [ "warn", "double", { avoidEscape: true } ],
	"@typescript-eslint/semi": [ "warn", "always" ],
	"@typescript-eslint/space-before-function-paren": [ "warn", {
		anonymous: "never",
		named: "never",
	} ],
	"@typescript-eslint/space-infix-ops": "warn",

	// TypeScript-exclusive
	"@typescript-eslint/array-type": "warn",
	"@typescript-eslint/ban-ts-comment": "off",
	"@typescript-eslint/consistent-generic-constructors": "warn",
	"@typescript-eslint/consistent-indexed-object-style": "warn",
	"@typescript-eslint/consistent-type-assertions": "warn",
	"@typescript-eslint/explicit-member-accessibility": [ "warn", {
		accessibility: "no-public",
		overrides: { parameterProperties: "explicit" },
	} ],
	"@typescript-eslint/explicit-module-boundary-types": "off",
	"@typescript-eslint/lines-between-class-members": [ "warn", "always", { exceptAfterSingleLine: true } ],
	"@typescript-eslint/member-delimiter-style": "warn",
	// nb: This is not simply a style rule, as the recommended style enforces contravariance instead
	// of bivariance.
	// https://github.com/microsoft/TypeScript/pull/18654
	"@typescript-eslint/method-signature-style": "warn",
	"@typescript-eslint/no-confusing-non-null-assertion": "warn",
	"@typescript-eslint/no-duplicate-enum-values": "warn",
	"@typescript-eslint/no-empty-function": "off",
	"@typescript-eslint/no-extraneous-class": "warn",
	"@typescript-eslint/no-invalid-void-type": [ "warn", { allowAsThisParameter: true } ],
	"@typescript-eslint/no-non-null-asserted-nullish-coalescing": "warn",
	"@typescript-eslint/no-useless-constructor": "warn",
	"@typescript-eslint/no-useless-empty-export": "warn",
	"@typescript-eslint/prefer-enum-initializers": "warn",
	"@typescript-eslint/prefer-for-of": "warn",
	"@typescript-eslint/prefer-function-type": "warn",
	"@typescript-eslint/prefer-literal-enum-member": "warn",
	"@typescript-eslint/prefer-ts-expect-error": "warn",
	"@typescript-eslint/type-annotation-spacing": "warn",
	"@typescript-eslint/unified-signatures": "warn",
});

/** @type {RulesRecord} */
const typedTypeScriptRules = acceptTypeScriptRules({
	"@typescript-eslint/no-explicit-any": "off",
	"@typescript-eslint/no-unnecessary-type-assertion": "off",
	"@typescript-eslint/no-unsafe-argument": "off",
	"@typescript-eslint/no-unsafe-assignment": "off",
	"@typescript-eslint/no-unsafe-call": "off",
	"@typescript-eslint/no-unsafe-enum-comparison": "off",
	"@typescript-eslint/no-unsafe-member-access": "off",
	"@typescript-eslint/no-unsafe-return": "off",

	"@typescript-eslint/consistent-type-exports": "warn",
	"@typescript-eslint/dot-notation": "warn",
	"@typescript-eslint/no-base-to-string": "warn",
	"@typescript-eslint/no-confusing-void-expression": [ "warn", {
		ignoreArrowShorthand: true,
		ignoreVoidOperator: true,
	} ],
	"@typescript-eslint/no-duplicate-type-constituents": "warn",
	"@typescript-eslint/no-meaningless-void-operator": "warn",
	// `checksConditionals` - Conditionals are handled by ts(2801)
	"@typescript-eslint/no-misused-promises": [ "warn", { checksConditionals: false } ],
	"@typescript-eslint/no-mixed-enums": "warn",
	"@typescript-eslint/no-redundant-type-constituents": "warn",
	"@typescript-eslint/no-throw-literal": "warn",
	"@typescript-eslint/no-unnecessary-boolean-literal-compare": "warn",
	"@typescript-eslint/no-unnecessary-condition": [ "warn", { allowConstantLoopConditions: true } ],
	"@typescript-eslint/no-unnecessary-qualifier": "warn",
	"@typescript-eslint/no-unnecessary-type-arguments": "warn",
	"@typescript-eslint/non-nullable-type-assertion-style": "warn",
	"@typescript-eslint/prefer-includes": "warn",
	"@typescript-eslint/prefer-optional-chain": "warn",
	"@typescript-eslint/prefer-readonly": "warn",
	"@typescript-eslint/prefer-reduce-type-parameter": "warn",
	"@typescript-eslint/prefer-regexp-exec": "warn",
	"@typescript-eslint/prefer-return-this-type": "warn",
	"@typescript-eslint/prefer-string-starts-ends-with": "warn",
	"@typescript-eslint/require-array-sort-compare": "warn",
	"@typescript-eslint/restrict-template-expressions": [ "warn", {
		allowAny: true,
		allowNever: true,
		allowNullish: true,
		allowNumber: true,
	} ],
	"@typescript-eslint/return-await": "warn",
	"@typescript-eslint/switch-exhaustiveness-check": "warn",
});

// Rules inherited from plugins will be checked against this list. If they do *not* appear in the
// list they will be downgraded from "error" to "warn".
const allowedErrors = [
	"@typescript-eslint/no-redeclare",
	"constructor-super",
	"for-direction",
	"no-async-promise-executor",
	"no-class-assign",
	"no-compare-neg-zero",
	"no-const-assign",
	"no-constructor-return",
	"no-dupe-args",
	"no-dupe-class-members",
	"no-dupe-else-if",
	"no-duplicate-case",
	"no-func-assign",
	"no-import-assign",
	"no-inner-declarations",
	"no-invalid-regexp",
	"no-misleading-character-class",
	"no-nonoctal-decimal-escape",
	"no-obj-calls",
	"no-redeclare",
	"no-template-curly-in-string",
	"no-this-before-super",
	"no-undef",
	"no-unsafe-finally",
	"no-unsafe-negation",
	"unicode-bom",
	"use-isnan",
	"valid-typeof",
];

const jsGlob = [ "**/*.js", "**/*.cjs", "**/*.mjs" ];
const tsGlob = [ "**/*.ts", "**/*.cts", "**/*.mts" ];
const everythingGlob = [ ...jsGlob, ...tsGlob ];

/** @type {FlatConfig[]} */
// eslint-disable-next-line import/no-anonymous-default-export
export default [
	// https://eslint.org/docs/latest/use/configure/configuration-files-new#globally-ignoring-files-with-ignores
	// "If `ignores` is used without any other keys in the configuration object, then the
	// patterns act as global ignores.
	{
		ignores: [
			"**/dist",
			"**/node_modules",
		],
	},

	// Settings
	{
		files: everythingGlob,
		languageOptions: {
			ecmaVersion: "latest",
			globals: globals.node,
			parser: babelParser,
			parserOptions: {
				babelrc: false,
				configFile: false,
				requireConfigFile: false,
				sourceType: "module",
			},
		},
		plugins: {
			import: importPlugin,
		},
	},

	// TypeScript settings
	{
		files: tsGlob,
		plugins: {
			"@typescript-eslint": typeScriptPlugin,
		},
		languageOptions: {
			parser: typeScriptParser,
			parserOptions: {
				project: true,
			},
		},
	},

	// JavaScript rules
	{
		rules: {
			...acceptRecommended(js.configs.recommended.rules),
			...rules,
		},
	},

	// TypeScript rules
	{
		files: tsGlob,
		rules: {
			...acceptRecommended(typeScriptPlugin.configs["eslint-recommended"].overrides[0].rules),
			...acceptRecommended(typeScriptPlugin.configs.recommended.rules),
			...typeScriptRules,
		},
	},
	{
		files: tsGlob,
		ignores: [ "**/*.d.ts" ],
		rules: {
			...acceptRecommended(typeScriptPlugin.configs["eslint-recommended"].overrides[0].rules),
			...acceptRecommended(typeScriptPlugin.configs["recommended-requiring-type-checking"].rules),
			...typeScriptRules,
			...typedTypeScriptRules,
		},
	},
];

/**
 * Downgrade severity of "error" rules unless specified in `errors`.
 * @param {FlatConfig} rules
 * @returns {FlatConfig}
 */
function acceptRecommended(rules) {
	return Object.fromEntries(Object.entries(rules).map(([ name, entry ]) => {
		const select = () => {
			if (typeof entry === "string" || typeof entry === "number") {
				return entry === "error" || entry === 2 ? "warn" : entry;
			} else if (entry[0] === "error" || entry[0] === 2) {
				return [ "warn", ...entry.slice(1) ];
			} else {
				return entry;
			}
		};
		return [ name, allowedErrors.includes(name) ? entry : select() ];
	}));
}

/**
 * Disable built-in rules that are replaced by TypeScript-specific rules.
 * @param {RulesRecord}
 * @returns {RulesRecord}
 */
function acceptTypeScriptRules(rules) {
	const builtInRules = new Set(Object.keys(js.configs.all.rules));
	return Object.fromEntries(Object.entries(rules).flatMap(([ name, entry ]) => {
		const [ , plainName ] = /^@typescript-eslint\/(.+)/.exec(name) ?? [];
		return [
			...plainName !== undefined && builtInRules.has(plainName) ? [ [ plainName, "off" ] ] : [],
			...plainName !== undefined && builtInRules.has(`no-${plainName}`) ? [ [ `no-${plainName}`, "off" ] ] : [],
			[ name, entry ],
		];
	}));
}
