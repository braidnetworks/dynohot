export * as default from "./functional.js";

/**
 * Predicate function which returns a loose boolean value
 * @internal
 */
export type Predicate<Type> = (value: Type) => Maybe<AnyObject | true>;

/**
 * Predicate function which attests a given a type
 * @internal
 */
export type PredicateAs<Type, As extends Type = Type> = (value: Type) => value is As;

/**
 * Returns a new predicate which expresses if *any* of the given predicates are true.
 * @internal
 */
export function somePredicate<Type>(predicates: Iterable<Predicate<Type>>): Predicate<Type>;
/** @internal */
export function somePredicate<Type, As extends Type = Type>(predicates: Iterable<PredicateAs<Type, As>>): PredicateAs<Type, As>;
export function somePredicate(predicates: Iterable<Predicate<unknown> | PredicateAs<unknown>>) {
	const { head, rest } = shift(predicates);
	return reduce(
		rest,
		head ?? (() => false),
		// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		(predicate, next) => value => predicate(value) || next(value));
}

/**
 * Iterate each item from an iterable of iterables.
 * @internal
 */
// TypeScript can't figure out the types on these so extra hints are needed.
export function concat<Type>(iterator: Iterable<Type>[]): IterableIterator<Type>;
/** @internal */
// eslint-disable-next-line @typescript-eslint/unified-signatures
export function concat<Type>(iterator: IterableIterator<Iterable<Type>>): IterableIterator<Type>;
/** @internal */
// eslint-disable-next-line @typescript-eslint/unified-signatures
export function concat<Type>(iterator: Iterable<Iterable<Type>>): IterableIterator<Type>;

/**
 * Iterate each item in a statically supplied argument vector of iterables.
 * @internal
 */
export function concat<Type>(...args: Iterable<Type>[]): IterableIterator<Type>;

export function *concat(...args: any[]) {
	for (const iterable of args.length === 1 ? args[0] : args) {
		for (const value of iterable) {
			yield value;
		}
	}
}

/**
 * Remove all non-truthy elements from a type
 * @internal
 */
export type Truthy<Type> = Type extends Maybe<void> ? never : Type;

const truthy: <Type>(value: Type) => value is Truthy<Type> = Boolean as never;

/**
 * Iterates the iterable, and emits only truthy elements.
 * @internal
 */
export function filter<Type>(iterable: Iterable<Type>): IterableIterator<Truthy<Type>>;

/**
 * Iterates the iterable, emitting only elements which pass the predicate. You can use the type
 * guard to affect the type of the resulting iterator.
 * @internal
 */
export function filter<Type, Filter extends Type>(
	iterable: Iterable<Type>, predicate: (value: Type) => value is Filter
): IterableIterator<Filter>;

/**
 * Iterates the iterable, emitting only elements which pass the predicate.
 * @internal
 */
export function filter<Type>(
	iterable: Iterable<Type>, predicate: Predicate<Type>
): IterableIterator<Type>;

export function *filter(iterable: Iterable<unknown>, predicate: Predicate<unknown> = truthy) {
	for (const value of iterable) {
		// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		if (predicate(value)) {
			yield value;
		}
	}
}

/**
 * Intersperses `separator` between every element of an iterable.
 */
export function *intersperse<Type, Separator>(iterable: Iterable<Type>, separator: Separator): IterableIterator<Type | Separator> {
	let first = true;
	for (const value of iterable) {
		if (first) {
			first = false;
		} else {
			yield separator;
		}
		yield value;
	}
}

/**
 * Eagerly folds the iterable, joining the results with the given separator.
 */
export function join(iterable: Iterable<string>, separator = "") {
	return reduce(intersperse(iterable, separator), "", (accumulator, fragment) => `${accumulator}${fragment}`);
}

/**
 * Applies a given function to an iterable.
 * @internal
 */
export function *map<Type, Result>(
	iterable: Iterable<Type>,
	callback: (value: Type) => Result,
): IterableIterator<Result> {
	for (const value of iterable) {
		yield callback(value);
	}
}

/**
 * Applies a given async function to an iterable, and returns a promise to an array of the results.
 * @internal
 */
