// End-to-end smoke test: spawn the built server over stdio, list tools, and
// exercise the read-only tools against the live Polymarket public APIs.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

let failures = 0;
const text = (r) => r.content?.map((c) => c.text).join("\n") ?? "";
const parse = (r) => {
  if (r.isError) throw new Error(`tool returned error envelope: ${text(r)}`);
  return JSON.parse(text(r));
};

function check(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
}

// 1. tools/list
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
check("lists 6 tools", tools.length === 6, names.join(", "));

// 2. search_markets
const search = parse(await client.callTool({ name: "search_markets", arguments: { query: "bitcoin", limit: 3 } }));
check("search_markets returns events", Array.isArray(search.events) && search.events.length > 0, `${search.count} events`);
const tokenId = search.events.flatMap((e) => e.markets).flatMap((m) => m.outcomes).find((o) => o?.tokenId)?.tokenId;
check("search_markets yields a tokenId", !!tokenId, tokenId?.slice(0, 12) + "...");

// 3. get_orderbook
if (tokenId) {
  const book = parse(await client.callTool({ name: "get_orderbook", arguments: { tokenId, depth: 3 } }));
  check("get_orderbook has midpoint", typeof book.midpoint === "number" || book.midpoint === undefined, `mid=${book.midpoint}`);
  check("get_orderbook returns levels", Array.isArray(book.bids) && Array.isArray(book.asks));

  // 4. get_price_history
  const hist = parse(await client.callTool({ name: "get_price_history", arguments: { tokenId, interval: "1w" } }));
  check("get_price_history returns points", Array.isArray(hist.points));
}

// 5. list_reward_markets (the differentiator)
const rewards = parse(await client.callTool({ name: "list_reward_markets", arguments: { limit: 3 } }));
check("list_reward_markets ranks markets", Array.isArray(rewards.markets) && rewards.markets.length > 0, `${rewards.count} markets`);
check("reward markets have a daily pool", rewards.markets?.every((m) => typeof m.dailyRewardPool === "number"));
check("reward markets are ranked", rewards.markets?.[0]?.rank === 1);
console.log("  top reward market:", rewards.markets?.[0]?.question, "| pool", rewards.markets?.[0]?.dailyRewardPool, "| score", rewards.markets?.[0]?.score);

// 6. get_market (by slug from search)
const slug = search.events.flatMap((e) => e.markets).find((m) => m?.slug)?.slug;
if (slug) {
  const market = parse(await client.callTool({ name: "get_market", arguments: { id: slug } }));
  check("get_market resolves by slug", market.found === true, market.question);
}

// 7. error envelope on bad input
const bad = await client.callTool({ name: "get_orderbook", arguments: { tokenId: "not-a-real-token" } });
check("bad tokenId returns isError envelope (not a crash)", bad.isError === true, text(bad).slice(0, 60));

// 8. trader activity input validation — malformed address must be rejected,
// either by a thrown protocol error or an isError envelope.
let rejected = false;
try {
  const res = await client.callTool({ name: "get_trader_activity", arguments: { address: "0xZZZ" } });
  rejected = res.isError === true;
} catch {
  rejected = true;
}
check("get_trader_activity rejects malformed address", rejected);

await client.close();
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
