import type { Writable } from "node:stream";
import { type AnimatedRasterSink, FatalError } from "@boundsvg/core";

/** Allow Node's callback-related nextTick/error delivery to complete before success. */
function settleStdoutTask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Forward GIF bytes with callback and drain backpressure; never close shared stdout. */
export function createAnimatedRasterStdoutSink(
  stream: Writable,
  format: "webp" | "gif",
): AnimatedRasterSink {
  let state: "active" | "finished" | "aborted" = "active";
  let failure: unknown;
  let hasFailed = false;
  let pending: Promise<void> | undefined;
  let rejectPending: ((reason: unknown) => void) | undefined;
  const fail = (operation: "write" | "finish"): FatalError => {
    const error = new FatalError(
      "ANIMATED_RASTER_SINK_FAILED",
      `Animated ${format} stdout ${operation} failed`,
      {
        stage: "emit",
        context: { format, operation, reason: operation, field: "sink" },
      },
    );
    Object.defineProperty(error, "cause", { value: failure, configurable: true });
    return error;
  };
  const onError = (error: unknown): void => {
    if (!hasFailed) {
      hasFailed = true;
      failure = error;
    }
    rejectPending?.(fail("write"));
  };
  stream.on("error", onError);
  const check = (operation: "write" | "finish"): void => {
    if (hasFailed) {
      throw fail(operation);
    }
    if (state !== "active") {
      throw new FatalError(
        "ANIMATED_RASTER_SESSION_INVALID_STATE",
        `Animated stdout ${operation} failed: ${state}`,
        {
          stage: "emit",
          context: {
            format,
            operation,
            reason: state === "aborted" ? "aborted" : "alreadyFinished",
          },
        },
      );
    }
  };
  return {
    write(chunk) {
      check("write");
      if (pending) {
        throw new FatalError(
          "ANIMATED_RASTER_SESSION_INVALID_STATE",
          "Animated stdout has a pending write",
          {
            stage: "emit",
            context: { format, operation: "write", reason: "pendingOutput" },
          },
        );
      }
      let onDrain: () => void = () => undefined;
      const operation = new Promise<void>((resolve, reject) => {
        rejectPending = reject;
        let isCallbackDone = false;
        let isDrainDone = false;
        let hasReturned = false;
        let shouldWaitForDrain = false;
        const complete = (): void => {
          if (hasReturned && isCallbackDone && (!shouldWaitForDrain || isDrainDone)) {
            resolve();
          }
        };
        onDrain = () => {
          isDrainDone = true;
          complete();
        };
        stream.on("drain", onDrain);
        try {
          shouldWaitForDrain = !stream.write(chunk, (error?: Error | null) => {
            if (error) {
              onError(error);
              return;
            }
            isCallbackDone = true;
            complete();
          });
          hasReturned = true;
          complete();
        } catch (error) {
          onError(error);
        }
      })
        .then(async () => {
          await settleStdoutTask();
          check("write");
        })
        .finally(() => {
          stream.removeListener("drain", onDrain);
          rejectPending = undefined;
          if (pending === operation) {
            pending = undefined;
          }
        });
      pending = operation;
      return operation;
    },
    async finish() {
      check("finish");
      await pending;
      await settleStdoutTask();
      check("finish");
      state = "finished";
      stream.removeListener("error", onError);
    },
    async abort(_reason) {
      if (state === "finished" || state === "aborted") {
        return;
      }
      state = "aborted";
      try {
        await pending;
      } catch {
        // The render owner preserves its write failure.
      }
      await settleStdoutTask();
      stream.removeListener("error", onError);
    },
  };
}
