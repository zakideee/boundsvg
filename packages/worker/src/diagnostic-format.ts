/** Format an unknown Worker boundary value without allowing a secondary failure. */
export function formatUnknownWorkerFailure(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value.length > 0 ? value : fallback;
  }

  if (value === null) {
    return "null";
  }

  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    try {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, "message");
      if (
        descriptor !== undefined &&
        "value" in descriptor &&
        typeof descriptor.value === "string" &&
        descriptor.value.length > 0
      ) {
        return descriptor.value;
      }
    } catch {
      return fallback;
    }
    return fallback;
  }

  try {
    const text = String(value);
    return text.length > 0 ? text : fallback;
  } catch {
    return fallback;
  }
}