export function mapAwait<Type, Result>(
	iterable: Iterable<Type>,
	callback: (value: Type) => Result | PromiseLike<Result>,
): Promise<Result[]> {
	return Promise.all(map(iterable, callback));
}

/**
 * The pipeline operator is stuck in specification hell so this works as a replacement to unfold
 * sequential operations.
 * https://github.com/tc39/proposal-pipeline-operator/blob/main/HISTORY.md
 */

// If you want to add more overloads then here's the golf:
// console.log(Array(12).fill().map((_, ii) => Array(ii + 1).fill().map((_, ii) => ii)).map(tt =>
// `export function pipe<T0, ${tt.map(ii => `T${ii + 1}`).join(', ')}>(vv: T0, ${tt.map(ii => `fn${ii}: (vv: T${ii}) => T${ii + 1}`).join(', ')}): T${tt.length};`
// ).join('\n'));
export function pipe<T0, T1>(vv: T0, fn0: (vv: T0) => T1): T1;
export function pipe<T0, T1, T2>(vv: T0, fn0: (vv: T0) => T1, fn1: (vv: T1) => T2): T2;
export function pipe<T0, T1, T2, T3>(vv: T0, fn0: (vv: T0) => T1, fn1: (vv: T1) => T2, fn2: (vv: T2) => T3): T3;
export function pipe<T0, T1, T2, T3, T4>(vv: T0, fn0: (vv: T0) => T1, fn1: (vv: T1) => T2, fn2: (vv: T2) => T3, fn3: (vv: T3) => T4): T4;
export function pipe<T0, T1, T2, T3, T4, T5>(vv: T0, fn0: (vv: T0) => T1, fn1: (vv: T1) => T2, fn2: (vv: T2) => T3, fn3: (vv: T3) => T4, fn4: (vv: T4) => T5): T5;
export function pipe<T0, T1, T2, T3, T4, T5, T6>(vv: T0, fn0: (vv: T0) => T1, fn1: (vv: T1) => T2, fn2: (vv: T2) => T3, fn3: (vv: T3) => T4, fn4: (vv: T4) => T5, fn5: (vv: T5) => T6): T6;
export function pipe<T0, T1, T2, T3, T4, T5, T6, T7>(vv: T0, fn0: (vv: T0) => T1, fn1: (vv: T1) => T2, fn2: (vv: T2) => T3, fn3: (vv: T3) => T4, fn4: (vv: T4) => T5, fn5: (vv: T5) => T6, fn6: (vv: T6) => T7): T7;
export function pipe<T0, T1, T2, T3, T4, T5, T6, T7, T8>(vv: T0, fn0: (vv: T0) => T1, fn1: (vv: T1) => T2, fn2: (vv: T2) => T3, fn3: (vv: T3) => T4, fn4: (vv: T4) => T5, fn5: (vv: T5) => T6, fn6: (vv: T6) => T7, fn7: (vv: T7) => T8): T8;
export function pipe<T0, T1, T2, T3, T4, T5, T6, T7, T8, T9>(vv: T0, fn0: (vv: T0) => T1, fn1: (vv: T1) => T2, fn2: (vv: T2) => T3, fn3: (vv: T3) => T4, fn4: (vv: T4) => T5, fn5: (vv: T5) => T6, fn6: (vv: T6) => T7, fn7: (vv: T7) => T8, fn8: (vv: T8) => T9): T9;
export function pipe<T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10>(vv: T0, fn0: (vv: T0) => T1, fn1: (vv: T1) => T2, fn2: (vv: T2) => T3, fn3: (vv: T3) => T4, fn4: (vv: T4) => T5, fn5: (vv: T5) => T6, fn6: (vv: T6) => T7, fn7: (vv: T7) => T8, fn8: (vv: T8) => T9, fn9: (vv: T9) => T10): T10;
export function pipe<T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11>(vv: T0, fn0: (vv: T0) => T1, fn1: (vv: T1) => T2, fn2: (vv: T2) => T3, fn3: (vv: T3) => T4, fn4: (vv: T4) => T5, fn5: (vv: T5) => T6, fn6: (vv: T6) => T7, fn7: (vv: T7) => T8, fn8: (vv: T8) => T9, fn9: (vv: T9) => T10, fn10: (vv: T10) => T11): T11;
export function pipe<T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12>(vv: T0, fn0: (vv: T0) => T1, fn1: (vv: T1) => T2, fn2: (vv: T2) => T3, fn3: (vv: T3) => T4, fn4: (vv: T4) => T5, fn5: (vv: T5) => T6, fn6: (vv: T6) => T7, fn7: (vv: T7) => T8, fn8: (vv: T8) => T9, fn9: (vv: T9) => T10, fn10: (vv: T10) => T11, fn11: (vv: T11) => T12): T12;
export function pipe(vv: unknown, ...fns: ((vv: unknown) => unknown)[]) {
	return fns.reduce((vv, fn) => fn(vv), vv);
}

