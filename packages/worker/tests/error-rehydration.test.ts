import {
  FatalError,
  RecoverableError,
  type SerializedFatalError,
  type SerializedRecoverableError,
} from "@boundsvg/core";
import { describe, expect, it } from "vitest";
import { rehydrateError } from "../src/error-rehydration.js";

describe("rehydrateError", () => {
  it("creates FatalError from a serialized fatal diagnostic", () => {
    const input: SerializedFatalError = {
      severity: "fatal",
      code: "TEST_CODE",
      message: "something broke",
    };
    const result = rehydrateError(input);
    expect(result).toBeInstanceOf(FatalError);
    expect(result.code).toBe("TEST_CODE");
    expect(result.message).toBe("something broke");
    expect(result.severity).toBe("fatal");
  });

  it("creates RecoverableError from a serialized recoverable diagnostic", () => {
    const input: SerializedRecoverableError = {
      severity: "recoverable",
      code: "WARN_CODE",
      message: "glyph missing",
      fallback: "used .notdef",
      stage: "text",
    };
    const result = rehydrateError(input);
    expect(result).toBeInstanceOf(RecoverableError);
    expect(result.code).toBe("WARN_CODE");
    expect(result.message).toBe("glyph missing");
    expect(result.severity).toBe("recoverable");
    expect((result as RecoverableError).fallback).toBe("used .notdef");
  });

  it("preserves stage in context", () => {
    const input: SerializedFatalError = {
      severity: "fatal",
      code: "X",
      message: "m",
      stage: "engine",
    };
    const result = rehydrateError(input);
    expect(result.stage).toBe("engine");
  });

  it("preserves nodeId in context", () => {
    const input: SerializedFatalError = {
      severity: "fatal",
      code: "X",
      message: "m",
      nodeId: "box-1",
    };
    const result = rehydrateError(input);
    expect(result.nodeId).toBe("box-1");
  });

  it("preserves context bag", () => {
    const input: SerializedFatalError = {
      severity: "fatal",
      code: "X",
      message: "m",
      context: { extra: "data" },
    };
    const result = rehydrateError(input);
    expect(result.context).toEqual({ extra: "data" });
  });

  it("preserves stage + nodeId + context together", () => {
    const input: SerializedFatalError = {
      severity: "fatal",
      code: "X",
      message: "m",
      stage: "emit",
      nodeId: "node-42",
      context: { detail: 123 },
    };
    const result = rehydrateError(input);
    expect(result.stage).toBe("emit");
    expect(result.nodeId).toBe("node-42");
    expect(result.context).toEqual({ detail: 123 });
  });

  it("rejects a recoverable diagnostic without fallback and stage", () => {
    const input: unknown = {
      severity: "recoverable",
      code: "W",
      message: "w",
    };
    expect(() => Reflect.apply(rehydrateError, undefined, [input])).toThrow(TypeError);
  });

  it("round-trips through FatalError.toJSON()", () => {
    const original = new FatalError("CODE", "msg", { stage: "layout", nodeId: "n" });
    const json = original.toJSON();
    const rehydrated = rehydrateError(json);
    expect(rehydrated).toBeInstanceOf(FatalError);
    expect(rehydrated.code).toBe("CODE");
    expect(rehydrated.message).toBe("msg");
    expect(rehydrated.stage).toBe("layout");
    expect(rehydrated.nodeId).toBe("n");
  });

  it("round-trips through RecoverableError.toJSON()", () => {
    const original = new RecoverableError("CODE", "msg", { fallback: "fb", stage: "text" });
    const json = original.toJSON();
    const rehydrated = rehydrateError(json);
    expect(rehydrated).toBeInstanceOf(RecoverableError);
    expect((rehydrated as RecoverableError).fallback).toBe("fb");
    expect(rehydrated.stage).toBe("text");
  });
});
