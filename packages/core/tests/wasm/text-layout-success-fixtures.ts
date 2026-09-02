export type TextLayoutRawSuccessFixture = {
  operation:
    | "layoutTextFlow"
    | "layoutTextFlowWithExclusions"
    | "measureTextBlock"
    | "shrinkwrapText"
    | "shrinkwrapFlow"
    | "measureIntrinsicInlineSize";
  wasmMethod:
    | "layout_text_flow"
    | "layout_text_flow_with_exclusions"
    | "measure_text_block"
    | "shrinkwrap_text"
    | "shrinkwrap_flow"
    | "measure_intrinsic_inline_size";
  inputJson: string;
  expectedOutputJson: string;
  inputSha256: string;
  outputSha256: string;
};

/** Exact node/web success bytes captured from pre-migration base 836b0bde. */
export const textLayoutRawSuccessFixtures: readonly TextLayoutRawSuccessFixture[] = [
  {
    operation: "layoutTextFlow",
    wasmMethod: "layout_text_flow",
    inputJson: '{"text":"AB","fontFamily":"NotoSansJP","fontSizePx":16,"lineWidths":[100]}',
    expectedOutputJson:
      '{"lines":[{"text":"AB","charStart":0,"charEnd":2,"inlineAdvancePx":20.240000000000002,"availableInlineSizePx":100.0}],"exhausted":true}',
    inputSha256: "7b2bc9b2f7ee5ebed459634521b1fbcb9047c0dc44b68ea6c7edb7a5f0f31791",
    outputSha256: "40eb99df275f3a6a413dfa7a069024900a57fc9678d7db2dbaeaaf4c55dd1e54",
  },
  {
    operation: "layoutTextFlowWithExclusions",
    wasmMethod: "layout_text_flow_with_exclusions",
    inputJson:
      '{"text":"AB","fontFamily":"NotoSansJP","fontSizePx":16,"flowBox":{"x":0,"y":0,"width":100,"height":40},"exclusions":[]}',
    expectedOutputJson:
      '{"lines":[{"fragments":[{"text":"AB","charStart":0,"charEnd":2,"x":0.0,"y":0.0,"inlineAdvancePx":20.240000000000002,"availableInlineSizePx":100.0,"regionIndex":0,"baselineOffset":15.68}],"lineIndex":0,"crossSize":19.2}],"exhausted":true,"usedLineCount":1,"topRubyOverflowPx":0.0,"bottomRubyOverflowPx":0.0}',
    inputSha256: "55bf40c58e99a928ef66903f8e585f8f3c6efe788fee17cd291654b274d2507d",
    outputSha256: "66db9e44ee64a789bad7cac6b8d9c69e9e5cec51772f0a466ce0a631bfcd5d43",
  },
  {
    operation: "measureTextBlock",
    wasmMethod: "measure_text_block",
    inputJson: '{"text":"AB","fontFamily":"NotoSansJP","fontSizePx":16,"maxWidth":100}',
    expectedOutputJson:
      '{"lineCount":1,"usedWidth":20.240000000000002,"usedHeight":19.2,"lines":[{"charStart":0,"charEnd":2,"text":"AB","inlineAdvancePx":20.240000000000002,"kinsokuUnresolved":false}]}',
    inputSha256: "f620a185a00837f7ac875d9121a613ebd6682864bdf80c30af8b61ec4c2b7a3c",
    outputSha256: "9550d5a6e217a3ca02c0b7804be64f4b912906dec334ea53c337976f13987646",
  },
  {
    operation: "shrinkwrapText",
    wasmMethod: "shrinkwrap_text",
    inputJson:
      '{"text":"AB","fontFamily":"NotoSansJP","fontSizePx":16,"maxWidth":100,"targetLineCount":1}',
    expectedOutputJson:
      '{"status":"satisfied","chosenWidthPx":20.29975,"lineCount":1,"usedHeight":19.2,"maxLineWidth":20.240000000000002}',
    inputSha256: "84145d208d76af513383788da7c075d3276c01af14e9e651530688734cc9e6d0",
    outputSha256: "a8b0b45459f9dfe13897fcbeb0c32088826e354a39b7d1435d7f9ab2ca584e4a",
  },
  {
    operation: "shrinkwrapFlow",
    wasmMethod: "shrinkwrap_flow",
    inputJson:
      '{"text":"AB","fontFamily":"NotoSansJP","fontSizePx":16,"flowBox":{"x":0,"y":0,"width":100,"height":40},"exclusions":[],"targetLineCount":1}',
    expectedOutputJson:
      '{"status":"satisfied","chosenWidthPx":20.3125,"usedLineCount":1,"usedHeight":19.2,"layout":{"lines":[{"fragments":[{"text":"AB","charStart":0,"charEnd":2,"x":0.0,"y":0.0,"inlineAdvancePx":20.240000000000002,"availableInlineSizePx":20.3125,"regionIndex":0,"baselineOffset":15.68}],"lineIndex":0,"crossSize":19.2}],"exhausted":true,"usedLineCount":1,"topRubyOverflowPx":0.0,"bottomRubyOverflowPx":0.0}}',
    inputSha256: "93dbe261f06e4585f8705d4de868df6de431419904bdd01c7e43d3be0369f27a",
    outputSha256: "902b30d64c40822a8d5d1a7bbba6ecfef15e61158ca8132f3f4ed165fd53c8c6",
  },
  {
    operation: "measureIntrinsicInlineSize",
    wasmMethod: "measure_intrinsic_inline_size",
    inputJson: '{"text":"AB","fontFamily":"NotoSansJP","fontSizePx":16}',
    expectedOutputJson: '{"minContentInlineSize":10.512,"maxContentInlineSize":20.240000000000002}',
    inputSha256: "48fa095d1609d8dd2a49b70d7351940fa073e323a8864d73bf16334e5f088fda",
    outputSha256: "8bcd51483bea28f0cdc4b751c1750640f702b448cb3f02766b1ca190b7a7ff68",
  },
];
