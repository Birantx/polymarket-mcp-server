/**
 * Shared helpers for shaping MCP tool results. Tools return JSON-as-text so the
 * model gets structured, parseable output without us committing to an
 * outputSchema for every endpoint (Polymarket's response shapes are large and
 * evolve). Errors are enveloped with `isError` so MCP clients degrade
 * gracefully instead of surfacing a transport failure.
 */

import { PolymarketApiError } from "./api.js";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  // MCP's CallToolResult carries an open index signature (_meta, etc.); mirror
  // it so our results are assignable to the SDK's expected return type.
  [key: string]: unknown;
}

export function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Wrap a tool handler so any thrown error becomes a clean, model-readable
 * envelope. Known API errors keep their HTTP context; everything else is
 * reported as an unexpected failure without leaking a stack trace.
 */
export function guarded<A>(handler: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return await handler(args);
    } catch (err) {
      if (err instanceof PolymarketApiError) {
        return fail(`Polymarket request failed${err.status ? ` (HTTP ${err.status})` : ""}: ${err.message}`);
      }
      const message = err instanceof Error ? err.message : String(err);
      return fail(`Unexpected error: ${message}`);
    }
  };
}

/** Round to a fixed number of decimals, returning a number (not a string). */
export function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
