// @ts-expect-error the broad serialized diagnostic union is not exported
import type { StructuredError } from "../../dist/index.js";
import {
  type DiagnosticContext,
  FatalError,
  type FatalErrorOptions,
  RecoverableError,
  type RecoverableErrorOptions,
  type SerializedFatalError,
  type SerializedRecoverableError,
} from "../../dist/index.js";

const context: DiagnosticContext = {
  count: 1,
  nested: { enabled: true },
  values: [null, "value", 2],
};
const fatalOptions: FatalErrorOptions = { stage: "validate", nodeId: "node-1", context };
const recoverableOptions: RecoverableErrorOptions = {
  fallback: "continued",
  stage: "text",
  nodeId: "text-1",
  context,
};

new FatalError("TEST_CODE", "Message", fatalOptions);
new RecoverableError("TEST_CODE", "Message", recoverableOptions);

const fatal: SerializedFatalError = {
  severity: "fatal",
  code: "TEST_CODE",
  message: "Message",
};
const recoverable: SerializedRecoverableError = {
  severity: "recoverable",
  code: "TEST_CODE",
  message: "Message",
  fallback: "continued",
  stage: "text",
};

FatalError.fromSerialized(fatal);
RecoverableError.fromSerialized(recoverable);

// @ts-expect-error metadata must be nested under explicit constructor options
new FatalError("TEST_CODE", "Message", { stage: "validate", detail: "invalid" });
// @ts-expect-error recoverable diagnostics require a pipeline stage
new RecoverableError("TEST_CODE", "Message", { fallback: "continued" });
// @ts-expect-error fatal diagnostics cannot carry a fallback
const fatalWithFallback: SerializedFatalError = { ...fatal, fallback: "invalid" };
// @ts-expect-error recoverable diagnostics require a fallback
const recoverableWithoutFallback: SerializedRecoverableError = {
  severity: "recoverable",
  code: "TEST_CODE",
  message: "Message",
  stage: "text",
};
// @ts-expect-error context values must be JSON-safe
const invalidContext: DiagnosticContext = { callback: () => undefined };
void fatalWithFallback;
void recoverableWithoutFallback;
void invalidContext;
void (null as unknown as StructuredError);
