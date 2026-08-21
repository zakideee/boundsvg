import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CliOptions } from "../src/cli.js";
import { parseArgs, parseConvertArgs } from "../src/cli.js";
import { convertSceneToComponent, convertSvgToComponent } from "../src/convert.js";

// Fixture path (reuse core's fixtures)
const fixturesDir = resolve(__dirname, "../../core/tests/svg/fixtures");
const thirdPartyFixturesDir = resolve(
  __dirname,
  "../../../fixtures/third-party-svg/fluentui-emoji",
);

describe("parseConvertArgs", () => {
  it("parses minimal required args", () => {
    const parsed = parseConvertArgs(["--input", "card.svg", "--default-font", "NotoSansJP"]);
    expect(parsed).not.toBeNull();
    const options = parsed!.options;
    expect(options.input).toBe("card.svg");
    expect(options.defaultFont).toBe("NotoSansJP");
    expect(options.output).toBe("card.tsx");
    expect(options.name).toBe("Card");
    expect(options.format).toBe("bound-component");
  });

  it("parses all options", () => {
    const parsed = parseConvertArgs([
      "--input",
      "my-card.svg",
      "--output",
      "src/Card.tsx",
      "--name",
      "MyCard",
      "--default-font",
      "NotoSansJP",
      "--font-map",
      "Noto Sans JP=NotoSansJP",
      "--dynamic",
      "0:title:Hello World",
      "--dynamic",
      "1:subtitle:Description",
      "--renderer",
      "svg-hook",
      "--wrap",
      "char",
      "--fit",
      "grow",
      "--verbose",
    ]);

    expect(parsed).not.toBeNull();
    const options = parsed!.options;
    expect(options.input).toBe("my-card.svg");
    expect(options.output).toBe("src/Card.tsx");
    expect(options.name).toBe("MyCard");
    expect(options.fontMap).toEqual({ "Noto Sans JP": "NotoSansJP" });
    expect(options.dynamicTexts).toHaveLength(2);
    expect(options.dynamicTexts[0]).toEqual({
      textIndex: 0,
      propName: "title",
      defaultValue: "Hello World",
    });
    expect(options.renderer).toBe("svg-hook");
    expect(options.wrap).toBe("char");
    expect(options.fit).toBe("grow");
    expect(options.verbose).toBe(true);
  });

  it("parses short flags", () => {
    const parsed = parseConvertArgs([
      "-i",
      "test.svg",
      "--default-font",
      "Inter",
      "-o",
      "out.tsx",
      "-n",
      "Test",
      "-v",
    ]);
    expect(parsed).not.toBeNull();
    const options = parsed!.options;
    expect(options.input).toBe("test.svg");
    expect(options.output).toBe("out.tsx");
    expect(options.name).toBe("Test");
    expect(options.verbose).toBe(true);
  });

  it("returns null for --help", () => {
    const parsed = parseConvertArgs(["--help"], () => undefined);
    expect(parsed).toBeNull();
  });

  it("returns null when input is missing", () => {
    const parsed = parseConvertArgs(["--default-font", "Inter"], () => undefined);
    expect(parsed).toBeNull();
  });

  it("returns null when default-font is missing for SVG input", () => {
    const parsed = parseConvertArgs(["--input", "test.svg"], () => undefined);
    expect(parsed).toBeNull();
  });

  it("does not require --default-font for scene input", () => {
    const parsed = parseConvertArgs(["--input", "card.scene.json"]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.inputFormat).toBe("scene");
  });

  it("auto-detects scene input format from .scene.json extension", () => {
    const parsed = parseConvertArgs(["--input", "card.scene.json"]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.inputFormat).toBe("scene");
    expect(parsed!.options.output).toBe("card.tsx");
  });

  it("auto-detects scene input format from .json extension", () => {
    const parsed = parseConvertArgs(["--input", "card.json"]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.inputFormat).toBe("scene");
  });

  it("respects --input-format override", () => {
    const parsed = parseConvertArgs(["--input", "card.svg", "--input-format", "scene"]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.inputFormat).toBe("scene");
  });

  it("derives PascalCase name from .scene.json filename", () => {
    const parsed = parseConvertArgs(["--input", "my-card.scene.json"]);
    expect(parsed!.options.name).toBe("MyCard");
  });

  it("routes error messages through writeStderr callback", () => {
    const stderr: string[] = [];
    const writeStderr = (message: string) => stderr.push(message);

    parseConvertArgs(["--default-font", "Inter"], writeStderr);
    expect(stderr.join("")).toContain("Error: --input is required");

    stderr.length = 0;

    parseConvertArgs(["--input", "test.svg"], writeStderr);
    expect(stderr.join("")).toContain("Error: --default-font is required for SVG input");
  });

  it("derives PascalCase name from filename", () => {
    const parsed = parseConvertArgs(["--input", "my-awesome-card.svg", "--default-font", "Inter"]);
    expect(parsed!.options.name).toBe("MyAwesomeCard");
  });

  it("derives .tsx output from .svg input", () => {
    const parsed = parseConvertArgs(["--input", "path/to/file.svg", "--default-font", "Inter"]);
    expect(parsed!.options.output).toBe("path/to/file.tsx");
  });

  it("creates default font source when none specified", () => {
    const parsed = parseConvertArgs(["--input", "test.svg", "--default-font", "NotoSansJP"]);
    expect(parsed!.options.fontSources).toHaveLength(1);
    expect(parsed!.options.fontSources[0]!.alias).toBe("NotoSansJP");
  });

  it("parses font-source with full spec", () => {
    const parsed = parseConvertArgs([
      "--input",
      "test.svg",
      "--default-font",
      "NotoSansJP",
      "--font-source",
      "NotoSansJP:700:normal:/fonts/noto-bold.woff2",
    ]);
    expect(parsed!.options.fontSources).toHaveLength(1);
    expect(parsed!.options.fontSources[0]).toEqual({
      alias: "NotoSansJP",
      weight: 700,
      style: "normal",
      source: "/fonts/noto-bold.woff2",
    });
  });

  it("parses --format scene and derives .scene.json output", () => {
    const parsed = parseConvertArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--format",
      "scene",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.format).toBe("scene");
    expect(parsed!.options.output).toBe("card.scene.json");
  });

  it("defaults format to bound-component", () => {
    const parsed = parseConvertArgs(["--input", "card.svg", "--default-font", "NotoSansJP"]);
    expect(parsed!.options.format).toBe("bound-component");
  });

  it("parses --dry-run flag", () => {
    const parsed = parseConvertArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--dry-run",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.dryRun).toBe(true);
  });

  it("parses --watch flag", () => {
    const parsed = parseConvertArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--watch",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.watch).toBe(true);
  });

  it("accumulates multiple --input flags", () => {
    const parsed = parseConvertArgs(["-i", "a.svg", "-i", "b.svg", "--default-font", "NotoSansJP"]);
    expect(parsed).not.toBeNull();
    expect(parsed!.allInputs).toEqual(["a.svg", "b.svg"]);
  });

  it("detects stdin marker (-i -)", () => {
    const parsed = parseConvertArgs(["-i", "-", "--default-font", "NotoSansJP"]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.inputSource).toBe("stdin");
    expect(parsed!.options.name).toBe("Component");
  });

  it("detects stdout marker (-o -)", () => {
    const parsed = parseConvertArgs(["-i", "card.svg", "-o", "-", "--default-font", "NotoSansJP"]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.outputTarget).toBe("stdout");
  });
});

