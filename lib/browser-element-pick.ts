/**
 * lib/browser-element-pick.ts — fork:element-picker
 *
 * 用户在浏览器面板里点一个元素，把它变成输入框里的一条 `@` 引用交给 agent
 * （对齐 ZCode 的 ElementPicker：`webElementPickerScript.ts` 664 行 +
 * `useWebElementPicker.ts` 181 行）。
 *
 * 两个刻意选择，都是被本仓的既有边界逼出来的：
 *
 * 1. **不新增协议 op。** `BROWSER_HOST_OPS` 里没有 `executeScript`，而
 *    `electron/browser-host.js` 的注释写明「任意 JS 不在协议面内」。但 `extract`
 *    这一 op 收的是**客户端构造好的表达式**（`browser-tools-extension.ts:591`
 *    在本仓侧调 `buildBrowserExtractExpression`，host 只 `Runtime.evaluate`），
 *    所以复用它就能在页面里跑我们的探针，一个新 op 都不用加。
 *
 * 2. **不做「注入高亮脚本 + 在页面里 hover」。** 那样需要真往页面 DOM 塞
 *    MutationObserver / 事件监听，既是新的信任面（页面脚本能反过来调我们），
 *    也只能在 managed 面成立。改成：一次探针拿回**一批带坐标的盒子**，高亮
 *    画在**我们自己的覆盖层**上（那个 slot 的矩形就等于原生视图的矩形），
 *    hover/click 全发生在我们的 DOM 里。视觉上与 ZCode 几乎一样，少的只是
 *    「高亮画在页面内部」这一点。
 *
 * 拿不到盒子时（iframe 面 / Web 宿主）整条功能优雅降级，理由与既有
 * `browser.iframeFallbackHint` 同源。
 */

import { assertBrowserExpressionSize, serializeBrowserPayload } from "./browser-page-scripts";

/** 一页最多列多少个候选。AX 观察那条路的上限是 240（`observe` 的 maxElements），
 *  覆盖层要在同一块面积上画这么多盒子，所以略收紧一点，免得糊成一片。 */
export const MAX_PICKABLE_ELEMENTS = 120;

/** 与 `observe` 同款的保留角色：无名元素只有本身可交互时才值得给用户看。 */
const INTERACTIVE_ROLES = [
  "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox",
  "listbox", "option", "menuitem", "switch", "slider", "tab", "img", "input",
];

export interface PickableBox {
  /** 探针返回时的序号；点中时用它回指这一批里的第几个。 */
  index: number;
  role: string;
  name: string;
  tag: string;
  /** CSS px，相对视口左上角，与 `getBoundingClientRect()` 同坐标系。 */
  bounds: { x: number; y: number; width: number; height: number };
  /** 交给 agent 的元素片段，截断过。 */
  snippet: string;
}

export interface BrowserPick {
  /** 稳定句柄，形如 `browser:<tabId>#<index>`，便于在 `@` 引用上重复指认。 */
  id: string;
  role: string;
  name: string;
  snippet: string;
}

const SNIPPET_MAX = 400;

/**
 * 页面探针：一次返回所有可选元素的盒子 + 标签。
 *
 * 纯函数：只拼字符串，不碰 DOM，所以能被单测逐字断言（与
 * `lib/browser-page-scripts.ts` 的其它 builder 同一形状）。
 */
export function buildPickListExpression(limit = MAX_PICKABLE_ELEMENTS): string {
  const capped = Math.max(1, Math.min(MAX_PICKABLE_ELEMENTS, Math.floor(limit) || MAX_PICKABLE_ELEMENTS));
  const expression = `(() => {
  const input = ${serializeBrowserPayload({ limit: capped })};
  const INTERACTIVE = ${serializeBrowserPayload(INTERACTIVE_ROLES)};
  const out = [];
  const all = document.querySelectorAll('*');
  for (const el of all) {
    if (out.length >= input.limit) break;
    const rect = el.getBoundingClientRect();
    // 看不见的（零尺寸、display:none、视口外）一律不列 —— 画出来只会挡住真东西。
    if (rect.width < 4 || rect.height < 4) continue;
    if (rect.bottom < 0 || rect.right < 0) continue;
    if (rect.top > innerHeight || rect.left > innerWidth) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if (Number(style.opacity) === 0) continue;
    const role = (el.getAttribute('role') || el.tagName || '').toLowerCase();
    const name = (
      el.getAttribute('aria-label')
      || (el instanceof HTMLInputElement || el instanceof HTMLButtonElement ? el.value : '')
      || el.getAttribute('title')
      || el.getAttribute('alt')
      || (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120)
    ).slice(0, 160);
    // 与 observe 同款取舍：无名元素只有本身可交互时才值得列出来。
    const interactive = INTERACTIVE.includes(role) || el instanceof HTMLInputElement
      || el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement
      || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      || el.isContentEditable;
    if (!name && !interactive) continue;
    out.push({
      role,
      name,
      tag: el.tagName.toLowerCase(),
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      snippet: el.outerHTML.slice(0, ${SNIPPET_MAX}),
    });
  }
  return {
    viewport: { width: innerWidth, height: innerHeight },
    boxes: out.map((item, index) => ({ index, ...item })),
  };
})()`;
  assertBrowserExpressionSize(expression);
  return expression;
}

