/** Caller-owned browser file handles provide patchable animation storage without a picker. */
import { type AnimatedRasterSpool, type AnimatedWebpSink, FatalError } from "@boundsvg/core";

/** Maximum bounded read shared with animation chunk transport. */
const SPOOL_READ_BYTES_MAX = 65_536;

/** Storage failures carry no file names, source text or browser exception message over the wire. */
function storageFailure(
  format: "webp" | "gif",
  operation: "open" | "write" | "patch" | "finish" | "abort",
  cause: unknown,
): FatalError {
  const isPermissionFailure =
    typeof cause === "object" && cause !== null && Reflect.get(cause, "name") === "NotAllowedError";
  const isUnsupported = cause === "unsupported";
  const fatal = new FatalError(
    isPermissionFailure || isUnsupported
      ? "ANIMATED_RASTER_SINK_UNAVAILABLE"
      : "ANIMATED_RASTER_SINK_FAILED",
    `Animated browser storage ${operation} failed`,
    {
      stage: "emit",
      context: {
        format,
        operation,
        reason: isPermissionFailure ? "permission" : isUnsupported ? "unsupported" : "storage",
        field: "sink",
      },
    },
  );
  Object.defineProperty(fatal, "cause", { value: cause, configurable: true });
  return fatal;
}

/** Keep caller file ownership separate from a browser stream's uncommitted writes. */
class BrowserAnimationFile implements AnimatedWebpSink {
  private position = 0;
  private format: "webp" | "gif" = "webp";
  private state: "active" | "finished" | "failed" | "aborted" = "active";
  private pending: Promise<void> | undefined;
  private cleanup: Promise<void> | undefined;
  private primary: unknown;
  private isAborting = false;
  private isPatched = false;

  /** Adopt only the newly opened writable stream; never remove its caller's file. */
  constructor(private readonly stream: FileSystemWritableFileStream) {}

  private run(
    operation: "write" | "patch" | "finish",
    callback: () => Promise<void>,
  ): Promise<void> {
    if (this.state === "failed") {
      return Promise.reject(this.primary);
    }
    if (this.state !== "active" || this.isAborting || this.pending) {
      return Promise.reject(
        new FatalError(
          "ANIMATED_RASTER_SESSION_INVALID_STATE",
          "Browser animation sink is not active",
          {
            stage: "emit",
            context: {
              format: this.format,
              operation,
              reason:
                this.isAborting || this.state === "aborted"
                  ? "aborted"
                  : this.pending
                    ? "pendingOutput"
                    : "alreadyFinished",
            },
          },
        ),
      );
    }
    const pending = Promise.resolve()
      .then(callback)
      .catch((error: unknown) => {
        this.state = "failed";
        this.primary = storageFailure(this.format, operation, error);
        throw this.primary;
      })
      .finally(() => {
        if (this.pending === pending) {
          this.pending = undefined;
        }
      });
    this.pending = pending;
    return pending;
  }

  /** Append at an exact checked position, awaiting browser backpressure. */
  write(chunk: Uint8Array): Promise<void> {
    return this.run("write", async () => {
      if (
        !(chunk instanceof Uint8Array) ||
        chunk.length === 0 ||
        !Number.isSafeInteger(this.position + chunk.length)
      ) {
        throw storageFailure(this.format, "write", "invalid chunk or output position");
      }
      if (
        this.position === 0 &&
        chunk.length >= 3 &&
        chunk[0] === 71 &&
        chunk[1] === 73 &&
        chunk[2] === 70
      ) {
        this.format = "gif";
      }
      await this.stream.write({ type: "write", position: this.position, data: chunk.slice() });
      this.position += chunk.length;
    });
  }

  /** Patch only the WebP RIFF size, preserving the next append position. */
  patch(offset: number, chunk: Uint8Array): Promise<void> {
    return this.run("patch", async () => {
      if (
        this.format !== "webp" ||
        this.isPatched ||
        offset !== 4 ||
        !(chunk instanceof Uint8Array) ||
        chunk.length !== 4 ||
        this.position < 8
      ) {
        throw storageFailure(this.format, "patch", "invalid RIFF patch");
      }
      this.isPatched = true;
      await this.stream.write({ type: "write", position: offset, data: chunk.slice() });
    });
  }

  /** Commit only through close; a later abort preserves successful output. */
  finish(): Promise<void> {
    return this.run("finish", async () => {
      await this.stream.close();
      this.state = "finished";
    });
  }

