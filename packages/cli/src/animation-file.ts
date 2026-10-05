/** Patchable Node animation storage commits by replacing a pathname after all writes settle. */
import { randomUUID } from "node:crypto";
import { type FileHandle, lstat, open, rename, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { type AnimatedRasterSpool, type AnimatedWebpSink, FatalError } from "@boundsvg/core";

/** Exact integer output positions supported by the JavaScript file API. */
const FILE_POSITION_MAX = Number.MAX_SAFE_INTEGER;
/** Largest owned read buffer returned by a spool. */
const SPOOL_READ_BYTES_MAX = 65536;

/** Describe IO failure without exposing the destination or temporary path in context. */
function storageFailure(
  operation: "open" | "write" | "patch" | "finish" | "abort",
  cause: unknown,
  format: "webp" | "gif" = "webp",
): FatalError {
  const error = new FatalError(
    "ANIMATED_RASTER_SINK_FAILED",
    `Animated output storage ${operation} failed`,
    {
      stage: "emit",
      context: { format, operation, reason: "storage", field: "sink" },
    },
  );
  Object.defineProperty(error, "cause", { value: cause, configurable: true });
  return error;
}

/** Reject unsupported storage state without inferring whether an external commit occurred. */
function storageStateFailure(
  operation: "write" | "patch" | "finish",
  reason: "aborted" | "alreadyFinished" | "pendingOutput",
  format: "webp" | "gif" = "webp",
): FatalError {
  return new FatalError(
    "ANIMATED_RASTER_SESSION_INVALID_STATE",
    `Animated output ${operation} failed: ${reason}`,
    {
      stage: "emit",
      context: { format, operation, reason },
    },
  );
}

/** Identify a missing owned file without interpreting error messages. */
function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT";
}

/** Append and patch one exclusive temporary file; only its own cleanup may remove it. */
class AnimationTemporaryFile implements AnimatedWebpSink {
  private position = 0;
  private format: "webp" | "gif" = "webp";
  private isPatched = false;
  private primary: unknown;
  private state: "active" | "finishing" | "finished" | "failed" | "aborted" = "active";
  private pending: Promise<void> | undefined;
  private isAbortRequested = false;
  private cleanup: Promise<void> | undefined;
  private isRemoved = false;
  private readHandle: FileHandle | undefined;
  private readonly destination: string | undefined;
  private readonly existingMode: number | undefined;

  /** Adopt a newly created file and the optional pathname replacement contract. */
  constructor(
    private handle: FileHandle | undefined,
    private readonly temporaryPath: string,
    replacement?: { destination: string; existingMode?: number },
  ) {
    this.destination = replacement?.destination;
    this.existingMode = replacement?.existingMode;
  }

