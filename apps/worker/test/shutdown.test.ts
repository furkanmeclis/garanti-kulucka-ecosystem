import { describe, expect, it } from "vitest";
import { drainWorkers, type DrainableWorker } from "../src/shutdown.js";

class FakeWorker implements DrainableWorker {
  readonly calls: string[] = [];
  private finishActive!: () => void;
  private readonly active: Promise<void>;

  constructor(activeJobMs: number | null) {
    this.active = new Promise((resolve) => {
      this.finishActive = resolve;
    });
    if (activeJobMs !== null) {
      setTimeout(() => this.finishActive(), activeJobMs);
    }
  }

  async pause(): Promise<void> {
    this.calls.push("pause");
    await this.active;
  }

  async close(force?: boolean): Promise<void> {
    this.calls.push(force ? "close:force" : "close");
  }
}

describe("worker graceful drain", () => {
  it("pauses every worker and waits for active jobs before closing", async () => {
    const workers = [new FakeWorker(20), new FakeWorker(60)];
    const result = await drainWorkers(workers, 1_000);

    expect(result).toEqual({ drained: true, timedOutWorkers: 0 });
    for (const worker of workers) {
      expect(worker.calls).toEqual(["pause", "close"]);
    }
  });

  it("force-closes only workers whose active jobs exceed the timeout", async () => {
    const fast = new FakeWorker(10);
    const stuck = new FakeWorker(null);
    const startedAt = Date.now();
    const result = await drainWorkers([fast, stuck], 100);

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(result).toEqual({ drained: false, timedOutWorkers: 1 });
    expect(fast.calls).toEqual(["pause", "close"]);
    expect(stuck.calls).toEqual(["pause", "close:force"]);
  });

  it("treats an empty worker set as drained", async () => {
    await expect(drainWorkers([], 10)).resolves.toEqual({ drained: true, timedOutWorkers: 0 });
  });
});
