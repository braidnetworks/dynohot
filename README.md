[![npm version](https://badgen.now.sh/npm/v/dynohot)](https://www.npmjs.com/package/dynohot)
[![isc license](https://badgen.now.sh/npm/license/dynohot)](https://github.com/braidnetworks/dynohot/blob/main/LICENSE)

dynohot - Hot module reloading for nodejs
=========================================

`dynohot` is a nodejs [loader](https://github.com/nodejs/loaders) which implements hot module
reloading, or HMR. When a module's code is updated, the modules which depend on it are given the
option to accept the update. If an update is accepted then the application can continue running with
new code against existing state.

Other HMR solutions like Webpack and Vite exist, but due to their focus on web browsers it can be
challenging to get them to run server-side apps. With the experimental nodejs loader API you can get
HMR running with a simple `--loader dynohot` flag. You should probably also add
`--enable-source-maps` because dynohot applies a [transformation](#transformation) to your source
code.

Note that your project *must* be using proper [JavaScript
Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules), i.e. `"type":
"module"` should be set in your `package.json`. Imports to CommonJS modules will work fine, but they
will not participate in hot reloading.


EXAMPLE
-------

`main.js`
```js
import { now } from "./now.js";
setInterval(() => console.log(counter), 1000);
import.meta.hot.accept("./now.js");
```

`now.js`
```js
export const now = new Date();
```

```
$ while true; do sleep 1; touch now.js; done &
$ node --no-warnings=ExperimentalWarnings --loader dynohot main.js
[hot] Loaded 1 new module, reevaluated 0 existing modules in 2ms.
2023-08-07T23:49:45.693Z
[hot] Loaded 1 new module, reevaluated 0 existing modules in 2ms.
2023-08-07T23:49:46.700Z
[hot] Loaded 1 new module, reevaluated 0 existing modules in 1ms.
2023-08-07T23:49:47.718Z
[hot] Loaded 1 new module, reevaluated 0 existing modules in 2ms.
2023-08-07T23:49:48.724Z
[hot] Loaded 1 new module, reevaluated 0 existing modules in 3ms.
2023-08-07T23:49:49.736Z
[hot] Loaded 1 new module, reevaluated 0 existing modules in 1ms.
2023-08-07T23:49:50.746Z
^C
```

TYPESCRIPT
----------

If you use TypeScript you can add the following triple-slash directive to a `*.d.ts` file in your
project and `import.meta.hot` will be typed correctly.

```ts
/// <reference types="dynohot/import-meta" />
```

API REFERENCE
-------------

dynohot loosely follows the [esm-hmr](https://github.com/FredKSchott/esm-hmr) and [Vite
HMR](https://vitejs.dev/guide/api-hmr.html) implementations. The main difference is that dynohot
also implements dynamic bindings similar to [WebPack's
HMR](https://webpack.js.org/guides/hot-module-replacement). In addition, dynohot handlers can return
promises [async functions] which will be awaited before continuing the update process. The `Hot`
interface is available on `import.meta.hot` and also `import.meta.dynoHot` in case there are
incompatibilities with another HMR implementation on the same stack.

```ts
type ModuleNamespace = Record<string, unknown>;
export declare class Hot<Data extends Record<keyof any, unknown>> {
    /**
     * This is the `data` object passed to the `dispose` handler of the previous
     * `Hot` instance. You can use this to stash references like an HTTP server
     * or database connection for the next instance of your module.
     */
    readonly data?: Data;

    /**
     * Accept updates for this module. When any unaccepted dependencies are
     * updated this module will be reevaluated without notifying any dependents.
     */
    accept(onUpdate?: (self: ModuleNamespace) => Promise<void> | void): void;

    /**
     * Accept updates for the given import specifier.
     */
    accept(specifier: string, onUpdate?: (dependency: ModuleNamespace) => Promise<void> | void): void;

    /**
     * Accept updates for the given import specifiers.
     */
    accept(specifiers: string[], onUpdate?: (dependencies: ModuleNamespace[]) => Promise<void> | void): void;

    /**
     * Mark this module as not-updatable. If this module needs to be updated
     * then the update will fail.
     */
    decline(): void;

    /**
     * Register a callback which is invoked when this module instance is
     * disposed. The callback receives a parameter `data` which can be used to
     * store arbitrary data. The same `data` object will be passed to the next
     * instance via `import.meta.hot.data`.
     */
    dispose(onDispose: (data: Data) => Promise<void> | void): void;

    /**
     * Mark this module as invalidated. If an update is in progress then this
     * will cancel a self-accept. If an update is not in progress then one will
     * be scheduled.
     */
    invalidate(): void;

    /**
     * Similar to `dispose`, but this is invoked when the module is removed from
     * the dependency graph entirely.
     */
    prune(onPrune: () => Promise<void> | void): void;
}
```


PATTERNS
--------

Pass forward a database connection:
```js
import { createClient } from "redis";

export const client = import.meta.hot?.data?.client ?? await async function() {
    const client = createClient();
    await client.connect();
    return client;
}();

import.meta.hot?.dispose(data => {
    data.client = client;
});
```


Invalidate module based on external events:
```js
import fs from "node:fs";
import fsPromises from "node:fs/promises";

export const payload = await fsPromises.readFile("payload.bin");
if (import.meta.hot) {
    const watcher = fs.watch("payload.bin", () => {
        import.meta.hot.invalidate();
        watcher.close();
    });
}
```


Well-typed `data` parameter [TypeScript]:
```ts
import type { Hot } from "dynohot";
import type { Server } from "node:http";
import { createServer } from "node:http";

const hot: Hot<{ server?: Server }> | undefined = import.meta.hot;
const server = hot?.data?.server ?? createServer();
hot?.dispose(data => {
    data.server = server;
});
```


TRANSFORMATION
--------------

dynohot runs static analysis and a transformation on your code before executing it. This is required
to implement live bindings, and to determine the dependencies of a module. Source maps are also
transformed and passed along, so the `--enable-source-maps` nodejs flag is recommended.

An example of the transformation follows:

`main.js`
```js
import { symbol } from "./symbol";
export const name = "hello world";
console.log(symbol);
```

```js
import { acquire } from "hot:runtime";
import _symbol from "hot:module?specifier=./symbol";
function* execute() {
    let _$ = yield [ next => { _$ = next; }, {
        name: () => name,
    } ];
    const name = "hello world";
    console.log(_$.symbol());
}
module().load({ async: false, execute }, null, false, {}, [ {
    controller: _symbol,
    specifier: "./symbol",
    bindings: [ {
        type: "import",
        name: "symbol"
    } ],
} ]);
export default function module() { return acquire("./main.js") }
```

The module body is wrapped in a generator function which lets us re-execute the same module multiple
times without needing to parse and load a new module each time. A `yield` preamble passes out
accessor functions for all exported symbols so we can open a scope against a module without actually
executing it. This trick ensures that ["access before
initialization"](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Cant_access_lexical_declaration_before_init)
semantics are well-preserved. Access to imported values goes through a holder which can be swapped
out using the yielded rebind function. Finally, metadata is passed along to runtime functions which
handle export binding. The JavaScript module linking algorithm is implemented to specification in
the runtime, with additional handling for rebinding existing imports.
