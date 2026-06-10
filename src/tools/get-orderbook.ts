import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CLOB_BASE, type PolymarketClient } from "../api.js";
import { guarded, ok } from "../format.js";
import { bookTopOfBook, type OrderBook } from "../summarize.js";

const inputSchema = {
  tokenId: z
    .string()
    .min(1)
    .describe("CLOB token ID (the long numeric string from a market's outcome; get it via search_markets or get_market)"),
  depth: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("How many price levels per side to return (default 10)"),
};

export function registerGetOrderbook(server: McpServer, client: PolymarketClient): void {
  server.registerTool(
    "get_orderbook",
    {
      title: "Get Polymarket order book",
      description:
        "Live bids/asks for one outcome token, with computed best bid, best ask, midpoint, and spread. Bids are returned highest-first and asks lowest-first (the top of book), truncated to `depth` levels.",
      inputSchema,
    },
    guarded(async ({ tokenId, depth = 10 }) => {
      const book = await client.get<OrderBook>(CLOB_BASE, "/book", { token_id: tokenId });
      const top = bookTopOfBook(book);

      const bids = [...(book.bids ?? [])]
        .sort((a, b) => Number(b.price) - Number(a.price))
        .slice(0, depth);
      const asks = [...(book.asks ?? [])]
        .sort((a, b) => Number(a.price) - Number(b.price))
        .slice(0, depth);

      return ok({
        tokenId,
        ...top,
        tickSize: book.tick_size,
        bids,
        asks,
      });
    }),
  );
}
