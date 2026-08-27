import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import { analyzeEmbeddedSvgIds } from "../../src/svg/embedded-id-analyzer.js";

type FixtureReference = {
  attribute: string;
  kind: "url" | "href" | "xlink:href" | "aria" | "smil" | "css-selector";
  syntax:
    | "url"
    | "fragment"
    | "single"
    | "list"
    | "id-selector"
    | "syncbase"
    | "eventbase"
    | "repeat"
    | "marker"
    | "deprecated-id";
  id: string;
};

type FixtureCase =
  | {
      name: string;
      input: string;
      status: "ok";
      definitions: string[];
      references: FixtureReference[];
      output: string;
    }
  | {
      name: string;
      input: string;
      status: "error";
      error: string;
    };

type FixtureDocument = {
  schemaVersion: number;
  prefix: string;
  cases: FixtureCase[];
};

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../../fixtures/conformance/embedded-svg-id-reference-cases.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as FixtureDocument;

describe("analyzeEmbeddedSvgIds", () => {
  it("collects ids and detects duplicate ids", () => {
    const result = analyzeEmbeddedSvgIds(`
      <svg>
        <defs>
          <clipPath id="clip-a"><rect width="10" height="10" /></clipPath>
          <linearGradient id='grad-a' />
          <filter id="clip-a" />
        </defs>
      </svg>
    `);

    expect(result.ids).toEqual(["clip-a", "grad-a", "clip-a"]);
    expect(result.duplicateIds).toEqual(["clip-a"]);
    expect(result.hasPotentialCollisions).toBe(true);
  });

  it("collects url(), href, and xlink:href references", () => {
    const result = analyzeEmbeddedSvgIds(`
      <svg>
        <defs><clipPath id="clip-a" /><path id="shape-a" /></defs>
        <rect clip-path="url(#clip-a)" fill='url("#missing-grad")' />
        <use href="#shape-a" />
        <use xlink:href='#missing-symbol' />
      </svg>
    `);

    expect(result.references).toEqual([
      {
        id: "clip-a",
        kind: "url",
        attribute: "clip-path",
        syntax: "url",
        raw: "url(#clip-a)",
      },
      {
        id: "missing-grad",
        kind: "url",
        attribute: "fill",
        syntax: "url",
        raw: 'url("#missing-grad")',
      },
      {
        id: "shape-a",
        kind: "href",
        attribute: "href",
        syntax: "fragment",
        raw: 'href="#shape-a"',
      },
      {
        id: "missing-symbol",
        kind: "xlink:href",
        attribute: "xlink:href",
        syntax: "fragment",
        raw: "xlink:href='#missing-symbol'",
      },
    ]);
    expect(result.unresolvedReferences).toEqual(["missing-grad", "missing-symbol"]);
  });

  it("returns no potential collisions when embedded svg has no ids", () => {
    const result = analyzeEmbeddedSvgIds('<svg><rect width="10" height="10" /></svg>');

    expect(result.ids).toEqual([]);
    expect(result.duplicateIds).toEqual([]);
    expect(result.references).toEqual([]);
    expect(result.unresolvedReferences).toEqual([]);
    expect(result.hasPotentialCollisions).toBe(false);
  });

  it("matches the shared embedded SVG reference fixture", () => {
    for (const fixtureCase of fixture.cases) {
      if (fixtureCase.status === "error") {
        expect(
          () => analyzeEmbeddedSvgIds(fixtureCase.input),
          `${fixtureCase.name} should reject the same unsafe syntax as contentIdPrefix`,
        ).toThrowError(expect.objectContaining({ code: fixtureCase.error }));
        continue;
      }

      const result = analyzeEmbeddedSvgIds(fixtureCase.input);
      const localIds = new Set(result.ids);
      const localReferences = result.references
        .filter((reference) => localIds.has(reference.id))
        .map(({ attribute, id, kind, syntax }) => ({ attribute, kind, syntax, id }));

      expect(result.ids, fixtureCase.name).toEqual(fixtureCase.definitions);
      expect(localReferences, fixtureCase.name).toEqual(fixtureCase.references);
    }
  });

  it("reports structural analysis failures as analyzer FatalError values", () => {
    try {
      analyzeEmbeddedSvgIds('<g id="unterminated>');
      expect.unreachable("malformed XML should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FatalError);
      expect(error).toMatchObject({
        code: "CONTENT_ID_PREFIX_MALFORMED_XML",
        stage: "analyzer",
      });
    }
  });
});
