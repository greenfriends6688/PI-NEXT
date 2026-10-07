/**
 * fork:websearch —— 抓取层的共同零件：SSRF 判定、浏览器特征头、超时。
 *
 * **SSRF 是本模块唯一的信任边界**：SearXNG 端点是用户自己填的 URL（自建实例常常就在
 * `127.0.0.1` 或局域网里，所以不能一律拒绝私网），但云元数据地址与文件协议必须挡住 ——
 * 否则一个被提示注入的模型就能让宿主去读 `http://169.254.169.254/latest/meta-data/`。
 * 判定顺序照 `pi参考项目/Aether-main/extensions/pi-web-access/ssrf-protection.ts` 的思路写。
 */

import { WebSearchError, type WebSearchProviderId } from "./types";

const BLOCKED_HOSTS = new Set([
  "169.254.169.254",           // AWS/GCP/Azure 元数据
  "metadata.google.internal",  // GCP 别名
  "metadata",
  "0.0.0.0",
  "[::]",
]);

export interface EndpointPolicy {
  /** 允许私网/本机地址（用户显式勾了「我自建在本机/局域网」）。 */
  allowPrivate: boolean;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** 抛 `WebSearchError` 而不是返回布尔：调用方不需要（也不许）自己决定要不要放行。 */
export function assertEndpointAllowed(rawUrl: string, provider: WebSearchProviderId, policy: EndpointPolicy): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebSearchError(provider, "endpoint is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebSearchError(provider, `endpoint must be http(s), got ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOSTS.has(host.replace(/^\[|\]$/g, ""))) {
    throw new WebSearchError(provider, "endpoint points at a cloud metadata address; refused");
  }
  if (!policy.allowPrivate && isPrivateHost(host)) {
    throw new WebSearchError(
      provider,
      "endpoint is a private/local address — turn on \"self-hosted on this machine/LAN\" in Settings → Web search to allow it",
    );
  }
  return url;
}

/** 抓取层的请求头：scraper 站点按「像不像浏览器」判，UA 与 Accept 都要给全。
 *  `sec-fetch-*` / `upgrade-insecure-requests` 不是可选项：实测 Mojeek 对只带 UA 的 GET
 *  回 403，补上这三个 + `accept-encoding` 后回 200（2026-10-07 本机实测）。 */
export function scraperHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "accept-encoding": "gzip, deflate, br",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    ...extra,
  };
}

export interface FetchTextOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/** 带硬超时与调用方取消的取文本。返回状态码与正文（不抛 HTTP 错，由 provider 判）。 */
export async function fetchText(url: string, options: FetchTextOptions): Promise<{ status: number; text: string }> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await doFetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      ...(options.body === undefined ? {} : { body: options.body }),
      signal: controller.signal,
      redirect: "follow",
    });
    const text = await response.text().catch(() => "");
    return { status: response.status, text };
  } catch (error) {
    if (options.signal?.aborted) throw new Error("cancelled by the caller");
    if (controller.signal.aborted) throw new Error(`timed out after ${options.timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
