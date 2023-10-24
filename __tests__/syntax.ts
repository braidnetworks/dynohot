import { SourceTextModule } from "node:vm";
import { expect, test } from "@jest/globals";
import { transformModuleSource } from "../loader/transform.js";

test("supports `using`", () => {
	expect(() => transformModuleSource("test.js", {}, "using foo = {}", null)).not.toThrow();
});

test("supports export { value as 'string literal' }", () => {
	const transformed = transformModuleSource("test.js", {}, "const value = 0; export { value as 'string literal' };", null);
	expect(() => new SourceTextModule(transformed)).not.toThrow();
});
