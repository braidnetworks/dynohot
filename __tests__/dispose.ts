import { expect, test } from "@jest/globals";
import { UpdateStatus } from "../runtime/controller.js";
import { TestModule } from "./__fixtures__/module.js";

test("dispose handlers should run bottom up", async () => {
	const main = new TestModule(() =>
		`let seen = false;
		import.meta.hot.accept();
		import.meta.hot.dispose(() => {
			expect(seen).toBe(true);
		});
		import.meta.hot.dispose(() => {
			seen = true;
		});`);
	await main.dispatch();
	await main.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
});

test("dispose handlers should run even if invalidated", async () => {
	const main = new TestModule(() =>
		`import.meta.hot.accept(() => {
			import.meta.hot.invalidate();
		});
		import.meta.hot.dispose(() => {
			globalThis.seen = true;
		});`);
	await main.dispatch();
	await main.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
	expect(main.global.seen).toBe(true);
});
