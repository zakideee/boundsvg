import type { OutputIrValidationError } from "../generated/ir/output-ir-validator.js";
import { validateOutputIr } from "../generated/ir/output-ir-validator.js";

/** Validate the JSON-safe IR shape emitted by the Rust rendering boundary. */
export function validateSerializedIR(value: unknown): boolean {
  return validateOutputIr(value);
}

function decodeJsonPointerToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function propertySegment(property: string): string {
  if (/^\d+$/u.test(property)) {
    return `[${property}]`;
  }
  if (/^[A-Za-z_$][\w$]*$/u.test(property)) {
    return `.${property}`;
  }
  return `[${JSON.stringify(property)}]`;
}

function propertyPath(instancePath: string): string {
  if (instancePath.length === 0) {
    return "";
  }
  return instancePath
    .split("/")
    .slice(1)
    .map((token) => propertySegment(decodeJsonPointerToken(token)))
    .join("");
}

function errorProperty(error: OutputIrValidationError): string | undefined {
  if (error.keyword === "required" && typeof error.params.missingProperty === "string") {
    return error.params.missingProperty;
  }
  if (
    error.keyword === "additionalProperties" &&
    typeof error.params.additionalProperty === "string"
  ) {
    return error.params.additionalProperty;
  }
  return undefined;
}

function errorDepth(error: OutputIrValidationError): number {
  const pointerDepth = error.instancePath.split("/").length - 1;
  return pointerDepth + (errorProperty(error) === undefined ? 0 : 1);
}

function mostSpecificError(
  errors: readonly OutputIrValidationError[] | null | undefined,
): OutputIrValidationError | undefined {
  let selectedError: OutputIrValidationError | undefined;
  let selectedDepth = -1;
  for (const error of errors ?? []) {
    const depth = errorDepth(error);
    if (depth > selectedDepth) {
      selectedError = error;
      selectedDepth = depth;
    }
  }
  return selectedError;
}

/** Details from the most recent failed generated-validator call. */
export function serializedIRValidationFailure(rootPath: string): {
  path: string;
  description: string;
} {
  const error = mostSpecificError(validateOutputIr.errors);
  if (!error) {
    return { path: rootPath, description: "unknown" };
  }
  const property = errorProperty(error);
  return {
    path: `${rootPath}${propertyPath(error.instancePath)}${
      property === undefined ? "" : propertySegment(property)
    }`,
    description: error.message ?? error.keyword,
  };
}