describe("parseArgs (backward compat)", () => {
  it("parses args with argv prefix", () => {
    const options = parseArgs([
      "node",
      "boundsvg-convert",
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
    ]);
    expect(options).not.toBeNull();
    expect(options!.input).toBe("card.svg");
  });
});

describe("convertSvgToComponent", () => {
  function makeOptions(overrides: Partial<CliOptions> = {}): CliOptions {
    return {
      input: "test.svg",
      output: "Test.tsx",
      name: "Test",
      inputFormat: "svg",
      defaultFont: "NotoSansJP",
      fontMap: {},
      fontSources: [
        {
          alias: "NotoSansJP",
          weight: 400,
          style: "normal",
          source: "/fonts/NotoSansJP.woff2",
        },
      ],
      dynamicTexts: [],
      renderer: "boundsvg",
      wrap: "word",
      fit: "shrink",
      textPathMode: "merged",
      pngScale: 2,
      format: "bound-component",
      verbose: false,
      dryRun: false,
      watch: false,
      inputSource: "file",
      outputTarget: "file",
      ...overrides,
    };
  }

  it("converts simple SVG to React component", () => {
    const svg = readFileSync(resolve(fixturesDir, "simple-text.svg"), "utf-8");
    const { code, warnings } = convertSvgToComponent(svg, makeOptions());

    expect(code).toContain("BoundSvgProvider");
    expect(code).toContain("BoundSvg");
    expect(code).toContain("export default function Test");
    expect(code).toContain("<Canvas");
    expect(code).toContain("<Text");
    expect(code).toContain("Hello World");
    expect(warnings.length).toBeGreaterThan(0); // viewBox fallback warning
  });

  it("converts multi-text SVG", () => {
    const svg = readFileSync(resolve(fixturesDir, "multi-text.svg"), "utf-8");
    const { code } = convertSvgToComponent(svg, makeOptions());

    expect(code).toContain("Title Text");
    expect(code).toContain("Subtitle description goes here");
    expect(code).toContain("Footer note");
  });

  it("includes non-text SVG as Svg component", () => {
    const svg = readFileSync(resolve(fixturesDir, "text-with-rect.svg"), "utf-8");
    const { code } = convertSvgToComponent(svg, makeOptions());

    expect(code).toContain("<Svg");
    expect(code).toContain("<Text");
  });

  it("generates svg-hook renderer", () => {
    const svg = readFileSync(resolve(fixturesDir, "simple-text.svg"), "utf-8");
    const { code } = convertSvgToComponent(svg, makeOptions({ renderer: "svg-hook" }));

    expect(code).toContain("useRenderToSvg");
  });

  it("generates png-hook renderer", () => {
    const svg = readFileSync(resolve(fixturesDir, "simple-text.svg"), "utf-8");
    const { code } = convertSvgToComponent(svg, makeOptions({ renderer: "png-hook" }));

    expect(code).toContain("useRenderToPng");
  });

  it("handles dynamic text props", () => {
    const svg = readFileSync(resolve(fixturesDir, "multi-text.svg"), "utf-8");
    const { code } = convertSvgToComponent(
      svg,
      makeOptions({
        name: "Card",
        dynamicTexts: [{ textIndex: 0, propName: "title", defaultValue: "Default Title" }],
      }),
    );

    expect(code).toContain("interface CardProps");
    expect(code).toContain("title?: string");
    expect(code).toContain("props.title");
  });

  it("reports unsupported property warnings", () => {
    const svg = readFileSync(resolve(fixturesDir, "unsupported-props.svg"), "utf-8");
    const { warnings } = convertSvgToComponent(svg, makeOptions());

    const unsupported = warnings.filter((w) => w.code === "SVG_UNSUPPORTED_PROPERTY");
    expect(unsupported.length).toBeGreaterThan(0);
  });

  it("handles SVG with font alias map", () => {
    const svg = readFileSync(resolve(fixturesDir, "multi-text.svg"), "utf-8");
    const { code } = convertSvgToComponent(
      svg,
      makeOptions({
        fontMap: { "Noto Sans JP": "NotoSansJP", Arial: "ArialFont" },
      }),
    );

    expect(code).toContain("NotoSansJP");
  });

  it("generates SceneDocument JSON for format=scene", () => {
    const svg = readFileSync(resolve(fixturesDir, "simple-text.svg"), "utf-8");
    const { code } = convertSvgToComponent(svg, makeOptions({ format: "scene" }));

    const scene = JSON.parse(code);
    expect(scene.type).toBe("Canvas");
    expect(scene.children).toBeDefined();
    expect(typeof code).toBe("string");
  });

  it("converts third-party Fluent SVG fixture", () => {
    const svg = readFileSync(resolve(thirdPartyFixturesDir, "sunset_color.svg"), "utf-8");
    const { code, warnings } = convertSvgToComponent(svg, makeOptions({ name: "FluentSunset" }));

    expect(code).toContain("export default function FluentSunset");
    expect(code).toContain("BoundSvgProvider");
    expect(code).toContain("<Svg");
    expect(warnings.length).toBeGreaterThanOrEqual(0);
  });

  it("converts third-party Natural Earth SVG fixture", { timeout: 15000 }, () => {
    const naturalEarthFixturesDir = resolve(
      __dirname,
      "../../../fixtures/third-party-svg/natural-earth",
    );
    const svg = readFileSync(
      resolve(naturalEarthFixturesDir, "world-terrain-borders-50m.svg"),
      "utf-8",
    );
    const { code, warnings } = convertSvgToComponent(
      svg,
      makeOptions({ name: "NaturalEarthWorld" }),
    );

    expect(code).toContain("export default function NaturalEarthWorld");
    expect(code).toContain("BoundSvgProvider");
    expect(code).toContain("<Svg");
    expect(warnings.length).toBeGreaterThanOrEqual(0);
  });
});

