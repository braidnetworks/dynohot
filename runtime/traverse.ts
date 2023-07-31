import assert from "node:assert/strict";

/** @internal */
export interface TraverseCyclicState {
	readonly index: number;
	ancestorIndex: number;
	completion: MaybePromise<void>;
	joined: boolean;
}

let lock = false;
let visitation = 0;

/** @internal */
export function traverseBreadthFirst<
	Node extends { visitation: number },
	Completion extends MaybePromise<void>,
>(
	node: Node,
	children: (node: Node) => Iterable<Node>,
	visit: (node: Node) => Completion,
): Completion {
	const inner = (node: Node, previousCompletion?: MaybePromise<void>) => {
		node.visitation = current;
		const nodes = Array.from(children(node));
		const completion = previousCompletion === undefined ? visit(node) : previousCompletion.then(() => visit(node));
		const pending: Promise<unknown>[] = [];
		for (const child of nodes) {
			if (child.visitation !== current) {
				const nextCompletion = inner(child, completion);
				if (nextCompletion) {
					pending.push(nextCompletion);
				}
			}
		}
		if (pending.length === 0) {
			return completion;
		} else {
			return Promise.all(pending);
		}
	};
	assert(!lock);
	lock = true;
	const current = ++visitation;
	const completion = inner(node);
	lock = false;
	return completion as Completion;
}

/**
 * This is a generalized version of the depth-first algorithm in `16.2.1.5.2 Link()` and
 * `16.2.1.5.3 Evaluate()`. I'm not actually sure the async semantics are identical, though.
 * @internal
 */
export function traverseDepthFirst<
	Node extends { traversalState: TraverseCyclicState | undefined },
	Completion extends MaybePromise<void>,
>(
	root: Node,
	children: (node: Node) => Iterable<Node>,
	handler: ((node: Node) => Completion) | {
		dispatch?: (node: Node) => Completion;
		join?: (cycleRoot: Node, cycleNodes: readonly Node[]) => Completion;
	},
): Completion {
	const inner = (node: Node): TraverseCyclicState => {
		assert(node.traversalState === undefined);
		const state: TraverseCyclicState = node.traversalState = {
			index,
			ancestorIndex: index,
			completion: undefined,
			joined: false,
		};
		++index;
		everyNode.push(node);
		stack.push(node);
		const pending: Promise<void>[] = [];
		for (const child of children(node)) {
			const childState = child.traversalState === undefined ? inner(child) : child.traversalState;
			if (childState.completion !== undefined) {
				pending.push(childState.completion);
			}
			if (!childState.joined) {
				state.ancestorIndex = Math.min(state.ancestorIndex, childState.ancestorIndex);
			}
		}
		if (pending.length === 0) {
			state.completion = dispatch?.(node);
		} else {
			state.completion = Promise.all(pending).then(() => dispatch?.(node));
		}
		const stackIndex = stack.indexOf(node);
		assert(state.ancestorIndex <= state.index);
		assert.notStrictEqual(stackIndex, -1);
		if (state.ancestorIndex === state.index) {
			const cycleNodes = stack.splice(stackIndex);
			state.joined = true;
			for (const node of cycleNodes) {
				assert(node.traversalState !== undefined);
				node.traversalState.joined = true;
			}
			if (join) {
				cycleNodes.shift();
				if (state.completion === undefined) {
					state.completion = join(node, cycleNodes);
				} else {
					state.completion = state.completion.then(() => join(node, cycleNodes));
				}
			}
		}
		return state;
	};

	const { dispatch, join } = function() {
		if (typeof handler === "function") {
			return {
				dispatch: handler,
				join: undefined,
			};
		} else {
			return handler;
		}
	}();

	assert(!lock);
	lock = true;
	let index = 0;
	const everyNode: Node[] = [];
	const stack: Node[] = [];
	try {
		return inner(root).completion as Completion;
	} finally {
		for (const node of everyNode) {
			node.traversalState = undefined;
		}
		lock = false;
	}
}
