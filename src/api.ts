/**
 * Thin client over Polymarket's three public REST surfaces. Everything here is
 * read-only and credential-free:
 *
 *  - Gamma API  (gamma-api.polymarket.com) — markets, events, full-text search
 *  - CLOB API   (clob.polymarket.com)      — books, prices, history, reward markets
 *  - Data API   (data-api.polymarket.com)  — wallet positions / activity / value
 *
 * Responses are returned as parsed JSON. Transport/HTTP errors are normalized
 * into `PolymarketApiError` so tool handlers can envelope them for the model
 * instead of leaking raw stack traces.
 */

import { TtlCache } from "./cache.js";

export const GAMMA_BASE = "https://gamma-api.polymarket.com";
export const CLOB_BASE = "https://clob.polymarket.com";
export const DATA_BASE = "https://data-api.polymarket.com";

const USER_AGENT = "polymarket-mcp-server/0.1 (+https://github.com/Birantx/polymarket-mcp-server)";
const REQUEST_TIMEOUT_MS = 15_000;

export class PolymarketApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
  ) {
    super(message);
    this.name = "PolymarketApiError";
  }
}

type QueryValue = string | number | boolean | undefined | null;
export type Query = Record<string, QueryValue>;

function buildUrl(base: string, path: string, query?: Query): string {
  const url = new URL(path, base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export class PolymarketClient {
  constructor(private readonly cache = new TtlCache()) {}

  /** GET a JSON resource, caching the parsed body for the cache TTL. */
  async get<T>(base: string, path: string, query?: Query): Promise<T> {
    const url = buildUrl(base, path, query);
    return this.cache.wrap(url, () => this.fetchJson<T>(url));
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": USER_AGENT },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const detail = body ? `: ${body.slice(0, 200)}` : "";
        throw new PolymarketApiError(
          `Polymarket API returned ${res.status} ${res.statusText}${detail}`,
          res.status,
          url,
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof PolymarketApiError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new PolymarketApiError(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`, undefined, url);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new PolymarketApiError(`Network error contacting Polymarket: ${message}`, undefined, url);
    } finally {
      clearTimeout(timer);
    }
  }
}
