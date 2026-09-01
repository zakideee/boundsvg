import { describe, expect, it, vi } from "vitest";
import { Engine } from "../../src/engine.js";
import { RecoverableError } from "../../src/errors.js";
import type { IRGroupNode, IRTextNode } from "../../src/ir/types.js";
import { createElement } from "../../src/vnode/create-element.js";
import { WasmEngineHandle } from "../../src/wasm/index.js";
import {
  decodeAnimationStateSamples,
  decodeIntrinsicInlineSizeResult,
  decodeMeasureTextBlockResult,
  decodeRenderToIrEnvelope,
  decodeRenderToSvgEnvelope,
  decodeShrinkwrapFlowResult,
  decodeShrinkwrapTextResult,
  decodeTextFlowResult,
  decodeTextFlowWithExclusionsResult,
} from "../../src/wasm/protocol-decoders.js";
import type { RenderToIrEnvelope, WasmEngineInstance } from "../../src/wasm/types.js";

const bbox = { x: 0, y: 0, w: 100, h: 40 };

function createFullyPopulatedEnvelope(): RenderToIrEnvelope {
  return {
    ir: {
      root: {
        type: "group",
        nodeId: "root",
        bbox,
        opacity: 0.9,
        transform: { translateX: 1, translateY: 2, scaleX: 1, scaleY: 1, rotateDeg: 3 },
        animation: {
          keyframes: [
            { at: 0, opacity: 0, transform: { translateX: 0 } },
            { at: 1, opacity: 1, transform: { translateX: 10 } },
          ],
          durationMs: 500,
          delayMs: 20,
          easing: { type: "steps", count: 4, position: "jump-end" },
          iterations: "infinite",
          fill: "both",
        },
        meta: { role: "fixture" },
        boxShadow: { dx: 1, dy: 2, blur: 3, spread: 4, color: "#0008" },
        clipPath: bbox,
        clipBorderRadius: { tl: 1, tr: 2, br: 3, bl: 4 },
        on: { onClick: "click", onPointerCancel: "cancel" },
        children: [
          {
            type: "rect",
            nodeId: "rect",
            bbox,
            fill: "#fff",
            stroke: "#000",
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "bevel",
            strokeDasharray: "2 1",
            strokeMiterlimit: 4,
            gradient: {
              type: "radial",
              geometry: { centerX: 10, centerY: 11, radiusX: 12, radiusY: 13 },
              stops: [
                { color: "#fff", offset: 0 },
                { color: "#000", offset: 1 },
              ],
            },
            borderRadius: 4,
            strokeScaling: "canvas",
          },
          {
            type: "text",
            nodeId: "text",
            bbox,
            lines: [
              {
                text: "A",
                glyphs: [
                  {
                    glyphId: 1,
                    xAdvance: 10,
                    yAdvance: 0,
                    xOffset: 0,
                    yOffset: 0,
                    cluster: 0,
                    fontAlias: "Fixture",
                    fontWeight: 400,
                    fontStyle: "normal",
                    rotationDeg: 0,
                  },
                ],
                width: 10,
                baselineY: 12,
                fragments: [
                  {
                    text: "A",
                    glyphs: [],
                    width: 10,
                    style: {
                      font: "Fixture",
                      fallback: ["Fallback"],
                      fontWeight: 400,
                      fontStyle: "normal",
                      fontVariationSettings: "'wght' 400",
                      fontFeatureSettings: "'kern' 1",
                      color: "#123",
                      textStrokes: [{ color: "#fff", widthPx: 2, linejoin: "round" }],
                      textShadows: [{ dx: 1, dy: 2, blurPx: 3, color: "#0008" }],
                      language: "ja",
                      fontSizePx: 16,
                      letterSpacingPx: 0,
                      textOrientation: "mixed",
                    },
                  },
                ],
                positionedGlyphs: [
                  {
                    glyphId: 1,
                    text: "A",
                    clusterStart: 0,
                    clusterEnd: 1,
                    sourceStart: 0,
                    sourceEnd: 1,
                    sourceRole: "content",
                    paintRangeIndex: 0,
                    textStrokes: [{ color: "#fff", widthPx: 2 }],
                    textShadows: [{ dx: 1, dy: 1, color: "#000" }],
                    fontAlias: "Fixture",
                    fontFallback: ["Fallback"],
                    fontWeight: 400,
                    fontStyle: "normal",
                    fontSizePx: 16,
                    fontVariationSettings: "'wght' 400",
                    fontFeatureSettings: "'kern' 1",
                    fill: "#123",
                    originX: 0,
                    originY: 12,
                    xOffset: 0,
                    yOffset: 0,
                    xAdvance: 10,
                    yAdvance: 0,
                    rotationDeg: 0,
                    baselineRotationDeg: 0,
                    inlineScale: 1,
                    syntheticKind: "ellipsis",
                    outlineWritingMode: "horizontal-tb",
                    absolutePosition: true,
                  },
                ],
              },
            ],
            font: "Fixture",
            fontFallback: ["Fallback"],
            fontSizePx: 16,
            fontWeight: 400,
            fontStyle: "italic",
            letterSpacingPx: 1,
            fontVariationSettings: "'wght' 400",
            fontFeatureSettings: "'kern' 1",
            color: "#123",
            textAlign: "center",
            layoutBox: bbox,
            writingMode: "horizontal-tb",
            language: "auto",
            lineHeightPx: 24,
            textLayoutKind: "path",
            textPath: {
              d: "M0 0L100 0",
              startOffsetPx: 1,
              textAnchor: "middle",
              pathDirection: "reverse",
              pathNormal: "right",
              pathOffsetPx: 2,
              pathFit: "spacing",
              pathOverflow: "ellipsis",
            },
            sourceText: "AB",
            displayText: "A",
            glyphPaths: [
              {
                nodeId: "text",
                d: "M0 0L1 0Z",
                fill: "#123",
                glyphIds: [1],
                text: "A",
                bbox,
                unitId: "unit-0",
                sourceStart: 0,
                sourceEnd: 1,
                sourceRole: "content",
                paintRangeIndex: 0,
                strokes: [{ color: "#fff", widthPx: 2 }],
                shadows: [{ dx: 1, dy: 1, color: "#000" }],
                missingGlyph: false,
              },
            ],
            unitMap: {
              kind: "cluster",
              ruby: "separate",
              units: [
                {
                  unitId: "unit-0",
                  kind: "cluster",
                  sourceStart: 0,
                  sourceEnd: 1,
                  lineId: "line-0",
                  logicalOrder: 0,
                  visualOrder: 0,
                  members: [{ lineIndex: 0, glyphIndex: 0, sourceRole: "content" }],
                },
              ],
            },
            unitAnimation: {
              by: "cluster",
              animation: { keyframes: [{ at: 0 }], durationMs: 100, easing: "linear" },
              delayStepMs: 5,
              order: "visual",
              ruby: "separate",
            },
            unitAnimationSamples: [
              {
                unitId: "unit-0",
                bbox,
                opacity: 0.5,
                transform: { translateX: 1, originX: 2 },
              },
            ],
            stroke: "#000",
            strokeWidth: 1,
            strokeLinecap: "square",
            strokeLinejoin: "miter",
            strokeDasharray: "1 2",
            strokeMiterlimit: 3,
            strokes: [{ color: "#fff", widthPx: 2, linecap: "round" }],
            shadows: [{ dx: 1, dy: 2, color: "#000" }],
            textDecorations: [
              {
                line: "underline",
                style: "solid",
                color: "#123",
                skipInk: "all",
                paths: [
                  {
                    d: "M0 0L1 0Z",
                    originX: 0,
                    originY: 1,
                    contourCount: 1,
                    segmentCount: 2,
                    pathDistanceStartPx: 0,
                    pathDistanceEndPx: 1,
                  },
                ],
                sourceStart: 0,
                sourceEnd: 1,
              },
            ],
            on: { onPointerDown: "down" },
          },
          {
            type: "image",
            nodeId: "image",
            bbox,
            src: "data:image/png;base64,AA==",
            preserveAspectRatio: "none",
            on: { onClick: "image" },
          },
          {
            type: "path",
            nodeId: "path",
            bbox,
            pathData: "M0 0L1 1",
            fill: "none",
            stroke: "#000",
            strokeWidth: 1,
            fillRule: "evenodd",
            strokeLinecap: "butt",
            strokeLinejoin: "round",
            strokeDasharray: "1 1",
            strokeMiterlimit: 4,
            strokeScaling: "transform",
            on: { onMouseMove: "move" },
          },
          {
            type: "svg",
            nodeId: "svg",
            bbox,
            svgContent: "<path/>",
            svgViewBox: "0 0 1 1",
            preserveAspectRatio: "none",
            on: { onTouchEnd: "end" },
          },
          {
            type: "shape",
            nodeId: "shape",
            bbox,
            shapeParts: [
              {
                partId: "part",
                d: "M0 0L1 1",
                strokeD: "M0 0L2 2",
                bounds: { x: 0, y: 0, width: 1, height: 1 },
                paint: {
                  fill: "#fff",
                  stroke: "#000",
                  strokeWidth: 1,
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                  strokeDasharray: "1 1",
                  strokeMiterlimit: 4,
                },
              },
            ],
            fill: "#fff",
            stroke: "#000",
            strokeWidth: 1,
            fillRule: "nonzero",
            strokeLinecap: "round",
            strokeLinejoin: "bevel",
            strokeDasharray: "1 1",
            strokeMiterlimit: 4,
            on: { onPointerUp: "up" },
          },
        ],
      },
      drawOrder: ["rect", "text", "image", "path", "svg", "shape", "root"],
      width: 100,
      height: 40,
      debug: true,
    },
    warnings: [
      {
        severity: "recoverable",
        code: "FIXTURE",
        message: "fixture warning",
        stage: "ir",
        nodeId: "root",
        fallback: "none",
        context: { count: 1 },
      },
    ],
  };
}

