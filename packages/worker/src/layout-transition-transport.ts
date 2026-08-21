import type { LayoutTransitionInput, SceneNode } from "@boundsvg/core";
import { assertSerializableSceneTransport, FatalError, isSceneNode } from "@boundsvg/core";

/**
 * Strict UTF-8 safety cap for one two-state Worker transition request.
 *
 * This bounds accidental transport and Worker/WASM memory multiplication. It
 * is not a performance guarantee, a node-count admission policy, or evidence
 * that requests near the limit have acceptable latency.
 */
export const MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES = 16 * 1_024 * 1_024;

/** Worker wire form: flattened SceneNodes only; VNode callbacks never cross. */
export type WorkerLayoutTransitionInput = Omit<LayoutTransitionInput, "states"> & {
  readonly states: Readonly<Record<string, SceneNode>>;
};

/** Validate, size, and JSON-snapshot one transition before enqueue. */
export function snapshotWorkerLayoutTransitionInput(
  input: WorkerLayoutTransitionInput,
): WorkerLayoutTransitionInput {
  const serialized = serializeWorkerLayoutTransitionInput(input);
  return JSON.parse(serialized) as WorkerLayoutTransitionInput;
}

/** Non-throwing protocol guard for messages received from an untrusted peer. */
export function isWorkerLayoutTransitionInput(
  value: unknown,
): value is WorkerLayoutTransitionInput {
  try {
    serializeWorkerLayoutTransitionInput(value);
    return true;
  } catch {
    return false;
  }
}

function serializeWorkerLayoutTransitionInput(value: unknown): string {
  try {
    // The core guard walks unknown JSON values internally. Applying it to the
    // entire envelope rejects accessors, explicit undefined, cycles, sparse
    // arrays, non-finite numbers, and non-plain instances before JSON encoding.
    assertSerializableSceneTransport(value as SceneNode);
  } catch (error) {
    throw transitionTransportError(
      "WORKER_LAYOUT_TRANSITION_NOT_SERIALIZABLE",
      `Layout transition request is not strict JSON: ${describeError(error)}`,
    );
  }
  if (!isPlainObject(value)) {
    throw transitionTransportError(
      "WORKER_LAYOUT_TRANSITION_INVALID",
      "Layout transition request must be a plain object",
    );
  }
  const states = Reflect.get(value, "states");
  if (!isPlainObject(states) || Object.keys(states).length !== 2) {
    throw transitionTransportError(
      "WORKER_LAYOUT_TRANSITION_INVALID",
      "Layout transition request must contain exactly two named states",
    );
  }
  for (const state of Object.values(states)) {
    if (!isSceneNode(state)) {
      throw transitionTransportError(
        "WORKER_LAYOUT_TRANSITION_INVALID",
        "Every layout transition state must be a flattened SceneNode",
      );
    }
  }
  const checkpoints = Reflect.get(value, "checkpoints");
  if (!Array.isArray(checkpoints) || checkpoints.length !== 4) {
    throw transitionTransportError(
      "WORKER_LAYOUT_TRANSITION_INVALID",
      "Layout transition request must contain exactly four checkpoints",
    );
  }

  const serialized = JSON.stringify(value);
  const payloadBytes = new TextEncoder().encode(serialized).byteLength;
  if (payloadBytes > MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES) {
    throw transitionTransportError(
      "WORKER_LAYOUT_TRANSITION_PAYLOAD_LIMIT",
      `Layout transition request is ${payloadBytes} bytes; the Worker limit is ${MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES} bytes`,
      { payloadBytes, payloadBytesMax: MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES },
    );
  }
  return serialized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function transitionTransportError(
  code: string,
  message: string,
  context: Record<string, unknown> = {},
): FatalError {
  return new FatalError(code, message, { stage: "engine", ...context });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
