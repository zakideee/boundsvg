import { FatalError } from "../errors.js";
import {
  DEFAULT_FONT_WEIGHT,
  type FontEntry,
  type FontFaceInput,
  type RegisterFontsOptions,
} from "./types.js";

export type FontRegistry = {
  register: (fonts: FontFaceInput[], options?: RegisterFontsOptions) => void;
  resolve: (alias: string, weight?: number, style?: "normal" | "italic") => FontEntry | null;
  resolveFallbackChain: (
    chain: string[],
    weight?: number,
    style?: "normal" | "italic",
  ) => FontEntry[];
  readonly size: number;
  dispose: () => void;
};

function fontKey(alias: string, weight: number, style: string): string {
  return `${alias}:${weight}:${style}`;
}

/** Negative when `candidate` is a better face than `incumbent` for the request. */
function compareFaceCandidates(
  candidate: { weight: number; style: string },
  incumbent: { weight: number; style: string },
  desired: { weight: number; style: string },
): number {
  const styleRank = (face: { style: string }): number => (face.style === desired.style ? 0 : 1);
  if (styleRank(candidate) !== styleRank(incumbent)) {
    return styleRank(candidate) - styleRank(incumbent);
  }
  const distance = (face: { weight: number }): number => Math.abs(face.weight - desired.weight);
  if (distance(candidate) !== distance(incumbent)) {
    return distance(candidate) - distance(incumbent);
  }
  return candidate.weight - incumbent.weight;
}

/**
 * Create a font registry that manages font registration and lookup.
 * Fonts are identified by the tuple (alias, weight, style).
 */
export function createFontRegistry(): FontRegistry {
  const entries = new Map<string, FontEntry>();

  function resolveRegisteredFont(
    alias: string,
    weight?: number,
    style?: "normal" | "italic",
  ): FontEntry | null {
    const desiredWeight = weight ?? DEFAULT_FONT_WEIGHT;
    const desiredStyle = style ?? "normal";
    const exact = entries.get(fontKey(alias, desiredWeight, desiredStyle));
    if (exact) {
      return exact;
    }
    // Closest match within the alias (documented contract: closest weight by
    // simple distance; matching style preferred; weight-distance ties go to
    // the lower weight). Same rule as the Rust registry.
    let best: FontEntry | null = null;
    for (const entry of entries.values()) {
      if (entry.alias !== alias) {
        continue;
      }
      if (
        best === null ||
        compareFaceCandidates(entry, best, { weight: desiredWeight, style: desiredStyle }) < 0
      ) {
        best = entry;
      }
    }
    return best;
  }

  return {
    register(fonts: FontFaceInput[], options?: RegisterFontsOptions): void {
      const onDuplicate = options?.onDuplicate ?? "error";

      for (const input of fonts) {
        const weight = input.weight ?? DEFAULT_FONT_WEIGHT;
        const style = input.style ?? "normal";
        const key = fontKey(input.alias, weight, style);

        if (entries.has(key)) {
          switch (onDuplicate) {
            case "error":
              throw new FatalError(
                "FONT_DUPLICATE",
                `Font already registered: ${input.alias} weight=${weight} style=${style}`,
                { stage: "font" },
              );
            case "skip":
              continue;
            case "replace":
              break;
          }
        }

        entries.set(key, {
          alias: input.alias,
          weight,
          style,
          data: input.data,
        });
      }
    },

    resolve(alias: string, weight?: number, style?: "normal" | "italic"): FontEntry | null {
      return resolveRegisteredFont(alias, weight, style);
    },

    resolveFallbackChain(
      chain: string[],
      weight?: number,
      style?: "normal" | "italic",
    ): FontEntry[] {
      const results: FontEntry[] = [];
      for (const alias of chain) {
        const entry = resolveRegisteredFont(alias, weight, style);
        if (entry) {
          results.push(entry);
        }
      }
      return results;
    },

    get size(): number {
      return entries.size;
    },

    dispose(): void {
      entries.clear();
    },
  };
}
