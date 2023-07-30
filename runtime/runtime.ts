import { AdapterModuleController } from "./adapter.js";
import { ReloadableModuleController } from "./controller.js";

/** @internal */
export function acquire(url: string) {
	return ReloadableModuleController.acquire(url);
}

/** @internal */
export function adapter(meta: ImportMeta, namespace: Record<string, unknown>) {
	return new AdapterModuleController(meta, namespace);
}
