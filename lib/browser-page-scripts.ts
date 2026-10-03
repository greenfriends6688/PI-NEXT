/**
 * fork:proma-42-browser · 页面内执行的**固定**脚本构造器（纯逻辑）。
 *
 * 这一层存在的唯一理由是：让「必须在页面上下文里跑」的两件事（抽取正文、按 selector
 * 定位元素）以**固定模板 + JSON 序列化数据**的方式发生，agent 提供的 selector /
 * maxChars 永远不会落进可执行位置。
 *
 * 三条纪律（与 `AGENTS.md`「原子工具优先于 executeJavaScript」一致）：
 *   1. 10 个原子工具里没有一个是「让 agent 写 JS」。这里生成的表达式**由本仓写死**，
 *      参数只作为 JSON 字面量注入；`serializePayload` 里的 `<` 转义保证
 *      `</script>` / `<!--` 不会提前闭合字符串。
 *   2. **绝不执行页面自己提供或诱导的脚本**：模板只读 DOM 文本与属性，不 eval、
 *      不用 `Function`、不读 `window` 上任何属性、不发起网络请求。
 *   3. 页面自带的 `data:` / `javascript:` / blob: 链接在改写时被丢弃，绝不当导航目标。
 *
 * 这些表达式由宿主（`electron/browser-host.js`）通过 CDP `Runtime.evaluate` 执行；
 * 宿主不自己拼字符串，只负责把这里的产物送进页面。
 */

import {
  MAX_BROWSER_EXTRACT_CHARS,
  MAX_BROWSER_SCRIPT_RESULT_CHARS,
  MAX_BROWSER_SELECTOR_CHARS,
} from "./browser-capacity";

export type BrowserExtractFormat = "text" | "markdown";

export interface BrowserExtractInput {
  /** 缺省取 `document.body`。 */
  selector?: string;
  format: BrowserExtractFormat;
  maxChars?: number;
}

/**
 * 注入页面上下文的字面量。`<` 必须转义 —— 否则一个值里的 `</script>` 或 `<!--`
 * 就能提前结束脚本块，剩下的部分就会被当成 HTML 解析（表达式注入的经典手法）。
 * ` ` / ` ` 同样要转，否则 JSON 字面量会被当成换行符截断。
 */
