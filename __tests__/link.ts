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

// Caused by a misreading of "16.2.1.5.3.1 InnerModuleEvaluation -> 16.b.i"
test("circular evaluation order", async () => {
	const main: TestModule = new TestModule(() =>
		`import {} from ${first};
		import {} from ${second};
		globalThis.order += ";main";
		expect(globalThis.order).toBe("undefined;main");`);
	const first = new TestModule(() =>
		`import {} from ${main};
		globalThis.order += ";first";
		expect(globalThis.order).toBe("undefined;main;first");`);
	const second = new TestModule(() =>
		`import {} from ${first};
		globalThis.order += ";second";
		expect(globalThis.order).toBe("undefined;main;first;second");`);
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
	child.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.linkError);
	main.update(() => `import {} from ${child};`);
	const result2 = await main.releaseUpdate();
	expect(result2?.type).toBe(UpdateStatus.success);
});

// I never got around to implementing the cyclic aggregate prevention clauses of the specification.
test("infinite re-export", async () => {
	const main = new TestModule(() =>
		`import { symbol } from ${child};
		import.meta.hot.accept();`);
	const child: TestModule = new TestModule(() =>
		`export * from ${child};`);
	await expect(main.dispatch()).rejects.toThrowError(SyntaxError);
});

test("circular indirect export", async () => {
	const main = new TestModule(() =>
		`import { name, indirect } from ${circular};`);
	const circular: TestModule = new TestModule(() =>
		`export { name as indirect } from ${circular};
		export const name = null;`);
	await main.dispatch();
});

// Babel checks this for us
test("duplicate named export", async () => {
	const main = new TestModule(() =>
		`export const name = 1;
		export const name = 2`);
	await expect(main.dispatch()).rejects.toThrowError(SyntaxError);
});

// Caused by combining the link + evaluation phases into a single yield
test("hoisted functions run correctly", async () => {
	const main: TestModule = new TestModule(() =>
		`import { value } from ${child};
		export function hoisted() { value; }`);
	const child = new TestModule(() =>
		`import { hoisted } from ${main};
		export const value = 1;
		hoisted();`);
	await main.dispatch();
});

test("concurrent cyclic top-level await", async () => {
	const main = new TestModule(() =>
		`import {} from ${left};
		import {} from ${right};
		import.meta.hot.accept();`);
	const left: TestModule = new TestModule(() =>
		`import { async } from ${async};
		import {} from ${right};
		await async();`);
	const right: TestModule = new TestModule(() =>
		`import { async } from ${async};
		import {} from ${left};
		await async();`);
	const async = new TestModule(() =>
		`let resolve;
		let ii = 0;
		const promise = new Promise(fulfill => resolve = fulfill);
		export function async() {
			if (++ii === 2) {
				resolve();
			}
			return promise;
		}`);
	await main.dispatch();
	async.update();
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
});

// Caused by incorrect optimization of `resolveSet`
test("exported named module namespace", async () => {
	const main = new TestModule(() =>
		`import { ns } from ${nsExport};`);
	const nsExport = new TestModule(() =>
		`export * as ns from ${indirectExport}`);
	const indirectExport = new TestModule(() =>
		`export { name } from ${child}`);
	const child = new TestModule(() =>
		"export const name = null;");
	await main.dispatch();
});
