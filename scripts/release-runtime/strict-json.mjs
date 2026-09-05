import { failRelease } from "./errors.mjs";

const tokenPattern = /("(?:[^"\\]|\\(?:["\\/bfnrt]|u[a-fA-F\d]{4}))*")([\t\n\r ]*:)?|[{}[\]]/g;
function recordObjectKey(keys, key, invalid) {
  if (!(keys instanceof Set) || keys.has(key)) {
    invalid();
  }
  keys.add(key);
}
export function parseStrictJsonBytes(bytes, label) {
  const invalid = (cause) =>
    failRelease("ARCHIVE_JSON_INVALID", `${label} is invalid JSON`, { cause });
  let source, value;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(source);
  } catch (error) {
    invalid(error);
  }
  const containers = [];
  for (const match of source.matchAll(tokenPattern)) {
    const token = match[1] ?? match[0];
    if (token === "{" || token === "[") {
      if (containers.length >= 128) {
        invalid();
      }
      containers.push(token === "{" ? new Set() : undefined);
    } else if (token === "}" || token === "]") {
      containers.pop();
    } else if (match[2] !== undefined) {
      recordObjectKey(containers.at(-1), JSON.parse(token), invalid);
    }
  }
  return value;
}
