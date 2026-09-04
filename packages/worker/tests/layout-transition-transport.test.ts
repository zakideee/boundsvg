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

  it("delegates state structure to Core and validates known outer data", () => {
    const callbackInput = transitionInput() as unknown as {
      states: { A: { callback: () => void } };
    };
    callbackInput.states.A.callback = () => {};
    expect(() =>
      snapshotWorkerLayoutTransitionInput(callbackInput as unknown as WorkerLayoutTransitionInput),
    ).toThrowError(expect.objectContaining({ code: "SCENE_DECODE_UNKNOWN_KEY" }));

    const undefinedInput = transitionInput() as unknown as { extra: undefined };
    undefinedInput.extra = undefined;
    expect(isWorkerLayoutTransitionInput(undefinedInput)).toBe(true);
    expect(
      snapshotWorkerLayoutTransitionInput(undefinedInput as WorkerLayoutTransitionInput),
    ).not.toHaveProperty("extra");

    const unsafeEasing = { ...transitionInput(), easing: undefined };
    expect(() =>
      snapshotWorkerLayoutTransitionInput(unsafeEasing as unknown as WorkerLayoutTransitionInput),
    ).toThrowError(expect.objectContaining({ code: "WORKER_LAYOUT_TRANSITION_NOT_SERIALIZABLE" }));

    const invalidState = transitionInput() as unknown as { states: { A: object } };
    invalidState.states.A = { width: 100 };
    expect(isWorkerLayoutTransitionInput(invalidState)).toBe(false);
  });

  it("reports a one-state Core byte violation before the aggregate Worker ceiling", () => {
    const input = transitionInput("x".repeat(MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES));

    expect(() => snapshotWorkerLayoutTransitionInput(input)).toThrowError(
      expect.objectContaining({ code: "SCENE_DECODE_RESOURCE_LIMIT" }),
    );
  });

  it("omits unknown outer and checkpoint properties without invoking them", () => {
    let getterCalls = 0;
    const input = transitionInput() as WorkerLayoutTransitionInput & {
      readonly ignored?: unknown;
    };
    Object.defineProperty(input, "ignored", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return undefined;
      },
    });
    Object.defineProperty(input.checkpoints[0], "ignored", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return undefined;
      },
    });

    const snapshot = snapshotWorkerLayoutTransitionInput(input);

    expect(getterCalls).toBe(0);
    expect(snapshot).not.toHaveProperty("ignored");
    expect(snapshot.checkpoints[0]).not.toHaveProperty("ignored");
  });

  it("uses each checkpoint index descriptor exactly once", () => {
    const input = transitionInput();
    const checkpointTarget = input.checkpoints;
    const descriptorReads = new Map<PropertyKey, number>();
    let ordinaryGetCalls = 0;
    const checkpoints = new Proxy(checkpointTarget, {
      get(target, key, receiver) {
        ordinaryGetCalls += 1;
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        const reads = (descriptorReads.get(key) ?? 0) + 1;
        descriptorReads.set(key, reads);
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (descriptor === undefined || key === "length" || reads === 1) {
          return descriptor;
        }
        return {
          ...descriptor,
          value: { timeMs: 999, state: "B" },
        };
      },
    });

    const snapshot = snapshotWorkerLayoutTransitionInput({ ...input, checkpoints });

    expect(snapshot.checkpoints).toEqual(input.checkpoints);
    expect([0, 1, 2, 3].map((index) => descriptorReads.get(String(index)))).toEqual([1, 1, 1, 1]);
    expect(descriptorReads.get("length")).toBe(1);
    expect(ordinaryGetCalls).toBe(0);
  });

  it("leaves safe schedule semantics to the receive-side Core owner", () => {
    const base = transitionInput();
    const input = {
      ...base,
      checkpoints: [{ timeMs: 10, state: "A" }, ...base.checkpoints.slice(1)],
    } as unknown as WorkerLayoutTransitionInput;

    expect(isWorkerLayoutTransitionInput(input)).toBe(true);
    expect(snapshotWorkerLayoutTransitionInput(input).checkpoints[0]).toEqual({
      timeMs: 10,
      state: "A",
    });
  });

  it("rejects unsafe known data with fixed private diagnostics", () => {
    let getterCalls = 0;
    const accessorInput = transitionInput();
    Object.defineProperty(accessorInput, "states", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return {};
      },
    });
    expect(() => snapshotWorkerLayoutTransitionInput(accessorInput)).toThrowError(
      expect.objectContaining({
        code: "WORKER_LAYOUT_TRANSITION_NOT_SERIALIZABLE",
        message: "Layout transition request contains an unsafe data value.",
        stage: "engine",
        context: { path: "/states", reason: "accessor-property" },
      }),
    );
    expect(getterCalls).toBe(0);

    const cyclicEasing: Record<string, unknown> = {};
    cyclicEasing.self = cyclicEasing;
    const cyclicInput = {
      ...transitionInput(),
      easing: cyclicEasing,
    } as unknown as WorkerLayoutTransitionInput;
    expect(() => snapshotWorkerLayoutTransitionInput(cyclicInput)).toThrowError(
      expect.objectContaining({
        code: "WORKER_LAYOUT_TRANSITION_NOT_SERIALIZABLE",
        message: "Layout transition request contains an unsafe data value.",
        stage: "engine",
        context: { path: "/easing/self", reason: "cycle" },
      }),
    );
  });

  it("reserves the non-enumerable length property for canonical arrays", () => {
    const recordEasing = { type: "spring", stiffness: 100 };
    Object.defineProperty(recordEasing, "length", {
      configurable: true,
      enumerable: false,
      value: 4,
    });
    const unsafeInput = {
      ...transitionInput(),
      easing: recordEasing,
    } as unknown as WorkerLayoutTransitionInput;

    expect(() => snapshotWorkerLayoutTransitionInput(unsafeInput)).toThrowError(
      expect.objectContaining({
        code: "WORKER_LAYOUT_TRANSITION_NOT_SERIALIZABLE",
        message: "Layout transition request contains an unsafe data value.",
        stage: "engine",
        context: { path: "/easing/length", reason: "non-enumerable-property" },
      }),
    );

    const frozenEasing = Object.freeze([0.25, 0.1, 0.25, 1] as const);
    const safeInput = { ...transitionInput(), easing: frozenEasing };
    expect(snapshotWorkerLayoutTransitionInput(safeInput).easing).toEqual(frozenEasing);
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
