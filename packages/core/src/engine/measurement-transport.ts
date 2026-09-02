import { FatalError } from "../errors.js";
import type { MeasurementTextLayoutOperation } from "../text/layout-operation.js";

/** Invoke one measurement producer through the operation-aware error boundary. */
export function invokeMeasurementTransport<Input, Result>(
  operation: MeasurementTextLayoutOperation,
  transport: (input: Input) => Result,
  input: Input,
): Result {
  try {
    return transport(input);
  } catch (error) {
    let isFatalError = false;
    try {
      isFatalError = error instanceof FatalError;
    } catch {
      // A hostile proxy may make instanceof itself throw.
    }
    if (isFatalError) {
      throw error;
    }
    throw new FatalError("TEXT_LAYOUT_TRANSPORT_FAILED", "Text layout transport failed.", {
      stage: "engine",
      context: { operation },
    });
  }
}
