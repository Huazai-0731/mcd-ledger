/**
 * 重试与限流。
 *
 * 官方约束：每个 Token 每分钟最多 600 次请求，超限返回 429。
 * 审计一次通常只有 5–10 次调用，但"失败后盲目重试"会把 429 放大成雪崩，
 * 所以这里的策略是：指数退避 + 抖动 + 尊重 Retry-After + 熔断式上限。
 */

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (info: { attempt: number; delayMs: number; error: Error }) => void;
}

export class HttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  constructor(status: number, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
  get retryable(): boolean {
    return this.status === 429 || this.status === 408 || this.status >= 500;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 带指数退避与抖动的执行器；仅对"可重试错误"重试 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 400;
  const max = opts.maxDelayMs ?? 8000;

  let lastError: Error = new Error("未知错误");
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const retryable = err instanceof HttpError ? err.retryable : isTransient(lastError);
      if (!retryable || attempt === attempts) break;

      const hinted = err instanceof HttpError ? err.retryAfterMs : null;
      const backoff = Math.min(max, base * 2 ** (attempt - 1));
      const jitter = Math.random() * 0.25 * backoff;
      const delay = hinted ?? backoff + jitter;

      opts.onRetry?.({ attempt, delayMs: delay, error: lastError });
      await sleep(delay);
    }
  }
  throw lastError;
}

function isTransient(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("terminated")
  );
}

/**
 * 简单的滑动窗口限流器：保证任意 60s 内不超过 limit 次调用。
 * 不是为了跑满配额，而是为了在批量拉取（如多门店菜单）时不触发 429。
 */
export class RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private stamps: number[] = [];

  constructor(limit = 500, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
      if (this.stamps.length < this.limit) {
        this.stamps.push(now);
        return;
      }
      const oldest = this.stamps[0] ?? now;
      await sleep(Math.max(50, this.windowMs - (now - oldest) + 10));
    }
  }
}
