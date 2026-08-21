import { describe, expect, it } from "vitest";
import { toSceneDocument } from "../src/scene/from-vnode.js";
import { validate } from "../src/validate/index.js";
import { createElement } from "../src/vnode/create-element.js";

/**
 * Regressions: out-of-contract layout inputs used to pass validate() and
 * silently turn into different values downstream (NaN → unspecified, "50%" →
 * 0, unknown enums → defaults, bad grid tracks → auto, string children and
 * un-typed image bytes → dropped). The contract is enforced at validation.
 */
function canvasWith(
  props: Record<string, unknown>,
  type = "Box",
): ReturnType<typeof createElement> {
  return createElement(
    "Canvas",
    { width: 300, height: 200 },
    createElement(type as "Box", { width: 50, height: 50, ...props }),
  );
}

describe("layout number contracts", () => {
  it.each([
    ["width", Number.NaN],
    ["width", Number.POSITIVE_INFINITY],
    ["width", -10],
    ["height", Number.NaN],
    ["minWidth", -1],
    ["gap", Number.NaN],
    ["flexGrow", -1],
  ])("rejects %s = %s", (key, value) => {
    expect(() => validate(canvasWith({ [key]: value }))).toThrow(/finite|negative/);
  });

  it("rejects percentage strings (px-only contract)", () => {
    expect(() => validate(canvasWith({ width: "50%" }))).toThrow(/finite number in px/);
  });

  it("rejects aspectRatio <= 0", () => {
    expect(() => validate(canvasWith({ aspectRatio: 0 }))).toThrow(/aspectRatio/);
    expect(() => validate(canvasWith({ aspectRatio: -2 }))).toThrow(/aspectRatio/);
  });

  it("rejects non-finite inset offsets but allows negative ones", () => {
    expect(() => validate(canvasWith({ top: Number.NaN }))).toThrow(/finite/);
    expect(() => validate(canvasWith({ position: "absolute", top: -5 }))).not.toThrow();
  });

  it("rejects malformed spacing tuples", () => {
    expect(() => validate(canvasWith({ padding: [1, 2] }))).toThrow(/tuple/);
    expect(() => validate(canvasWith({ margin: [1, 2, 3, Number.NaN] }))).toThrow(/tuple/);
  });

  it("accepts valid numbers, tuples, and flexBasis auto", () => {
    expect(() =>
      validate(
        canvasWith({
          padding: [1, 2, 3, 4],
          margin: -4,
          flexBasis: "auto",
          aspectRatio: 1.5,
        }),
      ),
    ).not.toThrow();
  });

  it("reports visual numeric errors before later layout enum errors", () => {
    expect(() =>
      validate(
        canvasWith({
          id: "both-invalid",
          position: "fixed",
          opacity: Number.NaN,
        }),
      ),
    ).toThrowError(
      "Validation error: 'opacity' must be a finite number in px, got null (both-invalid)",
    );
  });
});

describe("layout enum contracts", () => {
  it.each([
    ["position", "fixed"],
    ["overflow", "scroll"],
  ])("rejects %s = %s on any node", (key, value) => {
    expect(() => validate(canvasWith({ [key]: value }))).toThrow(/must be one of/);
  });

  it("rejects unknown Flex enums", () => {
    expect(() => validate(canvasWith({ direction: "sideways" }, "Flex"))).toThrow(/direction/);
    expect(() => validate(canvasWith({ justifyContent: "middle" }, "Flex"))).toThrow(
      /justifyContent/,
    );
  });

  it("does not confuse Text wrap with Flex wrap", () => {
    expect(() =>
      validate(
        createElement(
          "Canvas",
          { width: 300, height: 200 },
          createElement("Text", { font: "F", fontSizePx: 16, wrap: "char" }, "text"),
        ),
      ),
    ).not.toThrow();
  });
});

