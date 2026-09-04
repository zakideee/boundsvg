import { fromSceneDocument, type VNode } from "@boundsvg/core";

type ParsedSceneInput =
  | { ok: true; vnode: VNode }
  | { ok: false; kind: "syntax"; message: string }
  | { ok: false; kind: "scene"; error: unknown };

export function parseSceneInput(content: string): ParsedSceneInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, kind: "syntax", message: "Invalid JSON in input" };
  }

  try {
    return { ok: true, vnode: fromSceneDocument(parsed) };
  } catch (error) {
    return { ok: false, kind: "scene", error };
  }
}
