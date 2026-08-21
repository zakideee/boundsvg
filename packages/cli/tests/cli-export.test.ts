import { describe, expect, it } from "vitest";
import { parseExportArgs } from "../src/cli-export.js";

describe("parseExportArgs", () => {
  it("parses minimal required args for SVG input", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
    ]);
    expect(parsed).not.toBeNull();
    const options = parsed!.options;
    expect(options.input).toBe("card.svg");
    expect(options.inputFormat).toBe("svg");
    expect(options.format).toBe("svg");
    expect(options.defaultFont).toBe("NotoSansJP");
    expect(options.output).toBe("card.rendered.svg");
  });

  it("parses PNG format", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "png",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.format).toBe("png");
    expect(parsed!.options.output).toBe("card.png");
  });

  it("parses webp format", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "webp",
    ]);
    expect(parsed!.options.format).toBe("webp");
    expect(parsed!.options.output).toBe("card.webp");
  });

  it("parses animated-webp format and its schedule flags", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.scene.json",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "animated-webp",
      "--duration-ms",
      "2000",
      "--fps",
      "12",
      "--loop",
      "3",
    ]);
    const options = parsed!.options;
    expect(options.format).toBe("animated-webp");
    expect(options.output).toBe("card.webp");
    expect(options.durationMs).toBe(2000);
    expect(options.fps).toBe(12);
    expect(options.loop).toBe(3);
  });

  it("leaves the animation schedule flags unset when absent", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
    ]);
    expect(parsed!.options.fps).toBeUndefined();
    expect(parsed!.options.loop).toBeUndefined();
    expect(parsed!.options.durationMs).toBeUndefined();
  });

  it("rejects a malformed value instead of falling back to a default", () => {
    const cases: Array<[string, string[]]> = [
      ["--fps", ["--fps", "abc"]],
      ["--fps", ["--fps"]],
      ["--duration-ms", ["--duration-ms", "--verbose"]],
      ["--loop", ["--loop", ""]],
      ["--format", ["--format", "wepb"]],
      ["--format", ["--format"]],
    ];

    for (const [flag, args] of cases) {
      const messages: string[] = [];
      const parsed = parseExportArgs(
        [
          "--input",
          "card.svg",
          "--default-font",
          "NotoSansJP",
          "--font",
          "NotoSansJP:400:normal:./font.woff2",
          ...args,
        ],
        (message) => messages.push(message),
      );
      expect(parsed, args.join(" ")).toBeNull();
      expect(messages.join(""), args.join(" ")).toContain(`${flag} needs a valid value`);
    }
  });

  it("does not infer webp from a mistyped --format", () => {
    const messages: string[] = [];
    const parsed = parseExportArgs(
      [
        "--input",
        "card.svg",
        "--output",
        "card.webp",
        "--format",
        "wepb",
        "--default-font",
        "NotoSansJP",
        "--font",
        "NotoSansJP:400:normal:./font.woff2",
      ],
      (message) => messages.push(message),
    );
    // Silently falling back to svg would have written SVG text into card.webp.
    expect(parsed).toBeNull();
    expect(messages.join("")).toContain("--format needs a valid value");
  });

  it("accepts the --flag=value spelling", () => {
    const parsed = parseExportArgs([
      "--input=card.scene.json",
      "--font=NotoSansJP:400:normal:./font.woff2",
      "--format=animated-webp",
      "--duration-ms=2000",
      "--fps=12",
      "--loop=3",
      "--scale=3",
    ]);
    const options = parsed!.options;
    expect(options.input).toBe("card.scene.json");
    expect(options.format).toBe("animated-webp");
    expect(options.durationMs).toBe(2000);
    expect(options.fps).toBe(12);
    expect(options.loop).toBe(3);
    expect(options.scale).toBe(3);
  });

  it("rejects a malformed --flag=value the same way", () => {
    const messages: string[] = [];
    const parsed = parseExportArgs(
      [
        "--input",
        "card.svg",
        "--default-font",
        "NotoSansJP",
        "--font",
        "NotoSansJP:400:normal:./font.woff2",
        "--fps=abc",
      ],
      (message) => messages.push(message),
    );
    expect(parsed).toBeNull();
    expect(messages.join("")).toContain("--fps needs a valid value");
  });

  it("rejects a malformed --scale instead of falling back", () => {
    const messages: string[] = [];
    const parsed = parseExportArgs(
      [
        "--input",
        "card.svg",
        "--default-font",
        "NotoSansJP",
        "--font",
        "NotoSansJP:400:normal:./font.woff2",
        "--scale",
        "abc",
      ],
      (message) => messages.push(message),
    );
    expect(parsed).toBeNull();
    expect(messages.join("")).toContain("--scale needs a valid value");
  });

  it("carries an out-of-range --scale through to the flag validator", () => {
    // Parsing keeps the value verbatim; runExport refuses it with a range
    // message, which the integration suite pins.
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--scale",
      "9",
    ]);
    expect(parsed!.options.scale).toBe(9);
  });

  it("rejects a value on every switch flag", () => {
    for (const flag of ["--debug", "--verbose", "-v", "--inspect", "--dry-run", "--watch"]) {
      const messages: string[] = [];
      const parsed = parseExportArgs(
        [
          "--input",
          "card.svg",
          "--default-font",
          "NotoSansJP",
          "--font",
          "NotoSansJP:400:normal:./font.woff2",
          `${flag}=true`,
        ],
        (message) => messages.push(message),
      );
      expect(parsed, flag).toBeNull();
      expect(messages.join(""), flag).toContain(`${flag} does not take a value`);
    }
  });

  it("accepts the = spelling for every value-taking flag", () => {
    const parsed = parseExportArgs([
      "--input=card.svg",
      "--output=out/card.png",
      "--default-font=NotoSansJP",
      "--name=Card",
      "--input-format=svg",
      "--format=png",
      "--font=NotoSansJP:400:normal:./font.woff2",
      "--font-map=Noto Sans JP=NotoSansJP",
      "--wrap=char",
      "--fit=grow",
      "--text-path-mode=glyphs",
      "--scale=3",
      "--report=out/report.json",
    ]);
    const options = parsed!.options;
    expect(options.input).toBe("card.svg");
    expect(options.output).toBe("out/card.png");
    expect(options.componentName).toBe("Card");
    expect(options.format).toBe("png");
    // The value's own "=" must survive the split.
    expect(options.fontMap).toEqual({ "Noto Sans JP": "NotoSansJP" });
    expect(options.wrap).toBe("char");
    expect(options.fit).toBe("grow");
    expect(options.textPathMode).toBe("glyphs");
    expect(options.scale).toBe(3);
    expect(options.report).toBe("out/report.json");
  });

  it("infers gif from a .gif output path", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--output",
      "out/card.gif",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--duration-ms",
      "500",
    ]);
    expect(parsed!.options.format).toBe("gif");
  });

  it("infers still webp from an uppercase .WEBP output path", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--output",
      "out/card.WEBP",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
    ]);
    expect(parsed!.options.format).toBe("webp");
  });

  it("infers still webp from a .webp output path", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--output",
      "out/card.webp",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
    ]);
    expect(parsed!.options.format).toBe("webp");
  });

  it("lets an explicit --format win over the .webp output path", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--output",
      "out/card.webp",
      "--format",
      "animated-webp",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
    ]);
    expect(parsed!.options.format).toBe("animated-webp");
  });

  it("parses gif format", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.scene.json",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "gif",
      "--duration-ms",
      "1500",
    ]);
    const options = parsed!.options;
    expect(options.format).toBe("gif");
    expect(options.output).toBe("card.gif");
    expect(options.durationMs).toBe(1500);
  });

  it("parses layered-svg format", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "layered-svg",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.format).toBe("layered-svg");
    expect(parsed!.options.output).toBe("card.layers");
  });

  it("parses layered-png format", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "layered-png",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.format).toBe("layered-png");
    expect(parsed!.options.output).toBe("card.layers");
  });

  it("auto-detects scene input format from .scene.json extension", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.scene.json",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.inputFormat).toBe("scene");
    expect(parsed!.options.output).toBe("card.rendered.svg");
  });

  it("auto-detects scene input format from .json extension", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.json",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.inputFormat).toBe("scene");
  });

  it("respects --input-format override", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--input-format",
      "scene",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.inputFormat).toBe("scene");
  });

  it("requires --default-font for SVG input", () => {
    const parsed = parseExportArgs(
      ["--input", "card.svg", "--font", "NotoSansJP:400:normal:./font.woff2"],
      () => undefined,
    );
    expect(parsed).toBeNull();
  });

  it("does not require --default-font for scene input", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.scene.json",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
    ]);
    expect(parsed).not.toBeNull();
  });

  it("requires at least one --font", () => {
    const parsed = parseExportArgs(
      ["--input", "card.svg", "--default-font", "NotoSansJP"],
      () => undefined,
    );
    expect(parsed).toBeNull();
  });

  it("returns null for --help", () => {
    const parsed = parseExportArgs(["--help"], () => undefined);
    expect(parsed).toBeNull();
  });

  it("returns null when input is missing", () => {
    const parsed = parseExportArgs(
      ["--font", "NotoSansJP:400:normal:./font.woff2"],
      () => undefined,
    );
    expect(parsed).toBeNull();
  });

  it("parses multiple font sources", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./noto.woff2",
      "--font",
      "Inter:700:normal:./inter-bold.woff2",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.fontSources).toHaveLength(2);
    expect(parsed!.options.fontSources[0]!.alias).toBe("NotoSansJP");
    expect(parsed!.options.fontSources[1]!.alias).toBe("Inter");
    expect(parsed!.options.fontSources[1]!.weight).toBe(700);
  });

  it("parses all rendering options", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--wrap",
      "char",
      "--fit",
      "grow",
      "--text-path-mode",
      "glyphs",
      "--scale",
      "3",
      "--debug",
      "--verbose",
    ]);
    expect(parsed).not.toBeNull();
    const options = parsed!.options;
    expect(options.wrap).toBe("char");
    expect(options.fit).toBe("grow");
    expect(options.textPathMode).toBe("glyphs");
    expect(options.scale).toBe(3);
    expect(options.debug).toBe(true);
    expect(options.verbose).toBe(true);
  });

  it("rejects the retired --png-scale flag instead of ignoring it", () => {
    const messages: string[] = [];
    const parsed = parseExportArgs(
      [
        "--input",
        "card.svg",
        "--default-font",
        "NotoSansJP",
        "--font",
        "NotoSansJP:400:normal:./font.woff2",
        "--png-scale",
        "4",
      ],
      (message) => messages.push(message),
    );
    expect(parsed).toBeNull();
    expect(messages.join("")).toContain("--png-scale was renamed to --scale");
  });

  it("rejects the retired flag in its --flag=value spelling", () => {
    const messages: string[] = [];
    const parsed = parseExportArgs(
      [
        "--input",
        "card.svg",
        "--default-font",
        "NotoSansJP",
        "--font",
        "NotoSansJP:400:normal:./font.woff2",
        "--png-scale=4",
      ],
      (message) => messages.push(message),
    );
    expect(parsed).toBeNull();
    expect(messages.join("")).toContain("--png-scale was renamed to --scale");
  });

  it("derives .rendered.svg output from .scene.json input for svg format", () => {
    const parsed = parseExportArgs([
      "--input",
      "path/to/card.scene.json",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "svg",
    ]);
    expect(parsed!.options.output).toBe("path/to/card.rendered.svg");
  });

  it("derives .png output from .scene.json input for png format", () => {
    const parsed = parseExportArgs([
      "--input",
      "path/to/card.scene.json",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "png",
    ]);
    expect(parsed!.options.output).toBe("path/to/card.png");
  });

  it("derives .layers output from .scene.json input for layered-svg format", () => {
    const parsed = parseExportArgs([
      "--input",
      "path/to/card.scene.json",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "layered-svg",
    ]);
    expect(parsed!.options.output).toBe("path/to/card.layers");
  });

  it("derives .layers output from .scene.json input for layered-png format", () => {
    const parsed = parseExportArgs([
      "--input",
      "path/to/card.scene.json",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "layered-png",
    ]);
    expect(parsed!.options.output).toBe("path/to/card.layers");
  });

  it("respects explicit --output", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--output",
      "out/result.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
    ]);
    expect(parsed!.options.output).toBe("out/result.svg");
  });

  it("routes error messages through writeStderr callback", () => {
    const stderr: string[] = [];
    const writeStderr = (message: string) => stderr.push(message);

    // Missing --input
    parseExportArgs(["--font", "NotoSansJP:400:normal:./font.woff2"], writeStderr);
    expect(stderr.join("")).toContain("Error: --input is required");

    stderr.length = 0;

    // Missing --default-font for SVG input
    parseExportArgs(
      ["--input", "card.svg", "--font", "NotoSansJP:400:normal:./font.woff2"],
      writeStderr,
    );
    expect(stderr.join("")).toContain("Error: --default-font is required for SVG input");

    stderr.length = 0;

    // Missing --font
    parseExportArgs(["--input", "card.svg", "--default-font", "NotoSansJP"], writeStderr);
    expect(stderr.join("")).toContain("Error: at least one --font is required");
  });

  it("parses --font-map", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--font-map",
      "Noto Sans JP=NotoSansJP",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.fontMap).toEqual({ "Noto Sans JP": "NotoSansJP" });
  });

  // -----------------------------------------------------------------------
  // static-component format
  // -----------------------------------------------------------------------

  it("parses --format static-component", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "static-component",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.format).toBe("static-component");
    expect(parsed!.options.output).toBe("card.tsx");
  });

  it("derives .tsx output from .scene.json input", () => {
    const parsed = parseExportArgs([
      "--input",
      "path/to/card.scene.json",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "static-component",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.output).toBe("path/to/card.tsx");
  });

  it("derives PascalCase componentName from input filename", () => {
    const parsed = parseExportArgs([
      "--input",
      "my-fancy-card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "static-component",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.componentName).toBe("MyFancyCard");
  });

  it("derives componentName from .scene.json input", () => {
    const parsed = parseExportArgs([
      "--input",
      "banner.scene.json",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "static-component",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.componentName).toBe("Banner");
  });

  it("uses explicit --name for componentName", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "static-component",
      "--name",
      "CustomIcon",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.componentName).toBe("CustomIcon");
  });

  it("uses -n short flag for componentName", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--format",
      "static-component",
      "-n",
      "ShortName",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.componentName).toBe("ShortName");
  });

  it("does not derive componentName when format is not static-component", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.componentName).toBe("");
  });

  it("parses --dry-run flag", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--dry-run",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.dryRun).toBe(true);
  });

  it("parses --watch flag", () => {
    const parsed = parseExportArgs([
      "--input",
      "card.svg",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
      "--watch",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.watch).toBe(true);
  });

  it("detects stdin marker (-i -)", () => {
    const parsed = parseExportArgs([
      "-i",
      "-",
      "--default-font",
      "NotoSansJP",
      "--font",
      "NotoSansJP:400:normal:./font.woff2",
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.inputSource).toBe("stdin");
  });
});
