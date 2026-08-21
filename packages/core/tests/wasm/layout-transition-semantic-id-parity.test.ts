import { beforeAll, describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import { buildLayoutTransportJson } from "../../src/layout/taffy-layout-adapter.js";
import { assertLayoutTransitionSemanticIds } from "../../src/layout-transition-semantic-ids.js";
import { initNodeWasm } from "../../src/node.js";
import { fromSceneDocument } from "../../src/scene/from-vnode.js";
import type { SceneNode } from "../../src/scene/types.js";
import { getWasm } from "../../src/wasm/index.js";

const PLAN = JSON.stringify({
  checkpoints: [
    { timeMs: 0, stateIndex: 0 },
    { timeMs: 300, stateIndex: 1 },
    { timeMs: 700, stateIndex: 1 },
    { timeMs: 1_000, stateIndex: 0 },
  ],
});

function rustMismatch(rawTransport: string): Record<string, unknown> {
  const wasm = getWasm();
  const instance = new wasm.BoundSvgEngine();
  try {
    instance.compile_layout_transition?.(rawTransport, rawTransport, PLAN, "{}");
    throw new Error("expected Rust transition incompatibility");
  } catch (error) {
    return JSON.parse(String(error)) as Record<string, unknown>;
  } finally {
    instance.free();
  }
}

function tsMismatch(input: SceneNode): FatalError {
  try {
    assertLayoutTransitionSemanticIds(input);
    throw new Error("expected TypeScript transition incompatibility");
  } catch (error) {
    expect(error).toBeInstanceOf(FatalError);
    return error as FatalError;
  }
}

describe("layout transition semantic-ID diagnostic parity", () => {
  beforeAll(async () => {
    await initNodeWasm();
  });

  it("keeps generated-ID code, message, and context equal to the Rust backstop", () => {
    const input: SceneNode = {
      type: "Canvas",
      width: 100,
      height: 100,
      children: [],
    };
    const tsError = tsMismatch(input);
    const rustError = rustMismatch(buildLayoutTransportJson(fromSceneDocument(input), {}));

    expect(rustError).toMatchObject({
      code: tsError.code,
      message: tsError.message,
      stage: tsError.stage,
      nodeId: tsError.nodeId,
      context: tsError.context,
    });
  });

  it.each([
    "duplicate",
    "duplicate\u0000id",
    "duplicate-😀",
  ])("keeps duplicate authored-ID code, message, and context equal to the Rust backstop for %j", (duplicateId) => {
    const child = {
      type: "Box" as const,
      id: duplicateId,
      width: 20,
      height: 20,
      children: [],
    };
    const input: SceneNode = {
      type: "Canvas",
      id: "scene",
      width: 100,
      height: 100,
      children: [child, { ...child }],
    };
    const tsError = tsMismatch(input);
    const rustError = rustMismatch(buildLayoutTransportJson(fromSceneDocument(input), {}));

    expect(rustError).toMatchObject({
      code: tsError.code,
      message: tsError.message,
      stage: tsError.stage,
      nodeId: tsError.nodeId,
      context: tsError.context,
    });
  });

  it.each([
    ["high", "invalid-\uD800-id"],
    ["low", "invalid-\uDC00-id"],
  ])("rejects a lone %s surrogate before the UTF-8 WASM bridge", (_kind, invalidId) => {
    const input: SceneNode = {
      type: "Canvas",
      id: "scene",
      width: 100,
      height: 100,
      children: [
        {
          type: "Box",
          id: invalidId,
          width: 20,
          height: 20,
          children: [],
        },
      ],
    };

    const captureValidationError = (operation: () => void): FatalError => {
      try {
        operation();
        throw new Error("expected Unicode node-ID validation error");
      } catch (error) {
        expect(error).toBeInstanceOf(FatalError);
        return error as FatalError;
      }
    };
    const precheckError = captureValidationError(() => assertLayoutTransitionSemanticIds(input));
    const bridgeError = captureValidationError(() => {
      buildLayoutTransportJson(fromSceneDocument(input), {});
    });

    expect(precheckError).toMatchObject({
      code: "VALIDATION",
      stage: "validate",
      nodeId: invalidId,
      context: {
        stage: "validate",
        nodeId: invalidId,
        reason: "lone UTF-16 surrogate",
      },
    });
    expect(bridgeError).toMatchObject({
      code: precheckError.code,
      message: precheckError.message,
      stage: precheckError.stage,
      nodeId: precheckError.nodeId,
      context: precheckError.context,
    });
  });

  it("ignores rich-text nodes flattened outside the semantic layout tree", () => {
    const input: SceneNode = {
      type: "Canvas",
      id: "scene",
      width: 100,
      height: 100,
      children: [
        {
          type: "Text",
          id: "text",
          font: "NotoSansJP",
          fontSizePx: 16,
          children: [{ type: "Inline", children: ["hello"] }],
        },
      ],
    };

    expect(() => assertLayoutTransitionSemanticIds(input)).not.toThrow();
  });
});