function getFixtureTextNode(envelope: RenderToIrEnvelope): IRTextNode {
  const textNode = (envelope.ir.root as IRGroupNode).children?.find(
    (node): node is IRTextNode => node.type === "text",
  );
  if (!textNode) {
    throw new TypeError("fixture IR text node is missing");
  }
  return textNode;
}

function omitFixtureFragmentStyle(envelope: RenderToIrEnvelope): void {
  const fragment = getFixtureTextNode(envelope).lines[0]?.fragments?.[0];
  if (!fragment) {
    throw new TypeError("fixture line fragment is missing");
  }
  Reflect.deleteProperty(fragment, "style");
}

function expectCode(callback: () => unknown, code: string): void {
  expect(callback).toThrowError(
    expect.objectContaining({ name: "FatalError", code, stage: "wasm" }),
  );
}

describe("WASM protocol decoders", () => {
  it("accepts every IR discriminant and every currently consumer-readable nested field", () => {
    const envelope = createFullyPopulatedEnvelope();
    expect(decodeRenderToIrEnvelope(JSON.stringify(envelope))).toEqual(envelope);
    const svgEnvelope = {
      svg: "<svg/>",
      ir: envelope.ir,
      warnings: envelope.warnings,
      textNodeIds: ["text"],
    };
    expect(decodeRenderToSvgEnvelope(JSON.stringify(svgEnvelope))).toEqual(svgEnvelope);
    const stringOnlyEnvelope = {
      ...svgEnvelope,
      textNodeIds: ["text", "text-on-path"],
    };
    Reflect.deleteProperty(stringOnlyEnvelope, "ir");
    expect(decodeRenderToSvgEnvelope(JSON.stringify(stringOnlyEnvelope))).toEqual(
      stringOnlyEnvelope,
    );
    expect(
      decodeAnimationStateSamples(
        JSON.stringify([
          { nodeId: "root" },
          { nodeId: "child", opacity: 0.5, transform: { a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 } },
        ]),
      ),
    ).toHaveLength(2);
  });

  it("accepts and preserves Rust's style-less line-fragment projection", () => {
    const envelope = createFullyPopulatedEnvelope();
    omitFixtureFragmentStyle(envelope);

    const decoded = decodeRenderToIrEnvelope(JSON.stringify(envelope));
    expect(getFixtureTextNode(decoded).lines[0]?.fragments?.[0]).not.toHaveProperty("style");
  });

  it("rejects null effect fields and leaves unrelated diagnostic nulls untouched", () => {
    const envelope = createFullyPopulatedEnvelope();
    const textNode = (envelope.ir.root as IRGroupNode).children?.find(
      (node): node is IRTextNode => node.type === "text",
    );
    const positionedStroke = textNode?.lines[0]?.positionedGlyphs?.[0]?.textStrokes?.[0];
    const positionedShadow = textNode?.lines[0]?.positionedGlyphs?.[0]?.textShadows?.[0];
    Reflect.set(positionedStroke ?? {}, "linejoin", null);
    Reflect.set(positionedShadow ?? {}, "blurPx", null);
    expectCode(() => decodeRenderToIrEnvelope(JSON.stringify(envelope)), "WASM_INVALID_IR_OUTPUT");

    const validEnvelope = createFullyPopulatedEnvelope();
    const diagnosticContext = { blurPx: null, linecap: null, keep: null };
    Reflect.set(validEnvelope.warnings[0] ?? {}, "context", diagnosticContext);
    const decoded = decodeRenderToIrEnvelope(JSON.stringify(validEnvelope));
    expect(decoded.warnings[0]?.context).toEqual(diagnosticContext);
  });

  it("rejects malformed JSON, required fields, array elements, optional fields, discriminants, and closed enums", () => {
    expectCode(() => decodeRenderToIrEnvelope("{"), "WASM_INVALID_IR_OUTPUT");

    const missingRequired = structuredClone(createFullyPopulatedEnvelope());
    Reflect.deleteProperty(missingRequired.ir, "drawOrder");
    expectCode(
      () => decodeRenderToIrEnvelope(JSON.stringify(missingRequired)),
      "WASM_INVALID_IR_OUTPUT",
    );

    const invalidArrayElement = structuredClone(createFullyPopulatedEnvelope());
    Reflect.set(invalidArrayElement.ir, "drawOrder", [42]);
    expectCode(
      () => decodeRenderToIrEnvelope(JSON.stringify(invalidArrayElement)),
      "WASM_INVALID_IR_OUTPUT",
    );

    const invalidDiscriminant = structuredClone(createFullyPopulatedEnvelope());
    Reflect.set(invalidDiscriminant.ir.root, "type", "video");
    expectCode(
      () => decodeRenderToIrEnvelope(JSON.stringify(invalidDiscriminant)),
      "WASM_INVALID_IR_OUTPUT",
    );

    const invalidOptional = structuredClone(createFullyPopulatedEnvelope());
    const textNode = (invalidOptional.ir.root as IRGroupNode).children?.find(
      (node): node is IRTextNode => node.type === "text",
    );
    Reflect.set(textNode ?? {}, "fontStyle", "oblique");
    expectCode(
      () => decodeRenderToIrEnvelope(JSON.stringify(invalidOptional)),
      "WASM_INVALID_IR_OUTPUT",
    );

    const invalidClosedEnum = structuredClone(createFullyPopulatedEnvelope());
    const animation = (invalidClosedEnum.ir.root as IRGroupNode).animation;
    if (animation && typeof animation.easing === "object" && !Array.isArray(animation.easing)) {
      Reflect.set(animation.easing, "position", "middle");
    }
    expectCode(
      () => decodeRenderToIrEnvelope(JSON.stringify(invalidClosedEnum)),
      "WASM_INVALID_IR_OUTPUT",
    );

    const invalidWarning = structuredClone(createFullyPopulatedEnvelope());
    Reflect.set(invalidWarning.warnings[0] ?? {}, "stage", "network");
    expectCode(
      () => decodeRenderToIrEnvelope(JSON.stringify(invalidWarning)),
      "WASM_INVALID_IR_OUTPUT",
    );

    const duplicatedNestedWarnings = structuredClone(createFullyPopulatedEnvelope());
    Reflect.set(duplicatedNestedWarnings.ir, "warnings", []);
    expectCode(
      () => decodeRenderToIrEnvelope(JSON.stringify(duplicatedNestedWarnings)),
      "WASM_INVALID_IR_OUTPUT",
    );
  });

  it("routes all Engine render and animation response boundaries through the decoders", () => {
    const scene = createElement("Canvas", { width: 100, height: 40 });
    const validEnvelope = createFullyPopulatedEnvelope();
    const invalidIrEnvelope = structuredClone(validEnvelope);
    Reflect.set(invalidIrEnvelope.ir.root, "type", "video");
    const invalidSvgEnvelope = { svg: "<svg/>", ...structuredClone(validEnvelope) };
    Reflect.set(invalidSvgEnvelope.ir, "debug", "true");

    const invalidIrEngine = new Engine({
      computeLayoutFn: () => "{}",
      renderToIrFn: () => JSON.stringify(invalidIrEnvelope),
    });
    expectCode(() => invalidIrEngine.compile(scene), "WASM_INVALID_IR_OUTPUT");

    const invalidSvgEngine = new Engine({
      computeLayoutFn: () => "{}",
      renderToSvgFn: () => JSON.stringify(invalidSvgEnvelope),
    });
    expectCode(() => invalidSvgEngine.renderToSvg(scene), "WASM_INVALID_SVG_OUTPUT");

    const invalidAnimationEngine = new Engine({
      computeLayoutFn: () => "{}",
      renderToIrFn: () => JSON.stringify(validEnvelope),
      sampleAnimationStateFn: () =>
        JSON.stringify([{ nodeId: "root", opacity: "opaque", transform: null }]),
    });
    expectCode(
      () => invalidAnimationEngine.sampleAnimationState(scene, 0),
      "WASM_INVALID_ANIMATION_STATE_OUTPUT",
    );
  });

  it("accepts a style-less line fragment through the public Engine compile boundary", () => {
    const scene = createElement("Canvas", { width: 100, height: 40 });
    const styleLessEnvelope = createFullyPopulatedEnvelope();
    omitFixtureFragmentStyle(styleLessEnvelope);
    const engine = new Engine({
      computeLayoutFn: () => "{}",
      renderToIrFn: () => JSON.stringify(styleLessEnvelope),
    });

    const compiled = engine.compile(scene);
    const compiledText = (engine.snapshotCompiledIR(compiled).root as IRGroupNode).children?.find(
      (node): node is IRTextNode => node.type === "text",
    );
    expect(compiledText?.lines[0]?.fragments?.[0]).not.toHaveProperty("style");
  });

  it("rehydrates an AndIR warning once and detaches callback mutation from returned IR", () => {
    const scene = createElement("Canvas", { width: 100, height: 40 });
    const serializedWarning = {
      severity: "recoverable",
      code: "FIXTURE_WARNING",
      message: "retained warning",
      fallback: "retained fallback",
      stage: "ir",
      context: { owner: { id: "root" } },
    } as const;
    const engine = new Engine({
      computeLayoutFn: () => "{}",
      renderToSvgFn: () =>
        JSON.stringify({
          svg: "<svg/>",
          ir: {
            root: { type: "group", nodeId: "root", bbox },
            drawOrder: [],
            width: 100,
            height: 40,
          },
          warnings: [serializedWarning],
          textNodeIds: [],
        }),
    });
    const delivered: RecoverableError[] = [];
    const rehydrate = vi.spyOn(RecoverableError, "fromSerialized");
    try {
      const result = engine.renderToSvgAndIR(scene, {
        onWarning: (warning) => {
          delivered.push(warning);
          warning.message = "callback mutation";
          if (warning.context) {
            warning.context.owner = { id: "callback" };
          }
        },
      });

      expect(rehydrate).toHaveBeenCalledTimes(1);
      expect(result.ir.warnings).toHaveLength(1);
      expect(result.ir.warnings[0]).toBeInstanceOf(RecoverableError);
      expect(result.ir.warnings[0]?.message).toBe("retained warning");
      expect(result.ir.warnings[0]?.context).toEqual({ owner: { id: "root" } });
      expect(delivered[0]).not.toBe(result.ir.warnings[0]);
      expect(delivered[0]?.context).not.toBe(result.ir.warnings[0]?.context);
    } finally {
      rehydrate.mockRestore();
    }
  });

  it("accepts only the exact serialized Fatal shape at render boundaries", () => {
    const scene = createElement("Canvas", { width: 100, height: 40 });
    const strictEngine = new Engine({
      computeLayoutFn: () => "{}",
      renderToIrFn: () => {
        throw JSON.stringify({
          severity: "fatal",
          code: "STRICT_RENDER_FAILURE",
          message: "strict failure",
          stage: "ir",
          nodeId: "root",
          context: { reason: "fixture" },
        });
      },
    });
    expect(() => strictEngine.compile(scene)).toThrowError(
      expect.objectContaining({
        code: "STRICT_RENDER_FAILURE",
        message: "strict failure",
        stage: "ir",
        nodeId: "root",
        context: { reason: "fixture" },
      }),
    );

    for (const malformed of [
      { code: "LEGACY_FAILURE", message: "missing severity", stage: "ir" },
      {
        severity: "fatal",
        code: "EXTRA_FIELD_FAILURE",
        message: "extra field",
        stage: "ir",
        fallback: "not permitted",
      },
      {
        severity: "recoverable",
        code: "WRONG_SEVERITY_FAILURE",
        message: "wrong severity",
        stage: "ir",
        fallback: "continue",
      },
    ]) {
      const malformedEngine = new Engine({
        computeLayoutFn: () => "{}",
        renderToIrFn: () => {
          throw JSON.stringify(malformed);
        },
      });
      expect(() => malformedEngine.compile(scene)).toThrowError(
        expect.objectContaining({ code: "WASM_RENDER_FAILED", stage: "engine" }),
      );
    }
  });

  it.each([
    ["empty string", () => ""],
    ["symbol", () => Symbol("boundary")],
    ["BigInt", () => 42n],
    ["null-prototype object", () => Object.create(null) as object],
    [
      "throwing accessors and toString",
      () => {
        const value = {} as { message?: string; toString?: () => string };
        Object.defineProperty(value, "message", {
          enumerable: true,
          get: () => {
            throw new TypeError("message trap");
          },
        });
        value.toString = () => {
          throw new TypeError("toString trap");
        };
        return value;
      },
    ],
    [
      "hostile Proxy",
      () =>
        new Proxy(
          {},
          {
            getOwnPropertyDescriptor: () => {
              throw new TypeError("descriptor trap");
            },
            getPrototypeOf: () => {
              throw new TypeError("prototype trap");
            },
            get: () => {
              throw new TypeError("get trap");
            },
          },
        ),
    ],
  ] as const)("totally formats a %s render failure", (_name, createFailure) => {
    const scene = createElement("Canvas", { width: 100, height: 40 });
    const engine = new Engine({
      computeLayoutFn: () => "{}",
      renderToIrFn: () => {
        throw createFailure();
      },
    });
    expect(() => engine.compile(scene)).toThrowError(
      expect.objectContaining({ code: "WASM_RENDER_FAILED", stage: "engine" }),
    );
  });

  it("decodes all six measurement result contracts including nested flow and ruby fields", () => {
    const warning = {
      severity: "recoverable",
      code: "FLOW",
      message: "flow warning",
      stage: "text",
      fallback: "continue",
    } as const;
    expect(
      decodeTextFlowResult(
        JSON.stringify({
          lines: [
            { text: "A", charStart: 0, charEnd: 1, inlineAdvancePx: 10, availableInlineSizePx: 20 },
          ],
          exhausted: false,
          warnings: [warning],
        }),
      ).lines,
    ).toHaveLength(1);

    const fragmentStyle = {
      fontFamily: "Fixture",
      fontWeight: 400,
      fontStyle: "normal",
      fontSizePx: 16,
      letterSpacingPx: 1,
      color: "#123",
    };
    const flow = {
      lines: [
        {
          fragments: [
            {
              text: "A",
              charStart: 0,
              charEnd: 1,
              x: 0,
              y: 0,
              inlineAdvancePx: 10,
              availableInlineSizePx: 20,
              regionIndex: 0,
              baselineOffset: 12,
              overflowReason: "ellipsis",
              style: fragmentStyle,
              ruby: {
                text: "えー",
                position: "over",
                align: "center",
                style: fragmentStyle,
                gapPx: 1,
                offsetPx: 2,
                lineSizing: "stable",
                levels: [
                  {
                    text: "えー",
                    position: "over",
                    runs: [{ text: "えー", style: fragmentStyle }],
                  },
                ],
              },
            },
          ],
          lineIndex: 0,
          crossSize: 20,
        },
      ],
      exhausted: true,
      usedLineCount: 1,
      overflowReason: "maxLinesTruncated",
      chosenFontSizePx: 16,
      warnings: [warning],
      topRubyOverflowPx: 8,
      bottomRubyOverflowPx: 0,
    };
    expect(decodeTextFlowWithExclusionsResult(JSON.stringify(flow))).toEqual(flow);
    expect(
      decodeMeasureTextBlockResult(
        JSON.stringify({
          lineCount: 1,
          usedWidth: 10,
          usedHeight: 20,
          lines: [
            { charStart: 0, charEnd: 1, text: "A", inlineAdvancePx: 10, kinsokuUnresolved: false },
          ],
        }),
      ).lineCount,
    ).toBe(1);
    expect(
      decodeShrinkwrapTextResult(
        JSON.stringify({
          status: "satisfied",
          chosenWidthPx: 10,
          lineCount: 1,
          usedHeight: 20,
          maxLineWidth: 10,
        }),
      ).status,
    ).toBe("satisfied");
    expect(
      decodeShrinkwrapTextResult(
        JSON.stringify({
          status: "infeasible",
          chosenHeightPx: 40,
          lineCount: 2,
          usedWidth: 20,
          usedHeight: 40,
        }),
      ).status,
    ).toBe("infeasible");
    expect(
      decodeShrinkwrapFlowResult(
        JSON.stringify({
          status: "satisfied",
          chosenWidthPx: 20,
          usedLineCount: 1,
          usedHeight: 20,
          layout: flow,
        }),
      ).layout.lines,
    ).toHaveLength(1);
    expect(
      decodeIntrinsicInlineSizeResult(
        JSON.stringify({ minContentInlineSize: 10, maxContentInlineSize: 20, warnings: [warning] }),
      ).maxContentInlineSize,
    ).toBe(20);
  });

  it("routes all six WasmEngineHandle measurement methods through their decoders", () => {
    const malformedResult = (): string => JSON.stringify({ invalid: true });
    const handle = new WasmEngineHandle({
      register_font: () => undefined,
      compute_layout: () => "{}",
      layout_text_flow: malformedResult,
      layout_text_flow_with_exclusions: malformedResult,
      measure_text_block: malformedResult,
      shrinkwrap_text: malformedResult,
      shrinkwrap_flow: malformedResult,
      measure_intrinsic_inline_size: malformedResult,
      free: () => undefined,
    } as unknown as WasmEngineInstance);

    const common = { text: "A", fontFamily: "Fixture", fontSizePx: 16 };
    expectCode(
      () => handle.layoutTextFlow({ ...common, letterSpacingPx: 0, lineWidths: [100] }),
      "WASM_INVALID_FLOW_OUTPUT",
    );
    expectCode(
      () =>
        handle.layoutTextFlowWithExclusions({
          ...common,
          flowBox: { x: 0, y: 0, width: 100, height: 40 },
          exclusions: [],
        }),
      "WASM_INVALID_EXCLUSION_FLOW_OUTPUT",
    );
    expectCode(
      () => handle.measureTextBlock({ ...common, maxWidth: 100 }),
      "WASM_INVALID_MEASURE_OUTPUT",
    );
    expectCode(
      () => handle.shrinkwrapText({ ...common, maxWidth: 100 }),
      "WASM_INVALID_SHRINKWRAP_OUTPUT",
    );
    expectCode(
      () =>
        handle.shrinkwrapFlow({
          ...common,
          flowBox: { x: 0, y: 0, width: 100, height: 40 },
          exclusions: [],
        }),
      "WASM_INVALID_SHRINKWRAP_FLOW_OUTPUT",
    );
    expectCode(
      () => handle.measureIntrinsicInlineSize(common),
      "WASM_INVALID_INTRINSIC_INLINE_SIZE_OUTPUT",
    );
    handle.dispose();
  });

  it.each([
    ["layoutTextFlowWithExclusions", "layout_text_flow_with_exclusions"],
    ["shrinkwrapText", "shrinkwrap_text"],
    ["shrinkwrapFlow", "shrinkwrap_flow"],
  ] as const)("preserves a structured fatal text error from %s", (method, wasmMethod) => {
    const handle = new WasmEngineHandle({
      [wasmMethod]: () => {
        throw JSON.stringify({
          severity: "fatal",
          code: "TEXT_ELLIPSIS_CANDIDATE_LIMIT",
          message: "exact candidate budget exceeded",
          stage: "text",
        });
      },
      free: () => undefined,
    } as unknown as WasmEngineInstance);

    const common = {
      text: "A",
      fontFamily: "Fixture",
      fontSizePx: 16,
    };
    const invoke = {
      layoutTextFlowWithExclusions: () =>
        handle.layoutTextFlowWithExclusions({
          ...common,
          flowBox: { x: 0, y: 0, width: 100, height: 40 },
          exclusions: [],
        }),
      shrinkwrapText: () => handle.shrinkwrapText({ ...common, maxWidth: 100 }),
      shrinkwrapFlow: () =>
        handle.shrinkwrapFlow({
          ...common,
          flowBox: { x: 0, y: 0, width: 100, height: 40 },
          exclusions: [],
        }),
    }[method];

    expect(invoke).toThrowError(
      expect.objectContaining({
        name: "FatalError",
        code: "TEXT_ELLIPSIS_CANDIDATE_LIMIT",
        message: "exact candidate budget exceeded",
        stage: "text",
      }),
    );
    handle.dispose();
  });

  it("rejects invalid measurement optional fields, array elements, and nested enums", () => {
    expectCode(
      () => decodeTextFlowResult(JSON.stringify({ lines: [null], exhausted: false })),
      "WASM_INVALID_FLOW_OUTPUT",
    );
    expectCode(
      () =>
        decodeTextFlowWithExclusionsResult(
          JSON.stringify({
            lines: [],
            exhausted: true,
            usedLineCount: 0,
            overflowReason: "overflow",
            topRubyOverflowPx: 0,
            bottomRubyOverflowPx: 0,
          }),
        ),
      "WASM_INVALID_EXCLUSION_FLOW_OUTPUT",
    );
    expectCode(
      () =>
        decodeMeasureTextBlockResult(
          JSON.stringify({ lineCount: 1, usedWidth: 10, usedHeight: 20, lines: [{ text: "A" }] }),
        ),
      "WASM_INVALID_MEASURE_OUTPUT",
    );
    expectCode(
      () =>
        decodeShrinkwrapTextResult(
          JSON.stringify({
            status: "satisfied",
            chosenWidthPx: 10,
            chosenHeightPx: 20,
            lineCount: 1,
            usedWidth: 10,
            usedHeight: 20,
            maxLineWidth: 10,
          }),
        ),
      "WASM_INVALID_SHRINKWRAP_OUTPUT",
    );
    expectCode(
      () =>
        decodeShrinkwrapFlowResult(
          JSON.stringify({
            status: "satisfied",
            usedLineCount: 0,
            usedHeight: 0,
            layout: {
              lines: [],
              exhausted: true,
              usedLineCount: 0,
              topRubyOverflowPx: "0",
              bottomRubyOverflowPx: 0,
            },
          }),
        ),
      "WASM_INVALID_SHRINKWRAP_FLOW_OUTPUT",
    );
    expectCode(
      () =>
        decodeIntrinsicInlineSizeResult(
          JSON.stringify({
            minContentInlineSize: 10,
            maxContentInlineSize: 20,
            warnings: [{ severity: "info", code: "X", message: "x" }],
          }),
        ),
      "WASM_INVALID_INTRINSIC_INLINE_SIZE_OUTPUT",
    );
  });
});
