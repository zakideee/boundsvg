import { fromSceneDocument, isSceneNode, type SceneNode } from "@boundsvg/core";

type ParsedSceneInput = { ok: true; scene: SceneNode } | { ok: false; message: string };

export function parseSceneInput(content: string): ParsedSceneInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, message: "Invalid JSON in input" };
  }

  if (!isSceneNode(parsed)) {
    return { ok: false, message: "Invalid SceneDocument: input does not match SceneNode shape" };
  }

  try {
    fromSceneDocument(parsed);
  } catch (err) {
    return {
      ok: false,
      message: `Invalid SceneDocument: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { ok: true, scene: parsed };
}
