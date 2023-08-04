// @ts-check
/** @typedef {import("@jest/types").Config.InitialOptions} InitialOptions */
/** @type {InitialOptions} */
const config = {
	fakeTimers: {
		enableGlobally: true,
	},
	moduleNameMapper: {
		// 29 major semvers and Jest still doesn't fully support ESM or nodejs's package.json
		// resolution algorithm.

		// This issue on module resolution is closed because a user published a broken npm module
		// which doesn't work and no one complained for 30 days so it expired.
		// https://github.com/facebook/jest/issues/9771

		// Also being tracked here:
		// https://github.com/facebook/jest/issues/9430
		// https://github.com/facebook/jest/labels/ES%20Modules

		// They don't support file extensions which are *required* by modern resolution algorithms
		"^(\\..+)\\.js$": "$1",
	},
	testPathIgnorePatterns: [
		"\\/__fixtures__\\/",
		"\\/dist\\/",
		"\\/node_modules\\/",
	],
	testRegex: [
		"\\/__tests__\\/",
	],
	extensionsToTreatAsEsm: [ ".ts" ],
	transform: {
		"\\.m?ts$": [
			"babel-jest", {
				plugins: [
					"babel-plugin-transform-import-meta",
				],
				presets: [
					[ "@babel/preset-env", { targets: { node: "current" } } ],
					"@babel/preset-typescript",
				],
			},
		],
	},
};
export default config;
