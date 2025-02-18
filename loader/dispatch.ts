// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./declarations.d.ts" preserve="true" />
import { register } from "./register.js";

export type { Hot } from "dynohot/runtime/hot";
export type { LoaderHot } from "./loader-hot.js";

// Default auto-register
register({});
