/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { test } from "@jest/globals";
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