  /** Reject concurrent producer calls; sink backpressure permits only one active operation. */
  private run(
    operation: "write" | "patch" | "finish",
    callback: () => Promise<void>,
  ): Promise<void> {
    if (this.state === "failed") {
      return Promise.reject(this.primary);
    }
    if (this.pending) {
      return Promise.reject(storageStateFailure(operation, "pendingOutput", this.format));
    }
    if (this.isAbortRequested || this.state !== "active") {
      return Promise.reject(
        storageStateFailure(
          operation,
          this.isAbortRequested ? "aborted" : "alreadyFinished",
          this.format,
        ),
      );
    }
    const pending = Promise.resolve()
      .then(callback)
      .catch((error: unknown) => {
        this.state = "failed";
        this.primary = storageFailure(operation, error, this.format);
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

  /** Loop over actual short writes while preserving the independent append position. */
  private async writeAt(offset: number, chunk: Uint8Array): Promise<void> {
    const handle = this.handle;
    if (
      !handle ||
      !(chunk instanceof Uint8Array) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      chunk.length === 0 ||
      !Number.isSafeInteger(offset + chunk.length) ||
      offset + chunk.length > FILE_POSITION_MAX
    ) {
      throw storageFailure("write", "invalid file position or chunk");
    }
    let written = 0;
    while (written < chunk.length) {
      const result = await handle.write(chunk, written, chunk.length - written, offset + written);
      if (
        !Number.isInteger(result.bytesWritten) ||
        result.bytesWritten <= 0 ||
        result.bytesWritten > chunk.length - written
      ) {
        throw storageFailure("write", "invalid short write result");
      }
      written += result.bytesWritten;
    }
  }

  /** Append one chunk and advance only after every byte is written. */
  write(chunk: Uint8Array): Promise<void> {
    return this.run("write", async () => {
      if (
        this.position === 0 &&
        chunk instanceof Uint8Array &&
        chunk.length >= 3 &&
        chunk[0] === 71 &&
        chunk[1] === 73 &&
        chunk[2] === 70
      ) {
        this.format = "gif";
      }
      await this.writeAt(this.position, chunk);
      this.position += chunk.length;
    });
  }

  /** Apply the RIFF size patch to an existing four-byte range. */
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
        throw storageFailure("patch", "invalid RIFF patch");
      }
      this.isPatched = true;
      await this.writeAt(offset, chunk);
    });
  }

  /** Apply snapshotted permissions after all writes, close, then atomically replace the pathname. */
  finish(): Promise<void> {
    return this.run("finish", async () => {
      this.state = "finishing";
      const handle = this.handle;
      if (!handle) {
        throw storageFailure("finish", "file is unavailable");
      }
      if (this.existingMode !== undefined) {
        await handle.chmod(this.existingMode);
      }
      await handle.close();
      this.handle = undefined;
      if (this.destination !== undefined) {
        await rename(this.temporaryPath, this.destination);
        this.isRemoved = true;
      }
      this.state = "finished";
    });
  }

  /** Wait for in-flight IO and remove only the uncommitted owned temporary file. */
  abort(_reason: unknown): Promise<void> {
    if (this.state === "finished" && this.destination !== undefined) {
      return Promise.resolve();
    }
    this.isAbortRequested = true;
    return this.dispose();
  }

  /** Read one bounded part of a completed spool; file destinations never use this operation. */
  async read(offset: number, length: number): Promise<Uint8Array> {
    if (
      this.destination !== undefined ||
      this.state !== "finished" ||
      this.isAbortRequested ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(length) ||
      length < 1 ||
      length > SPOOL_READ_BYTES_MAX ||
      !Number.isSafeInteger(offset + length)
    ) {
      throw storageFailure("finish", "invalid spool read");
    }
    try {
      this.readHandle ??= await open(this.temporaryPath, "r");
      const bytes = new Uint8Array(length);
      const result = await this.readHandle.read(bytes, 0, length, offset);
      return bytes.subarray(0, result.bytesRead);
    } catch (error) {
      throw storageFailure("finish", error);
    }
  }

  /** Retry failed owned cleanup without deleting a successfully renamed destination. */
  dispose(): Promise<void> {
    if (this.cleanup) {
      return this.cleanup;
    }
    const cleanup = (async () => {
      try {
        await this.pending;
      } catch {
        // A failed write remains the caller's primary error.
      }
      if (this.state === "finished" && this.destination !== undefined) {
        return;
      }
      if (this.handle) {
        await this.handle.close();
        this.handle = undefined;
      }
      if (this.readHandle) {
        await this.readHandle.close();
        this.readHandle = undefined;
      }
      if (!this.isRemoved) {
        try {
          await unlink(this.temporaryPath);
        } catch (error) {
          if (!isMissingFile(error)) {
            throw error;
          }
        }
        this.isRemoved = true;
      }
      this.state = "aborted";
    })()
      .catch((error: unknown) => {
        throw storageFailure("abort", error, this.format);
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

/** Create a same-directory temporary sink that atomically replaces the specified pathname. */
export async function createAnimatedRasterFileSink(outputPath: string): Promise<AnimatedWebpSink> {
  if (typeof outputPath !== "string" || outputPath.length === 0) {
    throw storageFailure("open", "output path must be a nonempty string");
  }
  const destination = resolve(outputPath);
  const temporaryPath = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`);
  try {
    let existingMode: number | undefined;
    try {
      const previous = await lstat(destination);
      if (previous.isFile()) {
        existingMode = previous.mode & 0o7777;
      }
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
    const handle = await open(temporaryPath, "wx+");
    return new AnimationTemporaryFile(handle, temporaryPath, { destination, existingMode });
  } catch (error) {
    throw storageFailure("open", error);
  }
}

/** Create an owned temporary spool in the supplied directory, with no complete-file RAM copy. */
export async function createAnimatedRasterSpool(
  directoryPath?: string,
): Promise<AnimatedRasterSpool> {
  if (
    directoryPath !== undefined &&
    (typeof directoryPath !== "string" || directoryPath.length === 0)
  ) {
    throw storageFailure("open", "spool directory must be a nonempty string");
  }
  const temporaryPath = join(
    directoryPath === undefined ? tmpdir() : resolve(directoryPath),
    `.animated-${randomUUID()}.tmp`,
  );
  try {
    const storage = new AnimationTemporaryFile(await open(temporaryPath, "wx+"), temporaryPath);
    return {
      sink: storage,
      read: (offset, length) => storage.read(offset, length),
      dispose: () => storage.dispose(),
    };
  } catch (error) {
    throw storageFailure("open", error);
  }
}
