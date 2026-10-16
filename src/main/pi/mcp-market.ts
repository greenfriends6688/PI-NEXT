import { uiText } from "../engine/ui-text.ts";
import { OFFICIAL_MCP_SOURCE, type McpMarketEntry, type McpMarketPage, type McpMarketQuery, type McpMarketSource } from "../../shared/mcp-market.ts";

export { OFFICIAL_MCP_SOURCE, type McpMarketEntry, type McpMarketPage, type McpMarketQuery, type McpMarketSource };

const REGISTRY = OFFICIAL_MCP_SOURCE.url;
const REQUEST_TIMEOUT_MS = 15_000;
/** A page of cards. The registry's own default is smaller; this fills the pane. */
export const MARKET_PAGE_SIZE = 20;
/** A published catalog is a list, not a database: anything larger is a mistake. */
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;

type Unknown = Record<string, unknown>;

function asRecord(value: unknown): Unknown | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Unknown) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * One registry record as a server.
 *
 * A registry record names packages in order of preference and the app can install npm and
 * PyPI ones; a record that only offers something else is shown with the reason rather than
 * dropped, because a row that silently disappears reads as a broken search. `uvx` is
 * required for PyPI and is not bundled — the note says so.
 */
export function entryFromRegistry(record: unknown, sourceName: string): McpMarketEntry | null {
  const wrapper = asRecord(record) ?? {};
  // The API wraps each row as `{ server: {...}, _meta: {...} }`; a bare row is accepted too.
  const server = asRecord(wrapper.server) ?? wrapper;
  const name = asString(server.name) || asString(server.title);
  if (!name) return null;
  const id = asString(server.id) || `${sourceName}/${name}`;
  const description = asString(server.description);
  const base = { id, name, description, source: sourceName };
  const remotes = Array.isArray(server.remotes) ? server.remotes : [];
  const remote = remotes.map(asRecord).find((item) => item && asString(item.type) === "streamable-http" && asString(item.url).startsWith("https://"));
  if (remote) {
    return { ...base, server: { name, enabled: true, transport: "http", url: asString(remote.url) } };
  }
  const packages = (Array.isArray(server.packages) ? server.packages : []).map(asRecord).filter((item): item is Unknown => item !== null);
  const npm = packages.find((item) => asString(item.registryType) === "npm" || asString(item.registry_name) === "npm");
  if (npm) {
    const identifier = asString(npm.identifier) || asString(npm.name);
    if (!identifier) return { ...base, server: null, reason: uiText("记录里没有包名", "the record names no package") };
    const version = asString(npm.version);
    return {
      ...base,
      server: {
        name,
        enabled: true,
        transport: "stdio",
        command: "npx",
        args: ["-y", version ? `${identifier}@${version}` : identifier, ...packageArguments(npm)],
      },
    };
  }
  const pypi = packages.find((item) => asString(item.registryType) === "pypi" || asString(item.registry_name) === "pypi");
  if (pypi) {
    const identifier = asString(pypi.identifier) || asString(pypi.name);
    if (!identifier) return { ...base, server: null, reason: uiText("记录里没有包名", "the record names no package") };
    return {
      ...base,
      server: { name, enabled: true, transport: "stdio", command: "uvx", args: [identifier, ...packageArguments(pypi)] },
      reason: uiText("需要本机有 uv/uvx", "needs uv/uvx on this machine"),
    };
  }
  return { ...base, server: null, reason: uiText("记录里的包类型本机装不了", "the record offers no package this app can install") };
}

/** Positional arguments a registry record asks for, as strings. */
function packageArguments(item: Unknown): string[] {
  const list = Array.isArray(item.packageArguments) ? item.packageArguments : Array.isArray(item.runtimeArguments) ? item.runtimeArguments : [];
  return list
    .map(asRecord)
    .filter((entry): entry is Unknown => entry !== null)
    .map((entry) => ({ type: asString(entry.type), value: asString(entry.value), name: asString(entry.name) }))
    .filter((entry) => entry.value && (entry.type === "positional" || entry.type === "named"))
    .map((entry) => entry.value);
}

/**
 * A published catalog: `{ servers: [...] }` or a bare array of the same records.
 *
 * Deliberately the same reader as the registry's rows, so one file cannot mean something the
 * other does not. A `mcpServers` map (`{ "filesystem": { command: … } }`) is accepted too,
 * because the natural thing to publish is the file people already keep.
 */