/**
 * Eagerly iterates the given iterable, invoking the reducer for each element in the iterable.
 * Uses the previous result as the first parameter and the current value as the second.
 * @internal
 */
export function reduce<Type, Result = Type>(
	iterable: Iterable<Type>,
	initial: Result,
	reducer: (accumulator: Result, value: Type) => Result,
) {
	let result = initial;
	for (const value of iterable) {
		result = reducer(result, value);
	}
	return result;
}

/**
 * Iterates an array in reverse without modifying the original array.
 * @internal
 */
export function *reverse<Type>(array: readonly Type[]): IterableIterator<Type> {
	for (let ii = array.length - 1; ii >= 0; --ii) {
		yield array[ii]!;
	}
}

/**
 * Returns the first element from an iterable, as well as another iterable that will continue after
 * the shifted element.
 * @internal
 */
export function shift<Type>(iterable: Iterable<Type>) {
	const iterator = iterable[Symbol.iterator]();
	const { done, value } = iterator.next();
	const rest: Iterable<Type> = {
		[Symbol.iterator]() {
			return iterator;
		},
	};
	return {
		head: done ? undefined : value as Type,
		rest,
	};
}

/**
 * Returns `true` if the predicate is truthy for any element, otherwise `false`. Eagerly iterates
 * the whole iterable until a truthy value is found.
 * @internal
 */
export function some(iterable: Iterable<Maybe<boolean | AnyObject>>): boolean;
/** @internal */
export function some<Type>(iterable: Iterable<Type>, predicate: (value: Type) => Maybe<boolean | AnyObject>): boolean;
export function some(iterable: Iterable<unknown>, predicate = (value: unknown) => value) {
	for (const value of iterable) {
		if (predicate(value)) {
			return true;
		}
	}
	return false;
}

/**
 * Similar to `map` except the mapper returns an iterable which delegates to the result.
 * @internal
 */
export function *transform<Type, Result>(
	iterable: Iterable<Type>,
	callback: (value: Type) => Iterable<Result>,
): IterableIterator<Result> {
	for (const value of iterable) {
		yield* callback(value);
	}
}

/**
 * Comparator for two values. If the values are equal it must return 0, if `left` is less than
 * `right` then it must return a value less than 0, and otherwise it returns a value greater than 0.
 * @internal
 */
export type Comparator<Type> = (left: Type, right: Type) => number;

type PrimitiveComparable = bigint | boolean | string;

/**
 * A comparator which can be used mainly for strings, but also bigint / booleans if you feel the
 * need for that kind of thing. You could use it for numbers too, but that's better suited to
 * `numericComparator` so the types don't permit it in that case.
 * @internal
*/
export function primitiveComparator<Type extends PrimitiveComparable>(left: Type, right: Type) {
	return left < right ? -1 : left === right ? 0 : 1;
}

/**
 * Comparator for numeric types.
 * @internal
 */
export function numericComparator(left: number, right: number) {
	return left - right;
}

/**
 * Creates a comparator from a mapping function and a comparator.
 * @internal
 */
export function mappedComparator<Type, Result>(comparator: Comparator<Result>, map: (value: Type) => Result): Comparator<Type> {
	return (left, right) => comparator(map(left), map(right));
}

/** @internal */
export function mappedNumericComparator<Type>(map: (value: Type) => number) {
	return mappedComparator(numericComparator, map);
}

/** @internal */
export function mappedPrimitiveComparator<Type>(map: (value: Type) => PrimitiveComparable) {
	return mappedComparator(primitiveComparator, map);
}
