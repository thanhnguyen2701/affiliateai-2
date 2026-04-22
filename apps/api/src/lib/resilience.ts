// apps/api/src/lib/resilience.ts

// ─── Retry với exponential backoff + jitter ────────────────────────────────────
export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: Error) => boolean;
  onRetry?: (error: Error, attempt: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1_000,
    maxDelayMs  = 30_000,
    shouldRetry = (err) => !err.message.match(/ 40[0134]/), // không retry 400/401/403/404
    onRetry,
  } = opts;

  let last!: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e as Error;
      if (attempt === maxAttempts || !shouldRetry(last)) throw last;
      onRetry?.(last, attempt);
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1) + Math.random() * 500, maxDelayMs);
      await sleep(delay);
    }
  }
  throw last;
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────
type CBState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private failures  = 0;
  private lastFail  = 0;
  private successes = 0;
  private state: CBState = 'closed';

  constructor(
    readonly name: string,
    private threshold    = 5,
    private resetMs      = 60_000,
    private halfOpenOk   = 2,
  ) {}

  async call<T>(fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFail >= this.resetMs) {
        this.state    = 'half-open';
        this.successes = 0;
      } else {
        if (fallback) return fallback();
        throw new Error(`[CB:${this.name}] Circuit OPEN — service unavailable`);
      }
    }

    try {
      const result = await fn();
      if (this.state === 'half-open') {
        if (++this.successes >= this.halfOpenOk) {
          this.state    = 'closed';
          this.failures  = 0;
        }
      } else {
        this.failures = Math.max(0, this.failures - 1);
      }
      return result;
    } catch (err) {
      this.failures++;
      this.lastFail = Date.now();
      if (this.failures >= this.threshold || this.state === 'half-open') {
        this.state = 'open';
        console.error(`[CB:${this.name}] Opened after ${this.failures} failures`);
      }
      throw err;
    }
  }

  status() { return { name: this.name, state: this.state, failures: this.failures }; }
  reset()  { this.state = 'closed'; this.failures = 0; this.successes = 0; }
}

// ─── Timeout ──────────────────────────────────────────────────────────────────
export async function withTimeout<T>(
  fn: () => Promise<T>,
  ms: number,
  msg = `Timed out after ${ms}ms`
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}

// ─── Circuit breaker instances ────────────────────────────────────────────────
export const breakers = {
  cakeai:      new CircuitBreaker('cakeai',      5, 60_000),
  openai:      new CircuitBreaker('openai',      3, 30_000),
  anthropic:   new CircuitBreaker('anthropic',   3, 30_000),
  removebg:    new CircuitBreaker('removebg',    5, 120_000),
  shopee:      new CircuitBreaker('shopee',      5, 60_000),
  accesstrade: new CircuitBreaker('accesstrade', 5, 60_000),
  tiktok:      new CircuitBreaker('tiktok',      5, 60_000),
  fptai:       new CircuitBreaker('fptai',       3, 60_000),
};

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
