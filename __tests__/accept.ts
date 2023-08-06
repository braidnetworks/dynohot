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
	await child.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
});
