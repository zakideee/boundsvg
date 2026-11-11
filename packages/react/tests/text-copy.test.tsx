// @vitest-environment happy-dom
/** @jsxImportSource react */

import { buildIRSourceIndex, buildTextMap, type IR, type TextMap } from "@boundsvg/core/scene";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type UseTextCopyResult, useTextCopy } from "../src/hooks/use-text-copy.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(document, "execCommand");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountTextCopy(initialMap: TextMap | null = null): Promise<{
  current: () => UseTextCopyResult;
  updateMap: (textMap: TextMap) => Promise<void>;
  unmount: () => Promise<void>;
}> {
  let textCopyResult: UseTextCopyResult | null = null;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function Probe({ textMap }: { textMap: TextMap | null }) {
    textCopyResult = useTextCopy(textMap);
    return null;
  }

  await act(async () => {
    root.render(<Probe textMap={initialMap} />);
  });

  return {
    updateMap: async (textMap) => {
      await act(async () => root.render(<Probe textMap={textMap} />));
    },
    current: () => {
      if (!textCopyResult) {
        throw new TypeError("text copy hook did not mount");
      }
      return textCopyResult;
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

describe("useTextCopy clipboard fallback lifecycle", () => {
  it("does not create status state or a timer after unmount during clipboard await", async () => {
    const clipboard = deferred();
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(() => clipboard.promise) },
    });
    const hook = await mountTextCopy();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const copyPromise = hook.current().copyToClipboard("late copy");

    await hook.unmount();
    clipboard.resolve();
    await copyPromise;

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it("lets only the latest clipboard request create status feedback", async () => {
    const firstClipboard = deferred();
    const secondClipboard = deferred();
    const writeText = vi
      .fn()
      .mockImplementationOnce(() => firstClipboard.promise)
      .mockImplementationOnce(() => secondClipboard.promise);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const hook = await mountTextCopy();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const firstCopy = hook.current().copyToClipboard("first");
    const secondCopy = hook.current().copyToClipboard("second");

    await act(async () => {
      secondClipboard.resolve();
      await secondCopy;
    });
    await act(async () => {
      firstClipboard.resolve();
      await firstCopy;
    });

    expect(hook.current().copyStatus).toBe("copied");
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    await hook.unmount();
  });

  it("copies through the fallback and removes its transient textarea", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("permission denied")) },
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    const hook = await mountTextCopy();

    let copied = false;
    await act(async () => {
      copied = await hook.current().copyToClipboard("copy me");
    });

    expect(copied).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
    expect(hook.current().copyStatus).toBe("copied");
    await hook.unmount();
  });

  it("removes the transient textarea when the fallback throws", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("permission denied")) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        throw new Error("copy command failed");
      }),
    });
    const hook = await mountTextCopy();

    let copied = true;
    await act(async () => {
      copied = await hook.current().copyToClipboard("copy me");
    });

    expect(copied).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
    expect(hook.current().copyStatus).toBe("failed");
    await hook.unmount();
  });
});

function snapshotTextMap(label: string, text: string): TextMap {
  const bbox = { x: 0, y: 0, w: 100, h: 20 };
  const ir: IR = {
    width: 100,
    height: 40,
    warnings: [],
    root: {
      type: "group",
      nodeId: "root",
      bbox,
      ownership: { role: "source" },
      children: [
        {
          type: "group",
          nodeId: `${label}-group`,
          bbox,
          ownership: { role: "source" },
          children: [text, "peer"].map((content, index) => ({
            type: "text",
            nodeId: `${label}-${index}`,
            bbox,
            ownership: { role: "source" },
            lines: [{ text: content, width: 50, baselineY: 15, glyphs: [] }],
          })),
        },
      ],
    },
  };
  return buildTextMap(buildIRSourceIndex(ir));
}

describe("useTextCopy snapshot source lifetime", () => {
  for (const sameLabel of [false, true]) {
    it(`rejects old node, line and ancestor refs after ordinal reuse (sameLabel=${sameLabel})`, async () => {
      const oldMap = snapshotTextMap("old", "old text");
      const nextMap = snapshotTextMap(sameLabel ? "old" : "new", "new text");
      const oldSource = oldMap.nodes.get(2)?.source;
      const currentSource = nextMap.nodes.get(2)?.source;
      const oldGroup = oldMap.sourceIndex.sources.get(1)?.source;
      const currentGroup = nextMap.sourceIndex.sources.get(1)?.source;
      if (!oldSource || !currentSource || !oldGroup || !currentGroup) {
        throw new TypeError("Missing snapshot sources");
      }
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      const hook = await mountTextCopy(oldMap);
      const oldMenuBuilder = hook.current().buildMenuInfo;
      expect(hook.current().resolveNodeText(oldSource)).toBe("old text");
      await hook.updateMap(nextMap);
      expect(
        oldMenuBuilder({ source: oldSource, point: { svgX: 5, svgY: 5 }, clientX: 5, clientY: 5 }),
      ).toMatchObject({ nodeText: "old text", lineText: "old text" });
      expect(hook.current().resolveNodeText(oldSource)).toBeNull();
      expect(hook.current().resolveLineText(oldSource, { svgX: 5, svgY: 5 })).toBeNull();
      expect(hook.current().resolveAncestorText(oldSource)).toBeNull();
      expect(hook.current().resolveAncestorText(oldGroup)).toBeNull();
      expect(await hook.current().copyNodeText(oldSource)).toBe(false);
      expect(await hook.current().copyLineText(oldSource, { svgX: 5, svgY: 5 })).toBe(false);
      expect(await hook.current().copyAncestorText(oldSource)).toBe(false);
      expect(await hook.current().copyAncestorText(oldGroup)).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
      expect(hook.current().resolveNodeText(currentSource)).toBe("new text");
      expect(hook.current().resolveLineText(currentSource, { svgX: 5, svgY: 5 })).toBe("new text");
      expect(hook.current().resolveAncestorText(currentGroup)).toBe("new text\n\npeer");
      await act(async () => {
        expect(await hook.current().copyAncestorText(currentGroup)).toBe(true);
      });
      expect(writeText).toHaveBeenCalledExactlyOnceWith("new text\n\npeer");
      await hook.unmount();
    });
  }
});
