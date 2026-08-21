import { describe, expect, it } from "vitest";
import {
  isWorkerLayoutTransitionInput,
  MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES,
  snapshotWorkerLayoutTransitionInput,
  type WorkerLayoutTransitionInput,
} from "../src/layout-transition-transport.js";

function transitionInput(label = "slot"): WorkerLayoutTransitionInput {
  return {
    states: {
      A: {
        type: "Canvas",
        width: 100,
        height: 100,
        children: [{ type: "Box", id: label, width: 40, height: 20, children: [] }],
      },
      B: {
        type: "Canvas",
        width: 100,
        height: 100,
        children: [{ type: "Box", id: label, width: 40, height: 60, children: [] }],
      },
    },
    checkpoints: [
      { timeMs: 0, state: "A" },
      { timeMs: 100, state: "B" },
      { timeMs: 200, state: "B" },
      { timeMs: 300, state: "A" },
    ],
  };
}

describe("layout transition Worker transport", () => {
  it("creates a detached strict-JSON snapshot", () => {
    const input = transitionInput();
    const snapshot = snapshotWorkerLayoutTransitionInput(input);
    const firstState = input.states.A;
    if (firstState?.type === "Canvas") {
      firstState.width = 200;
    }

    expect(snapshot).not.toBe(input);
    expect(snapshot.states.A).toMatchObject({ width: 100 });
    expect(isWorkerLayoutTransitionInput(snapshot)).toBe(true);
  });

  it("rejects callbacks, explicit undefined, and non-SceneNode states", () => {
    const callbackInput = transitionInput() as unknown as {
      states: { A: { callback: () => void } };
    };
    callbackInput.states.A.callback = () => {};
    expect(() =>
      snapshotWorkerLayoutTransitionInput(callbackInput as unknown as WorkerLayoutTransitionInput),
    ).toThrowError(expect.objectContaining({ code: "WORKER_LAYOUT_TRANSITION_NOT_SERIALIZABLE" }));

    const undefinedInput = transitionInput() as unknown as { extra: undefined };
    undefinedInput.extra = undefined;
    expect(isWorkerLayoutTransitionInput(undefinedInput)).toBe(false);

    const invalidState = transitionInput() as unknown as { states: { A: object } };
    invalidState.states.A = { width: 100 };
    expect(isWorkerLayoutTransitionInput(invalidState)).toBe(false);
  });

  it("enforces the UTF-8 payload ceiling before enqueue", () => {
    const input = transitionInput("x".repeat(MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES));

    expect(() => snapshotWorkerLayoutTransitionInput(input)).toThrowError(
      expect.objectContaining({ code: "WORKER_LAYOUT_TRANSITION_PAYLOAD_LIMIT" }),
    );
  });

  it("accepts exactly the ceiling and rejects one byte over it", () => {
    const atCeiling = transitionInputWithExactByteSize(MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES);
    expect(serializedUtf8Bytes(atCeiling)).toBe(MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES);
    expect(isWorkerLayoutTransitionInput(atCeiling)).toBe(true);
    expect(snapshotWorkerLayoutTransitionInput(atCeiling)).not.toBe(atCeiling);

    const oneByteOver = transitionInputWithExactByteSize(
      MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES + 1,
    );
    expect(serializedUtf8Bytes(oneByteOver)).toBe(MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES + 1);
    expect(isWorkerLayoutTransitionInput(oneByteOver)).toBe(false);
    expect(() => snapshotWorkerLayoutTransitionInput(oneByteOver)).toThrowError(
      expect.objectContaining({ code: "WORKER_LAYOUT_TRANSITION_PAYLOAD_LIMIT" }),
    );
  });
});

function serializedUtf8Bytes(input: WorkerLayoutTransitionInput): number {
  return new TextEncoder().encode(JSON.stringify(input)).byteLength;
}

/** Pad the two per-state box ids so the serialized request hits an exact byte count. */
function transitionInputWithExactByteSize(targetBytes: number): WorkerLayoutTransitionInput {
  const build = (idA: string, idB: string): WorkerLayoutTransitionInput => ({
    states: {
      A: {
        type: "Canvas",
        width: 100,
        height: 100,
        children: [{ type: "Box", id: idA, width: 40, height: 20, children: [] }],
      },
      B: {
        type: "Canvas",
        width: 100,
        height: 100,
        children: [{ type: "Box", id: idB, width: 40, height: 60, children: [] }],
      },
    },
    checkpoints: [
      { timeMs: 0, state: "A" },
      { timeMs: 100, state: "B" },
      { timeMs: 200, state: "B" },
      { timeMs: 300, state: "A" },
    ],
  });
  const paddingBytes = targetBytes - serializedUtf8Bytes(build("", ""));
  const padA = Math.ceil(paddingBytes / 2);
  return build("a".repeat(padA), "b".repeat(paddingBytes - padA));
}
