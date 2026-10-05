/** Explicit collector and spool destinations define animation output ownership and commit boundaries. */
import {
  type AnimatedRasterFormat,
  animatedRasterFailure,
  animatedRasterSinkFailure,
} from "./animation-errors.js";

/** Destination receiving one owned chunk at a time; settle write before releasing the chunk. */
export type AnimatedRasterSink = {
  /** Append a chunk; resolve only after its bytes are accepted. */
  write(chunk: Uint8Array): void | Promise<void>;
  /** Commit a completed container after all writes and patches. */
  finish(): void | Promise<void>;
  /** Clean up owned, uncommitted output; the primary error remains unchanged. */
  abort(reason: unknown): void | Promise<void>;
};

/** Animated WebP destination supporting its final four-byte RIFF size patch. */
export type AnimatedWebpSink = AnimatedRasterSink & {
  /** Replace existing bytes at offset four without changing the append position. */
  patch(offset: number, chunk: Uint8Array): void | Promise<void>;
};

/** Cooperative cancellation checked between frame operations and settled callbacks. */
export type AnimatedRasterWriteOptions = { signal?: AbortSignal };

/** Completed container length; returned after the destination has committed. */
export type AnimatedRasterWriteResult = {
  format: AnimatedRasterFormat;
  frameCount: number;
  bytesWritten: number;
};

/** Explicit memory destination; consuming its completed output is allowed once. */
export type AnimatedRasterCollector = AnimatedWebpSink & {
  /** Transfer the completed bytes, retaining the backing buffer's spare capacity. */
  takeBytes(): Uint8Array;
};

/** Caller-provided storage for patchable output and bounded reads after finish. */
export type AnimatedRasterSpool = {
  /** Patchable destination for this spool's owned temporary output. */
  sink: AnimatedWebpSink;
  /** Read up to length bytes (1..65536); return an empty array only at EOF. */
  read(offset: number, length: number): Promise<Uint8Array>;
  /** Delete the owned temporary output; repeated calls are harmless. */
  dispose(): Promise<void>;
};

/** Memory collector limit; file and spool output have no corresponding total cap. */
const COLLECTOR_BYTES_MAX = 256 * 1024 * 1024;
/** Initial allocation avoids reserving the complete collector limit. */
const COLLECTOR_INITIAL_BYTES = 65_536;
/** Bounded spool forwarding read size. */
const SPOOL_READ_BYTES_MAX = 65_536;

/** State keeping output ownership separate from an empty or consumed buffer. */
type CollectorState = "active" | "finished" | "failed" | "aborted" | "consumed";

/** Retain the diagnostic format inferred from the first container header. */
class MemoryAnimationCollector implements AnimatedRasterCollector {
  private buffer = new Uint8Array(0);
  private length = 0;
  private state: CollectorState = "active";
  private format: AnimatedRasterFormat = "webp";
  private isPatched = false;
  private primary: unknown;

  /** Reject operations after completion, failure, cancellation or ownership transfer. */
  private assertActive(operation: "write" | "patch" | "finish"): void {
    if (this.state === "failed") {
      throw this.primary;
    }
    if (this.state !== "active") {
      throw animatedRasterFailure(this.format, operation, {
        family: "SESSION_INVALID_STATE",
        reason:
          this.state === "aborted"
            ? "aborted"
            : this.state === "consumed"
              ? "collectorConsumed"
              : "alreadyFinished",
      });
    }
  }

  /** Append into one growable buffer, with checked length before allocation or copying. */
  write(chunk: Uint8Array): void {
    this.assertActive("write");
    try {
      if (!(chunk instanceof Uint8Array) || chunk.length === 0) {
        throw animatedRasterFailure(this.format, "write", {
          family: "SESSION_INVALID_INPUT",
          reason: "wrongType",
          field: "sink",
        });
      }
      if (
        this.length === 0 &&
        chunk.length >= 3 &&
        chunk[0] === 71 &&
        chunk[1] === 73 &&
        chunk[2] === 70
      ) {
        this.format = "gif";
      }
      const nextLength = this.length + chunk.length;
      if (!Number.isSafeInteger(nextLength) || nextLength > COLLECTOR_BYTES_MAX) {
        throw animatedRasterFailure(this.format, "write", {
          family: "SINK_FAILED",
          reason: "collectorLimit",
          field: "bytesWritten",
        });
      }
      if (nextLength > this.buffer.length) {
        const capacity = Math.min(
          COLLECTOR_BYTES_MAX,
          Math.max(nextLength, this.buffer.length * 2, COLLECTOR_INITIAL_BYTES),
        );
        const replacement = new Uint8Array(capacity);
        replacement.set(this.buffer.subarray(0, this.length));
        this.buffer = replacement;
      }
      this.buffer.set(chunk, this.length);
      this.length = nextLength;
    } catch (error) {
      this.primary = error;
      this.state = "failed";
      throw error;
    }
  }

  /** Apply exactly the WebP size patch to bytes already received. */
  patch(offset: number, chunk: Uint8Array): void {
    this.assertActive("patch");
    try {
      if (
        this.format !== "webp" ||
        this.isPatched ||
        offset !== 4 ||
        !(chunk instanceof Uint8Array) ||
        chunk.length !== 4 ||
        this.length < 8
      ) {
        throw animatedRasterFailure(this.format, "patch", {
          family: "SESSION_INVALID_INPUT",
          reason: "outOfDomain",
          field: "patch",
        });
      }
      this.buffer.set(chunk, offset);
      this.isPatched = true;
    } catch (error) {
      this.primary = error;
      this.state = "failed";
      throw error;
    }
  }

