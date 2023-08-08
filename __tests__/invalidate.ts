import { expect, test } from "@jest/globals";
import { UpdateStatus } from "../runtime/controller.js";
import { TestModule } from "./__fixtures__/module.js";

// Caused by a missing call to `isInvalidated`
test("invalidate should work", async () => {
	const main = new TestModule(() =>
		`import.meta.hot.accept();
		globalThis.invalidate = () => import.meta.hot.invalidate();`);
	await main.dispatch();
	main.global.invalidate();
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
});
