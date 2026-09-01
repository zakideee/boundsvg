import { RecoverableError } from "../errors.js";
import type { StructuralIrValidationError } from "../generated/ir/structural-ir-validator.js";
import { validateStructuralIr } from "../generated/ir/structural-ir-validator.js";
import type { SerializedIR } from "./types.js";

let structuralWarningsRejected = false;

function ownDataProperty(value: object, key: string): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
}

function denseOwnDataElements(value: unknown): unknown[] | undefined {
  let arrayValue: unknown[];
  try {
    if (!Array.isArray(value)) {
      return undefined;
    }
    arrayValue = value;
  } catch {
    return undefined;
  }

  const lengthDescriptor = ownDataProperty(arrayValue, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return undefined;
  }

  const elements: unknown[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = ownDataProperty(arrayValue, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      return undefined;
    }
    elements.push(descriptor.value);
  }
  return elements;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate warning-free IR used inside WASM and Worker operation envelopes. */
export function validateStructuralIR(value: unknown): boolean {
  structuralWarningsRejected = false;
  if (!isObjectRecord(value)) {
    return false;
  }
  const warningsDescriptor = ownDataProperty(value, "warnings");
  if (warningsDescriptor !== undefined) {
    structuralWarningsRejected = true;
    return false;
  }
  try {
    return validateStructuralIr(value);
  } catch {
    return false;
  }
}

/** Validate a public JSON IR carrying one canonical serialized warning list. */
export function validateSerializedIR(value: unknown): value is SerializedIR {
  if (!isObjectRecord(value)) {
    return false;
  }
  const warningsDescriptor = ownDataProperty(value, "warnings");
  const warnings =
    warningsDescriptor !== undefined && "value" in warningsDescriptor
      ? denseOwnDataElements(warningsDescriptor.value)
      : undefined;
  if (
    warningsDescriptor === undefined ||
    !warningsDescriptor.enumerable ||
    !("value" in warningsDescriptor) ||
    warnings === undefined ||
    !warnings.every((warning) => RecoverableError.isSerialized(warning))
  ) {
    return false;
  }
  try {
    return validateStructuralIr(value);
  } catch {
    return false;
  }
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

function errorProperty(error: StructuralIrValidationError): string | undefined {
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

function errorDepth(error: StructuralIrValidationError): number {
  const pointerDepth = error.instancePath.split("/").length - 1;
  return pointerDepth + (errorProperty(error) === undefined ? 0 : 1);
}

function mostSpecificError(
  errors: readonly StructuralIrValidationError[] | null | undefined,
): StructuralIrValidationError | undefined {
  let selectedError: StructuralIrValidationError | undefined;
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
export function structuralIRValidationFailure(rootPath: string): {
  path: string;
  description: string;
} {
  if (structuralWarningsRejected) {
    return {
      path: `${rootPath}.warnings`,
      description: "nested warnings are forbidden in structural IR",
    };
  }
  const error = mostSpecificError(validateStructuralIr.errors);
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
