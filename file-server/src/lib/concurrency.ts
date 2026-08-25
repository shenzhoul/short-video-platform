/**
 * A counting gate for expensive, unbounded work.
 *
 * ## The failure this exists to stop
 *
 * Validating an image at the 60-megapixel budget costs roughly four seconds of
 * CPU across libvips' threads; probing and seek-decoding a video costs a child
 * process and whatever FFmpeg decides to spend. Neither is a problem once. Both
 * are a problem when twenty uploads finish at the same moment, because nothing
 * in the request path bounds how many run at once: TUS completions arrive
 * whenever transfers finish, and each one calls straight into the validator.
 *
 * The result is not a graceful slowdown. libvips and FFmpeg each allocate their
 * own thread pool, so N concurrent validations ask for N times the cores and
 * N times the memory, and on a single-machine deployment the API, MongoDB and
 * Redis are sharing that box. The first thing to fall over is usually not the
 * upload.
 *
 * ## Why a semaphore and not a queue
 *
 * The work is already inside a request that someone is waiting on, and the
 * answer is needed to decide whether to keep the bytes. Moving it to BullMQ
 * would mean accepting the file first and refusing it later, which is exactly
 * the "record pointing at nothing" the validators exist to prevent.
 *
 * So the work stays inline and is *gated*: over the limit, a caller waits its
 * turn rather than starting. Waiting is bounded — see `acquire`'s `timeoutMs` —
 * so a wedged holder cannot make every later upload hang forever; a caller that
 * times out waiting is told the server is busy, which is a true and actionable
 * answer.
 *
 * ## Why this is fine across a cluster
 *
 * It is not a distributed lock and does not pretend to be. Each process bounds
 * its own FFmpeg and libvips fan-out, which is the resource that is actually
 * per-process. Two instances doing four each is four per box, which is the
 * number that matters.
 */
export class ConcurrencyLimiter {
  private active = 0;

  private readonly waiting: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout | null;
  }> = [];

  constructor(
    /** How many may run at once. Clamped to at least 1. */
    private readonly limit: number,
    /** For logs and for the error a timed-out caller sees. */
    public readonly name: string
  ) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  /** How many are running, for a health check or a log line. */
  public get running(): number {
    return this.active;
  }

  /** How many are queued behind the limit. */
  public get queued(): number {
    return this.waiting.length;
  }

  /**
   * Run `work` with a slot held, releasing it however `work` ends.
   *
   * The release is in a `finally` and not at the end of the happy path: a
   * validator that throws is the *common* case here — that is what a rejected
   * upload is — and a limiter that leaked a slot on every rejection would seize
   * up after `limit` bad files.
   */
  public async run<T>(work: () => Promise<T>, timeoutMs?: number): Promise<T> {
    await this.acquire(timeoutMs);
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  /**
   * Wait for a slot.
   *
   * `timeoutMs` bounds the wait, not the work. Without it a single wedged holder
   * would park every later upload indefinitely; with it, backpressure surfaces
   * as a refusal the caller can report rather than as a request that never
   * answers.
   */
  private acquire(timeoutMs?: number): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const entry: {
        resolve: () => void;
        reject: (error: Error) => void;
        timer: NodeJS.Timeout | null;
      } = { resolve, reject, timer: null };

      if (timeoutMs && timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new Error(`${this.name} is busy`));
        }, timeoutMs);
        // A pending timer must not be a reason for the process to stay alive.
        entry.timer.unref?.();
      }

      this.waiting.push(entry);
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (!next) {
      this.active = Math.max(0, this.active - 1);
      return;
    }
    // The slot is handed straight over rather than decremented and re-taken, so
    // a burst of waiters cannot let a newcomer jump the queue between the two.
    if (next.timer) clearTimeout(next.timer);
    next.resolve();
  }
}
