import { type IR, RecoverableError } from "@boundsvg/core";

/** Keep diagnostic instances while detaching a public projection from the retained IR. */
export function cloneRenderedIr(ir: IR): IR {
  return {
    ...structuredClone({ ...ir, warnings: [] }),
    warnings: ir.warnings.map((warning) => RecoverableError.fromSerialized(warning.toJSON())),
  };
}
