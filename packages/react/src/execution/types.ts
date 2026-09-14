import type { RenderInputOptions } from "../types.js";

/** Controls scheduling and retention without entering Core render options. */
export type RenderExecutionOptions = RenderInputOptions & {
  retainPreviousResult?: boolean;
  onError?: (error: Error) => void;
};

/** Status describes the latest input; retained results alone are never ready. */
export type RenderExecutionState =
  | {
      status: "idle";
      execution: null;
      error: null;
      isRendering: false;
      isReady: false;
      isStale: false;
    }
  | {
      status: "rendering";
      execution: "main" | "worker";
      error: null;
      isRendering: true;
      isReady: false;
      isStale: boolean;
    }
  | {
      status: "success";
      execution: "main" | "worker";
      error: null;
      isRendering: false;
      isReady: true;
      isStale: false;
    }
  | {
      status: "error";
      execution: "main" | "worker" | null;
      error: Error;
      isRendering: false;
      isReady: false;
      isStale: boolean;
    };

type EmptyFields<Fields> = { [Key in keyof Fields]: null };

export type RenderExecutionResult<Fields> =
  | (Extract<RenderExecutionState, { status: "idle" }> & EmptyFields<Fields>)
  | (Extract<RenderExecutionState, { status: "success" }> & Fields)
  | (Extract<RenderExecutionState, { status: "rendering" | "error" }> &
      (({ isStale: true } & Fields) | ({ isStale: false } & EmptyFields<Fields>)));

/** Map one complete generation, preserving the state and all-or-none result invariant. */
export function mapRenderExecutionResult<Value, Fields>(
  result: RenderExecutionResult<{ data: Value }>,
  project: (value: Value) => Fields,
  emptyFields: EmptyFields<Fields>,
): RenderExecutionResult<Fields> {
  const { data, ...state } = result;
  const fields = data === null ? emptyFields : project(data);
  // TypeScript cannot retain the relation between generic mapped fields and the discriminator.
  return { ...state, ...fields } as RenderExecutionResult<Fields>;
}
