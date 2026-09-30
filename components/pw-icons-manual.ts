/**
 * fork:icons-manual（2026-09-30）—— 关掉画板图标表的「自跑 hydrate」。
 *
 * `design/pi-web-design/assets/icons.js` 末尾会在 DOMContentLoaded（或模块求值时，
 * 如果文档已经过了 loading）自己 hydrate 一次 —— 那是给**静态画板页面**用的：
 * 它们没有 React，只能靠那一次自跑把 `<i data-ico>` 换成 lucide SVG。
 *
 * 产品不需要它，而且它会坏事：Next 的流式渲染先把 Suspense 片段的 HTML 补进 DOM、
 * 再让 React 认领那段 DOM；自跑若恰好跑在这两步之间，就会往那些节点里塞
 * `data-ico-done="1"` 与 `<svg>`，React 认领时看到「服务端 HTML 与客户端渲染不一致」
 * → 报 hydration mismatch 并把整个子树重生（实测第一个撞上的是侧栏搜索钮的
 * `data-ico="search"`）。产品的 hydrator 是 `PwIcons.tsx`：commit 之后跑一次 +
 * MutationObserver 兜住动态节点，本来就已经覆盖了自跑的全部职责。
 *
 * 这个模块必须是 `PwIcons.tsx` 的**第一条 import**：ES 模块按出现顺序求值，
 * 只要它比 icons.js 先跑，标志位就已经就位。
 */
(globalThis as { __piIconsManual?: boolean }).__piIconsManual = true;

export {};
