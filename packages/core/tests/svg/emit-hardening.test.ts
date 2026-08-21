import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import { toCssSafeResourceId } from "../../src/svg/resource-id.js";
import { getUnsafeSvgReason } from "../../src/svg/security.js";
import { escapeXml, formatNumber } from "../../src/svg/utils.js";

/**
 * Emit-hardening regressions (SVG emit scope). Each case is a defect that
 * shipped: the scheme check was applied to undecoded markup, XML-forbidden
 * characters reached the document, `url(#...)` references were built from raw
 * node ids, and non-finite numbers were stringified into attributes.
 */
describe("raw Svg URI scheme check", () => {
  it("rejects javascript: hidden behind XML character references", () => {
    // Hex, decimal, and mixed-case references all decode to `javascript:`
    // before a consumer resolves the URI, so the scan must decode first.
    expect(getUnsafeSvgReason(`<a href="java&#x73;cript:alert(1)">x</a>`)).not.toBeNull();
    expect(getUnsafeSvgReason(`<a href="&#106;avascript:alert(1)">x</a>`)).not.toBeNull();
    expect(getUnsafeSvgReason(`<a href="JAVA&#X73;CRIPT:alert(1)">x</a>`)).not.toBeNull();
  });

  it("rejects javascript: split by control characters and whitespace", () => {
    expect(getUnsafeSvgReason("<a href='java\u0000script:alert(1)'>x</a>")).not.toBeNull();
    expect(getUnsafeSvgReason(`<a href="  javascript:alert(1)">x</a>`)).not.toBeNull();
  });

  it("rejects plain javascript: and url(javascript:) as before", () => {
    expect(getUnsafeSvgReason(`<a href="javascript:alert(1)">x</a>`)).not.toBeNull();
    expect(getUnsafeSvgReason(`<rect fill="url(javascript:alert(1))"/>`)).not.toBeNull();
  });

  it("rejects other active schemes and non-image data URIs", () => {
    expect(getUnsafeSvgReason(`<a href="vbscript:msgbox(1)">x</a>`)).not.toBeNull();
    expect(getUnsafeSvgReason(`<image href="data:text/html,<b>x</b>"/>`)).not.toBeNull();
  });

  it("allows fragments, relative paths, http(s), and image data URIs", () => {
    expect(getUnsafeSvgReason(`<use href="#glyph-1"/>`)).toBeNull();
    expect(getUnsafeSvgReason(`<image href="./logo.png"/>`)).toBeNull();
    expect(getUnsafeSvgReason(`<image href="https://example.com/logo.png"/>`)).toBeNull();
    expect(getUnsafeSvgReason(`<image href="data:image/png;base64,AAAA"/>`)).toBeNull();
    expect(getUnsafeSvgReason(`<rect fill="url(#grad-1)"/>`)).toBeNull();
  });
});

describe("escapeXml", () => {
  it("drops characters XML 1.0 forbids outright", () => {
    // NUL and SOH cannot be escaped in XML at all — leaving them in produces
    // a document that fails to rasterize ("non-XML character").
    expect(escapeXml("a\u0000b\u0001c")).toBe("abc");
    expect(escapeXml("a\ufffeb\uffffc")).toBe("abc");
  });

  it("preserves tab, newline, and carriage return", () => {
    expect(escapeXml("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });
});

describe("formatNumber", () => {
  it("rejects non-finite numbers instead of emitting NaN/Infinity tokens", () => {
    expect(() => formatNumber(Number.NaN)).toThrow(FatalError);
    expect(() => formatNumber(Number.POSITIVE_INFINITY)).toThrow(FatalError);
    expect(() => formatNumber(Number.NEGATIVE_INFINITY)).toThrow(FatalError);
  });

  it("does not overflow finite magnitudes to Infinity while rounding", () => {
    expect(formatNumber(1e308)).toBe("1e+308");
  });
});

describe("toCssSafeResourceId", () => {
  it("passes reference-safe ids through unchanged", () => {
    expect(toCssSafeResourceId("auto:0.1")).toBe("auto:0.1");
    expect(toCssSafeResourceId("card-title_2")).toBe("card-title_2");
  });

  it("replaces characters that break a url(#...) reference", () => {
    const id = toCssSafeResourceId(`a b"c'd)e`);
    expect(id).not.toMatch(/[\s"')]/);
  });

  it("keeps ids distinct when sanitization would collide", () => {
    expect(toCssSafeResourceId("a b")).not.toBe(toCssSafeResourceId("a_b"));
  });

  it("is deterministic", () => {
    expect(toCssSafeResourceId("a b)c")).toBe(toCssSafeResourceId("a b)c"));
  });
});
