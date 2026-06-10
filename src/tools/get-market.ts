import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CLOB_BASE, GAMMA_BASE, type PolymarketClient } from "../api.js";
import { guarded, ok } from "../format.js";
import { bookTopOfBook, summarizeMarket, type GammaMarket, type OrderBook } from "../summarize.js";

const inputSchema = {
  id: z
    .string()
    .min(1)
    .describe("Market numeric ID (e.g. '703258') or slug (e.g. 'will-jesus-christ-return-before-2027')"),
};

const isNumericId = (s: string) => /^\d+$/.test(s);

export function registerGetMarket(server: McpServer, client: PolymarketClient): void {
  server.registerTool(
    "get_market",
    {
      title: "Get Polymarket market detail",
      description:
        "Fetch full detail for a single market by numeric ID or slug, enriched with a live CLOB midpoint and spread for each outcome token. Use after search_markets when you need depth on one specific market.",
      inputSchema,
    },
    guarded(async ({ id }) => {
      // Gamma returns a single object for /markets/{id} and an array for ?slug=.
      const market = isNumericId(id)
        ? await client.get<GammaMarket>(GAMMA_BASE, `/markets/${id}`)
        : (await client.get<GammaMarket[]>(GAMMA_BASE, "/markets", { slug: id }))[0];

      if (!market) {
        return ok({ found: false, id, message: "No market found for that ID or slug." });
      }

      const summary = summarizeMarket(market);

      // Enrich each outcome token with a live midpoint + spread from one order
      // book fetch per token (bookTopOfBook derives both).
      const quotes = await Promise.all(
        summary.outcomes.map(async (o) => {
          if (!o.tokenId) return { ...o, midpoint: undefined, spread: undefined };
          const book = await client
            .get<OrderBook>(CLOB_BASE, "/book", { token_id: o.tokenId })
            .catch(() => undefined);
          const { midpoint, spread } = book ? bookTopOfBook(book) : { midpoint: undefined, spread: undefined };
          return { ...o, midpoint, spread };
        }),
      );

      return ok({
        found: true,
        ...summary,
        description: market.description,
        outcomes: quotes,
      });
    }),
  );
}
