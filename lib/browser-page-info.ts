/**
 * lib/browser-page-info.ts — fork:browser-page-info
 *
 * 浏览器面板的**页面信息**探针：标题、favicon、加载状态。一次性把三样都拿到，
 * 因为它们都只能从页面里读，而读页面在本仓只有一条合规的路（`extract` op 收
 * 客户端构造好的表达式 → `Runtime.evaluate`，见 `electron/browser-host.js:671-678`）。
 *
 * 不新增 `BROWSER_HOST_OPS` 成员：`BROWSER_HOST_OPS` 里刻意没有 `executeScript`
 * （协议头注：「任意 JS 不在协议面内」），而这个探针是**固定模板**生成的，
 * 与 `browser-page-scripts.ts` 里其它 builder 同一形状 —— 不是用户输入的脚本。
 *
 * iframe 面拿不到（跨源，同 `browser.iframeFallbackHint` 那条既有降级），
 * 所以调用方必须自己处理「读不到」这一态，不能当成空标题。
 */

import { assertBrowserExpressionSize, serializeBrowserPayload } from "./browser-page-scripts";

/** favicon 只接受 http(s)/data，别的（`javascript:` 等）直接丢掉。 */
const FAVICON_MAX_CHARS = 500;
const TITLE_MAX_CHARS = 200;

export interface BrowserPageInfo {
  /** 空串 = 页面还没给标题（而不是「没读到」——那是 null）。 */
  title: string;
  favicon: string | null;
  readyState: "loading" | "interactive" | "complete";
}

export const EMPTY_PAGE_INFO: BrowserPageInfo = { title: "", favicon: null, readyState: "loading" };

export function buildPageInfoExpression(): string {
  const expression = `(() => {
  const input = ${serializeBrowserPayload({ titleMax: TITLE_MAX_CHARS, faviconMax: FAVICON_MAX_CHARS })};
  const pick = (el) => {
    if (!el) return null;
    const href = el.getAttribute('href') || '';
    if (!href) return null;
    try {
      const url = new URL(href, location.href);
      // 只收 http(s)/data：javascript: / blob: 拿去做 favicon 没意义，
      // 而且把它们渲染进 src 是一条不必要的注入面。
      if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'data:') {
        return url.href.slice(0, input.faviconMax);
      }
    } catch { return null; }
    return null;
  };
  const links = Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="shortcut icon"]'));
  let favicon = null;
  for (const link of links) {
    favicon = pick(link);
    if (favicon) break;
  }
  return {
    title: (document.title || '').slice(0, input.titleMax),
    favicon,
    readyState: document.readyState,
  };
})()`;
  assertBrowserExpressionSize(expression);
  return expression;
}

/**
 * 探针结果 → 内部形状。宿主回 `unknown`，而这段 JSON 要直接进 `src`/`title`，
 * 所以逐项收紧：readyState 必须是三个已知值，favicon 必须是能安全渲染的协议。
 */
export function parsePageInfo(raw: unknown): BrowserPageInfo {
  if (!raw || typeof raw !== "object") return EMPTY_PAGE_INFO;
  const record = raw as Record<string, unknown>;
  const readyState = record.readyState;
  return {
    title: typeof record.title === "string" ? record.title.slice(0, TITLE_MAX_CHARS) : "",
    favicon: typeof record.favicon === "string" && isRenderableFavicon(record.favicon)
      ? record.favicon.slice(0, FAVICON_MAX_CHARS)
      : null,
    readyState: readyState === "complete" || readyState === "interactive" ? readyState : "loading",
  };
}

function isRenderableFavicon(value: string): boolean {
  if (value.startsWith("data:image/")) return true;
  return /^https?:\/\//u.test(value);
}