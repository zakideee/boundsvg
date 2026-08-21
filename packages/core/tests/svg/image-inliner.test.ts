import { beforeAll, describe, expect, it, vi } from "vitest";
import { FatalError } from "../../src/errors.js";
import { initNodeWasm } from "../../src/node.js";
import { inlineExternalImages, type ResolvedImage } from "../../src/svg/image-inliner.js";
import { assertWasmPkgAvailable } from "../wasm/test-prerequisites.js";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const resolveAll = async (): Promise<ResolvedImage> => ({ data: PNG_BYTES, mime: "image/png" });
const resolveNone = async (): Promise<ResolvedImage | null> => null;

beforeAll(async () => {
  assertWasmPkgAvailable();
  await initNodeWasm();
});

describe("inlineExternalImages", () => {
  it("inlines a resolvable href as a data URI", async () => {
    const result = await inlineExternalImages(
      `<svg xmlns="http://www.w3.org/2000/svg"><image href="a.png"/></svg>`,
      resolveAll,
    );

    expect(result.inlined).toEqual(["a.png"]);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.svg).toContain("data:image/png;base64,");
  });

  it("reports hrefs the safety filter refused, instead of hiding them", async () => {
    // A traversal href is (correctly) never resolved, but it used to appear in
    // no list — the caller believed everything was inlined while the SVG still
    // carried an unresolvable external reference.
    const result = await inlineExternalImages(
      `<svg xmlns="http://www.w3.org/2000/svg"><image href="../../etc/passwd"/><image href="a.png"/></svg>`,
      resolveAll,
    );

    expect(result.skipped).toEqual(["../../etc/passwd"]);
    expect(result.inlined).toEqual(["a.png"]);
    expect(result.svg).toContain('href="../../etc/passwd"');
  });

  it("reports unresolvable hrefs as failed", async () => {
    const result = await inlineExternalImages(
      `<svg xmlns="http://www.w3.org/2000/svg"><image href="a.png"/></svg>`,
      resolveNone,
    );

    expect(result.failed).toEqual(["a.png"]);
    expect(result.svg).toContain('href="a.png"');
  });

  it("rejects a resolver result missing its mime type", async () => {
    // This used to emit `data:undefined;base64,...` — a data URI that renders
    // nothing, with no error anywhere.
    const brokenResolver = async () => ({ data: PNG_BYTES }) as unknown as ResolvedImage;

    await expect(
      inlineExternalImages(
        `<svg xmlns="http://www.w3.org/2000/svg"><image href="a.png"/></svg>`,
        brokenResolver,
      ),
    ).rejects.toThrow(FatalError);

    const whitespaceMimeResolver = async () => ({
      data: PNG_BYTES,
      mime: "   ",
    });
    await expect(
      inlineExternalImages(`<svg><image href="a.png"/></svg>`, whitespaceMimeResolver),
    ).rejects.toMatchObject({ code: "IMAGE_RESOLVER_INVALID_RESULT" });
  });

  it("uses XML parsing for skipped hrefs instead of matching comments or quoted > characters", async () => {
    const result = await inlineExternalImages(
      `<svg><!-- <image href="../../comment"/> --><image aria-label="a > b" href="../../secret"/></svg>`,
      resolveAll,
    );

    expect(result.skipped).toEqual(["../../secret"]);
    expect(result.svg).toContain("../../comment");
  });

  it("replaces entity-encoded and whitespace-padded image hrefs", async () => {
    const seen: string[] = [];
    const result = await inlineExternalImages(
      `<svg><image href=" a&amp;b.png "/></svg>`,
      async (href) => {
        seen.push(href);
        return resolveAll();
      },
    );

    expect(seen).toEqual(["a&b.png"]);
    expect(result.inlined).toEqual(["a&b.png"]);
    expect(result.skipped).toEqual([]);
    expect(result.svg).toContain('href="data:image/png;base64,');
  });

  it("does not replace the same href on non-image elements", async () => {
    const result = await inlineExternalImages(
      `<svg><a href="same.png"><rect/></a><image href="same.png"/></svg>`,
      resolveAll,
    );

    expect(result.svg).toContain('<a href="same.png">');
    expect(result.svg).toContain('<image href="data:image/png;base64,');
  });

  it("treats data URI schemes case-insensitively", async () => {
    const resolver = vi.fn(resolveAll);
    const svg = `<svg><image href="DATA:image/png;base64,AA=="/></svg>`;
    const result = await inlineExternalImages(svg, resolver);

    expect(resolver).not.toHaveBeenCalled();
    expect(result.svg).toBe(svg);
    expect(result.skipped).toEqual([]);
  });

  it("does not resolve schemes obfuscated with XML whitespace or outside the allowlist", async () => {
    const resolver = vi.fn(resolveAll);
    const result = await inlineExternalImages(
      `<svg><image href="java&#x09;script:alert(1)"/><image href="ftp://example.com/a.png"/></svg>`,
      resolver,
    );

    expect(resolver).not.toHaveBeenCalled();
    expect(result.skipped).toEqual(["java\tscript:alert(1)", "ftp://example.com/a.png"]);
  });
});
