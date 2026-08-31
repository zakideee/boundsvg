import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import type { SceneNode } from "../../src/scene/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

function createContainerScene(
  containerType: "Box" | "Flex",
  idMode: "authored" | "automatic",
): SceneNode {
  const rootId = idMode === "authored" ? { id: "auto:0" } : {};
  const childId = idMode === "authored" ? { id: "auto:0.0" } : {};
  return {
    type: "Canvas",
    ...rootId,
    width: 100,
    height: 100,
    children: [
      {
        type: containerType,
        ...childId,
        width: 40,
        height: 30,
        children: [],
      },
    ],
  };
}

describe("layout transition IR provenance", () => {
  let handle: WasmEngineHandle;
  let engine: Engine;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
    engine = createEngineFromHandle(handle);
  });

  afterAll(() => {
    engine.dispose();
    handle.dispose();
  });

  it("cannot distinguish authored Box from authored Flex after IR build", () => {
    const boxIr = engine.snapshotCompiledIR(
      engine.compile(createContainerScene("Box", "authored")),
    );
    const flexIr = engine.snapshotCompiledIR(
      engine.compile(createContainerScene("Flex", "authored")),
    );

    expect(flexIr).toEqual(boxIr);
  });

  it("cannot distinguish generated IDs from authored IDs using the same strings", () => {
    const automaticIdIr = engine.snapshotCompiledIR(
      engine.compile(createContainerScene("Box", "automatic")),
    );
    const authoredIdIr = engine.snapshotCompiledIR(
      engine.compile(createContainerScene("Box", "authored")),
    );

    expect(authoredIdIr).toEqual(automaticIdIr);
  });

  it("keeps the public CompiledScene and IR byte shape free of transition provenance", () => {
    const compiled = engine.compile(createContainerScene("Box", "automatic"));
    const serializedIr = JSON.stringify(engine.snapshotCompiledIR(compiled));

    expect(Object.keys(compiled)).toEqual(["width", "height", "textPathMode"]);
    expect(serializedIr).toBe(
      '{"root":{"nodeId":"auto:0","bbox":{"x":0,"y":0,"w":100,"h":100},"type":"group","children":[{"nodeId":"auto:0.0","bbox":{"x":0,"y":0,"w":40,"h":30},"type":"group"}]},"drawOrder":[],"width":100,"height":100,"warnings":[]}',
    );
    expect(new TextEncoder().encode(serializedIr)).toHaveLength(219);
    expect(serializedIr).not.toContain("semanticManifest");
    expect(serializedIr).not.toContain("authoredId");
  });
});
