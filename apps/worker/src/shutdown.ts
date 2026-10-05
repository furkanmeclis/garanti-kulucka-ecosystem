export interface DrainableWorker {
  /** BullMQ: stops fetching new jobs; resolves after active jobs finish unless doNotWaitActive is true. */
  pause: (doNotWaitActive?: boolean) => Promise<void>;
  /** BullMQ: force=true closes without waiting for active jobs (they become stalled and are retried). */
  close: (force?: boolean) => Promise<void>;
}

export interface DrainWorkersResult {
  drained: boolean;
  timedOutWorkers: number;
}

/**
 * Graceful BullMQ drain for SIGTERM:
 * 1. pause every worker so no new job is picked up,
 * 2. wait for active jobs up to `timeoutMs`,
 * 3. close workers; workers whose jobs did not finish in time are force-closed so BullMQ's
 *    stalled-job checker hands the job to another worker (processors must stay idempotent).
 */
export async function drainWorkers(
  workers: Iterable<DrainableWorker>,
  timeoutMs: number,
): Promise<DrainWorkersResult> {
  const list = [...workers];
  const finished = new Set<DrainableWorker>();

  // Stop pulling new jobs on every worker immediately, before waiting on any of them.
  const waits = list.map((worker) =>
    worker.pause().then(
      () => {
        finished.add(worker);
      },
      () => {
        finished.add(worker);
      },
    ),
  );

  let timer: NodeJS.Timeout | undefined;
  const timedOut = await Promise.race([
    Promise.all(waits).then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
      timer.unref?.();
    }),
  ]);
  if (timer) clearTimeout(timer);

  const stuck = list.filter((worker) => !finished.has(worker));
  await Promise.all(list.map((worker) => worker.close(stuck.includes(worker))));

  return { drained: !timedOut && stuck.length === 0, timedOutWorkers: stuck.length };
}
