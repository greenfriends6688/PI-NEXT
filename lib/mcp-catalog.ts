/**
 * fork:proma-46-mcp-catalog — 内置「MCP 连接目录」的纯数据 + 纯函数。
 *
 * 参考实现：Proma `integration-catalog.ts`（目录数据 + 稳定排序）、
 * `mcp-configuration-service.ts`（受控写入）、`adapters/pi-mcp-tools.ts`
 * （必选 server 失败后的 2 分钟冷却）、`release-notes/v0.19.26.md`（三条加固）。
 *
 * 本模块**不 import 任何 node 内建 / SDK / React**：目录要同时给客户端组件和
 * 服务端路由用，还要能在 `.test.mjs` 里直接 import（见 lib/mcp-catalog.test.mjs）。
 *
 * 收录口径（与任务一致，宁缺毋滥）：只收录**能确认官方 endpoint / 官方包名**的
 * server；无法确认的一律不写进目录，理由列在报告里。Proma 自己就移除过 Playwright
 * 这类无效条目（release-notes/v0.19.1.md「连接目录顺序与条目修正」）。
 */

export type McpCatalogCategory = "mcp" | "credential" | "guided" | "cli";
export type McpCatalogTransport = "stdio" | "remote";

export interface McpCatalogCredentialField {
  /** remote：写入 `headers[headerName]`。 */
  headerName?: string;
  /** stdio：写入子进程环境变量（经洗过的 env 注入，见 lib/mcp-transport.ts）。 */
  envName?: string;
  /** 需要附加在裸值前的认证前缀（例如 `"Bearer "`，含尾空格）。 */
  valuePrefix?: string;
}

export interface McpCatalogEntry {
  id: string;
  category: McpCatalogCategory;
  /** 品牌名，不翻译。 */
  name: string;
  /** i18n key（三语同步）。 */
  descriptionKey: string;
  transport: McpCatalogTransport;
  /** 是否必须由用户提供一个凭据（API Key / Token）。OAuth 条目为 false。 */
  requiresCredential: boolean;
  /** 目录固定排序；连接状态从不影响位置（照抄 Proma）。 */
  priority: number;
  placement?: "bottom";
  /** 写进 mcp.json 的 server key。 */
  serverName: string;
  /** 官方文档 / 控制台入口。 */
  setupUrl: string;
  /** remote transport。 */
  url?: string;
  /** stdio transport。 */
  command?: string;
  args?: string[];
  /** 由 pi 的内置 `mcp` 扩展接管 OAuth（不自己实现）。 */
  oauth?: boolean;
  credential?: McpCatalogCredentialField;
}

/** 与 lib/mcp-transport.ts 的 WEB_PASSWORD_VARIABLE 同名；这里只用于拒绝。 */
const FORBIDDEN_ENVIRONMENT_VARIABLE = "PI_WEB_PASSWORD";

/**
 * 目录条目（10 条）。
 *
 * 来源逐条核对：
 * - GitHub / Notion / Linear / Supabase / Stripe / Vercel：官方远程 MCP endpoint，
 *   与 Proma `integration-catalog.ts` 中可见条目逐字一致。
 * - Exa / Tavily：官方远程 MCP endpoint + 单 API Key，Proma v0.19.53 / v0.19.26。
 * - Brave Search：官方 npm 包 `@brave/brave-search-mcp-server`（stdio），Proma v0.19.26。
 * - GitHub CLI：官方 CLI 入口 `https://cli.github.com/`，不作为 MCP 注入。
 */
