"use client";

/**
 * M-12 · 手机右栏六面板（2026-10-04 用户裁定：六项在手机上也出）。
 *
 * 抄 `design/v5/pwa/boards/M-12-right-panels.html` 的 DOM 原文：
 *   帧 A 入口 = 顶栏一枚 `panel-right` 钮 → `.m-sheet` 六项列表（每行一句现状）；
 *   帧 B 全屏层 = `.m-viewer.is-open` + `.m-viewer-bar`（`.m-cats.compact` 六项横滚
 *   + 右侧 `x`）+ 每个 pane 一块 `.m-panel-scroll` + 底部 `.m-vbar` 常驻那句
 *   「切到任何一块都不换页面，只换这一层内容」。
 *
 * 关键约定（与画板一致，产品不许改）：
 *   ① 入口只有一枚，底部面板只用来**选**，不装正文；
 *   ② 六块共用**同一层**，切块只换 `.m-panel-scroll` 的内容 —— 页面 / 滚动位置 /
 *      会话上下文都不动；
 *   ③ 轨迹仍是单例、审查仍是两份来源、Git 只读 —— 这里不重述它们的内容，
 *      正文由调用方从各自组件递进来（`items[].render`）。
 *
 * 接线层（本文件不碰）：把 `<MobileRightPanels items={…} />` 放在会话页顶栏，
 * `items` 的六块对应桌面右栏的六个页签（轨迹 / 文件 / 终端 / 浏览器 / Git / 审查）。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
// fork:v5-landing E4 —— M-11 帧 A-2 的左缘侧滑返回（`.m-swipe` / `.m-swipe-edge` /
// `.m-swipe-hint`）。这层的关闭动作在本组件里（`closeAll`），所以手势也归这儿 ——
// 不把「已经能关的一层」再报告给上面一层去猜。
import { PwaEdgeSwipeBack } from "./MobileGestures";

export interface MobileRightPanelItem {
  /** 稳定 id：切块只比它，不比下标。 */
  key: string;
  /** 图标集里的字形名（M-12 与桌面 D-05 同一批）。 */
  icon: string;
  /** 块名（轨迹 / 文件 / 终端 / 浏览器 / Git / 审查）。 */
  label: string;
  /** 这一路的现状一句话，写在 `.m-sheet-row-desc`。 */
  description: string;
  /**
   * fork:v5-frame-audit —— 点这一行时、进全屏层**之前**要先做的事（通常是
   * 「把还没开的块打开」：轨迹 / Git 这类单例布尔块关着也在选单里，M-12 帧 A
   * 的六项常驻）。选完即走，所以在同一个点击里先跑它再 `enter(key)`。
   */
  onSelect?: () => void;
  /** 行尾徽章 / 状态点（`.m-badge` / `.m-dot`）。 */
  trailing?: ReactNode;
  /** 正文：只有进入那一块时才调用，切块不重新挂载别的块。 */
  render: () => ReactNode;
  /**
   * fork:v5-landing E4 —— 这一块的容器类，缺省 `.m-panel-scroll`（M-12 帧 B/C/D 的
   * 六个 pane 共用同一种「唯一纵向滚动区」）。终端那一块传 M-06 帧 C 的
   * `.m-term-mobile`（终端容器：等宽 / code 底 / 自身滚动）—— 两个类**同时挂**
   * 在一个节点上是有意的：`.m-term-mobile` 给外观，`.m-panel-scroll` 给
   * `display:flex / flex-direction:column / min-height:0`（xterm 靠这三条拿到高度，
   * 缺了它终端会塔成 0 高）；两边都是库里的类，没有自造值。
   */
  containerClassName?: string;
}

export interface MobileRightPanelsProps {
  items: MobileRightPanelItem[];
  /** 入口钮与底部面板标题（与桌面 `panel-right` 同义）。 */
  title: string;
  /** 底部面板脚注（解释「为什么不是六个常驻页签」）。不给就用库里的 M-12 原文。 */
  footNote?: string;
  /** 分组标题那一行；不给就不渲染这一行。 */
  listLabel?: string;
  /** 层内底部常驻那句。 */
  layerNote?: string;
  /** 关闭整层回会话。 */
  closeLabel: string;
  /** 入口钮的接线 class（定位用，可选）。 */
  triggerClassName?: string;
  /** 入口钮之外还想带的东西（AppShell 的会话信息钮等）。 */
  trailing?: ReactNode;
}

