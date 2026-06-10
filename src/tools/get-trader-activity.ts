import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DATA_BASE, type PolymarketClient } from "../api.js";
import { guarded, fail, ok } from "../format.js";

const inputSchema = {
  address: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a 0x-prefixed 40-hex-character wallet address")
    .describe("Wallet address (0x...) of the trader to inspect"),
  view: z
    .enum(["positions", "activity", "value"])
    .optional()
    .describe("positions = open holdings (default); activity = recent on-chain actions; value = total portfolio value"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max rows for positions/activity views (default 25)"),
  offset: z.number().int().min(0).optional().describe("Pagination offset for positions/activity"),
};

export function registerGetTraderActivity(server: McpServer, client: PolymarketClient): void {
  server.registerTool(
    "get_trader_activity",
    {
      title: "Get Polymarket trader activity",
      description:
        "Public, read-only look at any wallet's Polymarket footprint — open positions, recent activity, or total portfolio value. Useful for whale-watching and copy-research. No credentials needed; uses only on-chain/public data.",
      inputSchema,
    },
    guarded(async ({ address, view = "positions", limit = 25, offset = 0 }) => {
      const user = address.toLowerCase();

      if (view === "value") {
        const value = await client.get<unknown>(DATA_BASE, "/value", { user });
        return ok({ address: user, view, value });
      }

      const path = view === "activity" ? "/activity" : "/positions";
      const rows = await client.get<unknown[]>(DATA_BASE, path, { user, limit, offset });
      if (!Array.isArray(rows)) {
        return fail(`Unexpected response shape from Polymarket data API for ${view}.`);
      }
      return ok({ address: user, view, count: rows.length, offset, rows });
    }),
  );
}
