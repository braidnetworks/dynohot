/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { expect, test } from "@jest/globals";
import { UpdateStatus } from "../runtime/controller.js";
import { TestModule } from "./__fixtures__/module.js";

test("removing module node should work", async () => {
	const main = new TestModule(() =>
		`import {} from ${child};
		import.meta.hot.accept(${child});`);
	const child = new TestModule(() =>
		`import {} from ${previousChild}`);
	const previousChild = new TestModule(() =>
		"import.meta.hot.prune(() => globalThis.seen = true);");
	await main.dispatch();
	child.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
	expect(main.global.seen).toBe(true);
});

test("dispose and prune runs together", async () => {
	const main = new TestModule(() =>
		`import ${child};
		import.meta.hot.accept();`);
	const child = new TestModule(() =>
		`globalThis.seen = 0;
		import.meta.hot.dispose(() => {
			expect(++seen).toBe(4);
		});
		import.meta.hot.prune(() => {
			expect(++seen).toBe(3);
		});
		import.meta.hot.dispose(() => {
			expect(++seen).toBe(2);
		});
		import.meta.hot.prune(() => {
			expect(++seen).toBe(1);
		});`);
	await main.dispatch();
	main.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
	expect(main.global.seen).toBe(4);
});
