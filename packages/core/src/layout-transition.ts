import type { EngineInput } from "./engine.js";
import { FatalError } from "./errors.js";
import { validateAnimationValue } from "./validate/visual-props.js";
import type { AnimationEasing } from "./vnode/types.js";

/** One discrete-state reference on a layout-transition timeline. */
export type LayoutTransitionCheckpoint = {
  readonly timeMs: number;
  readonly state: string;
};

/**
 * Exactly two compatible layout states compiled into an A/B/hold/A track.
 * Runtime validation enforces the tuple length and state sequence.
 */
export type LayoutTransitionInput = {
  readonly states: Readonly<Record<string, EngineInput>>;
  readonly checkpoints: readonly [
    LayoutTransitionCheckpoint,
    LayoutTransitionCheckpoint,
    LayoutTransitionCheckpoint,
    LayoutTransitionCheckpoint,
  ];
  readonly easing?: AnimationEasing;
};

type ResolvedLayoutTransitionInput = {
  readonly referenceStateName: string;
  readonly targetStateName: string;
  readonly referenceInput: EngineInput;
  readonly targetInput: EngineInput;
  readonly wirePlan: {
    readonly checkpoints: readonly [
      { readonly timeMs: number; readonly stateIndex: 0 },
      { readonly timeMs: number; readonly stateIndex: 1 },
      { readonly timeMs: number; readonly stateIndex: 1 },
      { readonly timeMs: number; readonly stateIndex: 0 },
    ];
    readonly easing?: AnimationEasing;
  };
};

function describeTransitionValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `array(length=${value.length})`;
  }
  if (typeof value === "string") {
    return JSON.stringify(value).slice(0, 120);
  }
  if (typeof value === "object") {
    return "object";
  }
  return String(value).slice(0, 120);
}

type InvalidTransitionSchedule = {
  readonly message: string;
  readonly expected: string;
  readonly observed: unknown;
  readonly reason?: string;
};

type NormalizedCheckpoint = { readonly timeMs: number; readonly state: string };
type NormalizedCheckpoints = readonly [
  NormalizedCheckpoint,
  NormalizedCheckpoint,
  NormalizedCheckpoint,
  NormalizedCheckpoint,
];

