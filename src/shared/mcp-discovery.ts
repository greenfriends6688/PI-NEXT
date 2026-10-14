/**
 * A server found in another agent's config, as the settings pane sees it.
 *
 * Shared because the discovery result crosses the bridge verbatim — the pane lists what was
 * found and the person chooses. Nothing here is adopted automatically: a config somebody
 * wrote for another tool is not consent to import it into this one.
 */
export type McpDiscoveryScope = "user" | "project";

export interface McpDiscoveredServer {
  name: string;
  tool: string;
  scope: McpDiscoveryScope;
  /** Absolute path of the file it came from. */
  path: string;
  /** Normalized definition, ready for pi's config. */
  def: Record<string, unknown>;
  /** Set when the source file marks the server off. */
  disabled: boolean;
  /** True when a higher-priority source defines the same name (project wins). */
  shadowed: boolean;
}
