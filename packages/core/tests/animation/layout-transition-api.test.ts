import { describe, expect, it } from "vitest";
import { Engine } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import {
  type LayoutTransitionInput,
  resolveLayoutTransitionInput,
} from "../../src/layout-transition.js";
import type { SceneNode } from "../../src/scene/types.js";

function state(boxHeight: number): SceneNode {
  return {
    type: "Canvas",
    id: "scene",
    width: 100,
    height: 100,
    children: [
      {
        type: "Box",
        id: "box",
        width: 20,
        height: boxHeight,
        background: "#123456",
        children: [],
      },
    ],
  };
}

function validInput(): LayoutTransitionInput {
  return {
    states: { collapsed: state(20), expanded: state(40) },
    checkpoints: [
      { timeMs: 0, state: "collapsed" },
      { timeMs: 300, state: "expanded" },
      { timeMs: 700, state: "expanded" },
      { timeMs: 1_000, state: "collapsed" },
    ],
    easing: "ease-in-out",
  };
}

function expectScheduleFatal(input: unknown): void {
  let thrown: unknown;
  try {
    resolveLayoutTransitionInput(input as LayoutTransitionInput);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(FatalError);
  expect(thrown).toMatchObject({
    code: "LAYOUT_TRANSITION_INVALID_SCHEDULE",
    stage: "validate",
    context: { category: "schedule" },
  });
}

describe("layout transition public API", () => {
  it("normalizes the two public state names to the private 0/1 wire sequence", () => {
    const resolved = resolveLayoutTransitionInput(validInput());

    expect(resolved.referenceStateName).toBe("collapsed");
    expect(resolved.targetStateName).toBe("expanded");
    expect(resolved.wirePlan).toEqual({
      checkpoints: [
        { timeMs: 0, stateIndex: 0 },
        { timeMs: 300, stateIndex: 1 },
        { timeMs: 700, stateIndex: 1 },
        { timeMs: 1_000, stateIndex: 0 },
      ],
      easing: "ease-in-out",
    });
  });

  it.each([
    ["one state", { ...validInput(), states: { collapsed: state(20) } }],
    ["three states", { ...validInput(), states: { ...validInput().states, third: state(60) } }],
    ["three checkpoints", { ...validInput(), checkpoints: validInput().checkpoints.slice(0, 3) }],
    [
      "non-zero start",
      {
        ...validInput(),
        checkpoints: [{ timeMs: 1, state: "collapsed" }, ...validInput().checkpoints.slice(1)],
      },
    ],
    [
      "non-finite time",
      {
        ...validInput(),
        checkpoints: [
          validInput().checkpoints[0],
          { timeMs: Number.POSITIVE_INFINITY, state: "expanded" },
          ...validInput().checkpoints.slice(2),
        ],
      },
    ],
    [
      "duplicate time",
      {
        ...validInput(),
        checkpoints: [
          validInput().checkpoints[0],
          validInput().checkpoints[1],
          { timeMs: 300, state: "expanded" },
          validInput().checkpoints[3],
        ],
      },
    ],
    [
      "wrong state sequence",
      {
        ...validInput(),
        checkpoints: [
          validInput().checkpoints[0],
          validInput().checkpoints[1],
          { timeMs: 700, state: "collapsed" },
          validInput().checkpoints[3],
        ],
      },
    ],
    [
      "unknown state",
      {
        ...validInput(),
        checkpoints: [
          validInput().checkpoints[0],
          { timeMs: 300, state: "missing" },
          { timeMs: 700, state: "missing" },
          validInput().checkpoints[3],
        ],
      },
    ],
    ["invalid easing", { ...validInput(), easing: "squiggle" }],
  ])("rejects %s before invoking Rust", (_name, input) => {
    expectScheduleFatal(input);
  });

  it("returns CompiledScene and never exposes sampleAnimation as an option", () => {
    const calls: Array<{
      reference: string;
      target: string;
      plan: string;
      options: string;
    }> = [];
    const engine = new Engine({
      computeLayoutFn: () => JSON.stringify({ nodes: [] }),
      compileLayoutTransitionFn: (reference, target, plan, options) => {
        calls.push({ reference, target, plan, options });
        return JSON.stringify({
          ir: {
            root: {
              nodeId: "scene",
              bbox: { x: 0, y: 0, w: 100, h: 100 },
              type: "group",
            },
            drawOrder: [],
            width: 100,
            height: 100,
          },
          warnings: [],
        });
      },
    });

    const compiled = engine.compileLayoutTransition(validInput(), {
      skipValidation: true,
      textPathMode: "glyphs",
    });

    expect(compiled).toMatchObject({ width: 100, height: 100, textPathMode: "glyphs" });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.options ?? "null")).toEqual({ textPathMode: "glyphs" });
    expect(JSON.parse(calls[0]?.plan ?? "null")).toEqual(
      resolveLayoutTransitionInput(validInput()).wirePlan,
    );
    expect(JSON.parse(calls[0]?.reference ?? "null").root.authoredId).toBe(true);
    expect(JSON.parse(calls[0]?.target ?? "null").root.authoredId).toBe(true);
  });

  it("delivers the transition envelope warnings in their retained order", () => {
    const engine = new Engine({
      computeLayoutFn: () => JSON.stringify({ nodes: [] }),
      compileLayoutTransitionFn: () =>
        JSON.stringify({
          ir: {
            root: {
              nodeId: "scene",
              bbox: { x: 0, y: 0, w: 100, h: 100 },
              type: "group",
            },
            drawOrder: [],
            width: 100,
            height: 100,
          },
          warnings: [
            {
              severity: "recoverable",
              code: "REFERENCE_WARNING",
              message: "reference warning",
              stage: "ir",
              fallback: "kept reference output",
            },
            {
              severity: "recoverable",
              code: "TARGET_WARNING",
              message: "target warning",
              stage: "ir",
              fallback: "kept reference output",
            },
          ],
        }),
      resolveAndEmitSvgFromIrFn: () => '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
    const compiled = engine.compileLayoutTransition(validInput(), { skipValidation: true });
    const warningCodes: string[] = [];

    engine.renderCompiledToSvg(compiled, {
      onWarning: (warning) => warningCodes.push(warning.code),
    });

    expect(warningCodes).toEqual(["REFERENCE_WARNING", "TARGET_WARNING"]);
  });
});
