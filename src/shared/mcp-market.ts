import type { McpServerConfig } from "./types.ts";

/**
 * The MCP market's wire shapes.
 *
 * Types only, so the renderer and the IPC table can name them: the reader that fills them in
 * lives in Main (`src/main/pi/mcp-market.ts`), because it needs the host's language for its
 * notes and never runs in a browser.
 */

export type McpMarketSource = { name: string; url: string; kind: "registry" | "catalog" };

/** The registry's own source, always present. */
export const OFFICIAL_MCP_SOURCE: McpMarketSource = {
  name: "Official registry",
  url: "https://registry.modelcontextprotocol.io/v0/servers",
  kind: "registry",
};

export type McpMarketEntry = {
  /** Stable within a source: the registry's id, or `<catalogName>/<name>`. */
  id: string;
  name: string;
  description: string;
  /** The source this row came from, so the pane can badge it. */
  source: string;
  /** A ready-to-store server, or null when the record cannot be installed (see `reason`). */
  server: Omit<McpServerConfig, "id"> | null;
  /** Why it cannot be installed when `server` is null, or a note about installing it. */
  reason?: string;
};

export type McpMarketPage = {
  entries: McpMarketEntry[];
  /** The registry's cursor for the next page, when it has one. */
  cursor?: string;
  /** Set when a source failed: its rows are missing, the others are not. */
  errors: Array<{ source: string; message: string }>;
};

export type McpMarketQuery = { query?: string; cursor?: string; sources?: McpMarketSource[] };