export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  {
    id: "github",
    category: "mcp",
    name: "GitHub",
    descriptionKey: "mcp.catalog.github.desc",
    transport: "remote",
    requiresCredential: false,
    priority: 1,
    serverName: "github",
    setupUrl: "https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/set-up-the-github-mcp-server",
    url: "https://api.githubcopilot.com/mcp/",
    oauth: true,
  },
  {
    id: "notion",
    category: "mcp",
    name: "Notion",
    descriptionKey: "mcp.catalog.notion.desc",
    transport: "remote",
    requiresCredential: false,
    priority: 2,
    serverName: "notion",
    setupUrl: "https://developers.notion.com/guides/mcp/get-started-with-mcp",
    url: "https://mcp.notion.com/mcp",
    oauth: true,
  },
  {
    id: "linear",
    category: "mcp",
    name: "Linear",
    descriptionKey: "mcp.catalog.linear.desc",
    transport: "remote",
    requiresCredential: false,
    priority: 3,
    serverName: "linear",
    setupUrl: "https://linear.app/docs/mcp",
    url: "https://mcp.linear.app/mcp",
    oauth: true,
  },
  {
    id: "supabase",
    category: "mcp",
    name: "Supabase",
    descriptionKey: "mcp.catalog.supabase.desc",
    transport: "remote",
    requiresCredential: false,
    priority: 4,
    serverName: "supabase",
    setupUrl: "https://supabase.com/docs/guides/ai-tools/mcp",
    url: "https://mcp.supabase.com/mcp",
    oauth: true,
  },
  {
    id: "stripe",
    category: "mcp",
    name: "Stripe",
    descriptionKey: "mcp.catalog.stripe.desc",
    transport: "remote",
    requiresCredential: false,
    priority: 5,
    serverName: "stripe",
    setupUrl: "https://docs.stripe.com/mcp",
    url: "https://mcp.stripe.com",
    oauth: true,
  },
  {
    id: "vercel",
    category: "mcp",
    name: "Vercel",
    descriptionKey: "mcp.catalog.vercel.desc",
    transport: "remote",
    requiresCredential: false,
    priority: 6,
    placement: "bottom",
    serverName: "vercel",
    setupUrl: "https://vercel.com/docs/agent-resources/vercel-mcp",
    url: "https://mcp.vercel.com",
    oauth: true,
  },
  {
    id: "exa",
    category: "credential",
    name: "Exa Search",
    descriptionKey: "mcp.catalog.exa.desc",
    transport: "remote",
    requiresCredential: true,
    priority: 7,
    serverName: "exa",
    setupUrl: "https://dashboard.exa.ai/api-keys",
    url: "https://mcp.exa.ai/mcp",
    credential: { headerName: "x-api-key" },
  },
  {
    id: "brave-search",
    category: "credential",
    name: "Brave Search",
    descriptionKey: "mcp.catalog.brave.desc",
    transport: "stdio",
    requiresCredential: true,
    priority: 8,
    serverName: "brave-search",
    setupUrl: "https://api-dashboard.search.brave.com/app/keys",
    command: "npx",
    args: ["-y", "@brave/brave-search-mcp-server", "--transport", "stdio"],
    credential: { envName: "BRAVE_API_KEY" },
  },
  {
    id: "tavily-search",
    category: "credential",
    name: "Tavily Search",
    descriptionKey: "mcp.catalog.tavily.desc",
    transport: "remote",
    requiresCredential: true,
    priority: 9,
    serverName: "tavily-search",
    setupUrl: "https://app.tavily.com/home",
    url: "https://mcp.tavily.com/mcp",
    credential: { headerName: "Authorization", valuePrefix: "Bearer " },
  },
  {
    id: "github-cli",
    category: "cli",
    name: "GitHub CLI",
    descriptionKey: "mcp.catalog.githubCli.desc",
    transport: "stdio",
    requiresCredential: false,
    priority: 10,
    serverName: "github-cli",
    setupUrl: "https://cli.github.com/",
  },
];

// ───────────────────────────── 目录有效性 / 排序 ─────────────────────────────

const CATEGORIES: readonly McpCatalogCategory[] = ["mcp", "credential", "guided", "cli"];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpUrl(value: unknown): boolean {
  return isNonEmptyString(value) && /^https?:\/\//i.test(value.trim());
}

/**
 * 条目本身是否可用于配置。除了结构检查，还拒绝任何引用 `PI_WEB_PASSWORD` 的
 * 条目（与 lib/mcp-transport.ts 的运行时拒绝同一条线，配置目录不能成为绕过口）。
 */
export function isCatalogEntryValid(entry: McpCatalogEntry): boolean {
  if (!isNonEmptyString(entry.id) || !isNonEmptyString(entry.name)) return false;
  if (!isNonEmptyString(entry.serverName) || !isNonEmptyString(entry.setupUrl)) return false;
  if (!CATEGORIES.includes(entry.category)) return false;
  if (!Number.isFinite(entry.priority)) return false;
  // CLI 条目只指向官方安装页，不是可直接写入 mcp.json 的 server，无 transport 字段。
  if (entry.category !== "cli") {
    if (entry.transport === "remote" && !isHttpUrl(entry.url)) return false;
    if (entry.transport === "stdio" && !isNonEmptyString(entry.command)) return false;
    if (entry.requiresCredential) {
      const credential = entry.credential;
      if (!credential?.headerName && !credential?.envName) return false;
    }
    if (entry.credential?.envName && entry.transport !== "stdio") return false;
    if (entry.credential?.headerName && entry.transport !== "remote") return false;
  }
  return !referencesWebPassword(entry);
}

