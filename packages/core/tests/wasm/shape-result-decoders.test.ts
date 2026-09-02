import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import {
  decodeCompiledShapePaths,
  decodeDividedShapeRegions,
  decodeEvaluatedShapeParts,
  decodeEvaluatedShapeRegion,
  decodeResolvedShapeGeometry,
  decodeShapeHits,
  decodeShapeIntersections,
  decodeShapeRawString,
} from "../../src/wasm/shape-result-decoders.js";

const LINE_REGION = {
  contours: [
    {
      segments: [
        {
          kind: "line",
          p0: { x: 0, y: 0 },
          p1: { x: 10, y: 10 },
        },
      ],
    },
  ],
};

function captureFatal(callback: () => unknown): FatalError {
  let capturedError: unknown;
  try {
    callback();
  } catch (error) {
    capturedError = error;
  }
  expect(capturedError).toBeInstanceOf(FatalError);
  return capturedError as FatalError;
}

describe("shape success decoders", () => {
  it("accepts both raw SVG routes without rewriting bytes", () => {
    const svg = '<svg viewBox="0 0 1 1"><path d="M-0,-0"/></svg>';
    expect(decodeShapeRawString(svg, "compileShapeSvg")).toBe(svg);
    expect(decodeShapeRawString(svg, "renderShapeRegionSvg")).toBe(svg);
  });

  it("accepts all seven JSON result roots and preserves unknown fields", () => {
    expect(decodeShapeHits('[{"partId":"body","hit":"fill","future":true}]')).toEqual([
      { partId: "body", hit: "fill", future: true },
    ]);

    expect(
      decodeCompiledShapePaths(
        '[{"d":"M0,0Z","partId":"body","strokeD":"M0,0","bounds":{"x":0,"y":0,"width":10,"height":10},"future":true}]',
      ),
    ).toEqual([
      {
        d: "M0,0Z",
        partId: "body",
        strokeD: "M0,0",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        future: true,
      },
    ]);

    expect(
      decodeResolvedShapeGeometry(
        JSON.stringify({
          viewBox: { x: 0, y: 0, width: 10, height: 10, future: true },
          root: {
            kind: "transform",
            transform: { translateX: 2 },
            child: { kind: "path", d: "M0 0Z", fillRule: "evenodd" },
          },
          future: true,
        }),
      ),
    ).toMatchObject({ future: true, viewBox: { future: true } });

    expect(
      decodeEvaluatedShapeParts(
        JSON.stringify([
          {
            partId: "body",
            region: LINE_REGION,
            strokeRegion: LINE_REGION,
            bounds: { x: 0, y: 0, width: 10, height: 10 },
            future: true,
          },
        ]),
      ),
    ).toMatchObject([{ partId: "body", future: true }]);

    expect(
      decodeEvaluatedShapeRegion(JSON.stringify({ ...LINE_REGION, future: true })),
    ).toMatchObject({ future: true });
    expect(
      decodeDividedShapeRegions(
        JSON.stringify({ subtract: LINE_REGION, intersect: LINE_REGION, future: true }),
      ),
    ).toMatchObject({ future: true });
    expect(
      decodeShapeIntersections(
        JSON.stringify([
          {
            point: { x: 5, y: 5 },
            tA: 0.5,
            tB: 0.25,
            contourIndexA: 0,
            segmentIndexA: 1,
            contourIndexB: 2,
            segmentIndexB: 3,
            future: true,
          },
        ]),
      ),
    ).toMatchObject([{ future: true }]);
  });

  it("preserves missing compile-path optionals and rejects present null", () => {
    const decoded = decodeCompiledShapePaths('[{"d":"M0,0Z"}]');
    expect(decoded).toEqual([{ d: "M0,0Z" }]);
    expect(Object.hasOwn(decoded[0]!, "partId")).toBe(false);
    expect(Object.hasOwn(decoded[0]!, "strokeD")).toBe(false);
    expect(Object.hasOwn(decoded[0]!, "bounds")).toBe(false);

    for (const field of ["partId", "strokeD", "bounds"] as const) {
      const fatalError = captureFatal(() =>
        decodeCompiledShapePaths(JSON.stringify([{ d: "M0,0Z", [field]: null }])),
      );
      expect(fatalError.toJSON()).toMatchObject({
        code: "SHAPE_OUTPUT_INVALID",
        message: "Shape operation returned invalid output.",
        stage: "wasm",
        context: {
          operation: "compileShapePaths",
          phase: "decode",
          protocolPath: `$[0].${field}`,
          received: "null",
        },
      });
    }
  });

  it("requires stroke geometry on every evaluated part", () => {
    const fatalError = captureFatal(() =>
      decodeEvaluatedShapeParts(JSON.stringify([{ partId: "body", region: LINE_REGION }])),
    );
    expect(fatalError.context).toEqual({
      operation: "evaluateShapeParts",
      phase: "decode",
      protocolPath: "$[0].strokeRegion",
      received: "undefined",
    });
  });

  it("rejects malformed JSON, wrong discriminants, null numbers, and unsafe indexes", () => {
    expect(captureFatal(() => decodeShapeHits("{")).context).toMatchObject({
      operation: "hitTestShapeParts",
      phase: "decode",
      protocolPath: "$",
    });

    expect(
      captureFatal(() =>
        decodeEvaluatedShapeRegion(
          JSON.stringify({
            contours: [
              {
                segments: [{ kind: "arc", p0: { x: 0, y: 0 }, p1: { x: 1, y: 1 } }],
              },
            ],
          }),
        ),
      ).context,
    ).toMatchObject({ protocolPath: "$.contours[0].segments[0].kind" });

    expect(
      captureFatal(() =>
        decodeCompiledShapePaths('[{"d":"M0,0Z","bounds":{"x":0,"y":0,"width":null,"height":1}}]'),
      ).context,
    ).toMatchObject({ protocolPath: "$[0].bounds.width", received: "null" });

    expect(
      captureFatal(() =>
        decodeShapeIntersections(
          JSON.stringify([
            {
              point: { x: 0, y: 0 },
              tA: 0,
              tB: 0,
              contourIndexA: -1,
              segmentIndexA: 0,
              contourIndexB: 0,
              segmentIndexB: 0,
            },
          ]),
        ),
      ).context,
    ).toMatchObject({ protocolPath: "$[0].contourIndexA" });
  });

  it("describes a hostile raw output without exposing it", () => {
    const hostileOutput = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new TypeError("unreadable value");
        },
      },
    );
    const fatalError = captureFatal(() =>
      decodeShapeRawString(hostileOutput, "renderShapeRegionSvg"),
    );
    expect(fatalError.context).toEqual({
      operation: "renderShapeRegionSvg",
      phase: "decode",
      protocolPath: "$",
      received: "uninspectable object",
    });
  });
});
