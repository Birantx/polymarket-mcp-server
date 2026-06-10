import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CLOB_BASE, type PolymarketClient } from "../api.js";
import { guarded, ok, round } from "../format.js";

const inputSchema = {
  tokenId: z.string().min(1).describe("CLOB token ID of the outcome to chart"),
  interval: z
    .enum(["1m", "1h", "6h", "1d", "1w", "max"])
    .optional()
    .describe("Look-back window (default '1w')"),
  fidelity: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Resolution in minutes between data points (e.g. 60 = hourly). Defaults per interval if omitted."),
};

/**
 * The CLOB endpoint enforces a minimum fidelity per interval (e.g. '1w' rejects
 * anything below 5). These defaults keep requests valid and point counts sane
 * when the caller doesn't specify a resolution.
 */
const DEFAULT_FIDELITY: Record<string, number> = {
  "1m": 1,
  "1h": 1,
  "6h": 5,
  "1d": 10,
  "1w": 60,
  max: 180,
};

interface PricePoint {
  t: number;
  p: number;
}
interface HistoryResponse {
  history?: PricePoint[];
}

const MAX_POINTS_RETURNED = 500;

export function registerGetPriceHistory(server: McpServer, client: PolymarketClient): void {
  server.registerTool(
    "get_price_history",
    {
      title: "Get Polymarket price history",
      description:
        "Historical mid-price time series for one outcome token. Returns summary stats (first/last/min/max, change) plus the raw points (Unix seconds `t`, probability `p`). Large series are downsampled to keep responses compact.",
      inputSchema,
    },
    guarded(async ({ tokenId, interval = "1w", fidelity }) => {
      const data = await client.get<HistoryResponse>(CLOB_BASE, "/prices-history", {
        market: tokenId,
        interval,
        fidelity: fidelity ?? DEFAULT_FIDELITY[interval],
      });

      const history = data.history ?? [];
      if (history.length === 0) {
        return ok({ tokenId, interval, count: 0, points: [], message: "No price history for this token/interval." });
      }

      const prices = history.map((h) => h.p);
      const first = history[0];
      const last = history[history.length - 1];
      const summary = {
        first: { t: first.t, p: round(first.p) },
        last: { t: last.t, p: round(last.p) },
        min: round(prices.reduce((m, p) => Math.min(m, p), Infinity)),
        max: round(prices.reduce((m, p) => Math.max(m, p), -Infinity)),
        change: round(last.p - first.p),
      };

      // Downsample evenly if the series is long, always keeping the last point.
      let points = history;
      if (history.length > MAX_POINTS_RETURNED) {
        const step = Math.ceil(history.length / MAX_POINTS_RETURNED);
        points = history.filter((_, i) => i % step === 0);
        if (points[points.length - 1] !== last) points.push(last);
      }

      return ok({
        tokenId,
        interval,
        count: history.length,
        returned: points.length,
        summary,
        points: points.map((h) => ({ t: h.t, p: round(h.p) })),
      });
    }),
  );
}
