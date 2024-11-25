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

test("only run affected handlers", async () => {
	const main = new TestModule(() =>
		`import {} from ${left};
		import {} from ${right};
		import.meta.hot.accept(${left}, () => {
			globalThis.leftSeen = true;
		});
		import.meta.hot.accept(${right}, () => {
			globalThis.rightSeen = true;
		});`);
	const left: TestModule = new TestModule(() => "");
	const right = new TestModule(() => "");
	await main.dispatch();
	left.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
	expect(main.global.leftSeen).toBe(true);
	expect(main.global.rightSeen).toBe(undefined);
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

test("catch error from accept", async () => {
	const main = new TestModule(() =>
		`import ${child};
		import.meta.hot.accept(${child}, () => {
			globalThis.seen2 = true;
		});`);
	const child = new TestModule(() =>
		`import ${child2};
		import.meta.hot.accept(${child2}, () => {
			globalThis.seen1 = true;
			throw new Error("uh oh");
		})`);
	const child2 = new TestModule(() => "");
	await main.dispatch();
	child2.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
	expect(main.global.seen1).toBe(true);
	expect(main.global.seen2).toBe(true);
});

test("catch error from self-accept", async () => {
	const main = new TestModule(() =>
		`import ${child};
		import.meta.hot.accept(${child});`);
	const child = new TestModule(() =>
		`import.meta.hot.accept(() => {
			throw new Error("uh oh");
		})`);
	await main.dispatch();
	child.update(() => "");
	const result = await main.releaseUpdate();
	expect(result?.type).toBe(UpdateStatus.success);
});