/**
 * 探针结果 → 内部盒子 + 页面视口尺寸。
 *
 * 页面完全控制这段 JSON，而这些数字要直接变成我们 DOM 里的
 * `left/top/width/height`，所以逐条收紧：坐标必须有限、必须与视口有交、
 * 面积不能为零。`viewport` 是**页面**的视口尺寸 —— 调用方靠它把页面 CSS px
 * 缩放到 slot 的实际像素（页面可能缩放过，两者不是同一个尺度）。
 */
export function parsePickList(
  raw: unknown,
  fallbackViewport: { width: number; height: number },
): PickableBox[] {
  if (!raw || typeof raw !== "object") return [];
  const root = raw as Record<string, unknown>;
  const vp = root.viewport as Record<string, unknown> | undefined;
  const viewport = {
    width: typeof vp?.width === "number" && Number.isFinite(vp.width) && vp.width > 0 ? vp.width : fallbackViewport.width,
    height: typeof vp?.height === "number" && Number.isFinite(vp.height) && vp.height > 0 ? vp.height : fallbackViewport.height,
  };
  if (!Array.isArray(root.boxes)) return [];
  const boxes: PickableBox[] = [];
  for (const item of root.boxes) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const bounds = record.bounds as Record<string, unknown> | undefined;
    if (!bounds || typeof bounds !== "object") continue;
    const num = (key: string) => (typeof bounds[key] === "number" && Number.isFinite(bounds[key]) ? bounds[key] : NaN);
    const x = num("x");
    const y = num("y");
    const width = num("width");
    const height = num("height");
    if (![x, y, width, height].every(Number.isFinite)) continue;
    if (width < 1 || height < 1) continue;
    // 页面可以把坐标写成天文数字；要求与视口有交，否则别画。
    if (x + width <= 0 || y + height <= 0) continue;
    if (x >= viewport.width || y >= viewport.height) continue;
    const index = typeof record.index === "number" ? record.index : boxes.length;
    boxes.push({
      index,
      role: typeof record.role === "string" ? record.role.slice(0, 40) : "",
      name: typeof record.name === "string" ? record.name.slice(0, 160) : "",
      tag: typeof record.tag === "string" ? record.tag.slice(0, 40) : "",
      bounds: { x, y, width, height },
      snippet: typeof record.snippet === "string" ? record.snippet.slice(0, SNIPPET_MAX) : "",
    });
  }
  return boxes;
}

/**
 * 页面 CSS px → slot 像素。slot 的矩形就是原生视图的矩形，但页面可能缩放过，
 * 直接用页面坐标会整体偏移，所以按两边宽高比各缩一次。
 */
export function scalePickBox(
  box: PickableBox,
  viewport: { width: number; height: number },
  slot: { width: number; height: number },
): PickableBox {
  if (viewport.width <= 0 || viewport.height <= 0) return box;
  const sx = slot.width / viewport.width;
  const sy = slot.height / viewport.height;
  return {
    ...box,
    bounds: {
      x: box.bounds.x * sx,
      y: box.bounds.y * sy,
      width: box.bounds.width * sx,
      height: box.bounds.height * sy,
    },
  };
}

/** 盒子 → 引用。标签沿用 ref 体系那句人话格式（`button「登录」`）。 */
export function toBrowserPick(box: PickableBox, tabId: string): BrowserPick {
  const role = box.role || box.tag || "element";
  const label = box.name ? `${role}「${box.name}」` : role;
  return {
    id: `browser:${tabId}#${box.index}`,
    role,
    name: box.name || label,
    snippet: box.snippet,
  };
}

// ── 面板 → 输入框的单次交接 ──────────────────────────────────────────────
//
// BrowserPanel 在右栏的 tab 里，ChatInput 在中间，两者没有父子关系。
// 走一个模块级 store（同 `lib/session-unread.ts` / `lib/draft-store.ts` 的既有形状），
// **单次消费**：投递后立刻被取走，避免下次打开输入框收到一条陈旧的引用。

type PickListener = () => void;

let pendingPick: BrowserPick | null = null;
const listeners = new Set<PickListener>();

/** 面板点中一个元素后投递；输入框订阅它。 */
export function publishBrowserPick(pick: BrowserPick): void {
  pendingPick = pick;
  for (const listener of listeners) listener();
}

/** 取走待交接的引用（**读一次就没了**），没有则 null。 */
export function takeBrowserPick(): BrowserPick | null {
  const pick = pendingPick;
  pendingPick = null;
  return pick;
}

/** 只读窥视，给测试与诊断用。 */
export function peekBrowserPick(): BrowserPick | null {
  return pendingPick;
}

export function subscribeBrowserPick(listener: PickListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 丢弃未消费的引用：会话切走了就别把上一个页面的元素塞进新对话。 */
export function clearBrowserPick(): void {
  if (!pendingPick) return;
  pendingPick = null;
  for (const listener of listeners) listener();
}