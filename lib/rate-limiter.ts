export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Serial queue that guarantees a minimum spacing between task starts.
 *
 * Every MusicBrainz request, including retries, is scheduled through one
 * shared instance, so backoff can never push the app over the published rate
 * limit. Single-process only. A multi-instance deployment needs a shared
 * token bucket (Redis) instead.
 */
export class RateLimiter {
  private minIntervalMs: number;
  private lastStart = 0;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(minIntervalMs: number) {
    this.minIntervalMs = minIntervalMs;
  }

  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const wait = this.minIntervalMs - (Date.now() - this.lastStart);
      if (wait > 0) await sleep(wait);
      this.lastStart = Date.now();
      return task();
    });
    // Keep the chain alive regardless of individual task failures.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
