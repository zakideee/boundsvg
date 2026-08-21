import { describe, expect, it } from "vitest";
import {
  formatPlaygroundLocator,
  formatSvgLocatorSegment,
} from "../../playground-shared/locator-copy";

describe("playground locator copy", () => {
  it("formats a paste-ready hierarchy with stable labels", () => {
    expect(
      formatPlaygroundLocator("playground-react", [
        "Category: Layout & Drawing [layout-drawing]",
        "Page: Text Flow [text-flow]",
        "Sample: Flow Rich [flow-rich]",
      ]),
    ).toBe(
      "playground-react > Category: Layout & Drawing [layout-drawing] > Page: Text Flow [text-flow] > Sample: Flow Rich [flow-rich]",
    );
  });

  it("removes duplicate segments from inferred and clicked labels", () => {
    expect(
      formatPlaygroundLocator("playground-core", [
        "Category: Typography [typography]",
        "Sample: Ruby Layout [ruby]",
        "Sample: Ruby Layout [ruby]",
      ]),
    ).toBe("playground-core > Category: Typography [typography] > Sample: Ruby Layout [ruby]");
  });

  it("formats an SVG hit with its index, node, part, and SVG-space point", () => {
    expect(
      formatSvgLocatorSegment({
        index: 2,
        total: 4,
        viewBox: "0 0 920 540",
        x: 318.25,
        y: 104,
        nodeId: "0.1.3",
        partId: "face",
      }),
    ).toBe("SVG: 2/4 | viewBox=0 0 920 540 | node=0.1.3 | part=face | point=(318.3, 104)");
  });
});
