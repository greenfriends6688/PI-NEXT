/**
 * fork:proma-42-browser · 受管浏览器的 URL 策略（纯逻辑，无 Electron / 无 Node 依赖）。
 *
 * 这一层是**安全边界**，不是「方便」：agent 能给的字符串只有两种结果 —— 被规范化后
 * 可以导航，或者被拒绝。
 *
 * 与参考实现（Proma `main/lib/browser-policy.ts`）的一处**刻意分歧**：Proma 的
 * `assertSafeBrowserUrl` 只做 `new URL()` 解析，明确写着「不限制目标网络、协议或认证信息」。
 * 本仓收紧为：
 *   · 只允许 `http:` / `https:`；
 *   · **禁止 `file:`**（以及 `javascript:` / `data:` / `blob:` / `chrome:` 等一切其它 scheme）；
 *   · 目标主机必须落在「公网 / loopback / 私网」三类之内（分类见下），其余一律拒；
 *   · 不做「输入不像 URL 就当搜索词」的回退 —— 那等于让任意一句话静默变成一次
 *     对外部搜索引擎的请求。地址栏的人为输入仍走既有的 `components/browser-tab-state.ts`，
 *     不受这里影响。
 *
 * 本地 HTML 预览走另一条通道（`resolveBrowserLocalPreviewPath` + 宿主侧的受权协议），
 * 绝不用 `file://` 兜底。
 */

/** 地址栏 / 工具参数的长度上限，防止把超长字符串塞进 Electron / CDP。 */
export const MAX_BROWSER_URL_LENGTH = 4_096;

/** 导航目标的网络归属分类。`public` 之外两类都是本机可达地址。 */
export type BrowserNetworkScope = "public" | "loopback" | "private";

export interface BrowserUrlDecision {
  /** 规范化后的绝对 URL；调用方只应使用这个值。 */
  url: string;
  scheme: "http" | "https";
  /** 去掉 IPv6 方括号的小写主机名。 */
  hostname: string;
  port: string | null;
  scope: BrowserNetworkScope;
}

export class BrowserUrlRejected extends Error {
  /** 机器可读的拒绝原因，便于路由与工具把话术翻成人话。 */
  readonly reason:
    | "empty"
    | "too-long"
    | "scheme-not-allowed"
    | "file-url-forbidden"
    | "unparsable"
    | "host-not-allowed"
    | "has-host-required";

  constructor(reason: BrowserUrlRejected["reason"], message: string) {
    super(message);
    this.name = "BrowserUrlRejected";
    this.reason = reason;
  }
}

