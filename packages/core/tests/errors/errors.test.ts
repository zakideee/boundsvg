import { describe, expect, it } from "vitest";
import { FatalError, RecoverableError } from "../../src/errors.js";

describe("FatalError", () => {
  it("has correct properties", () => {
    const err = new FatalError("VALIDATION", "Something failed", {
      nodeId: "n1",
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FatalError);
    expect(err.name).toBe("FatalError");
    expect(err.code).toBe("VALIDATION");
    expect(err.message).toBe("Something failed");
    expect(err.context).toEqual({ nodeId: "n1" });
    expect(err.severity).toBe("fatal");
  });

  it("works without context", () => {
    const err = new FatalError("TEST", "No context");
    expect(err.severity).toBe("fatal");

    expect(err.code).toBe("TEST");
    expect(err.context).toBeUndefined();
  });

  it("is throwable and catchable", () => {
    expect(() => {
      throw new FatalError("CODE", "msg");
    }).toThrow(FatalError);
  });

  it("extracts stage from context", () => {
    const err = new FatalError("VALIDATION", "msg", {
      stage: "validate",
      nodeId: "myNode",
    });
    expect(err.stage).toBe("validate");
    expect(err.nodeId).toBe("myNode");
  });

  it("extracts all valid pipeline stages", () => {
    const stages = [
      "validate",
      "layout",
      "text",
      "ir",
      "emit",
      "wasm",
      "font",
      "engine",
      "analyzer",
    ] as const;
    for (const stage of stages) {
      const err = new FatalError("TEST", "msg", { stage });
      expect(err.stage).toBe(stage);
    }
  });

  it("ignores invalid stage values", () => {
    const err = new FatalError("TEST", "msg", { stage: "bogus" });
    expect(err.stage).toBeUndefined();
  });

  it("ignores non-string nodeId", () => {
    const err = new FatalError("TEST", "msg", { nodeId: 42 });
    expect(err.nodeId).toBeUndefined();
  });

  it("stage/nodeId are undefined without context", () => {
    const err = new FatalError("TEST", "msg");
    expect(err.stage).toBeUndefined();
    expect(err.nodeId).toBeUndefined();
  });

  it("preserves full context alongside stage/nodeId", () => {
    const err = new FatalError("TEST", "msg", {
      stage: "ir",
      nodeId: "img1",
      extra: "data",
    });
    expect(err.stage).toBe("ir");
    expect(err.nodeId).toBe("img1");
    expect(err.context).toEqual({ stage: "ir", nodeId: "img1", extra: "data" });
  });

  it("toJSON() preserves message across JSON.stringify", () => {
    const err = new FatalError("VALIDATION", "Something failed", {
      stage: "validate",
      nodeId: "n1",
    });
    const json = JSON.parse(JSON.stringify(err));
    expect(json.severity).toBe("fatal");
    expect(json.code).toBe("VALIDATION");
    expect(json.message).toBe("Something failed");
    expect(json.stage).toBe("validate");
    expect(json.nodeId).toBe("n1");
  });
});

describe("RecoverableError", () => {
  it("has correct properties", () => {
    const err = new RecoverableError("IMAGE_LOAD_FAILED", "Could not load image", {
      fallback: "placeholder_rect",
      context: { nodeId: "img1" },
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RecoverableError);
    expect(err.name).toBe("RecoverableError");
    expect(err.code).toBe("IMAGE_LOAD_FAILED");
    expect(err.message).toBe("Could not load image");
    expect(err.fallback).toBe("placeholder_rect");
    expect(err.context).toEqual({ nodeId: "img1" });
    expect(err.severity).toBe("recoverable");
  });

  it("works without context", () => {
    const err = new RecoverableError("TEST", "msg", { fallback: "default" });

    expect(err.code).toBe("TEST");
    expect(err.fallback).toBe("default");
    expect(err.context).toBeUndefined();
    expect(err.severity).toBe("recoverable");
  });

  it("is not a FatalError", () => {
    const err = new RecoverableError("CODE", "msg", { fallback: "fallback" });
    expect(err).not.toBeInstanceOf(FatalError);
  });

  it("extracts stage and nodeId from context", () => {
    const err = new RecoverableError("IMG", "msg", {
      fallback: "fallback",
      context: { stage: "ir", nodeId: "img-node" },
    });
    expect(err.stage).toBe("ir");
    expect(err.nodeId).toBe("img-node");
  });

  it("stage/nodeId are undefined without context", () => {
    const err = new RecoverableError("TEST", "msg", { fallback: "fallback" });
    expect(err.stage).toBeUndefined();
    expect(err.nodeId).toBeUndefined();
  });

  it("toJSON() preserves message and fallback across JSON.stringify", () => {
    const err = new RecoverableError("IMAGE_LOAD_FAILED", "Load failed", {
      fallback: "placeholder_rect",
      context: { stage: "ir", nodeId: "img1" },
    });
    const json = JSON.parse(JSON.stringify(err));
    expect(json.severity).toBe("recoverable");
    expect(json.code).toBe("IMAGE_LOAD_FAILED");
    expect(json.message).toBe("Load failed");
    expect(json.fallback).toBe("placeholder_rect");
    expect(json.stage).toBe("ir");
    expect(json.nodeId).toBe("img1");
  });
});
