import {
  FatalError,
  RecoverableError,
  type SerializedFatalError,
  type SerializedRecoverableError,
} from "@boundsvg/core";

type SerializedDiagnostic = SerializedFatalError | SerializedRecoverableError;

/** Rehydrate a strict serialized diagnostic into its Error subclass. */
export function rehydrateError(error: SerializedDiagnostic): FatalError | RecoverableError {
  return error.severity === "recoverable"
    ? RecoverableError.fromSerialized(error)
    : FatalError.fromSerialized(error);
}
