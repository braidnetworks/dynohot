/**
 * Use this instead of `{}` or `object` if what you want is any non-null object. It should be
 * equivalent in meaning to those types.
 * https://github.com/typescript-eslint/typescript-eslint/issues/2063#issuecomment-675156492
 */
type AnyObject = Partial<Record<keyof any, unknown>>;

type Maybe<Type = null> = Type | undefined | null | false | "" | 0;
type MaybePromise<Type> = Type | Promise<Type>;
type MaybePromiseLike<Type> = Type | PromiseLike<Type>;
