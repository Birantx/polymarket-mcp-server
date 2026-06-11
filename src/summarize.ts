/**
 * Domain types for the slices of Polymarket responses we surface, plus helpers
 * that trim the (very large) raw objects down to what's useful to a model.
 *
 * Gamma encodes several array fields as JSON *strings* (e.g. `outcomes`,
 * `clobTokenIds`), so we parse those defensively.
 */

import { round } from "./format.js";

export interface GammaMarket {
  id?: string;
  question?: string;
  slug?: string;
  conditionId?: string;
  description?: string;
  active?: boolean;
  closed?: boolean;
  liquidity?: string | number;
  volume?: string | number;
  volumeNum?: number;
  liquidityNum?: number;
  endDate?: string;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  [key: string]: unknown;
}

export interface GammaEvent {
  id?: string;
  title?: string;
  slug?: string;
  markets?: GammaMarket[];
  [key: string]: unknown;
}

export interface BookLevel {
  price: string;
  size: string;
}

export interface OrderBook {
  market?: string;
  asset_id?: string;
  bids?: BookLevel[];
  asks?: BookLevel[];
  tick_size?: string;
}

export interface RewardRate {
  asset_address?: string;
  rewards_daily_rate?: number;
}

export interface SamplingMarket {
  condition_id?: string;
  question?: string;
  market_slug?: string;
  active?: boolean;
  closed?: boolean;
  accepting_orders?: boolean;
  minimum_order_size?: number;
  minimum_tick_size?: number;
  rewards?: {
    rates?: RewardRate[];
    min_size?: number;
    max_spread?: number;
  };
  tokens?: Array<{ token_id?: string; outcome?: string; price?: number }>;
}

function parseJsonArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** A compact, model-friendly view of a Gamma market. */
export function summarizeMarket(m: GammaMarket) {
  const outcomes = parseJsonArray<string>(m.outcomes);
  const prices = parseJsonArray<string>(m.outcomePrices).map((p) => toNumber(p));
  const tokenIds = parseJsonArray<string>(m.clobTokenIds);

  return {
    id: m.id,
    question: m.question,
    slug: m.slug,
    conditionId: m.conditionId,
    active: m.active,
    closed: m.closed,
    liquidity: toNumber(m.liquidityNum ?? m.liquidity),
    volume: toNumber(m.volumeNum ?? m.volume),
    endDate: m.endDate,
    outcomes: outcomes.map((outcome, i) => ({
      outcome,
      price: prices[i],
      tokenId: tokenIds[i],
    })),
    url: m.slug ? `https://polymarket.com/market/${m.slug}` : undefined,
  };
}

/** Best bid/ask, spread, and midpoint computed from an order book. */
export function bookTopOfBook(book: OrderBook) {
  const bids = (book.bids ?? []).map((b) => ({ price: Number(b.price), size: Number(b.size) }));
  const asks = (book.asks ?? []).map((a) => ({ price: Number(a.price), size: Number(a.size) }));
  // Derive extremes with reduce (not Math.max(...arr), which can overflow the
  // call stack on deep books). Best bid = highest buy, best ask = lowest sell.
  const bestBid = bids.length ? bids.reduce((m, b) => Math.max(m, b.price), -Infinity) : undefined;
  const bestAsk = asks.length ? asks.reduce((m, a) => Math.min(m, a.price), Infinity) : undefined;
  const midpoint = bestBid !== undefined && bestAsk !== undefined ? round((bestBid + bestAsk) / 2) : undefined;
  const spread = bestBid !== undefined && bestAsk !== undefined ? round(bestAsk - bestBid) : undefined;
  return { bestBid, bestAsk, midpoint, spread };
}

/**
 * Notional liquidity (Σ price·size) resting within `bandCents` of the midpoint
 * on both sides — our proxy for how much competition is already chasing this
 * market's maker rewards. Lower competition + higher pool = better edge.
 */
export function competitionWithinBand(book: OrderBook, bandCents: number): number {
  const { midpoint } = bookTopOfBook(book);
  if (midpoint === undefined) return 0;
  // The CLOB returns rewards.max_spread in *cents* (observed value e.g. 3.5),
  // while book prices are fractions of $1 (0..1). Convert cents -> fraction so
  // a 3.5¢ max spread becomes a ±0.035 band around the midpoint.
  const band = bandCents / 100;
  // Float guard: |0.535 - 0.5| evaluates to 0.03500000000000003, which would
  // silently drop a level resting exactly on max_spread and under-count
  // competition. 1e-9 is orders of magnitude below any real price tick.
  const BAND_EPS = 1e-9;
  const inBand = (level: BookLevel) => {
    const price = Number(level.price);
    const size = Number(level.size);
    if (!Number.isFinite(price) || !Number.isFinite(size)) return 0;
    return Math.abs(price - midpoint) <= band + BAND_EPS ? price * size : 0;
  };
  const bidNotional = (book.bids ?? []).reduce((sum, l) => sum + inBand(l), 0);
  const askNotional = (book.asks ?? []).reduce((sum, l) => sum + inBand(l), 0);
  return round(bidNotional + askNotional, 2);
}
