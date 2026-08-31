import { FatalError } from "./errors.js";
import { cloneIR } from "./ir/clone.js";
import type { IR } from "./ir/types.js";
import type { TextPathMode } from "./text/types.js";

/** Hidden runtime marker that makes authentic facades nominal. */
const compiledSceneBrand: unique symbol = Symbol("CompiledScene");
/** Type-only marker that keeps owner tokens opaque. */
declare const compiledSceneOwnerTokenBrand: unique symbol;

/**
 * An opaque render artifact produced by one exact Engine instance.
 *
 * The metadata is readable, but the render state is private and immutable.
 * Use Engine.snapshotCompiledIR() when an editable inspection copy is needed.
 */
export type CompiledScene = {
  readonly [compiledSceneBrand]: true;
  /** Authoritative compiled canvas width. */
  readonly width: number;
  /** Authoritative compiled canvas height. */
  readonly height: number;
  /** Text-on-path strategy fixed when the scene was compiled. */
  readonly textPathMode: TextPathMode;
};

/** Opaque identity owned by one Engine instance. */
export type CompiledSceneOwnerToken = {
  readonly [compiledSceneOwnerTokenBrand]: true;
};

/** Private state authenticated for a compiled-scene operation. */
export type CompiledSceneRecord = Readonly<{
  ownerToken: CompiledSceneOwnerToken;
  ir: IR;
  width: number;
  height: number;
  textPathMode: TextPathMode;
}>;

/** Private compiled state keyed weakly by its public facade identity. */
const compiledSceneRecords = new WeakMap<CompiledScene, CompiledSceneRecord>();

function invalidCompiledSceneError(): FatalError {
  return new FatalError("COMPILED_SCENE_INVALID", "Compiled scene is not an authentic artifact", {
    stage: "engine",
  });
}

function metadataRecord(compiled: CompiledScene): CompiledSceneRecord {
  const record = compiledSceneRecords.get(compiled);
  if (record === undefined) {
    throw invalidCompiledSceneError();
  }
  return record;
}

function compiledSceneWidth(this: CompiledScene): number {
  return metadataRecord(this).width;
}

function compiledSceneHeight(this: CompiledScene): number {
  return metadataRecord(this).height;
}

function compiledSceneTextPathMode(this: CompiledScene): TextPathMode {
  return metadataRecord(this).textPathMode;
}

/** Create the immutable identity token for one Engine instance. */
export function createCompiledSceneOwnerToken(): CompiledSceneOwnerToken {
  return Object.freeze({}) as CompiledSceneOwnerToken;
}

/** Create the only authentic public facade for private compiled state. */
export function createCompiledScene(
  ownerToken: CompiledSceneOwnerToken,
  ir: IR,
  textPathMode: TextPathMode,
): CompiledScene {
  const record: CompiledSceneRecord = {
    ownerToken,
    ir,
    width: ir.width,
    height: ir.height,
    textPathMode,
  };
  const compiled = {} as CompiledScene;
  Object.defineProperty(compiled, compiledSceneBrand, {
    value: true,
  });
  Object.defineProperty(compiled, "width", {
    enumerable: true,
    get: compiledSceneWidth,
  });
  Object.defineProperty(compiled, "height", {
    enumerable: true,
    get: compiledSceneHeight,
  });
  Object.defineProperty(compiled, "textPathMode", {
    enumerable: true,
    get: compiledSceneTextPathMode,
  });
  compiledSceneRecords.set(compiled, record);
  return Object.freeze(compiled);
}

/**
 * Authenticate a facade and return its private state.
 *
 * Authenticity is checked before ownership so forged values cannot reveal
 * owner information.
 */
export function authenticateCompiledScene(
  compiled: CompiledScene,
  expectedOwnerToken: CompiledSceneOwnerToken,
): CompiledSceneRecord {
  if (typeof compiled !== "object" || compiled === null) {
    throw invalidCompiledSceneError();
  }
  const record = compiledSceneRecords.get(compiled);
  if (record === undefined) {
    throw invalidCompiledSceneError();
  }
  if (record.ownerToken !== expectedOwnerToken) {
    throw new FatalError(
      "COMPILED_SCENE_WRONG_ENGINE",
      "Compiled scene belongs to a different Engine",
      { stage: "engine" },
    );
  }
  return record;
}

/** Return a detached inspection snapshot of authenticated private state. */
export function snapshotCompiledSceneRecordIR(record: CompiledSceneRecord): IR {
  return cloneIR(record.ir);
}
