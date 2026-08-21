import { describe, expect, it } from "vitest";
import { analyzeEmbeddedSvgIds } from "../../src/svg/embedded-id-analyzer.js";

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
      { id: "clip-a", kind: "url", raw: "url(#clip-a)" },
      { id: "missing-grad", kind: "url", raw: 'url("#missing-grad")' },
      { id: "shape-a", kind: "href", raw: 'href="#shape-a"' },
      { id: "missing-symbol", kind: "xlink:href", raw: "xlink:href='#missing-symbol'" },
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
});