  /** Mark completion without forcing an additional trim allocation. */
  finish(): void {
    this.assertActive("finish");
    this.state = "finished";
  }

  /** Release only collector-owned memory; transferred bytes remain with their caller. */
  abort(_reason: unknown): void {
    if (this.state === "consumed" || this.state === "aborted") {
      return;
    }
    this.buffer = new Uint8Array(0);
    this.length = 0;
    this.state = "aborted";
  }

  /** Transfer the completed buffer view once, then release the collector's reference. */
  takeBytes(): Uint8Array {
    if (this.state !== "finished") {
      throw animatedRasterFailure(this.format, "takeBytes", {
        family: "SESSION_INVALID_STATE",
        reason: this.state === "consumed" ? "collectorConsumed" : "collectorNotFinished",
      });
    }
    const output = this.buffer.subarray(0, this.length);
    this.buffer = new Uint8Array(0);
    this.length = 0;
    this.state = "consumed";
    return output;
  }
}

/** Create an explicit 256 MiB memory sink for previews and small downloads. */
export function createAnimatedRasterCollector(): AnimatedRasterCollector {
  return new MemoryAnimationCollector();
}

/** Authenticate sink method capability without adopting it or invoking its callbacks. */
export function assertAnimatedRasterSink(
  sink: unknown,
  requirements: { format: AnimatedRasterFormat; shouldRequirePatch: boolean },
): asserts sink is AnimatedRasterSink {
  const { format, shouldRequirePatch } = requirements;
  const reason = sink === undefined ? "missingField" : sink === null ? "nullField" : "wrongType";
  if (
    typeof sink !== "object" ||
    sink === null ||
    ["write", "finish", "abort", ...(shouldRequirePatch ? ["patch"] : [])].some(
      (key) => typeof Reflect.get(sink, key) !== "function",
    )
  ) {
    throw animatedRasterFailure(format, "open", {
      family: "SESSION_INVALID_INPUT",
      reason: reason,
      field: "sink",
    });
  }
}

/** Forward a completed, patched spool to a sequential destination in bounded chunks. */
export function createAnimatedWebpSpoolSink(
  spool: AnimatedRasterSpool,
  destination: AnimatedRasterSink,
): AnimatedWebpSink {
  assertAnimatedRasterSink(spool?.sink, { format: "webp", shouldRequirePatch: true });
  assertAnimatedRasterSink(destination, { format: "webp", shouldRequirePatch: false });
  if (typeof spool.read !== "function" || typeof spool.dispose !== "function") {
    throw animatedRasterFailure("webp", "open", {
      family: "SESSION_INVALID_INPUT",
      reason: "wrongType",
      field: "sink",
    });
  }
  let state: "active" | "finishing" | "finished" | "aborted" = "active";
  let offset = 0;
  let cleanup: Promise<void> | undefined;
  let isCleaned = false;
  let aborting: Promise<void> | undefined;
  const assertActive = (operation: "write" | "patch" | "finish"): void => {
    if (state !== "active") {
      throw animatedRasterFailure("webp", operation, {
        family: "SESSION_INVALID_STATE",
        reason: state === "aborted" ? "aborted" : "alreadyFinished",
      });
    }
  };
  const dispose = (): Promise<void> => {
    if (isCleaned) {
      return Promise.resolve();
    }
    cleanup ??= Promise.resolve()
      .then(() => spool.dispose())
      .then(() => {
        isCleaned = true;
      })
      .finally(() => {
        cleanup = undefined;
      });
    return cleanup;
  };
  return {
    write(chunk) {
      assertActive("write");
      return spool.sink.write(chunk);
    },
    patch(position, chunk) {
      assertActive("patch");
      return spool.sink.patch(position, chunk);
    },
    async finish() {
      assertActive("finish");
      state = "finishing";
      try {
        await spool.sink.finish();
        while (true) {
          const chunk = await spool.read(offset, SPOOL_READ_BYTES_MAX);
          if (!(chunk instanceof Uint8Array) || chunk.length > SPOOL_READ_BYTES_MAX) {
            throw animatedRasterFailure("webp", "finish", {
              family: "SINK_FAILED",
              reason: "storage",
              field: "sink",
            });
          }
          if (chunk.length === 0) {
            break;
          }
          if (!Number.isSafeInteger(offset + chunk.length)) {
            throw animatedRasterFailure("webp", "finish", {
              family: "NUMERIC_UNREPRESENTABLE",
              reason: "unsafeOutputPosition",
              field: "bytesWritten",
            });
          }
          await destination.write(chunk);
          offset += chunk.length;
        }
        await destination.finish();
        state = "finished";
        await dispose();
      } catch (error) {
        throw animatedRasterSinkFailure("webp", "finish", error);
      }
    },
    abort(reason) {
      if (state === "finished") {
        return dispose();
      }
      if (aborting) {
        return aborting;
      }
      const isFirstAbort = state !== "aborted";
      state = "aborted";
      aborting = (async () => {
        const results = isFirstAbort
          ? await Promise.allSettled([
              Promise.resolve().then(() => spool.sink.abort(reason)),
              Promise.resolve().then(() => destination.abort(reason)),
            ])
          : [];
        await dispose();
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected?.status === "rejected") {
          throw rejected.reason;
        }
      })().finally(() => {
        aborting = undefined;
      });
      return aborting;
    },
  };
}
