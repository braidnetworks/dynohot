import { AdapterModuleController } from "./adapter.js";
import { makeAcquire } from "./controller.js";

/** @internal */
export const acquire = makeAcquire((specifier, assertions) => import(specifier, assertions));

/** @internal */
export function adapter(meta: ImportMeta, namespace: Record<string, unknown>) {
	return new AdapterModuleController(meta, namespace);
}