export function entriesFromCatalog(document: unknown, sourceName: string): McpMarketEntry[] {
  const root = asRecord(document);
  const listed = Array.isArray(document)
    ? document
    : Array.isArray(root?.servers)
      ? root.servers
      : Array.isArray(root?.servers_list)
        ? root.servers_list
        : null;
  if (listed) {
    return listed.map((record) => entryFromRegistry(record, sourceName)).filter((entry): entry is McpMarketEntry => entry !== null);
  }
  const map = asRecord(root?.mcpServers) ?? asRecord(root?.servers);
  if (!map) return [];
  const entries: McpMarketEntry[] = [];
  for (const [name, config] of Object.entries(map)) {
    const item = asRecord(config);
    if (!item) continue;
    const url = asString(item.url);
    const command = asString(item.command);
    if (!url && !command) continue;
    entries.push({
      id: `${sourceName}/${name}`,
      name,
      description: asString(item.description),
      source: sourceName,
      server: url
        ? { name, enabled: true, transport: "http", url }
        : { name, enabled: true, transport: "stdio", command, args: (Array.isArray(item.args) ? item.args : []).map(String) },
    });
  }
  return entries;
}

async function get(url: string, accept: string): Promise<{ ok: true; body: string } | { ok: false; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept, "user-agent": "Pinext" } });
    if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };
    return { ok: true, body: await response.text() };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One page: the registry (paged and searched) beside every catalog (fetched whole, filtered
 * here). A source that fails contributes an error and nothing else — a catalog URL that is
 * down must not take the registry's rows with it.
 */
/**
 * The catalog sources the user added, read from settings.
 *
 * A malformed entry is dropped rather than reported: the list is a convenience, and a pane
 * that refuses to open because one URL is not a string would be worse than one that shows
 * fewer rows. Nothing is fetched here — that is the caller's job, once.
 */
export function readMcpMarketSources(settings: Record<string, unknown>): McpMarketSource[] {
  const raw = settings.mcpMarketSources;
  if (!Array.isArray(raw)) return [];
  const sources: McpMarketSource[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;
    const url = asString(record.url).trim();
    if (!/^https:\/\//i.test(url)) continue;
    const kind = record.kind === "registry" ? "registry" : "catalog";
    sources.push({ name: asString(record.name).trim() || new URL(url).hostname, url, kind });
  }
  return sources.slice(0, 10);
}

export async function fetchMcpMarket(query: McpMarketQuery = {}): Promise<McpMarketPage> {
  const sources = query.sources && query.sources.length > 0 ? query.sources : [OFFICIAL_MCP_SOURCE];
  const search = query.query?.trim() ?? "";
  const entries: McpMarketEntry[] = [];
  const errors: McpMarketPage["errors"] = [];
  let cursor: string | undefined;

  await Promise.all(
    sources.map(async (source) => {
      if (source.kind === "registry") {
        const url = new URL(source.url);
        if (search) url.searchParams.set("search", search);
        url.searchParams.set("limit", String(MARKET_PAGE_SIZE));
        if (query.cursor) url.searchParams.set("cursor", query.cursor);
        const result = await get(url.toString(), "application/json");
        if (!result.ok) {
          errors.push({ source: source.name, message: result.message });
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(result.body);
        } catch {
          errors.push({ source: source.name, message: uiText("返回的不是 JSON", "the answer was not JSON") });
          return;
        }
        const record = asRecord(parsed) ?? {};
        const rows = Array.isArray(record.servers) ? record.servers : Array.isArray(parsed) ? parsed : [];
        for (const row of rows) {
          const entry = entryFromRegistry(row, source.name);
          if (entry) entries.push(entry);
        }
        const meta = asRecord(record.metadata);
        if (meta && typeof meta.nextCursor === "string" && meta.nextCursor) cursor = meta.nextCursor;
        return;
      }
      const result = await get(source.url, "application/json, text/plain");
      if (!result.ok) {
        errors.push({ source: source.name, message: result.message });
        return;
      }
      if (result.body.length > MAX_CATALOG_BYTES) {
        errors.push({ source: source.name, message: uiText("目录文件太大", "the catalog file is too large") });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.body);
      } catch {
        errors.push({ source: source.name, message: uiText("不是有效的 JSON", "that is not valid JSON") });
        return;
      }
      const needle = search.toLowerCase();
      for (const entry of entriesFromCatalog(parsed, source.name)) {
        if (needle && !`${entry.name} ${entry.description}`.toLowerCase().includes(needle)) continue;
        entries.push(entry);
      }
    }),
  );

  // A name is how a server is stored, so two sources offering the same one is one row: the
  // first source wins, and the second is what 「already have it」 means.
  const seen = new Set<string>();
  const unique = entries.filter((entry) => {
    if (seen.has(entry.name)) return false;
    seen.add(entry.name);
    return true;
  });
  return { entries: unique, ...(cursor ? { cursor } : {}), errors };
}
