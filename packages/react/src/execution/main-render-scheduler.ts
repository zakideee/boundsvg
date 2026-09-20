import { FatalError } from "@boundsvg/core";

const QUEUE_LIMIT = 32;

type RenderJob = {
  run: () => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  onAbort: () => void;
};

/** Provider-owned FIFO. Each synchronous computation starts in a separate task. */
export class MainRenderScheduler {
  private readonly queue: RenderJob[] = [];
  private current: RenderJob | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isDisposed = false;

  enqueue<T>(compute: () => T, signal: AbortSignal): Promise<T> {
    if (this.isDisposed || signal.aborted) {
      return Promise.reject(this.disposedError());
    }
    if (this.current && this.queue.length >= QUEUE_LIMIT) {
      return Promise.reject(
        new FatalError("RENDER_QUEUE_FULL", "Render request queue is full", {
          stage: "engine",
          context: { queueLimit: QUEUE_LIMIT },
        }),
      );
    }
    return new Promise<T>((resolve, reject) => {
      const job: RenderJob = {
        signal,
        reject,
        run: () => {
          try {
            resolve(compute());
          } catch (error: unknown) {
            reject(error);
          }
        },
        onAbort: () => {
          const position = this.queue.indexOf(job);
          if (position >= 0) {
            this.queue.splice(position, 1);
          } else if (this.current === job && this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
            this.current = null;
          }
          signal.removeEventListener("abort", job.onAbort);
          reject(this.disposedError());
          this.pump();
        },
      };
      signal.addEventListener("abort", job.onAbort, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const jobs = this.current ? [this.current, ...this.queue] : [...this.queue];
    this.current = null;
    this.queue.length = 0;
    for (const job of jobs) {
      job.signal.removeEventListener("abort", job.onAbort);
      job.reject(this.disposedError());
    }
  }

  private pump(): void {
    if (this.current || this.isDisposed) {
      return;
    }
    const job = this.queue.shift();
    if (!job) {
      return;
    }
    this.current = job;
    this.timer = setTimeout(() => {
      this.timer = null;
      job.run();
      job.signal.removeEventListener("abort", job.onAbort);
      this.current = null;
      this.pump();
    }, 0);
  }

  private disposedError(): FatalError {
    return new FatalError("ENGINE_DISPOSED", "Engine has been disposed", {
      stage: "engine",
    });
  }
}
