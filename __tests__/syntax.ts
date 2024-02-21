import { SourceTextModule } from "node:vm";
import { test } from "@jest/globals";
import { transformModuleSource } from "../loader/transform.js";

function transform(source: string) {
	return transformModuleSource("test.js", {}, source, null);
}

function parses(source: string) {
	const transformed = transform(source);
	// eslint-disable-next-line no-new
	new SourceTextModule(transformed);
}

test("supports `using`", () => {
	transform("using foo = {}");
});

test("supports export { value as 'string literal' }", () => {
	parses("const value = 0; export { value as 'string literal' };");
});

// Caused by broken specifier-to-identifier expression
test("string literal imports don't collide", () => {
	parses(
		`import dash1 from '-';
		import dash2 from '-';
		import bang from '!';`);
});
