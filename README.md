[![npm version](https://badgen.now.sh/npm/v/dynohot)](https://www.npmjs.com/package/dynohot)
[![isc license](https://badgen.now.sh/npm/license/dynohot)](https://github.com/braidnetworks/dynohot/blob/main/LICENSE)

🔥 dynohot - Hot module reloading for nodejs
============================================

`dynohot` is a nodejs [loader](https://github.com/nodejs/loaders) which implements hot module
reloading, or HMR. When a module's code is updated, the modules which depend on it are given the
option to accept the update. If an update is accepted then the application can continue running with
new code against existing state.

Other HMR solutions like Webpack and Vite exist, but due to their focus on web browsers it can be
challenging to get them to run server-side apps. With the experimental nodejs loader API you can get
HMR running with a simple `--loader dynohot` [or `--import dynohot/register`] flag. You should
probably also add `--enable-source-maps` because dynohot applies a [transformation](#transformation)
to your source code.

Note that your project *must* be using proper [JavaScript
Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules), i.e. `"type":
"module"` should be set in your `package.json`. Imports to CommonJS modules will work fine, but they
will not participate in hot reloading.


EXAMPLE
-------

`main.js`
```js
import { now } from "./now.js";
setInterval(() => console.log(now), 1000);
import.meta.hot.accept("./now.js");
```

`now.js`
```js
export const now = new Date();
```

```
$ while true; do sleep 1; touch now.js; done &

$ node --import dynohot/register main.js
[hot] Loaded 1 new module, reevaluated 0 existing modules in 2ms.
2023-08-07T23:49:45.693Z
[hot] Loaded 1 new module, reevaluated 0 existing modules in 2ms.
2023-08-07T23:49:46.700Z
[hot] Loaded 1 new module, reevaluated 0 existing modules in 1ms.
2023-08-07T23:49:47.718Z  // <-- 🔥 Look the timestamp is changing
[hot] Loaded 1 new module, reevaluated 0 existing modules in 2ms.
2023-08-07T23:49:48.724Z
[hot] Loaded 1 new module, reevaluated 0 existing modules in 3ms.
2023-08-07T23:49:49.736Z
[hot] Loaded 1 new module, reevaluated 0 existing modules in 1ms.
2023-08-07T23:49:50.746Z
^C
```


GETTING STARTED
---------------

Probably your service has a file called `main.js` or whatever that starts an HTTP server. The
easiest way to enable hot reloading is to add a call to `import.meta.hot.accept` in this "top"
module. So your file would look something like this:

```js
import { createServer } from "node:http";
import { someMiddlewareProvider } from "./the-rest-of-your-app.js";

const server = createServer();
server.on("request", someMiddlewareProvider);

server.listen(8000);

// 🔥 This is what you have to do. This is "self accepting".
import.meta.hot?.accept(() => {
    server.close();
});
```

When a file in the import graph is updated, that change will traverse back down the module graph and
eventually reach the main module, which accepts itself. The `accept` handler is basically
instructions on how to clean up after itself. You need to close the old HTTP server because
otherwise if the module reevaluates then it will fail when it tries to call `listen()`.

How is this better than something like `nodemon`? Well, you could compare nodemon to a bomb and
dynohot to a scalpel. Imagine all the files and modules in your application as a tree, or a directed
graph if you're into that kind of thing. At the root of the graph is `main.js`, the file that you're
running. Then the leaf nodes of that graph are all the files that don't import anything, they just
export. When you update a file's content anywhere in that graph you trace downwards towards the root
module, and all the modules that you touched along the way need to be reevaluated. The interesting
thing is that all the "child" and "cousin" modules haven't actually been changed, so there's no need
to reevaluate them.

What that means is that you can restart only the parts of your application that have changed,
without having to restart nodejs. It's just so much faster, you really have to try it.

You can even get real fancy with it and [`accept` individual
modules](#swappable-middleware-express-koa-etc) so that you don't even have to close the HTTP server
if you don't want to.

No doubt your application has all kinds of side-effects littered about. Maybe you have a
`setInterval` or something which runs a job every now and then. You'll need to tell dynohot how to
clean those up, because otherwise if the module reevaluates itself then you will make a new timer
each time. For cases like those you can use `import.meta.hot.dispose()`. Take a look at the [API
reference](#api-reference) below to get started on that.


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


TYPESCRIPT
----------

To use TypeScript source files directly under dynohot (instead of running transpiled JavaScript
output files) you can chain another loader which provides this functionality. The author of this
module created [`@loaderkit/ts`](https://github.com/braidnetworks/loaderkit/tree/main/packages/ts)
which handles this and works well with dynohot.

```
node --import @loaderkit/ts/register --import dynohot/register ./main.ts
```

You can add the following triple-slash directive to a `*.d.ts` file in your project and
`import.meta.hot` will be typed correctly.

```ts
/// <reference types="dynohot/import-meta" />
```


PATTERNS
--------

### Swappable middleware [Express, Koa, etc]
```ts
import express from "express";
import yourMiddleware from "./your-middleware.js";

// Reusable utility function
function makeSwappableMiddleware<Middleware extends (...args: readonly any[]) => any>(
    initial: Middleware,
): [
    swap: (next: Middleware) => void,
    middleware: Middleware,
] {
    if (import.meta.hot) {
        let current = initial;
        const swap = (next: Middleware) => {
            current = next;
        };
        const middleware = ((...args) => current(...args)) as Middleware;
        return [ swap, middleware ];
    } else {
        const swap = () => {
            throw new Error("Middleware is not swappable.");
        };
        return [ swap, initial ];
    }
}

// Updates to "./your-middleware.js" will be applied without needing to restart
// an HTTP server. No overhead incurred in production.
const app = express();
const [ swap, middleware ] = makeSwappableMiddleware(yourMiddleware);
app.use(middleware);
import.meta.hot?.accept("./your-middleware.js", () => {
    swap(yourMiddleware);
});
app.listen(8000);
```


### Pass forward a database connection
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


### Invalidate module based on external events
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


### Well-typed `data` parameter [TypeScript]
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
import { importedValue } from "./a-module";
export const exportedValue = "hello world";
console.log(importedValue);
```

```js
import { acquire } from "hot:runtime";
import _a_module from "hot:module?specifier=./a-module";
function* execute(_meta, _import) {
    // suspend until initial link of this module
    let _$ = yield [
        // re-link function, updates import holder
        next => { _$ = next },
        // exported locals
        { exportedValue: () => exportedValue },
    ];
    // suspend until this module is ready to evaluate
    yield;
    const exportedValue = "hello world";
    // imported values go through a function call
    console.log(_$.importedValue());
}
module().load(
    // module body
    { async: false, execute },
    // import.meta [unused in this example]
    null,
    // uses dynamic `import()`?
    false,
    // module format: [ "module", "json", "commonjs", (others??) ]
    "module",
    // import assertions `import .. with { type: "json" }`
    {},
    // imports
    [ {
        controller: _a_module,
        specifier: "./a-module",
        bindings: [ {
            type: "import",
            name: "importedValue",
        } ],
    } ],
);
// a hoistable function must be used to export the module controller in circular graphs
export default function module() { return acquire("file:///main.mjs"); }
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
