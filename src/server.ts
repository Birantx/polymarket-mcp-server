/**
 * Transport-agnostic server assembly. `buildServer()` wires up the Polymarket
 * client and registers every tool; the entrypoint (index.ts) is responsible for
 * picking a transport (stdio today; Streamable HTTP later if needed).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PolymarketClient } from "./api.js";
import { registerSearchMarkets } from "./tools/search-markets.js";
import { registerGetMarket } from "./tools/get-market.js";
import { registerGetOrderbook } from "./tools/get-orderbook.js";
import { registerGetPriceHistory } from "./tools/get-price-history.js";
import { registerListRewardMarkets } from "./tools/list-reward-markets.js";
import { registerGetTraderActivity } from "./tools/get-trader-activity.js";

export const SERVER_NAME = "polymarket-mcp-server";
export const SERVER_VERSION = "0.1.0";

export function buildServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const client = new PolymarketClient();

  registerSearchMarkets(server, client);
  registerGetMarket(server, client);
  registerGetOrderbook(server, client);
  registerGetPriceHistory(server, client);
  registerListRewardMarkets(server, client);
  registerGetTraderActivity(server, client);

  return server;
}