export function MobileRightPanels({
  items,
  title,
  footNote,
  listLabel,
  layerNote,
  closeLabel,
  triggerClassName,
  trailing,
}: MobileRightPanelsProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  /* fork:v5-frame-audit —— M-12 帧 A 的 `.m-group-title` 与 `.m-sheet-foot`：
     接线层（AppShell）原来两行都没给，于是这块面板少了两句话 ——
     「选一块进入」是使用规则，「不做常驻页签」是取舍说明。调用方仍可覆盖。 */
  const groupTitle = listLabel ?? t("pwa.rightPanels.groupTitle");
  const sheetFoot = footNote ?? t("pwa.rightPanels.footNote");

  const closeAll = useCallback(() => {
    setSheetOpen(false);
    setOpenKey(null);
  }, []);

  // 选完一块：底部面板收起，同一个全屏层接管（M-12 帧 A → 帧 B）。
  const enter = useCallback((key: string) => {
    setSheetOpen(false);
    setOpenKey(key);
  }, []);

  // Esc：先关全屏层，再关底部面板（两层都在时按 Esc 只退一层）。
  useEffect(() => {
    if (!sheetOpen && !openKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      if (openKey) setOpenKey(null);
      else setSheetOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openKey, sheetOpen]);

  const layerItem = openKey ? items.find((item) => item.key === openKey) ?? null : null;
  const layerOpen = layerItem !== null;

  if (typeof document === "undefined") return null;

  return (
    <>
      {/* 帧 A · 入口：会话页顶栏右侧只放这一枚（与桌面 D-05 / D-01 同义）。 */}
      <button
        type="button"
        className={`m-top-btn${triggerClassName ? ` ${triggerClassName}` : ""}`}
        title={title}
        aria-label={title}
        aria-expanded={sheetOpen}
        aria-haspopup="dialog"
        onClick={() => setSheetOpen((open) => !open)}
      >
        <i data-ico="panel-right" data-size="16" aria-hidden="true"></i>
      </button>
      {trailing}

      {(sheetOpen || layerOpen) && createPortal(
        <div
          /* 只承载层级摆放（fixed 全屏宿主 + 层级），其余一律来自 system.css。 */
          style={{ position: "fixed", inset: 0, zIndex: "var(--nx-z-modal)", pointerEvents: "none" }}
        >
          {sheetOpen && (
            <>
              {/* 宿主是 pointer-events:none 的全屏层，只有这三块接手指（接线层）。 */}
              <div className="m-scrim is-open" style={{ pointerEvents: "auto" }} onClick={() => setSheetOpen(false)} />
              <div className="m-sheet is-open" role="dialog" aria-label={title} style={{ pointerEvents: "auto" }}>
                {/* 抓手也是一枚「点一下即收」的钮（div→button 的既定换法）；
                    命中区在 `app/design/v5-forms.css` 的接线层放大。 */}
                <button
                  type="button"
                  className="m-sheet-grab"
                  aria-label={t("chat.close")}
                  onClick={() => setSheetOpen(false)}
                />
                <div className="m-sheet-title">{title}</div>
                <div className="m-sheet-body">
                  <div className="m-group-title">{groupTitle}</div>
                  {items.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className="m-sheet-row"
                      onClick={() => {
                        item.onSelect?.();
                        enter(item.key);
                      }}
                    >
                      <i data-ico={item.icon} data-size="16" aria-hidden="true"></i>
                      <span className="m-setrow-body">
                        <span className="m-setrow-t">{item.label}</span>
                        <span className="m-sheet-row-desc">{item.description}</span>
                      </span>
                      {item.trailing}
                    </button>
                  ))}
                </div>
                {sheetFoot ? <div className="m-sheet-foot">{sheetFoot}</div> : null}
              </div>
            </>
          )}

          {layerItem && (
            <div
              className="m-viewer is-open"
              ref={layerRef}
              role="dialog"
              aria-label={layerItem.label}
              style={{ pointerEvents: "auto" }}
            >
              {/* M-11 帧 A-2 —— 左缘 28px 侧滑返回：松手就是这一层的「返回」，
                  与右上角那枚 × 是同一个动作（板面原话：手势不可发现，所以必须有
                  一个常驻的等价入口，而它就是这枚 ×）。 */}
              <PwaEdgeSwipeBack onBack={closeAll} target={layerItem.label} />
              <div className="m-viewer-bar">
                <div className="m-cats compact m-grow" role="tablist" aria-label={title}>
                  {items.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      role="tab"
                      aria-selected={item.key === layerItem.key}
                      className={`m-cat${item.key === layerItem.key ? " is-on" : ""}`}
                      title={item.label}
                      aria-label={item.label}
                      onClick={() => setOpenKey(item.key)}
                    >
                      <i data-ico={item.icon} data-size="15" aria-hidden="true"></i>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="m-top-btn"
                  title={closeLabel}
                  aria-label={closeLabel}
                  onClick={closeAll}
                >
                  <i data-ico="x" data-size="15" aria-hidden="true"></i>
                </button>
              </div>

              {/* 六块共用这一层：只有当前块挂载，切块只换内容。
                  M-12 帧 B/D 的终端 pane 把正文指向 M-06 帧 C —— 那一帧的容器就是
                  `.m-term-mobile`（`.m-cats` 的图标名也是同一批：terminal / square-terminal）。 */}
              {items.map((item) => (
                <section
                  key={item.key}
                  className={
                    item.containerClassName
                      ?? (item.icon === "terminal" || item.icon === "square-terminal"
                        ? "m-panel-scroll m-term-mobile"
                        : "m-panel-scroll")
                  }
                  hidden={item.key !== layerItem.key}
                  aria-label={item.label}
                >
                  {item.key === layerItem.key ? item.render() : null}
                </section>
              ))}

              <div className="m-vbar">
                <span className="m-grow m-t-xs m-t-faint">{layerNote}</span>
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

export default MobileRightPanels;