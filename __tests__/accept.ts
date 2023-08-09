/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { expect, test } from "@jest/globals";
import { UpdateStatus } from "../runtime/controller.js";
import { TestModule } from "./__fixtures__/module.js";

test("accept handlers should run top down", async () => {
	const main = new TestModule(() =>
		`import {} from ${child};
		let seen = false;
		import.meta.hot.accept(${child}, () => {
			seen = true;
		});
		import.meta.hot.accept(${child}, () => {
			expect(seen).toBe(true);
		});`);
	const child = new TestModule(() => "");
	await main.dispatch();
	child.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
});

test("should be able to accept a cycle root", async () => {
	const main = new TestModule(() =>
		`import {} from ${left};
		import.meta.hot.accept(${left});`);
	const left: TestModule = new TestModule(() =>
		`import {} from ${right};`);
	const right = new TestModule(() =>
		`import {} from ${left};`);
	await main.dispatch();
	right.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
});
