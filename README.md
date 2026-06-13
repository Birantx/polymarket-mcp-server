# Polymarket MCP Server

> A **Model Context Protocol (MCP) server** that gives Claude — and any MCP client — read-only access to [Polymarket](https://polymarket.com), the largest prediction market. Search markets, pull live order books and price history, inspect any wallet's positions, and **rank the liquidity-reward markets by where you actually earn the most per dollar quoted.**

**No API keys. No wallet. No signup.** Every tool runs against Polymarket's public APIs, so it works the second you add it to Claude.

```
"Claude, find me Polymarket markets paying the most liquidity rewards with the least competition."
```

---

## Why this exists

Most prediction-market tooling stops at "list the markets." This server adds the thing market-makers actually care about: **`list_reward_markets`** ranks Polymarket's maker-reward programs by `daily reward pool ÷ on-book competition` — surfacing where resting liquidity earns the best rate, not just which markets exist.

Built on the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk), Zod-validated, with graceful error envelopes and a short in-process cache so repeated questions in a single Claude turn stay fast.

## 60-second quickstart

### Claude Code

```bash
claude mcp add polymarket -- npx -y polymarket-mcp-server
```

### Claude Desktop

Add this to your `claude_desktop_config.json`
(`~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows):

```json
{
  "mcpServers": {
    "polymarket": {
      "command": "npx",
      "args": ["-y", "polymarket-mcp-server"]
    }
  }
}
```

Restart Claude Desktop, and the tools appear under the 🔌 menu. That's it — no credentials to configure.

### Cursor / other MCP clients

Point any MCP client at the stdio command `npx -y polymarket-mcp-server`.

## Tools

| Tool | What it does |
|------|--------------|
| `search_markets` | Full-text search across events & markets → questions, prices, liquidity, volume, and token IDs. |
| `get_market` | Full detail for one market (by ID or slug), enriched with live midpoint & spread per outcome. |
| `get_orderbook` | Live bids/asks for an outcome token, with best bid/ask, midpoint, and spread computed. |
| `get_price_history` | Historical probability time series with summary stats; auto-downsampled for long ranges. |
| `list_reward_markets` | **The differentiator.** Markets paying maker rewards, ranked by pool ÷ competition. |
| `get_trader_activity` | Any wallet's public positions, recent activity, or total portfolio value (whale-watching). |

### Example: ranking reward markets

```
You:    Which Polymarket reward markets have the best pool-to-competition right now?
Claude: (calls list_reward_markets)
        1. "Will Roberto Sánchez Palomino win the 2026 Peruvian presidential election?"
           daily pool $2,000 · max spread 3.5¢ · min size 20 · competition $40.7k · score 0.049
        ...
```

`score = dailyRewardPool / (competitionNotional + 1)`, where `competitionNotional` is the notional liquidity (Σ price·size) already resting within the scoring spread on the order book — a proxy for how crowded the reward is.

## How it works

```
Claude / MCP client  ──stdio──▶  polymarket-mcp-server
                                       │
                 ┌─────────────────────┼─────────────────────┐
                 ▼                     ▼                     ▼
          Gamma API            CLOB API              Data API
   (markets, search)   (books, prices, rewards)  (wallet positions)
```

- **Read-only & credential-free** — only public endpoints are called.
- **Zod-validated inputs** on every tool; malformed input is rejected cleanly.
- **Graceful errors** — upstream failures come back as readable messages, never raw stack traces.
- **Short TTL cache** (60s) on hot queries to respect public rate limits.

## Local development

```bash
git clone https://github.com/Birantx/polymarket-mcp-server.git
cd polymarket-mcp-server
npm install
npm run build
npm test          # end-to-end smoke test against the live public APIs
```

Run it directly over stdio:

```bash
node dist/index.js
```

## Roadmap

- `v0.1` (this release): read-only tools, credential-free.
- `v0.2` (demand-driven): optional authenticated order placement via the CLOB client, gated behind explicit key configuration.

## Related

- [**deltafarm**](https://github.com/Birantx/deltafarm) — a non-custodial, delta-neutral funding farmer for Hyperliquid (long spot / short perp; your keys stay on your machine). Same author, same approach: on-chain-verifiable trading tooling you can read and run yourself.

## Disclaimer

This is an unofficial, community-built tool and is **not affiliated with Polymarket**. It is read-only and for informational use. Nothing here is financial advice. Prediction markets may be restricted in your jurisdiction.

## License

MIT © 2026 — see [LICENSE](./LICENSE).

---

*Keywords: Polymarket MCP server, Model Context Protocol, Claude, Anthropic, prediction markets, market making, liquidity rewards, MCP tools, AI trading research.*
