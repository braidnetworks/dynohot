import { register } from "node:module";

export type { Hot } from "dynohot/runtime/hot";

register("dynohot/loader", {
	parentURL: import.meta.url,
});
