#!/usr/bin/env node
/**
 * polymarket-mcp-server entrypoint.
 *
 * Connects the MCP server over stdio — the transport used by local clients like
 * Claude Desktop and Claude Code. All logging goes to stderr so it never
 * corrupts the JSON-RPC stream on stdout.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

main().catch((err) => {
  console.error("Fatal error starting polymarket-mcp-server:", err);
  process.exit(1);
});
