/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { expect, test } from "@jest/globals";
import { UpdateStatus } from "../runtime/controller.js";
import { TestModule } from "./__fixtures__/module.js";

test("simple test", async () => {
	const main = new TestModule(() =>
		`import { counter } from ${child};
		if (globalThis.seen) {
			expect(counter).toBe(2);
			globalThis.seen2 = true;
		} else {
			expect(counter).toBe(1);
			globalThis.seen = true;
		}
		import.meta.hot.accept();`);
	const child = new TestModule(() =>
		"export const counter = 1;");
	await main.dispatch();
	child.update(() =>
		"export const counter = 2;");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
	expect(main.global.seen2).toBe(true);
});

test("unaccepted should not run", async () => {
	const main = new TestModule(() =>
		`import {} from ${child};
		expect(globalThis.seen).toBe(undefined);
		globalThis.seen = true;`);
	const child = new TestModule(() => "");
	await main.dispatch();
	child.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.unaccepted);
});

test("accepted with unupdated accepted", async () => {
	const main = new TestModule(() =>
		`import {} from ${updated};
		import {} from ${unupdated};
		import.meta.hot.accept([ ${updated}, ${unupdated} ]);
		expect(globalThis.seen).toBe(undefined);
		globalThis.seen = true;`);
	const unupdated = new TestModule(() => "");
	const updated = new TestModule(() => "");
	await main.dispatch();
	updated.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
});

test("unaccepted dynamic should not run", async () => {
	const main = new TestModule(() =>
		`await import(${child});
		expect(globalThis.seen).toBe(undefined);
		globalThis.seen = true;`);
	const child = new TestModule(() => "");
	await main.dispatch();
	child.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.unaccepted);
});

test("accepted dynamic", async () => {
	const main = new TestModule(() =>
		`const { counter } = await import(${child});
		expect(counter).toBe(1);
		expect(globalThis.seen).toBe(undefined);
		globalThis.seen = true;
		import.meta.hot.accept(${child}, async () => {
			const { counter } = await import(${child});
			expect(counter).toBe(2);
			globalThis.seen2 = true;
		});`);
	const child = new TestModule(() => "export const counter = 1;");
	await main.dispatch();
	child.update(() => "export const counter = 2;");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
	expect(main.global.seen2).toBe(true);
});

test("unchanged declined import", async () => {
	const main = new TestModule(() =>
		`import {} from ${accepted};
		import {} from ${declined};
		import.meta.hot.accept(${accepted});`);
	const accepted = new TestModule(() => "");
	const declined = new TestModule(() =>
		"import.meta.hot.decline();");
	await main.dispatch();
	accepted.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
});

test("declined with accept import", async () => {
	const main = new TestModule(() =>
		`import {} from ${declined};`);
	const accepted = new TestModule(() => "");
	const declined = new TestModule(() =>
		`import {} from ${accepted};
		import.meta.hot.accept(${accepted});
		import.meta.hot.decline();`);
	await main.dispatch();
	accepted.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
});

test("errors are recoverable", async () => {
	const main = new TestModule(() =>
		`import { counter } from ${accepted};
		import.meta.hot.accept(${accepted}, () => {
			expect(counter).toBe(3);
			globalThis.seen = true;
		});`);
	const accepted = new TestModule(() =>
		"export const counter = 1;");
	await main.dispatch();
	accepted.update(() =>
		`export const counter = 2;
		throw new Error();`);
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.evaluationFailure);
	accepted.update(() =>
		"export const counter = 3;");
	const result2 = await main.releaseUpdate();
	expect(result2?.type).toBe(UpdateStatus.success);
	expect(main.global.seen).toBe(true);
});

test("errors persist", async () => {
	const main = new TestModule(() =>
		`import {} from ${error};
		import.meta.hot.accept();`);
	const error = new TestModule(() => "");
	await main.dispatch();
	error.update(() =>
		"throw new Error();");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.evaluationFailure);
	main.update();
	const result2 = await main.releaseUpdate();
	expect(result2?.type).toBe(UpdateStatus.evaluationFailure);
	error.update(() => "");
	const result3 = await main.releaseUpdate();
	expect(result3?.type).toBe(UpdateStatus.success);
});

// Caused due to issue in `traverseDepthFirst` result collection
test("common dependency", async () => {
	const main = new TestModule(() =>
		`import {} from ${left};
		import {} from ${right};
		import.meta.hot.accept(${left});`);
	const left = new TestModule(() =>
		`import {} from ${child}`);
	const right = new TestModule(() =>
		`import {} from ${child}`);
	const child = new TestModule(() => "");
	await main.dispatch();
	child.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.unaccepted);
});

// Caused by assumptions that `node.current` would be defined during the update process.
test("new module node should work", async () => {
	const main = new TestModule(() =>
		`import {} from ${child};
		import.meta.hot.accept(${child});`);
	const child = new TestModule(() => "");
	await main.dispatch();
	child.update(() =>
		`import {} from ${newChild}`);
	const newChild = new TestModule(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
});