describe("convertSceneToComponent", () => {
  function makeOptions(overrides: Partial<CliOptions> = {}): CliOptions {
    return {
      input: "test.scene.json",
      output: "Test.tsx",
      name: "Test",
      inputFormat: "scene",
      defaultFont: "",
      fontMap: {},
      fontSources: [
        {
          alias: "NotoSansJP",
          weight: 400,
          style: "normal",
          source: "/fonts/NotoSansJP.woff2",
        },
      ],
      dynamicTexts: [],
      renderer: "boundsvg",
      wrap: "word",
      fit: "shrink",
      textPathMode: "merged",
      pngScale: 2,
      format: "bound-component",
      verbose: false,
      dryRun: false,
      watch: false,
      inputSource: "file",
      outputTarget: "file",
      ...overrides,
    };
  }

  it("converts SceneDocument JSON to React component", () => {
    // First generate a SceneDocument from SVG
    const svg = readFileSync(resolve(fixturesDir, "simple-text.svg"), "utf-8");
    const { code: sceneJson } = convertSvgToComponent(
      svg,
      makeOptions({
        input: "test.svg",
        inputFormat: "svg",
        defaultFont: "NotoSansJP",
        format: "scene",
      }),
    );

    // Then convert SceneDocument to bound component
    const scene = JSON.parse(sceneJson);
    const { code } = convertSceneToComponent(scene, makeOptions({ name: "FromScene" }));

    expect(code).toContain("export default function FromScene");
    expect(code).toContain("BoundSvgProvider");
    expect(code).toContain("BoundSvg");
  });

  it("round-trips SVG → Scene → Component preserving text content", () => {
    const svg = readFileSync(resolve(fixturesDir, "multi-text.svg"), "utf-8");
    const { code: sceneJson } = convertSvgToComponent(
      svg,
      makeOptions({
        input: "test.svg",
        inputFormat: "svg",
        defaultFont: "NotoSansJP",
        format: "scene",
      }),
    );

    const scene = JSON.parse(sceneJson);
    const { code } = convertSceneToComponent(scene, makeOptions({ name: "RoundTrip" }));

    expect(code).toContain("export default function RoundTrip");
    expect(code).toContain("Title Text");
    expect(code).toContain("Subtitle description goes here");
  });
});
