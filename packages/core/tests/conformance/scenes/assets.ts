/** Font aliases registered by the conformance engine (see conformance-engine.ts). */
export const FONT_SANS_JP = "NotoSansJP";
export const FONT_SERIF_JP = "NotoSerifJP";
export const FONT_MONO = "JetBrainsMono";
export const FONT_LATIN = "InterVariable";

// 48x48 truecolor PNG with a fixed diagonal blue-to-teal gradient, generated
// once and embedded so scenes never read the filesystem or the network.
const SAMPLE_PHOTO_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAByklEQVR42s3OiT4TAAAH4P/L5FqikSPXEkOOhFxD+im5r5KSVSiUEGaMHYZtzGxjHVTOVESUklS0DiQv0Wv8vyf4cCjrwOHCP4eL+47Zf52y95wu7Trn7Djn/nHJ+y3I/yUo+Hm4wO5aaHct+nGkeNutZMut9Lt76Tf3sq9HL28Kr3wRlm94XP3sWbHuWfHp2LWPXtfXvCo/eN9471O16iNd8ZW+8725fPzWkt/tt37Vi/41iwE1CwG1bwLvvA66+yqobl5U/1LUMHeiYTb43kzw/emTjVOg2oQ8mATVJqTpBag2oc3PQbURNz8D1UbcMgGqTdjDcVBtwlqfgmoT3vYEVJuI9seg2kTIHoFqc0pmA9UmssMGqk2kfAxUm6jOUVBtorusoNpEKyyg2sQozKDaxHSPgGpzuscEqk2schhUm1iVEVSbM+ohUG3iNIOg2sRpDKDaxPfqQbVJ0OpAtUnoGwDV5mx/P6g2iQN9oNok6rSg2iTpekG1SdJrQLVJNqhBtUkZVIFqkzKkBNUm1agE1UZi7AHVRjLcDapNmkkBqk36SBeoNunmTlBtMixyUG0yrB2g2pyzykC1yRxtB9Umc6wNVJvzttb/s2XsxHQyw+AAAAAASUVORK5CYII=";

/** Deterministic 48x48 sample photo used by image-bearing scenes. */
export const SAMPLE_PHOTO_PNG: Uint8Array = Uint8Array.from(
  Buffer.from(SAMPLE_PHOTO_BASE64, "base64"),
);
