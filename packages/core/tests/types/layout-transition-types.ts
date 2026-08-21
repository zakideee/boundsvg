import {
  type CompiledScene,
  compileLayoutTransition,
  type Engine,
  type LayoutTransitionInput,
  type VNode,
} from "../../dist/index.js";

declare const engine: Engine;
declare const stateA: VNode;
declare const stateB: VNode;

const transition: LayoutTransitionInput = {
  states: { A: stateA, B: stateB },
  checkpoints: [
    { timeMs: 0, state: "A" },
    { timeMs: 300, state: "B" },
    { timeMs: 700, state: "B" },
    { timeMs: 1_000, state: "A" },
  ],
  easing: "ease-in-out",
};

const engineCompiled: CompiledScene = engine.compileLayoutTransition(transition, {
  skipValidation: true,
  textPathMode: "glyphs",
});
const defaultCompiled: CompiledScene = compileLayoutTransition(transition);
void engineCompiled;
void defaultCompiled;

engine.compileLayoutTransition(transition, {
  // @ts-expect-error animation sampling is fixed by the transition operation
  sampleAnimation: true,
});

const invalidCheckpointCount: LayoutTransitionInput = {
  states: { A: stateA, B: stateB },
  // @ts-expect-error a transition schedule has exactly four checkpoints
  checkpoints: [
    { timeMs: 0, state: "A" },
    { timeMs: 300, state: "B" },
    { timeMs: 1_000, state: "A" },
  ],
};
void invalidCheckpointCount;