/** 条目（或其凭据字段）是否引用了产品登录口令；引用即拒，不做清洗。 */
export function referencesWebPassword(entry: McpCatalogEntry): boolean {
  const fields = [entry.url, entry.command, ...(entry.args ?? []), entry.credential?.headerName, entry.credential?.envName];
  return fields.some((field) => typeof field === "string" && field.toUpperCase().includes(FORBIDDEN_ENVIRONMENT_VARIABLE));
}

/**
 * 目录固定排序：先 priority，再把 `placement: "bottom"` 沉底。
 * 与连接状态无关；`Array.prototype.sort` 稳定，所以同优先级保持插入顺序
 * （照抄 Proma `compareCatalogConnectionCards`）。
 */
export function compareCatalogEntries(
  left: Pick<McpCatalogEntry, "priority" | "placement">,
  right: Pick<McpCatalogEntry, "priority" | "placement">,
): number {
  if (left.priority !== right.priority) return left.priority - right.priority;
  return Number(left.placement === "bottom") - Number(right.placement === "bottom");
}

/** 先剔除无效条目，再稳定排序。绝不修改入参数组。 */
export function sortCatalogEntries(entries: readonly McpCatalogEntry[]): McpCatalogEntry[] {
  return entries.filter(isCatalogEntryValid).slice().sort(compareCatalogEntries);
}

/** 按类分组的目录；组内顺序沿用 `sortCatalogEntries`。 */
export function groupCatalogEntries(
  entries: readonly McpCatalogEntry[] = MCP_CATALOG,
): Array<{ category: McpCatalogCategory; entries: McpCatalogEntry[] }> {
  const sorted = sortCatalogEntries(entries);
  return CATEGORIES
    .map((category) => ({ category, entries: sorted.filter((entry) => entry.category === category) }))
    .filter((group) => group.entries.length > 0);
}

export function findCatalogEntry(id: string, entries: readonly McpCatalogEntry[] = MCP_CATALOG): McpCatalogEntry | undefined {
  return entries.find((entry) => entry.id === id);
}

// ───────────────────────────── 凭据前缀剥离 ─────────────────────────────

/**
 * 剥离用户可能从控制台整段复制来的认证前缀（例如 `"Bearer abc"` → `"abc"`）。
 *
 * Proma 踩过的坑：把 `Bearer abc` 直接当裸值再加一次前缀，拼出
 * `"Bearer Bearer abc"`，请求 401，而凭据已经写进存储。比较忽略大小写、容忍
 * 前后空白；prefix 为空时只 trim 原值。
 */
export function stripCredentialPrefix(raw: string, prefix?: string): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  const trimmedPrefix = typeof prefix === "string" ? prefix.trim() : "";
  if (!trimmedPrefix) return value;
  if (value.toLowerCase().startsWith(trimmedPrefix.toLowerCase())) {
    return value.slice(trimmedPrefix.length).trimStart();
  }
  return value;
}

/** 存进请求头的最终值：剥离重复前缀后，恰好拼一次前缀。 */
export function formatCredentialValue(raw: string, prefix?: string): string {
  const bare = stripCredentialPrefix(raw, prefix);
  return prefix ? `${prefix}${bare}` : bare;
}

// ───────────────────── stdio 凭据与保存时命令绑定 ─────────────────────

export interface StdioCredentialBinding {
  command: string;
  args: string[];
}

/** 保存 stdio 凭据时记下当时的启动命令（Proma `stdioBinding`）。 */
export function createStdioCredentialBinding(command: string, args: readonly string[] = []): StdioCredentialBinding {
  return {
    command: typeof command === "string" ? command.trim() : "",
    args: (Array.isArray(args) ? args : []).filter((arg): arg is string => typeof arg === "string"),
  };
}

/**
 * 当前 server 配置是否仍与凭据绑定完全一致。`command` / `args` 任一被外部改动
 * （含直接编辑 mcp.json）即返回 false，调用方据此**不注入**该 API Key。
 */
export function stdioCredentialBindingMatches(
  binding: StdioCredentialBinding | undefined,
  config: { command?: unknown; args?: unknown },
): boolean {
  if (!binding || !isNonEmptyString(binding.command)) return false;
  const command = isNonEmptyString(config.command) ? config.command.trim() : "";
  const args = Array.isArray(config.args)
    ? config.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  if (binding.command !== command) return false;
  if (binding.args.length !== args.length) return false;
  return binding.args.every((arg, index) => arg === args[index]);
}

export interface CatalogServerConfig {
  config: Record<string, unknown>;
  /** stdio + 凭据时存在；remote 不需要（无命令可绑）。 */
  credentialBinding?: StdioCredentialBinding;
  /** 已按前缀规则整理好的凭据值（remote header 用）。 */
  headerValue?: string;
  /** stdio 环境变量名与值（由凭据存储注入，不写进 mcp.json）。 */
  envName?: string;
  envValue?: string;
}

