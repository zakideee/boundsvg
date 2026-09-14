import { useLayoutEffect, useRef } from "react";

const CALLBACK_KEYS = new Set(["onWarning", "onPngResolutionAdjusted"]);

/** Compare own values, leaving nested values under the caller's immutable identity contract. */
export function useShallowRenderOptions<Options extends object>(
  options: Options | undefined,
): Options | undefined {
  const entries = options && Object.entries(options).filter(([key]) => !CALLBACK_KEYS.has(key));
  const committed = useRef<{ entries: typeof entries; options: Options | undefined } | null>(null);
  const previous = committed.current;
  const isEqual =
    previous !== null &&
    (entries == null
      ? previous.entries === entries
      : previous.entries != null &&
        entries.length === previous.entries.length &&
        entries.every(([key, value]) =>
          previous.entries?.some(
            ([oldKey, oldValue]) => key === oldKey && Object.is(value, oldValue),
          ),
        ));
  const stableOptions = isEqual
    ? previous.options
    : options != null && typeof options === "object" && !Array.isArray(options)
      ? (Object.fromEntries(entries ?? []) as Options)
      : options;
  useLayoutEffect(() => {
    committed.current = { entries, options: stableOptions };
  });
  return stableOptions;
}
