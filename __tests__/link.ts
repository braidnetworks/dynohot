/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { expect, test } from "@jest/globals";
import { UpdateStatus } from "dynohot/runtime/controller";
import { TestModule } from "./__fixtures__/module.js";

test("as default", async () => {
	const main = new TestModule(() =>
		`import name from ${child};
		expect(name).toBe("child");`);
	const child = new TestModule(() =>
		`const name = "child";
		export { name as default };`);
	await main.dispatch();
});

// Caused due to invalid `relink` testing in the evaluation phase. We were relinking the module's
// previous body to try `accept` handlers which would cause a link error.
test("link error is recoverable from parent", async () => {
	const main = new TestModule(() =>
		`import { symbol } from ${child};
		import.meta.hot.accept();`);
	const child = new TestModule(() =>
		"export const symbol = null;");
	await main.dispatch();
	await child.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.linkError);
	await main.update(() => `import {} from ${child};`);
	const result2 = await main.releaseUpdate();
	expect(result2?.type).toBe(UpdateStatus.success);
});