  /** Wait for a pending callback before cancelling uncommitted stream writes. */
  abort(reason: unknown): Promise<void> {
    if (this.state === "finished" || this.state === "aborted") {
      return Promise.resolve();
    }
    if (this.cleanup) {
      return this.cleanup;
    }
    this.isAborting = true;
    const cleanup = (async () => {
      try {
        await this.pending;
      } catch {
        // Preserve the producer's primary failure.
      }
      if (this.state === "finished") {
        return;
      }
      await this.stream.abort(reason);
      this.state = "aborted";
    })()
      .catch((error: unknown) => {
        throw storageFailure(this.format, "abort", error);
      })
      .finally(() => {
        if (this.cleanup === cleanup) {
          this.cleanup = undefined;
        }
      });
    this.cleanup = cleanup;
    return cleanup;
  }
}

/**
 * Open patchable output with a caller-provided handle; changes become visible at finish.
 * @throws FatalError when createWritable is unavailable or opening fails because of permissions or storage.
 */
export async function createAnimatedRasterFileSink(
  fileHandle: FileSystemFileHandle,
): Promise<AnimatedWebpSink> {
  if (
    typeof fileHandle !== "object" ||
    fileHandle === null ||
    typeof fileHandle.createWritable !== "function"
  ) {
    throw storageFailure("webp", "open", "unsupported");
  }
  try {
    return new BrowserAnimationFile(await fileHandle.createWritable({ keepExistingData: false }));
  } catch (error) {
    throw storageFailure("webp", "open", error);
  }
}

/**
 * Create one dedicated temporary file in a caller-provided directory, including OPFS.
 * @throws FatalError for unavailable capabilities, permissions, quota or storage failure.
 */
export async function createAnimatedRasterSpool(
  directory: FileSystemDirectoryHandle,
): Promise<AnimatedRasterSpool> {
  if (
    typeof directory !== "object" ||
    directory === null ||
    typeof directory.getFileHandle !== "function" ||
    typeof directory.removeEntry !== "function" ||
    typeof globalThis.crypto?.randomUUID !== "function"
  ) {
    throw storageFailure("webp", "open", "unsupported");
  }
  const name = `animated-${globalThis.crypto.randomUUID()}.tmp`;
  // Reject a collision rather than claiming cleanup ownership of an existing entry.
  try {
    await directory.getFileHandle(name);
    throw storageFailure("webp", "open", "temporary entry already exists");
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      Reflect.get(error, "name") !== "NotFoundError"
    ) {
      throw storageFailure("webp", "open", error);
    }
  }
  let file: FileSystemFileHandle;
  let destination: AnimatedWebpSink;
  let isCreated = false;
  try {
    file = await directory.getFileHandle(name, { create: true });
    isCreated = true;
    destination = await createAnimatedRasterFileSink(file);
  } catch (error) {
    // File creation may have succeeded even when opening its writable failed.
    if (isCreated) {
      try {
        await directory.removeEntry(name);
      } catch {
        // Preserve open failure.
      }
    }
    throw storageFailure("webp", "open", error);
  }
  let isFinished = false;
  let isRemoved = false;
  let cleanup: Promise<void> | undefined;
  const spoolSink: AnimatedWebpSink = {
    write: (chunk) => destination.write(chunk),
    patch: (offset, chunk) => destination.patch(offset, chunk),
    async finish() {
      await destination.finish();
      isFinished = true;
    },
    abort: (reason) => destination.abort(reason),
  };
  return {
    sink: spoolSink,
    async read(offset, length) {
      if (
        !isFinished ||
        isRemoved ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isInteger(length) ||
        length < 1 ||
        length > SPOOL_READ_BYTES_MAX ||
        !Number.isSafeInteger(offset + length)
      ) {
        throw storageFailure("webp", "finish", "invalid spool read");
      }
      try {
        const snapshot = await file.getFile();
        return new Uint8Array(await snapshot.slice(offset, offset + length).arrayBuffer());
      } catch (error) {
        throw storageFailure("webp", "finish", error);
      }
    },
    dispose() {
      if (isRemoved) {
        return Promise.resolve();
      }
      if (cleanup) {
        return cleanup;
      }
      const pending = (async () => {
        await destination.abort("spool disposed");
        await directory.removeEntry(name);
        isRemoved = true;
      })()
        .catch((error: unknown) => {
          throw storageFailure("webp", "abort", error);
        })
        .finally(() => {
          if (cleanup === pending) {
            cleanup = undefined;
          }
        });
      cleanup = pending;
      return pending;
    },
  };
}