describe("grid contracts", () => {
  it("rejects grid placements with trailing garbage", () => {
    expect(() => validate(canvasWith({ gridColumn: "2junk" }, "Grid"))).toThrow(/gridColumn/);
  });

  it("accepts supported placement forms", () => {
    for (const value of ["2", "2 / 4", "1 / span 2"]) {
      expect(() => validate(canvasWith({ gridColumn: value }))).not.toThrow();
    }
  });

  it("rejects unsupported track syntax instead of silently using auto", () => {
    for (const template of ["minmax(100px, 1fr) 50px", "minmax(100px,1fr) 50px", "garbage 50px"]) {
      expect(() =>
        validate(
          createElement(
            "Canvas",
            { width: 300, height: 200 },
            createElement("Grid", { templateColumns: template, width: 200, height: 100 }),
          ),
        ),
      ).toThrow(/unsupported track/);
    }
  });

  it("accepts supported track syntax", () => {
    expect(() =>
      validate(
        createElement(
          "Canvas",
          { width: 300, height: 200 },
          createElement("Grid", {
            templateColumns: "100px 1fr auto 2.5fr 30",
            width: 200,
            height: 100,
          }),
        ),
      ),
    ).not.toThrow();
  });
});

describe("container string children", () => {
  it.each([
    "Canvas",
    "Flex",
    "Grid",
    "Box",
  ] as const)("rejects a string child of <%s> (it was silently dropped)", (type) => {
    const container =
      type === "Canvas"
        ? createElement("Canvas", { width: 100, height: 100, children: ["lost"] })
        : createElement(
            "Canvas",
            { width: 100, height: 100 },
            createElement(type, { width: 50, height: 50, children: ["lost"] }),
          );
    expect(() => validate(container)).toThrow(/string child/);
  });

  it("still accepts string children on text-bearing nodes", () => {
    expect(() =>
      validate(
        createElement(
          "Canvas",
          { width: 100, height: 100 },
          createElement("Text", { font: "F", fontSizePx: 16 }, "ok"),
        ),
      ),
    ).not.toThrow();
  });
});

describe("Image binary src contracts", () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  it("validate rejects Uint8Array src without mediaType", () => {
    expect(() =>
      validate(
        createElement(
          "Canvas",
          { width: 100, height: 100 },
          createElement("Image", { src: bytes, width: 50, height: 50 }),
        ),
      ),
    ).toThrow(/mediaType/);
  });

  it('toSceneDocument rejects it too instead of writing src: ""', () => {
    expect(() =>
      toSceneDocument(createElement("Image", { src: bytes, width: 50, height: 50 })),
    ).toThrow(/mediaType/);
  });
});

describe("boxShadow contract", () => {
  it("rejects unparseable boxShadow instead of dropping it silently", () => {
    // CSS px units are outside the API contract (all units are px numbers).
    // These used to parse to `undefined` in the IR builder and vanish — the
    // render reported success with no shadow and no warning.
    expect(() => validate(canvasWith({ boxShadow: "2px 2px 4px #000000" }))).toThrow(/boxShadow/);
    expect(() => validate(canvasWith({ boxShadow: "not a shadow" }))).toThrow(/boxShadow/);
    expect(() => validate(canvasWith({ boxShadow: "4" }))).toThrow(/boxShadow/);
    expect(() => validate(canvasWith({ boxShadow: 5 }))).toThrow(/boxShadow/);
  });

  it("rejects a boxShadow whose color half is not a color", () => {
    expect(() => validate(canvasWith({ boxShadow: "0 4 8 0 notacolor" }))).toThrow();
    expect(() => validate(canvasWith({ boxShadow: "0 4 -8 0 #000000" }))).toThrow(/boxShadow/);
  });

  it("accepts the documented forms", () => {
    for (const shadow of [
      "0 4 8 0 rgba(0,0,0,0.2)",
      "0 4 8 rgba(0,0,0,0.2)",
      "2 2 4 0 #000000",
      "0 4 8 0 #00000033",
      "2 2",
    ]) {
      expect(() => validate(canvasWith({ boxShadow: shadow })), shadow).not.toThrow();
    }
  });
});
