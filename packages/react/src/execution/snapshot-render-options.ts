/** Copy option value containers while leaving invalid values for the existing Core validators. */
export function snapshotRenderOptions<Value>(value: Value): Value {
  return copyOptionValue(value, new Map()) as Value;
}

function copyOptionValue(value: unknown, copies: Map<object, unknown>): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (copies.has(value)) {
    return copies.get(value);
  }
  if (Array.isArray(value)) {
    const arrayCopy: unknown[] = [];
    copies.set(value, arrayCopy);
    for (const element of value) {
      arrayCopy.push(copyOptionValue(element, copies));
    }
    return arrayCopy;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return value;
  }
  const objectCopy: Record<string, unknown> = {};
  copies.set(value, objectCopy);
  for (const key of Object.keys(value)) {
    Object.defineProperty(objectCopy, key, {
      value: copyOptionValue(Reflect.get(value, key), copies),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return objectCopy;
}
