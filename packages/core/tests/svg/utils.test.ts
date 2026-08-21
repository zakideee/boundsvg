import { describe, expect, it } from "vitest";
import { escapeXml, formatNumber, toBase64DataUri, uint8ToBase64 } from "../../src/svg/utils.js";

describe("svg utils", () => {
  it("escapes XML special characters", () => {
    expect(escapeXml(`<tag attr="v&v">'`)).toBe("&lt;tag attr=&quot;v&amp;v&quot;&gt;&apos;");
  });

  it("formats numbers with configurable precision", () => {
    expect(formatNumber(1.23456)).toBe("1.23");
    expect(formatNumber(1.23456, 4)).toBe("1.2346");
    expect(formatNumber(10)).toBe("10");
  });

  it("encodes Uint8Array to base64 string", () => {
    const bytes = new Uint8Array([72, 105]); // "Hi"
    expect(uint8ToBase64(bytes)).toBe("SGk=");
  });

  it("creates base64 data URI", () => {
    const bytes = new Uint8Array([72, 105]); // "Hi"
    expect(toBase64DataUri(bytes, "text/plain")).toBe("data:text/plain;base64,SGk=");
  });
});