function invalidTransitionSchedule(details: InvalidTransitionSchedule): never {
  throw new FatalError("LAYOUT_TRANSITION_INVALID_SCHEDULE", details.message, {
    stage: "validate",
    category: "schedule",
    expected: details.expected,
    observed: describeTransitionValue(details.observed),
    ...(details.reason === undefined ? {} : { reason: details.reason }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveTransitionStates(input: unknown): {
  states: Record<string, unknown>;
  stateNames: readonly [string, string];
} {
  if (!isRecord(input)) {
    invalidTransitionSchedule({
      message: "Layout transition input must be an object.",
      expected: "an object with states and checkpoints",
      observed: input,
    });
  }

  const states = input.states;
  if (!isRecord(states)) {
    invalidTransitionSchedule({
      message: "Layout transition states must be an object.",
      expected: "exactly two named states",
      observed: states,
    });
  }
  const stateNames = Object.keys(states);
  if (stateNames.length !== 2) {
    invalidTransitionSchedule({
      message: `Layout transition requires exactly two states, got ${stateNames.length}.`,
      expected: "exactly two named states",
      observed: stateNames,
    });
  }
  const [firstStateName, secondStateName] = stateNames;
  if (firstStateName === undefined || secondStateName === undefined) {
    invalidTransitionSchedule({
      message: "Layout transition state normalization failed.",
      expected: "exactly two named states",
      observed: stateNames,
    });
  }
  return { states, stateNames: [firstStateName, secondStateName] };
}

function resolveTransitionCheckpoints(
  checkpoints: unknown,
  stateDetails: {
    states: Record<string, unknown>;
    stateNames: readonly [string, string];
  },
): NormalizedCheckpoints {
  if (!Array.isArray(checkpoints) || checkpoints.length !== 4) {
    invalidTransitionSchedule({
      message: `Layout transition requires exactly four checkpoints, got ${
        Array.isArray(checkpoints) ? checkpoints.length : "a non-array value"
      }.`,
      expected: "exactly four checkpoints",
      observed: checkpoints,
    });
  }

  const normalizedCheckpoints: NormalizedCheckpoint[] = [];
  let previousTimeMs = -1;
  for (const [checkpointIndex, checkpoint] of checkpoints.entries()) {
    const normalizedCheckpoint = resolveTransitionCheckpoint({
      checkpoint,
      checkpointIndex,
      previousTimeMs,
      stateDetails,
    });
    normalizedCheckpoints.push(normalizedCheckpoint);
    previousTimeMs = normalizedCheckpoint.timeMs;
  }

  const firstCheckpoint = normalizedCheckpoints[0];
  const secondCheckpoint = normalizedCheckpoints[1];
  const holdCheckpoint = normalizedCheckpoints[2];
  const returnCheckpoint = normalizedCheckpoints[3];
  if (!firstCheckpoint || !secondCheckpoint || !holdCheckpoint || !returnCheckpoint) {
    invalidTransitionSchedule({
      message: "Layout transition checkpoint normalization failed.",
      expected: "four valid checkpoints",
      observed: normalizedCheckpoints,
    });
  }
  return [firstCheckpoint, secondCheckpoint, holdCheckpoint, returnCheckpoint];
}

function resolveTransitionCheckpoint(details: {
  checkpoint: unknown;
  checkpointIndex: number;
  previousTimeMs: number;
  stateDetails: {
    states: Record<string, unknown>;
    stateNames: readonly [string, string];
  };
}): NormalizedCheckpoint {
  const { checkpoint, checkpointIndex, previousTimeMs, stateDetails } = details;
  if (!isRecord(checkpoint)) {
    invalidTransitionSchedule({
      message: `Layout transition checkpoint ${checkpointIndex} must be an object.`,
      expected: "{ timeMs, state }",
      observed: checkpoint,
    });
  }
  const { timeMs, state } = checkpoint;
  if (typeof timeMs !== "number" || !Number.isFinite(timeMs) || timeMs < 0) {
    invalidTransitionSchedule({
      message: `Layout transition checkpoint ${checkpointIndex} has an invalid timeMs.`,
      expected: "a non-negative finite number",
      observed: timeMs,
    });
  }
  if (checkpointIndex === 0 && timeMs !== 0) {
    invalidTransitionSchedule({
      message: "Layout transition must start at timeMs 0.",
      expected: "0",
      observed: timeMs,
    });
  }
  if (checkpointIndex > 0 && timeMs <= previousTimeMs) {
    invalidTransitionSchedule({
      message: `Layout transition checkpoint ${checkpointIndex} must be later than its predecessor.`,
      expected: `a value greater than ${previousTimeMs}`,
      observed: timeMs,
    });
  }
  if (typeof state !== "string" || state.length === 0) {
    invalidTransitionSchedule({
      message: `Layout transition checkpoint ${checkpointIndex} has an invalid state name.`,
      expected: "a non-empty state name",
      observed: state,
    });
  }
  if (!Object.hasOwn(stateDetails.states, state)) {
    invalidTransitionSchedule({
      message: `Layout transition checkpoint ${checkpointIndex} references unknown state ${JSON.stringify(state)}.`,
      expected: `one of ${stateDetails.stateNames.map((name) => JSON.stringify(name)).join(", ")}`,
      observed: state,
    });
  }
  return { timeMs, state };
}

function resolveTransitionStateSequence(
  checkpoints: NormalizedCheckpoints,
  stateNames: readonly [string, string],
): { referenceStateName: string; targetStateName: string } {
  const [firstCheckpoint, secondCheckpoint, holdCheckpoint, returnCheckpoint] = checkpoints;
  const referenceStateName = firstCheckpoint.state;
  const targetStateName = secondCheckpoint.state;
  if (
    referenceStateName === targetStateName ||
    holdCheckpoint.state !== targetStateName ||
    returnCheckpoint.state !== referenceStateName
  ) {
    invalidTransitionSchedule({
      message: "Layout transition state sequence must be [first, second, second, first].",
      expected: "[first, second, second, first] with two distinct states",
      observed: checkpoints.map((checkpoint) => checkpoint.state),
    });
  }
  if (!stateNames.includes(referenceStateName) || !stateNames.includes(targetStateName)) {
    invalidTransitionSchedule({
      message: "Layout transition checkpoints must reference both declared states.",
      expected: "both declared states",
      observed: checkpoints.map((checkpoint) => checkpoint.state),
    });
  }
  return { referenceStateName, targetStateName };
}

function validateTransitionEasing(easing: AnimationEasing | undefined, durationMs: number): void {
  try {
    validateAnimationValue(
      {
        keyframes: [
          { at: 0, transform: { translateX: 0 } },
          { at: 1, transform: { translateX: 0 } },
        ],
        durationMs,
        easing,
      },
      "<layout-transition>",
    );
  } catch (error) {
    if (!(error instanceof FatalError)) {
      throw error;
    }
    invalidTransitionSchedule({
      message: "Layout transition easing is invalid.",
      expected: "a supported AnimationEasing value",
      observed: easing,
      reason: error.message,
    });
  }
}

/** Validate and normalize the public two-state contract for the Rust wire. */
export function resolveLayoutTransitionInput(
  input: LayoutTransitionInput,
): ResolvedLayoutTransitionInput {
  const stateDetails = resolveTransitionStates(input);
  const checkpoints = resolveTransitionCheckpoints(input.checkpoints, stateDetails);
  const { referenceStateName, targetStateName } = resolveTransitionStateSequence(
    checkpoints,
    stateDetails.stateNames,
  );
  const [firstCheckpoint, secondCheckpoint, holdCheckpoint, returnCheckpoint] = checkpoints;
  validateTransitionEasing(input.easing, returnCheckpoint.timeMs);

  const referenceInput = stateDetails.states[referenceStateName] as EngineInput | undefined;
  const targetInput = stateDetails.states[targetStateName] as EngineInput | undefined;
  if (referenceInput === undefined || targetInput === undefined) {
    invalidTransitionSchedule({
      message: "Layout transition states cannot be undefined.",
      expected: "two EngineInput values",
      observed: referenceInput === undefined ? referenceStateName : targetStateName,
    });
  }

  return {
    referenceStateName,
    targetStateName,
    referenceInput,
    targetInput,
    wirePlan: {
      checkpoints: [
        { timeMs: firstCheckpoint.timeMs, stateIndex: 0 },
        { timeMs: secondCheckpoint.timeMs, stateIndex: 1 },
        { timeMs: holdCheckpoint.timeMs, stateIndex: 1 },
        { timeMs: returnCheckpoint.timeMs, stateIndex: 0 },
      ],
      ...(input.easing === undefined ? {} : { easing: input.easing }),
    },
  };
}

/**
 * Meta keys the compiler stamps on generated wrapper Groups in a transition's
 * private compiled state. Consumers inspecting a detached IR snapshot can map
 * a wrapper back to its authored source node by matching these keys instead of
 * copying the strings.
 */
export const LAYOUT_TRANSITION_WRAPPER_META = {
  /** Meta key marking a Group as compiler-generated. */
  generatedKey: "boundsvg.generated",
  /** Value of `generatedKey` on layout-transition wrappers. */
  generatedValue: "layout-transition-wrapper",
  /** Meta key carrying the authored source node id. */
  sourceNodeIdKey: "boundsvg.sourceNodeId",
} as const;
