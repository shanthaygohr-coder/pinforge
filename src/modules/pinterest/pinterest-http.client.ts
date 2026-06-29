// ============================================================================
// PinterestHttpClient — middleware HTTP cu gestionarea STRICTA a rate-limit.
// ----------------------------------------------------------------------------
// La eroare 429 Too Many Requests:
//   - citeste header-ul `x-ratelimit-reset` (secunde pana la reset)
//   - aplica EXPONENTIAL BACKOFF cu jitter, plafonat la 32 de secunde
//   - persista starea (resetAt, remaining) pentru ca scheduler-ul sa nu mai
//     trimita cereri inainte de reset
// Respecta de asemenea `x-ratelimit-remaining` pentru a frana proactiv.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';

const API_BASE = 'https://api.pinterest.com/v5';
const MAX_BACKOFF_MS = 32_000; // plafonul cerut: 32 secunde
const BASE_BACKOFF_MS = 1_000;

export interface RateLimitSnapshot {
  remaining: number;
  resetAt: Date;
}

export interface PinterestRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string; // ex: "/pins"
  accessToken: string;
  body?: unknown;
  // callback optional pentru a persista starea rate-limit (RateLimitState).
  onRateLimit?: (endpoint: string, snap: RateLimitSnapshot) => Promise<void>;
}

@Injectable()
export class PinterestHttpClient {
  private readonly logger = new Logger(PinterestHttpClient.name);

  async request<T>(req: PinterestRequest): Promise<T> {
    const endpoint = `${req.method} ${req.path}`;
    let attempt = 0;

    // pana la 6 incercari; backoff-ul nu depaseste 32s.
    while (true) {
      const res = await fetch(`${API_BASE}${req.path}`, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${req.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: req.body ? JSON.stringify(req.body) : undefined,
      });

      // Capteaza mereu starea de rate-limit pentru scheduler.
      await this.captureRateLimit(endpoint, res, req.onRateLimit);

      if (res.status === 429) {
        attempt++;
        const resetSec = this.parseResetSeconds(res);
        // Respecta reset-ul serverului daca exista, altfel exponential backoff.
        const waitMs =
          resetSec != null
            ? Math.min(resetSec * 1000, MAX_BACKOFF_MS)
            : this.expBackoff(attempt);
        this.logger.warn(`429 pe ${endpoint}; astept ${waitMs}ms (incercare ${attempt}).`);
        if (attempt >= 6) {
          throw new RateLimitExceededError(endpoint, waitMs);
        }
        await this.sleep(waitMs);
        continue; // reincearca
      }

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Pinterest ${endpoint} -> ${res.status}: ${txt}`);
      }

      return (await res.json()) as T;
    }
  }

  /**
   * Exponential backoff cu jitter, plafonat la MAX_BACKOFF_MS (32s).
   * attempt=1 -> ~1s, 2 -> ~2s, 3 -> ~4s, 4 -> ~8s, 5 -> ~16s, 6+ -> 32s.
   */
  private expBackoff(attempt: number): number {
    const exp = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
    const jitter = Math.random() * 0.3 * exp; // +/- jitter ca sa evitam thundering herd
    return Math.min(Math.round(exp + jitter), MAX_BACKOFF_MS);
  }

  private parseResetSeconds(res: Response): number | null {
    const reset = res.headers.get('x-ratelimit-reset');
    if (!reset) return null;
    const n = Number(reset);
    return Number.isFinite(n) ? n : null;
  }

  private async captureRateLimit(
    endpoint: string,
    res: Response,
    cb?: (endpoint: string, snap: RateLimitSnapshot) => Promise<void>,
  ): Promise<void> {
    if (!cb) return;
    const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? 'NaN');
    const resetSec = this.parseResetSeconds(res);
    if (Number.isFinite(remaining) && resetSec != null) {
      await cb(endpoint, {
        remaining,
        resetAt: new Date(Date.now() + resetSec * 1000),
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export class RateLimitExceededError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly retryAfterMs: number,
  ) {
    super(`Rate limit depasit pe ${endpoint}; reincercare in ${retryAfterMs}ms`);
    this.name = 'RateLimitExceededError';
  }
}