function isIpv4(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function loopbackIpv4(hostname: string): boolean {
  if (!isIpv4(hostname)) return false;
  const first = Number(hostname.split(".")[0]);
  return first === 127;
}

function privateIpv4(hostname: string): boolean {
  if (!isIpv4(hostname)) return false;
  const parts = hostname.split(".").map((part) => Number(part));
  const [a, b] = parts;
  if (a === undefined || b === undefined) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // 169.254/16 是 link-local，不是私网地址段，单独归 loopback 之外也拒绝：
  // 它只在同一条链路上有意义，受管浏览器没有理由自动连它。
  return false;
}

/**
 * link-local（169.254/16、fe80::/10）**不算**可导航目标：它只在同一条链路上有意义，
 * 而 agent 没有「我就在你办公网里」这个上下文，默认放行等于把内网探测的口子留着。
 */
function linkLocalIpv4(hostname: string): boolean {
  if (!isIpv4(hostname)) return false;
  const parts = hostname.split(".").map((part) => Number(part));
  return parts[0] === 169 && parts[1] === 254;
}

function normalizeHostname(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

export function classifyBrowserHostname(rawHostname: string): BrowserNetworkScope | "blocked" {
  const host = normalizeHostname(rawHostname);
  if (!host) return "blocked";
  // 域名形式：localhost 及其子域、mDNS 的 `.local`。
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return "loopback";
  // 0.0.0.0 / :: 作为「本机」的写法，Chromium 会当回环用。
  if (host === "0.0.0.0" || host === "::") return "loopback";
  if (host === "::1") return "loopback";
  if (isIpv4(host)) {
    if (loopbackIpv4(host)) return "loopback";
    if (linkLocalIpv4(host)) return "blocked";
    if (privateIpv4(host)) return "private";
    return "public";
  }
  // IPv6 ULA（fc00::/7）与 link-local（fe80::/10）。同样不放行 link-local。
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return "private";
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return "blocked";
  // 其余 IPv6（含全局单播）按公网处理。
  if (host.includes(":")) return "public";
  // 普通域名：公网。DNS 解析结果不在这一层判断（解析发生在宿主网络栈里）。
  return "public";
}

function isIpv6Literal(hostname: string): boolean {
  return hostname.includes(":");
}

/**
 * 「看起来像一个主机名」。没有点、又不是 IP 字面量 / localhost / .local 的东西，
 * 一律当**不可解析**——否则 `今天的天气怎么样` 会被 `new URL()` 变成一个 punycode
 * 主机名，然后按 https 真的发出去一次请求。
 */
function isHostLikeHostname(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return true;
  if (isIpv4(hostname) || isIpv6Literal(hostname)) return true;
  return hostname.includes(".");
}

/**
 * 补全 scheme。`localhost:3000` / `example.com/docs` 这类无协议输入按常见写法补：
 * loopback / 私网用 http，其余用 https。
 */
export function normalizeBrowserTarget(input: string): string {
  const value = input.trim();
  if (!value) throw new BrowserUrlRejected("empty", "浏览器地址不能为空。");
  if (value.length > MAX_BROWSER_URL_LENGTH) {
    throw new BrowserUrlRejected("too-long", `浏览器地址不能超过 ${MAX_BROWSER_URL_LENGTH} 个字符。`);
  }
  // 协议相对 URL 按 https 处理。
  if (value.startsWith("//")) return `https:${value}`;

  // `host:port` 必须在 scheme 判定**之前**处理：`example.com:8080/x` 里的
  // `example.com:` 长得就像一个合法 scheme，先判 scheme 会把它当成未知协议拒掉。
  if (/^[^/?#:\s]+:\d+(?:[/?#]|$)/.test(value)) {
    const candidate = parseHostCandidate(value);
    return classifyBrowserHostname(candidate.hostname) === "public" ? `https://${value}` : `http://${value}`;
  }

  const explicitScheme = /^([a-zA-Z][a-zA-Z\d+.-]*):/.exec(value);
  if (explicitScheme) {
    const scheme = explicitScheme[1].toLowerCase();
    // `file:` 是显式禁止项，单独给出可执行的替代指引。
    if (scheme === "file") {
      throw new BrowserUrlRejected(
        "file-url-forbidden",
        "受管浏览器禁止 file:// 地址。本地 HTML 预览请用 browser_navigate 的 localPath（只接受项目根或会话目录内的文件）。",
      );
    }
    if (scheme !== "http" && scheme !== "https") {
      throw new BrowserUrlRejected("scheme-not-allowed", `只允许 http/https 地址，收到 ${scheme}: 。`);
    }
    return value;
  }

  // 裸主机（可带路径 / query）：先确认它真的长得像主机名。
  const candidate = parseHostCandidate(value);
  if (!isHostLikeHostname(candidate.hostname)) {
    throw new BrowserUrlRejected(
      "unparsable",
      "这看起来不是一个网址。请给出完整的 http/https 地址（例如 https://example.com/docs）。",
    );
  }
  return classifyBrowserHostname(candidate.hostname) === "public" ? `https://${value}` : `http://${value}`;
}

function parseHostCandidate(value: string): URL {
  try {
    return new URL(`http://${value}`);
  } catch {
    throw new BrowserUrlRejected("unparsable", "浏览器地址无效。");
  }
}

/**
 * 规范化 + 校验，返回一个可以直接导航的绝对 URL。
 * 任何无法归入「公网 / loopback / 私网」的地址都 fail closed。
 */
export function assertNavigableBrowserUrl(input: string): BrowserUrlDecision {
  const normalized = normalizeBrowserTarget(input);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new BrowserUrlRejected("unparsable", "浏览器地址无效。");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    if (parsed.protocol === "file:") {
      throw new BrowserUrlRejected("file-url-forbidden", "受管浏览器禁止 file:// 地址。");
    }
    throw new BrowserUrlRejected("scheme-not-allowed", `只允许 http/https 地址，收到 ${parsed.protocol}。`);
  }
  if (!parsed.hostname) {
    throw new BrowserUrlRejected("has-host-required", "地址缺少主机名。");
  }
  const scope = classifyBrowserHostname(parsed.hostname);
  if (scope === "blocked") {
    throw new BrowserUrlRejected("host-not-allowed", `不允许导航到 ${parsed.hostname}（链路本地 / 无效主机）。`);
  }
  return {
    url: parsed.toString(),
    scheme: parsed.protocol === "http:" ? "http" : "https",
    hostname: normalizeHostname(parsed.hostname),
    port: parsed.port || null,
    scope,
  };
}

/** 只做 URL 解析、不做网络分类 —— 宿主在导航拦截时用同一条 scheme 规则。 */
export function isAllowedBrowserUrlScheme(input: string): boolean {
  try {
    const scheme = /^([a-zA-Z][a-zA-Z\d+.-]*):/.exec(input.trim());
    if (scheme) return scheme[1].toLowerCase() === "http" || scheme[1].toLowerCase() === "https";
    const parsed = new URL(normalizedOrRaw(input));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizedOrRaw(input: string): string {
  try {
    return normalizeBrowserTarget(input);
  } catch {
    return input;
  }
}