export function serializeBrowserPayload(payload: unknown): string {
  return JSON.stringify(payload ?? null)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function assertBrowserSelector(selector: string | undefined, required = false): void {
  if (required && !selector?.trim()) throw new Error("CSS selector 不能为空。");
  if (selector && selector.length > MAX_BROWSER_SELECTOR_CHARS) {
    throw new Error(`CSS selector 不能超过 ${MAX_BROWSER_SELECTOR_CHARS} 个字符。`);
  }
}

export function assertBrowserExtract(input: BrowserExtractInput): void {
  assertBrowserSelector(input.selector);
  if (input.format !== "text" && input.format !== "markdown") {
    throw new Error("抽取格式必须是 text 或 markdown。");
  }
  if (input.maxChars !== undefined && (!Number.isFinite(input.maxChars) || input.maxChars < 1 || input.maxChars > MAX_BROWSER_EXTRACT_CHARS)) {
    throw new Error(`maxChars 必须是 1 到 ${MAX_BROWSER_EXTRACT_CHARS} 的有限数字。`);
  }
}

/** 在 open shadow root 里逐层找元素的固定实现；只做查询，不改页面。 */
const FIND_ELEMENT_SOURCE = `
  const findElement = (root, selector) => {
    const direct = root.querySelector(selector);
    if (direct) return direct;
    for (const host of root.querySelectorAll('*')) {
      if (!host.shadowRoot) continue;
      const nested = findElement(host.shadowRoot, selector);
      if (nested) return nested;
    }
    return null;
  };
`;

/**
 * 抽取页面正文的固定表达式。
 *
 * 三个必须保留的边界（照抄自参考实现并逐条确认过为什么）：
 *   · `maxNodes` / `maxDepth` / `workCharLimit` —— 单个巨型文本节点不能让页面卡死；
 *   · `safeLink` 把 href 重写成 origin + pathname，非 http(s) 直接丢 —— 页面给的
 *     `javascript:` 链接不能被模型当成可点目标带走；
 *   · `script` / `style` / `template` / `svg` / `noscript` / `aria-hidden` 整棵跳过 ——
 *     页面里的注释与提示词不是内容。
 */
export function buildBrowserExtractExpression(input: BrowserExtractInput): string {
  assertBrowserExtract(input);
  return `(() => {
  const input = ${serializeBrowserPayload(input)};${FIND_ELEMENT_SOURCE}
  const root = input.selector ? findElement(document, input.selector) : document.body;
  if (!root) return { ok: false, error: '未找到可抽取内容。' };
  const maxChars = Math.min(${MAX_BROWSER_EXTRACT_CHARS}, Math.floor(input.maxChars || ${MAX_BROWSER_EXTRACT_CHARS}));
  const workCharLimit = maxChars + 1024;
  const maxNodes = 10000;
  const maxDepth = 64;
  let remainingRawChars = workCharLimit;
  let remainingOutputChars = workCharLimit;
  let visitedNodes = 0;
  let stoppedEarly = false;
  const emit = (value) => {
    if (!value || remainingOutputChars <= 0) { if (value) stoppedEarly = true; return ''; }
    const bounded = value.slice(0, remainingOutputChars);
    if (bounded.length < value.length) stoppedEarly = true;
    remainingOutputChars -= bounded.length;
    return bounded;
  };
  const cleanText = (value) => {
    if (!value || remainingRawChars <= 0) { if (value) stoppedEarly = true; return ''; }
    const raw = String(value);
    const bounded = raw.slice(0, remainingRawChars);
    if (bounded.length < raw.length) stoppedEarly = true;
    remainingRawChars -= bounded.length;
    return emit(bounded.replace(/\\s+/g, ' ').trim());
  };
  const safeLink = (href) => {
    try {
      const url = new URL(String(href).slice(0, 2048), location.href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin + url.pathname : '';
    } catch { return ''; }
  };
  const markdown = (node, depth) => {
    const level = depth || 0;
    if (++visitedNodes > maxNodes || level > maxDepth) { stoppedEarly = true; return ''; }
    if (node.nodeType === 3) return cleanText(node.nodeValue || '');
    if (node.nodeType !== 1) return '';
    const element = node;
    const tag = element.tagName.toLowerCase();
    if (element.hidden || ['script','style','noscript','template','svg'].includes(tag) || element.getAttribute('aria-hidden') === 'true') return '';
    const parts = [];
    for (const child of element.childNodes) {
      if (visitedNodes >= maxNodes || remainingOutputChars <= 0) { stoppedEarly = true; break; }
      const childContent = markdown(child, level + 1);
      if (childContent) {
        if (parts.length) parts.push(emit(' '));
        parts.push(childContent);
      }
    }
    const children = parts.length === 1 ? parts[0] : parts.join('');
    if (!children && tag !== 'img' && tag !== 'br') return '';
    if (/^h[1-6]$/.test(tag)) return emit('\\n\\n' + '#'.repeat(Number(tag[1])) + ' ') + children + emit('\\n\\n');
    if (tag === 'p' || tag === 'section' || tag === 'article' || tag === 'blockquote') return emit('\\n\\n') + children + emit('\\n\\n');
    if (tag === 'li') return emit('\\n- ') + children;
    if (tag === 'br') return emit('\\n');
    if (tag === 'pre') { const fence = String.fromCharCode(96).repeat(3); return emit('\\n\\n' + fence + '\\n') + children + emit('\\n' + fence + '\\n\\n'); }
    if (tag === 'code') { const tick = String.fromCharCode(96); return emit(tick) + children + emit(tick); }
    if (tag === 'a') { const href = safeLink(element.getAttribute('href') || ''); return href ? emit('[') + (children || emit(href)) + emit('](' + href + ')') : children; }
    if (tag === 'img') { const alt = cleanText(element.getAttribute('alt') || ''); return alt ? emit(' ![') + alt + emit(']') : ''; }
    return children;
  };
  const rendered = markdown(root, 0);
  const content = input.format === 'text'
    ? String(rendered).replace(/\\s+/g, ' ').trim()
    : rendered.replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
  return {
    ok: true,
    format: input.format,
    selector: input.selector || null,
    text: content.slice(0, maxChars),
    truncated: stoppedEarly || content.length > maxChars,
    totalChars: content.length,
    totalCharsIsLowerBound: stoppedEarly,
    visitedNodes,
  };
})()`;
}

/**
 * 读取元素可交互属性的固定表达式（`browser_type` 之前的自检、`browser_click` 的回执）。
 * 只读不写：可编辑性 / 焦点 / 可见性 / 包围盒，用它代替「读一下这个 ref 是什么」。
 */
export function buildBrowserInspectExpression(selector: string): string {
  assertBrowserSelector(selector, true);
  return `(() => {
  const input = ${serializeBrowserPayload({ selector })};${FIND_ELEMENT_SOURCE}
  const element = findElement(document, input.selector);
  if (!element) return { ok: false, error: '未找到匹配 selector 的元素。' };
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const isPassword = element instanceof HTMLInputElement && element.type === 'password';
  const safeHref = (() => {
    if (!(element instanceof HTMLAnchorElement) || !element.href) return null;
    try { const url = new URL(element.href); return url.origin + url.pathname; } catch { return null; }
  })();
  const rawValue = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element.value
    : element.isContentEditable ? (element.textContent || '') : '';
  return {
    ok: true,
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    contentEditable: element.isContentEditable,
    focused: document.activeElement === element,
    visible: !!(element.getClientRects().length && style.visibility !== 'hidden' && style.display !== 'none'),
    disabled: 'disabled' in element ? !!element.disabled : false,
    checked: element instanceof HTMLInputElement ? element.checked : element.getAttribute('aria-checked'),
    valueLength: rawValue.length,
    // 密码字段永远不回显内容，只回长度 —— 这是截图/observe 都会漏掉的一条。
    valuePreview: isPassword ? null : rawValue.slice(0, 500),
    text: (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 2000),
    href: safeHref,
    bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
  };
})()`;
}

/** 页面加载完成的固定探针：给 navigate 一个可判定的「到位」信号。 */
export function buildBrowserReadyExpression(): string {
  return `(() => ({
  readyState: document.readyState,
  url: location.href,
  title: (document.title || '').slice(0, 200),
}))()`;
}

/** 表达式本身的字符上限，防止有人把一整页塞进来当脚本执行。 */
export function assertBrowserExpressionSize(expression: string): void {
  if (expression.length > MAX_BROWSER_SCRIPT_RESULT_CHARS) {
    throw new Error("页面表达式过大。");
  }
}