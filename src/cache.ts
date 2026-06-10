/**
 * Tiny in-process TTL cache. Polymarket's public endpoints are unauthenticated
 * and rate-limited; caching hot queries for a short window keeps us friendly and
 * makes repeated tool calls within a single Claude turn feel instant.
 */

const DEFAULT_TTL_MS = 60_000;

interface Entry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

export class TtlCache {
  private readonly store = new Map<string, Entry<unknown>>();
  /** In-flight producers, keyed by cache key, to collapse concurrent misses. */
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  get<T>(key: string, now: number): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, now: number): void {
    this.store.set(key, { value, expiresAt: now + this.ttlMs });
  }

  /**
   * Return the cached value for `key`, or run `produce`, cache its result, and
   * return it. Concurrent misses for the same key share a single `produce()`
   * call (no thundering herd). Errors are never cached.
   */
  async wrap<T>(key: string, produce: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key, Date.now());
    if (hit !== undefined) return hit;

    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const pending = produce()
      .then((value) => {
        this.set(key, value, Date.now());
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, pending);
    return pending;
  }
}
