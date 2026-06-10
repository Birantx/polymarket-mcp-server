import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GAMMA_BASE, type PolymarketClient } from "../api.js";
import { guarded, ok } from "../format.js";
import { summarizeMarket, type GammaEvent } from "../summarize.js";

const inputSchema = {
  query: z.string().min(1).describe("Free-text search, e.g. 'US election', 'bitcoin 100k', 'premier league'"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Max events to return per type (default 10)"),
  activeOnly: z
    .boolean()
    .optional()
    .describe("Restrict to currently-active/tradable events (default true)"),
};

interface SearchResponse {
  events?: GammaEvent[];
}

export function registerSearchMarkets(server: McpServer, client: PolymarketClient): void {
  server.registerTool(
    "search_markets",
    {
      title: "Search Polymarket markets",
      description:
        "Full-text search across Polymarket events and their markets. Returns matching events with each market's question, outcome prices, liquidity, and volume. Use this first to discover markets and their token IDs (token IDs feed get_orderbook / get_price_history).",
      inputSchema,
    },
    guarded(async ({ query, limit = 10, activeOnly = true }) => {
      const data = await client.get<SearchResponse>(GAMMA_BASE, "/public-search", {
        q: query,
        limit_per_type: limit,
        events_status: activeOnly ? "active" : undefined,
      });

      const events = (data.events ?? []).map((event) => ({
        id: event.id,
        title: event.title,
        slug: event.slug,
        url: event.slug ? `https://polymarket.com/event/${event.slug}` : undefined,
        markets: (event.markets ?? []).map(summarizeMarket),
      }));

      return ok({ query, count: events.length, events });
    }),
  );
}
