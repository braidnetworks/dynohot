/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { expect, test } from "@jest/globals";
import { UpdateStatus } from "../runtime/controller.js";
import { TestModule } from "./__fixtures__/module.js";

test("dynamic import with error throws", async () => {
	const main = new TestModule(() =>
		`const module = await import(${error});`);
	const error = new TestModule(() =>
		"throw new Error()");
	await expect(main.dispatch()).rejects.toThrow();
});

test("lazy dynamic import with error is recoverable", async () => {
	const main = new TestModule(() =>
		`const module = import(${error});
		await module.catch(() => {});
		import.meta.hot.accept(${error});`);
	const error = new TestModule(() =>
		"throw new Error()");
	await main.dispatch();
	error.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
});
