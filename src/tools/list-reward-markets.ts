import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CLOB_BASE, type PolymarketClient } from "../api.js";
import { guarded, ok, round } from "../format.js";
import { competitionWithinBand, type OrderBook, type SamplingMarket } from "../summarize.js";

const inputSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("How many ranked reward markets to return (default 10)"),
  measureCompetition: z
    .boolean()
    .optional()
    .describe(
      "If true (default), fetch each finalist's order book to measure in-band competition and rank by pool ÷ competition. If false, rank by raw daily pool only (fewer API calls).",
    ),
};

interface SamplingResponse {
  data?: SamplingMarket[];
  next_cursor?: string;
}

function dailyPool(m: SamplingMarket): number {
  return (m.rewards?.rates ?? []).reduce((sum, r) => sum + (r.rewards_daily_rate ?? 0), 0);
}

export function registerListRewardMarkets(server: McpServer, client: PolymarketClient): void {
  server.registerTool(
    "list_reward_markets",
    {
      title: "List Polymarket liquidity-reward markets (ranked)",
      description:
        "THE differentiator: lists markets currently paying maker (liquidity) rewards, ranked by daily reward pool ÷ in-band competition — i.e. where you earn the most rewards per dollar of resting liquidity. Each row includes the daily pool, max scoring spread, min order size, and the measured competition (notional resting within the scoring band). Credential-free.",
      inputSchema,
    },
    guarded(async ({ limit = 10, measureCompetition = true }) => {
      // One unauthenticated page of sampling markets (~100 reward-eligible markets).
      const page = await client.get<SamplingResponse>(CLOB_BASE, "/sampling-markets");
      const eligible = (page.data ?? [])
        .filter((m) => m.active && !m.closed && m.accepting_orders && dailyPool(m) > 0)
        .sort((a, b) => dailyPool(b) - dailyPool(a));

      // When ranking by score we oversample: a market with a modest pool but an
      // empty book can out-score a high-pool/crowded one, so consider more than
      // `limit` candidates before re-ranking — but cap the number of book calls.
      const MAX_BOOK_CALLS = 30;
      const candidateCount = measureCompetition ? Math.min(limit * 3, MAX_BOOK_CALLS) : limit;
      const candidates = eligible.slice(0, candidateCount);

      const ranked = await Promise.all(
        candidates.map(async (m) => {
          const pool = round(dailyPool(m), 4);
          const maxSpread = m.rewards?.max_spread ?? 0;
          const yesToken = m.tokens?.[0]?.token_id;

          let competitionNotional: number | undefined;
          if (measureCompetition && yesToken && maxSpread > 0) {
            const book = await client
              .get<OrderBook>(CLOB_BASE, "/book", { token_id: yesToken })
              .catch(() => undefined);
            if (book) competitionNotional = competitionWithinBand(book, maxSpread);
          }

          // Score: reward pool per dollar of competing liquidity. +1 avoids
          // divide-by-zero and rewards genuinely empty books.
          const score =
            competitionNotional !== undefined ? round(pool / (competitionNotional + 1), 6) : undefined;

          return {
            question: m.question,
            slug: m.market_slug,
            conditionId: m.condition_id,
            dailyRewardPool: pool,
            maxSpreadCents: maxSpread,
            minOrderSize: m.rewards?.min_size,
            outcomes: (m.tokens ?? []).map((t) => ({
              outcome: t.outcome,
              price: t.price,
              tokenId: t.token_id,
            })),
            competitionNotional,
            score,
            url: m.market_slug ? `https://polymarket.com/market/${m.market_slug}` : undefined,
          };
        }),
      );

      // Re-rank by score when competition was measured, then trim oversampled
      // candidates down to the requested limit; otherwise pool order stands.
      if (measureCompetition) {
        ranked.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      }
      const result = ranked.slice(0, limit).map((m, i) => ({ rank: i + 1, ...m }));

      return ok({
        count: result.length,
        consideredCandidates: candidates.length,
        rankedBy: measureCompetition ? "dailyRewardPool / (competitionNotional + 1)" : "dailyRewardPool",
        note: "competitionNotional = Σ price·size resting within max_spread of midpoint on the Yes-token book (proxy for how many makers are already chasing this pool).",
        markets: result,
      });
    }),
  );
}
