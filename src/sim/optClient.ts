import type { OptResult, OptTask } from "./opt.worker";

/** A small pool of headless-simulation workers. */
export class OptPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { task: OptTask; resolve: (r: OptResult) => void; reject: (e: Error) => void }[] = [];
  private cancelled = false;

  constructor(size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./opt.worker.ts", import.meta.url), { type: "module" });
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  get size() {
    return this.workers.length;
  }

  run(task: OptTask): Promise<OptResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.pump();
    });
  }

  private pump() {
    while (!this.cancelled && this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      w.onmessage = (e: MessageEvent<OptResult & { error?: string }>) => {
        this.idle.push(w);
        if (e.data.error) job.reject(new Error(e.data.error));
        else job.resolve(e.data);
        this.pump();
      };
      w.onerror = (e) => {
        this.idle.push(w);
        job.reject(new Error(e.message));
        this.pump();
      };
      w.postMessage(job.task);
    }
  }

  dispose() {
    this.cancelled = true;
    for (const j of this.queue) j.reject(new Error("cancelled"));
    this.queue = [];
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
  }
}
