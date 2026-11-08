import { FatalError } from "../errors.js";
import type { MeasurementTextLayoutOperation } from "../text/layout-operation.js";
import { assertTextFlowMeasurementOutput } from "../wasm/protocol-decoders.js";

/** Invoke one measurement producer through the operation-aware error boundary. */
export function invokeMeasurementTransport<Input, Result>(
  operation: MeasurementTextLayoutOperation,
  transport: (input: Input) => Result,
  input: Input,
): Result {
  try {
    const measurementResult = transport(input);
    if (operation === "layoutTextFlowWithExclusions" || operation === "shrinkwrapFlow") {
      assertTextFlowMeasurementOutput(measurementResult, operation);
    }
    return measurementResult;
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
