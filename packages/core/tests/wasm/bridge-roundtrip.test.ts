import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "./test-prerequisites.js";

describe("Rust serde / TypeScript bridge round-trip", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [
        {
          alias: "NotoSansJP",
          weight: 400,
          style: "normal",
          data: loadSubsetFont(),
        },
      ],
    });
  });

  it("preserves nested ruby span data through flow input and result DTOs", () => {
    const result = engine.layoutTextFlowWithExclusions({
      text: "",
      fontFamily: "NotoSansJP",
      fontSizePx: 18,
      lineHeight: 1.5,
      flowBox: { x: 0, y: 0, width: 160, height: 80 },
      exclusions: [],
      spans: [
        {
          text: "漢字",
          rubyText: "かんじ",
          rubyPosition: "under",
          rubyAlign: "center",
          rubyFontSizePx: 9,
          rubyColor: "#d946ef",
        },
      ],
    });

    const fragment = result.lines[0]?.fragments[0];
    const ruby = fragment?.ruby;
    expect(fragment?.ruby).toMatchObject({
      text: "かんじ",
      position: "under",
      align: "center",
      style: { fontSizePx: 9, color: "#d946ef" },
      lineSizing: "css",
      levels: [
        {
          text: "かんじ",
          position: "under",
          runs: [{ text: "かんじ", style: { fontSizePx: 9, color: "#d946ef" } }],
        },
      ],
    });
    expect(Number.isFinite(ruby?.gapPx)).toBe(true);
    expect(ruby?.gapPx).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(ruby?.offsetPx)).toBe(true);
    expect(result.topRubyOverflowPx).toBe(0);
    expect(result.bottomRubyOverflowPx).toBeGreaterThan(0);
  });

  it("round-trips every flow overflow variant", () => {
    const common = {
      text: "あいうえおかきくけこ",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja" as const,
      wrap: "char" as const,
      exclusions: [],
    };

    const maxLines = engine.layoutTextFlowWithExclusions({
      ...common,
      flowBox: { x: 0, y: 0, width: 40, height: 300 },
      maxLines: 1,
    });
    const exhaustedBox = engine.layoutTextFlowWithExclusions({
      ...common,
      flowBox: { x: 0, y: 0, width: 40, height: 30 },
    });
    const cannotFit = engine.layoutTextFlowWithExclusions({
      ...common,
      text: "あ",
      flowBox: { x: 0, y: 0, width: 1, height: 1 },
      fit: "shrink",
      minFontSizePx: 20,
    });

    expect(maxLines.overflowReason).toBe("maxLinesTruncated");
    expect(exhaustedBox.overflowReason).toBe("flowBoxExhausted");
    expect(cannotFit.overflowReason).toBe("cannotFit");
  });

  it("round-trips canvas stroke scaling through the real layout and IR bridge", () => {
    const ir = engine.renderToIR(
      createElement(
        "Canvas",
        { width: 96, height: 64 },
        createElement("Box", {
          id: "hairline",
          width: 40,
          height: 20,
          background: "#111",
          borderWidth: 1,
          borderColor: "#fff",
          strokeScaling: "canvas",
        }),
        createElement("Path", {
          id: "path-hairline",
          d: "M0 0L20 20",
          width: 20,
          height: 20,
          stroke: "#fff",
          strokeWidth: 1,
          strokeScaling: "canvas",
        }),
      ),
    );
    const owner = ir.root.children?.find((node) => node.nodeId === "hairline");
    expect(owner?.type).toBe("group");
    expect(owner?.children?.find((node) => node.nodeId === "hairline:bg")).not.toHaveProperty(
      "strokeScaling",
    );
    expect(owner?.children?.find((node) => node.nodeId === "hairline:border")).toMatchObject({
      type: "rect",
      strokeScaling: "canvas",
    });
    const pathOwner = ir.root.children?.find((node) => node.nodeId === "path-hairline");
    expect(pathOwner?.type).toBe("group");
    expect(pathOwner?.children?.find((node) => node.type === "path")).toMatchObject({
      nodeId: "path-hairline",
      strokeScaling: "canvas",
    });
  });

  it("preserves region and shrinkwrap search controls", () => {
    const commonFlow = {
      text: "あいうえお",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja" as const,
      wrap: "char" as const,
      flowBox: { x: 0, y: 0, width: 100, height: 60 },
      exclusions: [{ kind: "rect" as const, x: 40, y: 0, width: 20, height: 30 }],
    };
    const narrowRegionsAllowed = engine.layoutTextFlowWithExclusions(commonFlow);
    const narrowRegionsRejected = engine.layoutTextFlowWithExclusions({
      ...commonFlow,
      minRegionWidthPx: 50,
    });
    const allowedFirstY = narrowRegionsAllowed.lines[0]?.fragments[0]?.y;
    const rejectedFirstY = narrowRegionsRejected.lines[0]?.fragments[0]?.y;
    expect(allowedFirstY).toBe(0);
    expect(rejectedFirstY).toBeGreaterThan(allowedFirstY ?? Number.POSITIVE_INFINITY);

    const infeasible = engine.shrinkwrapText({
      text: "あいうえおかきくけこ",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja",
      wrap: "char",
      maxWidth: 50,
      targetLineCount: 1,
    });
    expect(infeasible.status).toBe("infeasible");

    const searchInput = {
      text: "あいうえおかきくけこさしすせそ",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja" as const,
      wrap: "char" as const,
      minWidth: 40,
      maxWidth: 240,
      targetLineCount: 2,
      epsilonPx: 0.01,
    };
    const zeroIterations = engine.shrinkwrapText({ ...searchInput, maxIterations: 0 });
    const converged = engine.shrinkwrapText({ ...searchInput, maxIterations: 20 });
    expect(zeroIterations.status).toBe("satisfied");
    expect(converged.status).toBe("satisfied");
    expect(zeroIterations.chosenWidthPx).toBeGreaterThan(converged.chosenWidthPx);
    expect(converged.lineCount).toBe(2);
  });
});
