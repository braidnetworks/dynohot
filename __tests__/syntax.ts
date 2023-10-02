import { expect, test } from "@jest/globals";
import { transformModuleSource } from "../loader/transform.js";

test("supports `using`", () => {
	expect(() => transformModuleSource("test.js", {}, "using foo = {}", null)).not.toThrow();
});
