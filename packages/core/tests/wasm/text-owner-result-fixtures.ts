import type { TextLayoutRawSuccessFixture } from "./text-layout-success-fixtures.js";

/** Pins fallback success and language-sensitive advances across transports. */
export const textOwnerResultFixtures: readonly TextLayoutRawSuccessFixture[] = [
  {
    operation: "measureTextBlock",
    wasmMethod: "measure_text_block",
    inputJson:
      '{"fontFamily":"NotoSansJP","fontSizePx":20.0,"language":"auto","lineHeight":1.5,"maxWidth":180.0,"text":"A\\"A","whiteSpace":"normal","wrap":"char"}',
    expectedOutputJson:
      '{"lineCount":1,"usedWidth":31.28,"usedHeight":30.0,"lines":[{"charStart":0,"charEnd":3,"text":"A\\"A","inlineAdvancePx":31.28,"kinsokuUnresolved":false}]}',
    inputSha256: "60c46bf77f6ca4f1ad7c6a0bd68f504f748e83a12a640ac2289f236923f2a7ad",
    outputSha256: "6cdd9e93c7f2369d7e1b2ce5b48be681765022d8da26ed25660dfe6f075896b3",
  },
  {
    operation: "shrinkwrapText",
    wasmMethod: "shrinkwrap_text",
    inputJson:
      '{"fontFamily":"NotoSansJP","fontSizePx":20.0,"language":"auto","lineHeight":1.5,"maxWidth":180.0,"text":"A\\"A","whiteSpace":"normal","wrap":"char"}',
    expectedOutputJson:
      '{"status":"satisfied","chosenWidthPx":31.33703125,"lineCount":1,"usedHeight":30.0,"maxLineWidth":31.28}',
    inputSha256: "60c46bf77f6ca4f1ad7c6a0bd68f504f748e83a12a640ac2289f236923f2a7ad",
    outputSha256: "bfe1e5a769c43a14767264b03b1100b71f24192a0e196d593ffd8fce632baff2",
  },
  {
    operation: "measureTextBlock",
    wasmMethod: "measure_text_block",
    inputJson:
      '{"fontFamily":"NotoSansJP","fontSizePx":20.0,"language":"auto","lineHeight":1.5,"maxWidth":32.8,"text":"A\\"A","whiteSpace":"normal","wrap":"char"}',
    expectedOutputJson:
      '{"lineCount":1,"usedWidth":31.28,"usedHeight":30.0,"lines":[{"charStart":0,"charEnd":3,"text":"A\\"A","inlineAdvancePx":31.28,"kinsokuUnresolved":false}]}',
    inputSha256: "0589edc09147f0c2d8965fa68121be30acbc9e75cda15db709799a98c5844426",
    outputSha256: "6cdd9e93c7f2369d7e1b2ce5b48be681765022d8da26ed25660dfe6f075896b3",
  },
  {
    operation: "shrinkwrapText",
    wasmMethod: "shrinkwrap_text",
    inputJson:
      '{"fontFamily":"NotoSansJP","fontSizePx":20.0,"language":"auto","lineHeight":1.5,"maxWidth":32.8,"text":"A\\"A","whiteSpace":"normal","wrap":"char"}',
    expectedOutputJson:
      '{"status":"satisfied","chosenWidthPx":31.34875,"lineCount":1,"usedHeight":30.0,"maxLineWidth":31.28}',
    inputSha256: "0589edc09147f0c2d8965fa68121be30acbc9e75cda15db709799a98c5844426",
    outputSha256: "80e403ab10aa5efffbde471249eed545a95e443d0807ce48eb71ef10b6221166",
  },
  {
    operation: "measureTextBlock",
    wasmMethod: "measure_text_block",
    inputJson:
      '{"fontFamily":"NotoSansJP","fontSizePx":20.0,"language":"ja","lineHeight":1.5,"maxWidth":180.0,"text":"A\\"A","whiteSpace":"normal","wrap":"char"}',
    expectedOutputJson:
      '{"lineCount":1,"usedWidth":33.82,"usedHeight":30.0,"lines":[{"charStart":0,"charEnd":3,"text":"A\\"A","inlineAdvancePx":33.82,"kinsokuUnresolved":false}]}',
    inputSha256: "2d4624c87c81687fce735a8ca07bc9a76c2b29ebfb831c14089e278d1ff015a1",
    outputSha256: "eece6ec8461fc1389a9aa33cf87f0856f2228000c44775470dd5b1194c94894a",
  },
  {
    operation: "shrinkwrapText",
    wasmMethod: "shrinkwrap_text",
    inputJson:
      '{"fontFamily":"NotoSansJP","fontSizePx":20.0,"language":"ja","lineHeight":1.5,"maxWidth":180.0,"text":"A\\"A","whiteSpace":"normal","wrap":"char"}',
    expectedOutputJson:
      '{"status":"satisfied","chosenWidthPx":33.95953125,"lineCount":1,"usedHeight":30.0,"maxLineWidth":33.82}',
    inputSha256: "2d4624c87c81687fce735a8ca07bc9a76c2b29ebfb831c14089e278d1ff015a1",
    outputSha256: "487718819ea2231cca2dd349628eee0194a15bcab5d0b9c7aec51977a3ee9fa6",
  },
  {
    operation: "measureTextBlock",
    wasmMethod: "measure_text_block",
    inputJson:
      '{"fontFamily":"NotoSansJP","fontSizePx":20.0,"language":"ja","lineHeight":1.5,"maxWidth":32.8,"text":"A\\"A","whiteSpace":"normal","wrap":"char"}',
    expectedOutputJson:
      '{"lineCount":2,"usedWidth":21.66,"usedHeight":60.0,"lines":[{"charStart":0,"charEnd":2,"text":"A\\"","inlineAdvancePx":21.66,"kinsokuUnresolved":false},{"charStart":2,"charEnd":3,"text":"A","inlineAdvancePx":12.16,"kinsokuUnresolved":false}]}',
    inputSha256: "1e38041ae27bce99bf9321282c0f685b9af612b5a7ef0b2b563cad39c23e5fb0",
    outputSha256: "144539b7e242e3bb41d2cacc2feee8e3078bd2dfcac51b219b72fec133b314e1",
  },
  {
    operation: "shrinkwrapText",
    wasmMethod: "shrinkwrap_text",
    inputJson:
      '{"fontFamily":"NotoSansJP","fontSizePx":20.0,"language":"ja","lineHeight":1.5,"maxWidth":32.8,"text":"A\\"A","whiteSpace":"normal","wrap":"char"}',
    expectedOutputJson:
      '{"status":"satisfied","chosenWidthPx":21.67375,"lineCount":2,"usedHeight":60.0,"maxLineWidth":21.66}',
    inputSha256: "1e38041ae27bce99bf9321282c0f685b9af612b5a7ef0b2b563cad39c23e5fb0",
    outputSha256: "d9f5f5d22ba6cfe02328c604459184d9d528a8f6c01a31e0c111bef1d961e316",
  },
  {
    operation: "measureTextBlock",
    wasmMethod: "measure_text_block",
    inputJson:
      '{"fontFamily":"NotoSansJP","fontSizePx":20.0,"language":"en","lineHeight":1.5,"maxWidth":180.0,"text":"A\\"A","whiteSpace":"normal","wrap":"char"}',
    expectedOutputJson:
      '{"lineCount":1,"usedWidth":31.28,"usedHeight":30.0,"lines":[{"charStart":0,"charEnd":3,"text":"A\\"A","inlineAdvancePx":31.28,"kinsokuUnresolved":false}]}',
    inputSha256: "9f645efd96dc60776504a883455e82e84fd2261548ed596658c2e5257d643477",
    outputSha256: "6cdd9e93c7f2369d7e1b2ce5b48be681765022d8da26ed25660dfe6f075896b3",
  },
  {
    operation: "shrinkwrapText",
    wasmMethod: "shrinkwrap_text",
    inputJson:
      '{"fontFamily":"NotoSansJP","fontSizePx":20.0,"language":"en","lineHeight":1.5,"maxWidth":180.0,"text":"A\\"A","whiteSpace":"normal","wrap":"char"}',
    expectedOutputJson:
      '{"status":"satisfied","chosenWidthPx":31.33703125,"lineCount":1,"usedHeight":30.0,"maxLineWidth":31.28}',
    inputSha256: "9f645efd96dc60776504a883455e82e84fd2261548ed596658c2e5257d643477",
    outputSha256: "bfe1e5a769c43a14767264b03b1100b71f24192a0e196d593ffd8fce632baff2",
  },
  {
    operation: "measureTextBlock",
    wasmMethod: "measure_text_block",
    inputJson:
      '{"fontFamily":"NotoSansJP","fontSizePx":20.0,"language":"en","lineHeight":1.5,"maxWidth":32.8,"text":"A\\"A","whiteSpace":"normal","wrap":"char"}',
    expectedOutputJson:
      '{"lineCount":1,"usedWidth":31.28,"usedHeight":30.0,"lines":[{"charStart":0,"charEnd":3,"text":"A\\"A","inlineAdvancePx":31.28,"kinsokuUnresolved":false}]}',
    inputSha256: "09b78a1240b1c3fc7256953121e79ed6040e78422c13cdc774c0e123fffc40f6",
    outputSha256: "6cdd9e93c7f2369d7e1b2ce5b48be681765022d8da26ed25660dfe6f075896b3",
  },
  {
    operation: "shrinkwrapText",
    wasmMethod: "shrinkwrap_text",
    inputJson:
      '{"fontFamily":"NotoSansJP","fontSizePx":20.0,"language":"en","lineHeight":1.5,"maxWidth":32.8,"text":"A\\"A","whiteSpace":"normal","wrap":"char"}',
    expectedOutputJson:
      '{"status":"satisfied","chosenWidthPx":31.34875,"lineCount":1,"usedHeight":30.0,"maxLineWidth":31.28}',
    inputSha256: "09b78a1240b1c3fc7256953121e79ed6040e78422c13cdc774c0e123fffc40f6",
    outputSha256: "80e403ab10aa5efffbde471249eed545a95e443d0807ce48eb71ef10b6221166",
  },
  {
    operation: "shrinkwrapText",
    wasmMethod: "shrinkwrap_text",
    inputJson:
      '{"fontFamily":"NotoSansJP","fontSizePx":20.0,"maxWidth":180.0,"text":"Hello 🎉","whiteSpace":"normal"}',
    expectedOutputJson:
      '{"status":"satisfied","chosenWidthPx":73.75,"lineCount":1,"usedHeight":24.0,"maxLineWidth":73.60000000000001}',
    inputSha256: "ad5753c1dca558344d52f97a333911c6e0dbf31a5d318c1223f191ac3e966021",
    outputSha256: "95e56f00aeed9ba0e77ab9bdbf098b6538520492ea7f19699b932b41b28ed18f",
  },
  {
    operation: "shrinkwrapText",
    wasmMethod: "shrinkwrap_text",
    inputJson:
      '{"fontFamily":"NotoSansJP","fontSizePx":20.0,"maxWidth":180.0,"text":"Hello 龘","whiteSpace":"normal"}',
    expectedOutputJson:
      '{"status":"satisfied","chosenWidthPx":73.75,"lineCount":1,"usedHeight":24.0,"maxLineWidth":73.60000000000001}',
    inputSha256: "897bd6ceaf56d74e9f263e86b603e2cb084ac0199879946e6543ba92ad1c3e47",
    outputSha256: "95e56f00aeed9ba0e77ab9bdbf098b6538520492ea7f19699b932b41b28ed18f",
  },
  {
    operation: "measureTextBlock",
    wasmMethod: "measure_text_block",
    inputJson:
      '{"text":"Hello 🎉","fontFamily":"NotoSansJP","fontSizePx":20,"maxWidth":180,"whiteSpace":"normal"}',
    expectedOutputJson:
      '{"lineCount":1,"usedWidth":73.60000000000001,"usedHeight":24.0,"lines":[{"charStart":0,"charEnd":7,"text":"Hello 🎉","inlineAdvancePx":73.60000000000001,"kinsokuUnresolved":false}]}',
    inputSha256: "d834dcda5a5ad10c6c8bb4194907a7f6da8e2e6d200093e797aeefb669eabb7a",
    outputSha256: "4a89de85f4b5db1aa2a551c3c9bb22020843f78a45bb78fbff2b3bbd5ee819dd",
  },
  {
    operation: "measureTextBlock",
    wasmMethod: "measure_text_block",
    inputJson:
      '{"text":"Hello 龘","fontFamily":"NotoSansJP","fontSizePx":20,"maxWidth":180,"whiteSpace":"normal"}',
    expectedOutputJson:
      '{"lineCount":1,"usedWidth":73.60000000000001,"usedHeight":24.0,"lines":[{"charStart":0,"charEnd":7,"text":"Hello 龘","inlineAdvancePx":73.60000000000001,"kinsokuUnresolved":false}]}',
    inputSha256: "b8cb057f6f04a7415cc81aa3b67e596e366c5d8fa72b44c152ddb6a8dc4a277d",
    outputSha256: "352d2176675670a8c8899b6c5791c572d35d2ca4cc21645098ccc4b85f9785b0",
  },
];
