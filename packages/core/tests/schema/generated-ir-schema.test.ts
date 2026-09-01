import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import type {
  IrNode as GeneratedIrNode,
  GeneratedStructuralIr,
} from "../../src/generated/ir/structural-ir.js";
import { validateStructuralIr } from "../../src/generated/ir/structural-ir-validator.js";
import { validateSerializedIR } from "../../src/ir/output-validator.js";
import { createElement } from "../../src/vnode/create-element.js";
import { createConformanceEngine } from "../conformance/conformance-engine.js";
import { CONFORMANCE_SCENES } from "../conformance/scenes/index.js";

type SchemaObject = Record<string, unknown>;

const generatedDirectory = fileURLToPath(new URL("../../src/generated/ir/", import.meta.url));
const outputSchemaPath = `${generatedDirectory}structural-ir.schema.json`;
const inputSchemaPath = `${generatedDirectory}emit-ir-input.schema.json`;
const outputTypesPath = `${generatedDirectory}structural-ir.ts`;
const outputValidatorPath = `${generatedDirectory}structural-ir-validator.js`;

function readSchema(path: string): SchemaObject {
  return JSON.parse(readFileSync(path, "utf8")) as SchemaObject;
}

function asObject(value: unknown, context: string): SchemaObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${context} is not an object`);
  }
  return value as SchemaObject;
}

function asArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${context} is not an array`);
  }
  return value;
}

function definition(schema: SchemaObject, name: string): SchemaObject {
  const definitions = asObject(schema.$defs, "$defs");
  return asObject(definitions[name], `$defs.${name}`);
}

function properties(schema: SchemaObject, context: string): SchemaObject {
  return asObject(schema.properties, `${context}.properties`);
}

function requiredFields(schema: SchemaObject): string[] {
  return asArray(schema.required ?? [], "required").map((field) => {
    if (typeof field !== "string") {
      throw new TypeError("required entry is not a string");
    }
    return field;
  });
}

function schemaAllowsNull(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null) {
    return false;
  }
  if (Array.isArray(schema)) {
    return schema.some(schemaAllowsNull);
  }
  const object = schema as SchemaObject;
  if (object.type === "null") {
    return true;
  }
  if (Array.isArray(object.type) && object.type.includes("null")) {
    return true;
  }
  if (Array.isArray(object.enum) && object.enum.includes(null)) {
    return true;
  }
  return [object.anyOf, object.oneOf].some(schemaAllowsNull);
}

function schemaKeywordInventory(schema: unknown): { formats: number; nullable: number } {
  let formats = 0;
  let nullable = 0;
  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    const object = value as SchemaObject;
    if (object.format !== undefined) {
      formats += 1;
    }
    if (
      object.type === "null" ||
      (Array.isArray(object.type) && object.type.includes("null")) ||
      (Array.isArray(object.enum) && object.enum.includes(null))
    ) {
      nullable += 1;
    }
    for (const nested of Object.values(object)) {
      visit(nested);
    }
  };
  visit(schema);
  return { formats, nullable };
}

function collectNodes(root: GeneratedIrNode): GeneratedIrNode[] {
  const nodes: GeneratedIrNode[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    nodes.push(node);
    if (node.type === "group") {
      pending.push(...(node.children ?? []));
    }
  }
  return nodes;
}

function validatorMessage(errors: readonly ErrorObject[] | null | undefined): string {
  return JSON.stringify(errors ?? [], null, 2);
}

