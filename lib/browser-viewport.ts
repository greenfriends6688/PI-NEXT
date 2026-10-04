/**
 * lib/browser-viewport.ts — fork:browser-viewport
 *
 * 浏览器面板的自由视口尺寸 + 缩放档。对齐 ZCode 的
 * `packages/shared/src/browser-use/command-metadata.ts`（`BROWSER_VIEWPORT_LIMITS`
 * 与 `BROWSER_VIEWPORT_ZOOM_OPTIONS`）与 `browser-ui/src/browser-use/browserViewportZoom.ts`。
 *
 * 纯逻辑，零 DOM 依赖，所以能被单测逐字覆盖 —— 尺寸与缩放算错一次，
 * 页面上表现为「视口跟手但内容不对」，人眼很难当场归因。
 */

/**
 * 内置自由尺寸的安全边界（CSS px）。
 *
 * 与 ZCode 同值（`command-metadata.ts:3-9`）：小于 320 宽的页面在桌面面板里
 * 没法用，大于 3840 宽的收益为零，而且视口越大对 GPU 合成越不友好。
 */
export const BROWSER_VIEWPORT_LIMITS = {
  minWidth: 320,
  maxWidth: 3840,
  minHeight: 320,
  maxHeight: 2160,
} as const;

/** 缩放档。与 ZCode 同序（`command-metadata.ts:39-51`），默认 `fit`。 */
export const BROWSER_VIEWPORT_ZOOM_OPTIONS = ["fit", "50", "75", "100", "125", "150", "200"] as const;
export type BrowserViewportZoom = (typeof BROWSER_VIEWPORT_ZOOM_OPTIONS)[number];
export const DEFAULT_BROWSER_VIEWPORT_ZOOM: BrowserViewportZoom = "fit";

export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * 「自由尺寸」模式的起始视口。非主题值（不是设计令牌）：1280×720 是**内容本身
 * 写死的 agent 默认视口**（与 ZCode 的 `DEFAULT_AGENT_BROWSER_VIEWPORT`
 * 同值，`command-metadata.ts:11-15`），第一次拖把手之前页面就按这个尺寸渲染，
 * 免得先闪一个 390 的手机宽度再跳。
 */
export const DEFAULT_FREE_VIEWPORT_SIZE: ViewportSize = { width: 1280, height: 720 };

/** 面板可用区（减去视口框自身的外边距）。宽或高拿不到时给一个保守的下限。 */
export function resolveViewportFitScale(container: ViewportSize): number {
  if (container.width <= 0 || container.height <= 0) return 1;
  const scale = Math.min(
    container.width / BROWSER_VIEWPORT_LIMITS.maxWidth,
    container.height / BROWSER_VIEWPORT_LIMITS.maxHeight,
  );
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * 一档缩放下的实际呈现尺寸。
 *
 * `fit` = 按容器缩到装得下；其余档是**页面自身的缩放**（不动视口 CSS 尺寸），
 * 与 ZCode 的 `resolveBrowserViewportScale` + `resolveResponsiveBrowserGuestLayout`
 * 是同一套两段语义：尺寸归尺寸，缩放归缩放。
 */
export function resolveViewportRender(
  viewport: ViewportSize | null,
  zoom: BrowserViewportZoom,
  container: ViewportSize,
): { renderWidth: number; renderHeight: number; scale: number } {
  if (!viewport) {
    // 填满：视口就是容器本身，不额外缩放。
    return { renderWidth: container.width, renderHeight: container.height, scale: 1 };
  }
  const { width, height } = clampViewportSize(viewport);
  if (zoom === "fit") {
    const scale = Math.min(container.width / width, container.height / height);
    const safe = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return { renderWidth: width * safe, renderHeight: height * safe, scale: safe };
  }
  const percent = Number(zoom) / 100;
  return { renderWidth: width * percent, renderHeight: height * percent, scale: percent };
}

/** 夹进安全边界。非法输入（非有限 / ≤0）回落到下限，而不是产生 NaN 布局。 */
export function clampViewportSize(size: ViewportSize): ViewportSize {
  const width = Number.isFinite(size.width) && size.width > 0 ? size.width : BROWSER_VIEWPORT_LIMITS.minWidth;
  const height = Number.isFinite(size.height) && size.height > 0 ? size.height : BROWSER_VIEWPORT_LIMITS.minHeight;
  return {
    width: Math.min(BROWSER_VIEWPORT_LIMITS.maxWidth, Math.max(BROWSER_VIEWPORT_LIMITS.minWidth, Math.round(width))),
    height: Math.min(BROWSER_VIEWPORT_LIMITS.maxHeight, Math.max(BROWSER_VIEWPORT_LIMITS.minHeight, Math.round(height))),
  };
}

/**
 * 拖拽把手算出的新尺寸。
 *
 * 视口是**居中**的（面板里 `place-items: center`），所以一条边把手拉过去时，
 * 视口的中线不动 ⇒ 新尺寸 = 「指针到它所贴那条边的距离」× 2。
 * 写成这个形式是因为它对左右对称、且「拉到面板边缘」天然得到容器整宽/整高
 * （指针贴到对边时距离就是容器一半，×2 正好是整宽）；而「指针位置减一个边距」
 * 那种写法对左右不对称，拉到边缘会对不齐。
 *
 * `pointer` 是指针相对**容器**的位置，`edges` 说明这条把手负责哪几条边
 * （`none` = 不负责，该轴不动）。
 */
export function resizeViewportFromDrag(
  pointer: ViewportSize,
  container: ViewportSize,
  edges: { x: "left" | "right" | "none"; y: "top" | "bottom" | "none" },
): ViewportSize {
  const width = edges.x === "none"
    ? undefined
    : edges.x === "right" ? container.width - pointer.width : pointer.width;
  const height = edges.y === "none"
    ? undefined
    : edges.y === "bottom" ? container.height - pointer.height : pointer.height;
  return clampViewportSize({
    width: width === undefined ? Number.NaN : width * 2,
    height: height === undefined ? Number.NaN : height * 2,
  });
}

/** 校验用户手输的宽/高是否可用（输入框那条路）。 */
export function isValidViewportDimension(
  value: number,
  kind: "width" | "height",
): boolean {
  if (!Number.isFinite(value)) return false;
  const limits = kind === "width"
    ? { min: BROWSER_VIEWPORT_LIMITS.minWidth, max: BROWSER_VIEWPORT_LIMITS.maxWidth }
    : { min: BROWSER_VIEWPORT_LIMITS.minHeight, max: BROWSER_VIEWPORT_LIMITS.maxHeight };
  return value >= limits.min && value <= limits.max;
}