/**
 * 把一个目录条目变成 pi 的 `McpServerConfig`。
 *
 * **stdio 的 API Key 不写进 mcp.json**：只返回 `envName` / `envValue` 与
 * `credentialBinding`，由调用方存进凭据存储，连接时经绑定校验后注入
 * （`lib/mcp-catalog-credentials.ts` + `lib/mcp-transport.ts` 的 resolver）。
 * remote 的凭据按 header 写进配置（与 pi / Proma 一致）。
 */
export function buildCatalogServerConfig(entry: McpCatalogEntry, rawCredential?: string): CatalogServerConfig {
  if (entry.transport === "remote") {
    const config: Record<string, unknown> = { url: entry.url };
    if (rawCredential !== undefined && entry.credential?.headerName) {
      const headerValue = formatCredentialValue(rawCredential, entry.credential.valuePrefix);
      config.headers = { [entry.credential.headerName]: headerValue };
      return { config, headerValue };
    }
    return { config };
  }
  const config: Record<string, unknown> = {
    command: entry.command,
    args: [...(entry.args ?? [])],
  };
  if (rawCredential !== undefined && entry.credential?.envName) {
    const envValue = stripCredentialPrefix(rawCredential, entry.credential.valuePrefix);
    return {
      config,
      envName: entry.credential.envName,
      envValue,
      credentialBinding: createStdioCredentialBinding(entry.command ?? "", entry.args ?? []),
    };
  }
  return { config };
}

// ───────────────────────────── 失败冷却状态机 ─────────────────────────────

/** 必选 server 握手失败后的冷却窗口（Proma `REQUIRED_MCP_FAILURE_COOLDOWN_MS`）。 */
export const MCP_FAILURE_COOLDOWN_MS = 2 * 60_000;
/** 失败表的防御性上限：超出时淘汰最旧记录，避免配置频繁变更导致无限增长。 */
export const MCP_FAILURE_COOLDOWN_LIMIT = 64;

export interface McpFailureCooldown {
  /** 该 key 是否仍在冷却窗口内（顺带惰性清掉过期项）。 */
  isCoolingDown(key: string): boolean;
  /** 记一次失败；同 key 覆盖时间戳。 */
  markFailure(key: string): void;
  /** 后台重连成功：立即恢复。 */
  markSuccess(key: string): void;
  readonly size: number;
  clear(): void;
}

export interface McpFailureCooldownOptions {
  cooldownMs?: number;
  limit?: number;
  now?: () => number;
}

/**
 * 2 分钟冷却状态机。
 *
 * 规则（Proma 实测收益：不冷却时每一轮 Agent 都要吃满一次完整连接超时，
 * 首 token 时间被拖死）：
 * - `markFailure` 记下 `now`；表满时淘汰**最旧**的一条。
 * - `isCoolingDown` 在 `now - failedAt < cooldownMs` 时为 true，否则惰性删除并 false。
 * - `markSuccess` 立即删除；后台重连成功即恢复必选语义。
 * - `now` 可注入，单测不依赖真实时钟。
 */
export function createMcpFailureCooldown(options: McpFailureCooldownOptions = {}): McpFailureCooldown {
  const cooldownMs = options.cooldownMs ?? MCP_FAILURE_COOLDOWN_MS;
  const limit = options.limit ?? MCP_FAILURE_COOLDOWN_LIMIT;
  const now = options.now ?? Date.now;
  const failedAt = new Map<string, number>();

  return {
    get size() {
      return failedAt.size;
    },
    isCoolingDown(key: string): boolean {
      const failed = failedAt.get(key);
      if (failed === undefined) return false;
      if (now() - failed < cooldownMs) return true;
      failedAt.delete(key);
      return false;
    },
    markFailure(key: string): void {
      if (!failedAt.has(key) && failedAt.size >= limit) {
        const oldest = failedAt.keys().next().value;
        if (oldest !== undefined) failedAt.delete(oldest);
      }
      failedAt.set(key, now());
    },
    markSuccess(key: string): void {
      failedAt.delete(key);
    },
    clear(): void {
      failedAt.clear();
    },
  };
}

// ───────────────────────────── 配置指纹 ─────────────────────────────

/** 键顺序无关的稳定序列化（Proma `stableStringify` 的纯函数版）。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

/** FNV-1a 32 位；纯 JS，客户端/服务端一致，不引 crypto。 */
export function fingerprint(value: unknown): string {
  const input = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** 冷却 key：server 名 + 配置指纹。改配置即换 key，等于立刻解除冷却。 */
export function mcpFailureKey(serverName: string, config: unknown): string {
  return `${serverName}:${fingerprint(config)}`;
}