function fullGraphScene(imageBytes: Uint8Array) {
  const shapeGeometry = {
    viewBox: { width: 10, height: 10 },
    root: { kind: "path" as const, d: "M0 0H10V10H0Z" },
  };
  return createElement(
    "Canvas",
    { id: "schema-root", width: 360, height: 180, background: "#ffffff" },
    createElement("Box", {
      id: "schema-rect",
      position: "absolute",
      left: 4,
      top: 4,
      width: 40,
      height: 30,
      background: "#123456",
      animate: {
        keyframes: [
          { at: 0, opacity: 0.5 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 200,
        easing: { type: "steps", count: 2, position: "jump-end" },
        iterations: "infinite",
        fill: "both",
      },
    }),
    createElement(
      "Text",
      {
        id: "schema-text",
        position: "absolute",
        left: 50,
        top: 4,
        width: 100,
        height: 34,
        font: "NotoSansJP",
        fontSizePx: 18,
        color: "#222222",
      },
      "Schema",
    ),
    createElement("Image", {
      id: "schema-image",
      position: "absolute",
      left: 4,
      top: 48,
      width: 24,
      height: 24,
      src: imageBytes,
      mediaType: "image/png",
    }),
    createElement("Path", {
      id: "schema-path",
      position: "absolute",
      left: 36,
      top: 48,
      width: 40,
      height: 24,
      d: "M0 0L40 24",
      fill: "none",
      stroke: "#ff0000",
      strokeWidth: 2,
    }),
    createElement("Svg", {
      id: "schema-svg",
      position: "absolute",
      left: 84,
      top: 48,
      width: 30,
      height: 24,
      content: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
      preserveAspectRatio: "meet",
    }),
    createElement("Shape", {
      id: "schema-shape",
      position: "absolute",
      left: 122,
      top: 48,
      width: 30,
      height: 24,
      geometry: shapeGeometry,
      fill: "#00aa55",
      emitPartIds: true,
    }),
  );
}

const outputSchema = readSchema(outputSchemaPath);
const inputSchema = readSchema(inputSchemaPath);

describe("generated directional IR schemas", () => {
  it("preserves recursive flattened tagged nodes with all seven variants", () => {
    const irNode = definition(outputSchema, "IrNode");
    const variants = asArray(irNode.oneOf, "$defs.IrNode.oneOf").map((variant, index) => {
      const variantProperties = properties(
        asObject(variant, `IrNode variant ${index}`),
        `IrNode variant ${index}`,
      );
      return asObject(variantProperties.type, `IrNode variant ${index}.type`).const;
    });
    expect(variants).toEqual(["group", "rect", "text", "image", "path", "svg", "shape"]);

    const group = asObject(asArray(irNode.oneOf, "IrNode.oneOf")[0], "group variant");
    const children = asObject(properties(group, "group").children, "group.children");
    expect(asObject(children.items, "group.children.items").$ref).toBe("#/$defs/IrNode");
  });

  it("uses the concrete serializer projection and a separate deserialize line view", () => {
    const outputLine = definition(outputSchema, "LineProjection");
    expect(Object.keys(properties(outputLine, "LineProjection"))).toEqual([
      "text",
      "glyphs",
      "width",
      "baselineY",
      "fragments",
      "positionedGlyphs",
    ]);
    const outputStyle = definition(outputSchema, "TextRunStyleProjection");
    expect(requiredFields(outputStyle)).toContain("color");

    const inputLine = definition(inputSchema, "LineWire");
    expect(Object.keys(properties(inputLine, "LineWire"))).toEqual([
      "text",
      "glyphs",
      "width",
      "baselineY",
      "fragments",
      "positionedGlyphs",
    ]);
    expect(definition(inputSchema, "LineFragmentWire")).toBeDefined();
    expect(definition(inputSchema, "TextRunStyle")).toBeDefined();
  });

  it("models omit-none output separately from defaulted nullable input", () => {
    const outputProperties = properties(outputSchema, "output IR");
    const inputProperties = properties(inputSchema, "emit input");
    expect(outputProperties.warnings).toBeUndefined();
    expect(inputProperties.warnings).toBeUndefined();
    expect(requiredFields(outputSchema)).not.toContain("debug");
    expect(schemaAllowsNull(outputProperties.debug)).toBe(false);
    expect(requiredFields(inputSchema)).not.toContain("debug");
    expect(schemaAllowsNull(inputProperties.debug)).toBe(true);

    const outputText = asObject(
      asArray(definition(outputSchema, "IrNode").oneOf, "output variants")[2],
      "output text variant",
    );
    const inputText = asObject(
      asArray(definition(inputSchema, "IrNode").oneOf, "input variants")[2],
      "input text variant",
    );
    expect(schemaAllowsNull(properties(outputText, "output text").fontStyle)).toBe(false);
    expect(schemaAllowsNull(properties(inputText, "input text").fontStyle)).toBe(true);
    expect(schemaKeywordInventory(outputSchema)).toEqual({ formats: 0, nullable: 0 });
    expect(schemaKeywordInventory(inputSchema).nullable).toBeGreaterThan(0);
  });

  it("accepts an exact SerializedIR with a non-empty top-level warning list", () => {
    const serializedIr = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 10, h: 10 },
        children: [],
      },
      drawOrder: ["root"],
      width: 10,
      height: 10,
      warnings: [
        {
          severity: "recoverable",
          code: "SERIALIZED_IR_WARNING",
          message: "retained warning",
          fallback: "retained output",
          stage: "ir",
          nodeId: "root",
          context: { owner: { id: "root" } },
        },
      ],
    };

    expect(validateSerializedIR(serializedIr)).toBe(true);
    expect(validateStructuralIr(serializedIr)).toBe(true);
    expect(validateSerializedIR({ ...serializedIr, warnings: [] })).toBe(true);
    expect(
      validateSerializedIR({
        ...serializedIr,
        warnings: [{ ...serializedIr.warnings[0], stage: undefined }],
      }),
    ).toBe(false);

    const sparseWarnings = new Array(1);
    expect(validateSerializedIR({ ...serializedIr, warnings: sparseWarnings })).toBe(false);

    let warningGetterCalls = 0;
    const accessorWarnings = new Array(1);
    Object.defineProperty(accessorWarnings, "0", {
      enumerable: true,
      get() {
        warningGetterCalls += 1;
        return serializedIr.warnings[0];
      },
    });
    expect(validateSerializedIR({ ...serializedIr, warnings: accessorWarnings })).toBe(false);
    expect(warningGetterCalls).toBe(0);

    let descriptorCalls = 0;
    const hostileWarnings = new Proxy([serializedIr.warnings[0]], {
      getOwnPropertyDescriptor() {
        descriptorCalls += 1;
        throw new Error("descriptor must be contained");
      },
    });
    expect(validateSerializedIR({ ...serializedIr, warnings: hostileWarnings })).toBe(false);
    expect(descriptorCalls).toBe(1);
  });

  it("preserves untagged easing order and resolves cross-crate schema types", () => {
    const easingVariants = asArray(
      definition(outputSchema, "AnimationEasing").anyOf,
      "AnimationEasing.anyOf",
    );
    expect(asObject(easingVariants[0], "named easing").enum).toEqual([
      "linear",
      "ease",
      "ease-in",
      "ease-out",
      "ease-in-out",
      "step-start",
      "step-end",
    ]);
    expect(asObject(easingVariants[1], "cubic easing").type).toBe("array");
    expect(asObject(easingVariants[2], "spring easing").$ref).toBe("#/$defs/AnimationSpring");
    expect(asObject(easingVariants[3], "steps easing").$ref).toBe("#/$defs/AnimationSteps");

    expect(definition(outputSchema, "Transform2D")).toBeDefined();
    expect(definition(outputSchema, "TextUnitMap")).toBeDefined();
    expect(definition(outputSchema, "PositionedGlyph")).toBeDefined();
  });

  it("contains no any or unknown escape hatch in a generated known field", () => {
    const sourceText = readFileSync(outputTypesPath, "utf8");
    const sourceFile = ts.createSourceFile(
      outputTypesPath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const forbiddenFields: string[] = [];
    let knownFieldCount = 0;
    const visit = (node: ts.Node): void => {
      if (ts.isPropertySignature(node) && node.type) {
        knownFieldCount += 1;
        const propertyName = node.name.getText(sourceFile);
        const inspectType = (typeNode: ts.Node): void => {
          if (
            typeNode.kind === ts.SyntaxKind.AnyKeyword ||
            typeNode.kind === ts.SyntaxKind.UnknownKeyword
          ) {
            forbiddenFields.push(propertyName);
          }
          ts.forEachChild(typeNode, inspectType);
        };
        inspectType(node.type);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    expect(sourceFile.parseDiagnostics).toEqual([]);
    expect(knownFieldCount).toBe(320);
    expect(forbiddenFields).toEqual([]);
  });

  it("ships standalone ESM without a runtime compiler or dynamic evaluation", () => {
    const validatorSource = readFileSync(outputValidatorPath, "utf8");
    const sourceFile = ts.createSourceFile(
      outputValidatorPath,
      validatorSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const imports: string[] = [];
    const dynamicEvaluation: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        imports.push(node.moduleSpecifier.getText(sourceFile));
      }
      if (
        (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === "eval" || node.expression.text === "Function")
      ) {
        dynamicEvaluation.push(node.expression.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    expect(imports).toEqual([]);
    expect(dynamicEvaluation).toEqual([]);
    expect(validatorSource).toContain("export const validateStructuralIr");
  });
});

describe("generated IR validator against real WASM output", () => {
  let engine: Engine;
  let actualCorpus: GeneratedStructuralIr[];
  let inputValidator: ValidateFunction;
  const schemaDiagnostics: string[] = [];

  beforeAll(async () => {
    const inputAjv = new Ajv2020({
      allErrors: true,
      strict: true,
      logger: {
        log() {},
        warn(message) {
          schemaDiagnostics.push(String(message));
        },
        error(message) {
          schemaDiagnostics.push(String(message));
        },
      },
    });
    inputValidator = inputAjv.compile(inputSchema);

    engine = await createConformanceEngine();
    const conformanceIr = CONFORMANCE_SCENES.map((scene) =>
      scene.animatedSvg
        ? engine.renderToAnimatedSvgAndIR(scene.build(), {
            ...scene.renderOptions,
            playback: { mode: "independent" },
          }).ir
        : engine.renderToSvgAndIR(scene.build(), scene.renderOptions).ir,
    );
    const imageBytes = engine.renderToPng(
      createElement("Canvas", { width: 2, height: 2, background: "#336699" }),
    );
    const fullGraphIr = engine.renderToSvgAndIR(fullGraphScene(imageBytes), {
      timeMs: 100,
    }).ir;
    actualCorpus = [...conformanceIr, fullGraphIr] as GeneratedStructuralIr[];
  });

  afterAll(() => {
    engine.dispose();
  });

  it("accepts the real corpus and executes every output node variant", () => {
    const nodeTypes = new Set<string>();
    for (const ir of actualCorpus) {
      expect(validateStructuralIr(ir), validatorMessage(validateStructuralIr.errors)).toBe(true);
      for (const node of collectNodes(ir.root)) {
        nodeTypes.add(node.type);
      }
    }
    expect(nodeTypes).toEqual(new Set(["group", "rect", "text", "image", "path", "svg", "shape"]));
    expect(schemaDiagnostics).toEqual([]);
  });

  it("rejects required deletion, wrong primitives, discriminants, enums, and output null", () => {
    const requiredDeletion = structuredClone(actualCorpus[0]);
    Reflect.deleteProperty(requiredDeletion, "width");
    expect(validateStructuralIr(requiredDeletion)).toBe(false);

    const wrongPrimitive = structuredClone(actualCorpus[0]);
    Reflect.set(wrongPrimitive, "height", "180");
    expect(validateStructuralIr(wrongPrimitive)).toBe(false);

    const unknownDiscriminant = structuredClone(actualCorpus.at(-1));
    Reflect.set(unknownDiscriminant.root, "type", "video");
    expect(validateStructuralIr(unknownDiscriminant)).toBe(false);

    const closedEnum = structuredClone(actualCorpus.at(-1));
    const textNode = collectNodes(closedEnum.root).find((node) => node.type === "text");
    if (!textNode || textNode.type !== "text") {
      throw new TypeError("full-graph fixture has no text node");
    }
    Reflect.set(textNode, "fontStyle", "oblique");
    expect(validateStructuralIr(closedEnum)).toBe(false);

    const outputNull = structuredClone(actualCorpus[0]);
    Reflect.set(outputNull, "debug", null);
    expect(validateStructuralIr(outputNull)).toBe(false);

    const nestedEffectNull = structuredClone(actualCorpus.at(-1));
    const nestedTextNode = collectNodes(nestedEffectNull.root).find((node) => node.type === "text");
    if (!nestedTextNode || nestedTextNode.type !== "text") {
      throw new TypeError("full-graph fixture has no text node");
    }
    nestedTextNode.strokes = [{ color: "#ffffff", widthPx: 2, linejoin: "round" }];
    Reflect.set(nestedTextNode.strokes[0] ?? {}, "linejoin", null);
    expect(validateStructuralIr(nestedEffectNull)).toBe(false);
  });

  it("accepts optional omission and only the deserialize contract's permitted null", () => {
    const optionalOutput = structuredClone(actualCorpus[0]);
    Reflect.set(optionalOutput, "debug", true);
    expect(
      validateStructuralIr(optionalOutput),
      validatorMessage(validateStructuralIr.errors),
    ).toBe(true);
    Reflect.deleteProperty(optionalOutput, "debug");
    expect(
      validateStructuralIr(optionalOutput),
      validatorMessage(validateStructuralIr.errors),
    ).toBe(true);

    const emitInput = {
      root: actualCorpus[0]?.root,
      width: actualCorpus[0]?.width,
      height: actualCorpus[0]?.height,
      debug: null,
    };
    expect(inputValidator(emitInput), validatorMessage(inputValidator.errors)).toBe(true);
  });
});
