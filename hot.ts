/* eslint-disable @typescript-eslint/method-signature-style */
type Data = Record<keyof any, any>;
type ModuleNamespace = Record<string, unknown>;
export interface Hot {
	readonly data?: Data | undefined;
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
	prune(callback: () => Promise<void> | void): void;
}
