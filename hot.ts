/* eslint-disable @typescript-eslint/no-useless-empty-export */
/* eslint-disable @typescript-eslint/prefer-readonly */
/* eslint-disable @stylistic/indent */
type ModuleNamespace = Record<string, unknown>;
export declare class Hot<Data extends Record<keyof any, unknown> = Record<keyof any, unknown>> {
    #private;
    /**
     * This is the `data` object passed to the `dispose` handler of the previous `Hot` instance.
     * You can use this to stash references like an HTTP server or database connection for the
     * next instance of your module.
     */
    readonly data?: Data | undefined;
    constructor(module: unknown, instance: unknown, usesDynamicImport: boolean, data?: Data);
    /**
     * Accept updates for this module. When any unaccepted dependencies are updated this module will
     * be reevaluated without notifying any dependents.
     */
    accept(onUpdate?: (self: ModuleNamespace) => Promise<void> | void): void;
    /**
     * Accept updates for the given import specifier.
     */
    accept(specifier: string, onUpdate?: (dependency: ModuleNamespace) => Promise<void> | void): void;
    /**
     * Accept updates for the given import specifiers.
     */
    accept<const Specifiers extends readonly string[]>(specifiers: Specifiers, onUpdate?: (dependencies: {
        [Specifier in keyof Specifiers]: ModuleNamespace;
    }) => Promise<void> | void): void;
    /**
     * Mark this module as not-updatable. If this module needs to be updated then the update will
     * fail.
     */
    decline(): void;
    /**
     * Register a callback which is invoked when this module instance is disposed. The callback
     * receives a parameter `data` which can be used to store arbitrary data. The same `data` object
     * will be passed to the next instance via `import.meta.hot.data`.
     */
    dispose(onDispose: (data: Data) => Promise<void> | void): void;
    /**
     * Mark this module as invalidated. If an update is in progress then this will cancel a
     * self-accept. If an update is not in progress then one will be scheduled.
     */
    invalidate(): void;
    /**
     * Similar to `dispose`, but this is invoked when the module is removed from the dependency
     * graph entirely.
     */
    prune(onPrune: () => Promise<void> | void): void;
    /**
     * Listen for informative messages which are sent to `console`.
     */
    on(event: "message", callback: (message: string, ...params: unknown[]) => void): () => void;
}
export {};
