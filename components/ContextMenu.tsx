"use client";

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { enteredClass, useTwoPhaseEnter } from "@/hooks/useTwoPhaseEnter";
// fork:v5-wave-b-2026-10-04 —— 形态判据。≤640 才挂 m-*，与
// `app/design/v5-forms.css` 给 pwa/system.css 的 @import 媒体条件同一个断点；
// 641–1024 的平板档仍然是 d-* DOM（写成 useIsCompact 会让平板掉进 PWA 形态）。
import { useIsMobile } from "@/hooks/useIsMobile";

/**
 * Generic right-click / dropdown menu.
 *
 * Renders into a portal on `document.body` so it always floats above every
 * panel and stacking context, and any component under the provider can open it:
 *
 *   const { openMenu } = useContextMenu();
 *   openMenu(event.clientX, event.clientY, [{ label: "Copy", onSelect: copy }]);
 *
 * Behaviour (each of these was previously missing from the one hand-rolled menu
 * this replaces):
 *  - follows the pointer and flips at the viewport edges;
 *  - closes on outside click, Escape, user wheel/touch scroll, `window.blur` and
 *    `resize` — but **not** on programmatic scroll, so a streaming chat that
 *    auto-scrolls under the menu does not dismiss it;
 *  - keyboard navigation (↑/↓, Home/End, Enter/Space);
 *  - `feedbackLabel` briefly replaces the label after a select (e.g. "Copied")
 *    before the menu closes itself;
 *  - submenus are limited to one level **by the type**, so a nested flyout is
 *    impossible to express.
 *
 * fork:v5-wave-b-2026-10-04 —— 窄屏（≤640）分支照画板 **M-04 帧 C** 的菜单件抄：
 *   外壳 `m-pop-float.is-open`（PWA 浮层）+ 行 `m-menu-row` + 分隔 `m-sep`，
 *   文字弱化用 `m-t-faint` / `m-t-xs`。桌面分支逐字不动。
 *   为什么不整套换成 `.m-menu-sheet`（底部升起那一档）：那份是「长按会话行就地
 *   升起」的形态，会把**所有**右键/下拉菜单的锚点从指针位置改成屏幕底边 ——
 *   那是行为变更，不在本次换皮的范围内（见汇报的需配合项）。这里只换件，
 *   定位、翻转、键盘导航、反馈标签与关闭时机全部不变。
 */

export interface ContextMenuItem {
  /** Discriminant for the entry union; callers never need to set it. */
  type?: "item";
  label: string;
  icon?: ReactNode;
  /** Render the label in the danger colour (destructive actions). */
  danger?: boolean;
  disabled?: boolean;
  /** Native tooltip, e.g. explaining why an item is disabled. */
  title?: string;
  /** Label shown for a moment after selecting, before the menu closes. */
  feedbackLabel?: string;
  /** Show a check mark in the icon slot (the currently active option). */
  checked?: boolean;
  /** Right-aligned secondary text (e.g. a count). */
  hint?: ReactNode;
  /**
   * One level of nested options, rendered as a flyout. Nested submenus are not
   * rendered, and the type forbids them.
   */
  submenu?: Omit<ContextMenuItem, "submenu">[];
  onSelect?: () => void | Promise<void>;
}

export type ContextMenuEntry = ContextMenuItem | { type: "separator" };

interface MenuState {
  x: number;
  y: number;
  entries: ContextMenuEntry[];
  /** 画板 D-02c 帧 A「结构件」与 D-02d 帧 D：浮窗顶部的分组标题（可选）。 */
  title?: string;
  /** 脚注：一句话说明这个菜单为什么这么收着（可选）。 */
  footer?: string;
  /**
   * fork:v5-frame-audit-2026-10-05 —— 长菜单顶部的搜索头
   * （画板 D-02c 帧 A「搜索头」/ 帧 C「新建任务选择器」/ 「标签页总览」：
   * `<div class="d-searchfield"><i search><input …></div>` 钉在浮窗顶上，不随内容滚）。
   * `match` 决定一行在当前查询词下留不留；不传 `match` 就只渲染搜索框不过滤。
   */
  search?: { placeholder: string; match: (label: string, query: string) => boolean };
}

interface ContextMenuApi {
  openMenu: (x: number, y: number, entries: ContextMenuEntry[], chrome?: {
    title?: string;
    footer?: string;
    search?: { placeholder: string; match: (label: string, query: string) => boolean };
  }) => void;
  closeMenu: () => void;
}

const ContextMenuContext = createContext<ContextMenuApi | null>(null);

const MENU_MARGIN = 6;
const MIN_WIDTH = 168;
const FEEDBACK_MS = 1200;
const CLOSE_ANIMATION_MS = 90;

export function useContextMenu(): ContextMenuApi {
  const context = useContext(ContextMenuContext);
  if (!context) {
    throw new Error("useContextMenu must be used inside a <ContextMenuProvider>");
  }
  return context;
}

function isSeparator(entry: ContextMenuEntry): entry is { type: "separator" } {
  return (entry as { type?: string }).type === "separator";
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // fork:ui-01 — two-phase enter: the menu mounts invisible and picks up
  // `context-menu--entered` one frame later, which is what lets the CSS
  // transition (fork-ui.css) actually play instead of the menu popping in.
  const entered = useTwoPhaseEnter(Boolean(menu));
  const [feedbackIndex, setFeedbackIndex] = useState(-1);
  // fork:v5-frame-audit-2026-10-05 —— 搜索头里的查询词。
  const [query, setQuery] = useState("");
  const [submenuIndex, setSubmenuIndex] = useState<number | null>(null);
  const [submenuPos, setSubmenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // fork:v5-wave-b-2026-10-04 —— 窄屏换 m-* 件；宽屏仍是 d-*。
  const isMobile = useIsMobile();

  const clearTimers = useCallback(() => {
    if (feedbackTimer.current) {
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const closeMenu = useCallback(() => {
    clearTimers();
    setSubmenuIndex(null);
    setSubmenuPos(null);
    setFeedbackIndex(-1);
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setClosing(false);
      setMenu(null);
      setPos(null);
      setActiveIndex(-1);
    }, CLOSE_ANIMATION_MS);
  }, [clearTimers]);

  const openMenu = useCallback((x: number, y: number, entries: ContextMenuEntry[], chrome?: {
    title?: string;
    footer?: string;
    search?: { placeholder: string; match: (label: string, query: string) => boolean };
  }) => {
    clearTimers();
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setClosing(false);
    setSubmenuIndex(null);
    setSubmenuPos(null);
    setFeedbackIndex(-1);
    setActiveIndex(-1);
    setMenu({ x, y, entries, title: chrome?.title, footer: chrome?.footer, search: chrome?.search });
    // 每次打开都清空上一次查询词（画板 D-02c 帧 C：别让人以为列表被过滤坏了）。
    setQuery("");
    // Provisional position; useLayoutEffect re-measures and flips.
    setPos({ x, y });
  }, [clearTimers]);

  // Measure the rendered menu and flip it at the viewport edges, so a right-click
  // near the bottom-right corner does not open a menu that runs off-screen.
  // layout size (offsetWidth/Height), NOT getBoundingClientRect: the enter
  // transition scales the layer to 0.98, and a rect measured mid-transition is
  // ~2% short, which lands the clamped position a couple of pixels over the
  // edge once the scale finishes (measured on a 390x844 viewport).
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const menuWidth = menuRef.current.offsetWidth;
    const menuHeight = menuRef.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = Math.max(MENU_MARGIN, Math.min(menu.x, vw - menuWidth - MENU_MARGIN));
    const y = Math.max(MENU_MARGIN, Math.min(menu.y, vh - menuHeight - MENU_MARGIN));
    setPos((current) => (current && current.x === x && current.y === y ? current : { x, y }));
  }, [menu]);

  // Dismissal. Note the deliberate asymmetry on scroll: a real wheel/touch
  // gesture closes the menu (the anchor is no longer where the user pointed),
  // but a programmatic scroll does not — otherwise a streaming transcript would
  // tear the menu away mid-click.
  useEffect(() => {
    if (!menu) return;

    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      }
    };
    const onUserScroll = (event: Event) => {
      // fork:ui-projectchip-fix — 只有**真的滚动**才关菜单。触控板与 Magic Mouse
      // 在指针移动时会喷出 deltaY=0/±1 的 wheel 事件，原来一律 closeMenu()，
      // 表现就是「鼠标一动浮窗就没了」。阈值取 8px：小于它的当成抖动。
      if (event.type === "touchmove") {
        closeMenu();
        return;
      }
      const wheel = event as WheelEvent;
      const delta = Math.abs(wheel.deltaX) + Math.abs(wheel.deltaY);
      if (delta >= 8) closeMenu();
    };
    const onBlur = () => closeMenu();
    const onResize = () => closeMenu();

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("wheel", onUserScroll, { passive: true, capture: true });
    window.addEventListener("touchmove", onUserScroll, { passive: true, capture: true });
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("wheel", onUserScroll, { capture: true });
      window.removeEventListener("touchmove", onUserScroll, { capture: true });
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
    };
  }, [menu, closeMenu]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  if (typeof document === "undefined") {
    return <ContextMenuContext.Provider value={{ openMenu, closeMenu }}>{children}</ContextMenuContext.Provider>;
  }

  const selectableIndexes = menu
    ? menu.entries
      .map((entry, index) => (isSeparator(entry) || entry.disabled ? -1 : index))
      .filter((index) => index >= 0)
    : [];

  const move = (delta: number) => {
    if (selectableIndexes.length === 0) return;
    const currentSlot = selectableIndexes.indexOf(activeIndex);
    const nextSlot = currentSlot === -1
      ? (delta > 0 ? 0 : selectableIndexes.length - 1)
      : (currentSlot + delta + selectableIndexes.length) % selectableIndexes.length;
    setActiveIndex(selectableIndexes[nextSlot]);
    setSubmenuIndex(null);
  };

  const runItem = async (entry: ContextMenuItem, index: number) => {
    if (entry.disabled) return;
    if (entry.submenu && entry.submenu.length > 0) {
      setSubmenuIndex((current) => (current === index ? null : index));
      return;
    }
    if (!entry.onSelect) {
      closeMenu();
      return;
    }
    if (entry.feedbackLabel) {
      setFeedbackIndex(index);
    }
    try {
      await entry.onSelect();
    } catch {
      // A rejecting action (e.g. a denied clipboard write) must not escape as an
      // unhandled rejection; the menu still closes the way it always does.
    } finally {
      if (entry.feedbackLabel) {
        feedbackTimer.current = setTimeout(() => closeMenu(), FEEDBACK_MS);
      } else {
        closeMenu();
      }
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(1); break;
      case "ArrowUp": event.preventDefault(); move(-1); break;
      case "Home":
      case "End": {
        event.preventDefault();
        if (selectableIndexes.length === 0) break;
        // Jump straight to the end slot: going through `move()` wraps back to the
        // current slot once anything is active, which made Home/End no-ops.
        setActiveIndex(event.key === "Home"
          ? selectableIndexes[0]
          : selectableIndexes[selectableIndexes.length - 1]);
        setSubmenuIndex(null);
        break;
      }
      case "Enter":
      case " ": {
        if (activeIndex < 0 || !menu) return;
        const entry = menu.entries[activeIndex];
        if (!entry || isSeparator(entry)) return;
        event.preventDefault();
        void runItem(entry, activeIndex);
        break;
      }
      default:
        break;
    }
  };

  // key → 索引，供反馈标签与 runItem 用（子菜单行不在 entries 索引里，传 -1）。
  const entryIndexByKey = new Map<string, number>();
  menu?.entries.forEach((entry, index) => {
    if (!isSeparator(entry)) entryIndexByKey.set(`${(entry as ContextMenuItem).label}-${index}`, index);
  });

  const renderEntryIcon = (entry: ContextMenuItem) => {
    // 画板 D-02c 帧 A：选中行 = 图标位换 check；危险行的颜色由 `.d-menu-row.danger`
    // 给（文字色），lucide 图标用 currentColor 跟着继承，不需要再内联。
    if (entry.checked) {
      return <i data-ico="check" data-size="14" aria-hidden="true"></i>;
    }
    if (entry.icon) {
      return entry.icon;
    }
    return null;
  };

  const renderRow = (entry: ContextMenuItem, key: string, opts: {
    index?: number;
    isActive?: boolean;
    hasSubmenu?: boolean;
    submenuOpen?: boolean;
    onActivate?: (el: HTMLButtonElement) => void;
  }) => {
    const danger = Boolean(entry.danger);
    const index = opts.index ?? -1;
    const trailing = entry.hint !== undefined || opts.hasSubmenu;
    return (
      <button
        key={key}
        type="button"
        role="menuitem"
        /* fork:v5-landing —— 行原子 = 画板 D-02c 帧 A 的 `.d-menu-row`：
           禁用 = `disabled` + 字弱化（`.d-menu-row:disabled` + `d-t-faint`），
           危险 = `.danger`（文字转红，不是红底）。键盘高亮沿用同族行惯用的 `is-on`
           （system.css 暂无 `.d-menu-row.is-on`，与 ComposerReferenceMenu/ChatInput 一致；
           选中项的「对勾」由 icon 槽给）。
           fork:v5-wave-b-2026-10-04 —— 窄屏换成 M-04 帧 C 的 `.m-menu-row`
           （同形状：图标槽 + 文字 + 右端 chevron；`.danger` / `.is-on` 同义）。 */
        className={`${isMobile ? "m-menu-row" : "d-menu-row"}${opts.isActive ? " is-on" : ""}${danger ? " danger" : ""}`}
        style={{ width: "100%" }}
        aria-haspopup={opts.hasSubmenu ? "menu" : undefined}
        aria-expanded={opts.hasSubmenu ? Boolean(opts.submenuOpen) : undefined}
        aria-disabled={entry.disabled || undefined}
        disabled={entry.disabled}
        title={entry.title}
        onMouseEnter={opts.onActivate ? (event) => opts.onActivate!(event.currentTarget) : undefined}
        onClick={() => void runItem(entry, index)}
      >
        {renderEntryIcon(entry)}
        {/* fork:v5-frame-audit-2026-10-05 —— 文字格用库里的 `.d-grow`（flex:1 / min-width:0），
            与画板 D-02c 帧 A 的 `<span class="d-grow">文字</span>` 一致；原来是一枚
            无类 span 靠内联 flex 复刻同一件事（同一个值两个来源）。 */}
        <span
          className={[
            isMobile ? "m-grow" : "d-grow",
            entry.disabled ? (isMobile ? "m-t-faint" : "d-t-faint") : "",
          ].filter(Boolean).join(" ")}
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", ...(trailing ? { flex: "1 1 auto" } : {}) }}
        >
          {feedbackIndex === index && entry.feedbackLabel ? entry.feedbackLabel : entry.label}
        </span>
        {entry.hint !== undefined && (
          <span
            className={isMobile ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"}
            style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
          >{entry.hint}</span>
        )}
        {opts.hasSubmenu && (
          <i data-ico="chevron-right" data-size="14" aria-hidden="true"></i>
        )}
      </button>
    );
  };

  return (
    <ContextMenuContext.Provider value={{ openMenu, closeMenu }}>
      {children}
      {menu && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          aria-label="Context menu"
          /* fork:v5-wave-b-2026-10-04 —— 窄屏外壳 = 画板 M-04 帧 C 的 `.m-pop-float`
             （`.is-open` 是它唯一的显形开关，与 `display:none` 成对）。
             `.m-pop-float` 自带 `left/right: var(--nx-sp-3)`（那是底部面板那种
             贴边浮层的写法），而本菜单是跟随指针的：所以 `right:"auto"` 与
             `position:"fixed"` 作为**几何定位**内联（铁律四允许），top/left 沿用
             视口翻转算出来的那个值。背景 / 描边 / 圆角 / 阴影 / 内边距全在库里。 */
          className={`${isMobile ? "m-pop-float" : "d-pop-float"} is-open ${enteredClass("context-menu", entered)}${closing ? " is-closing" : ""}`}
          style={{
            ...(isMobile ? { position: "fixed", right: "auto" } : null),
            top: pos.y,
            left: pos.x,
            minWidth: MIN_WIDTH,
            maxWidth: "min(360px, calc(100vw - 12px))",
          }}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={onMenuKeyDown}
        >
          {/* fork:v5-frame-audit-2026-10-05 —— 三块结构件补上（画板 D-02c 帧 A「结构件·
              标题 / 分隔 / 搜索头 / 脚注」、D-02d 帧 D 会话动作菜单）：顶部搜索头
              `.d-searchfield`、分组标题 `.d-pop-title` 与底部脚注 `.d-pop-foot`
              都在板面上，产品此前只有行与分隔线。不给就不渲染，所以不受影响的那
              一批菜单（右键会话行等）仍与板面一致。 */}
          {menu.search && (
            <div className="d-searchfield" style={{ margin: "0 var(--nx-sp-1) var(--nx-sp-1)", flexShrink: 0 }}>
              <i data-ico="search" data-size="13" aria-hidden="true"></i>
              <input
                value={query}
                placeholder={menu.search.placeholder}
                aria-label={menu.search.placeholder}
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") { event.stopPropagation(); closeMenu(); }
                }}
              />
            </div>
          )}
          {menu.title && <div className="d-pop-title">{menu.title}</div>}
          {menu.entries.map((entry, index) => {
            if (isSeparator(entry)) {
              return <div key={`sep-${index}`} role="separator" className={isMobile ? "m-sep" : "d-sep"} />;
            }
            const item = entry as ContextMenuItem;
            const q = query.trim().toLowerCase();
            if (q && menu.search && !menu.search.match(item.label, q)) return null;
            const hasSubmenu = Boolean(item.submenu && item.submenu.length > 0);
            const key = `${item.label}-${index}`;
            // fork:v5-frame-audit-2026-10-05 —— 去掉每个条目外面那层无类 `div`：
            // 板面上行 / 分隔线 / 子菜单都是浮窗的**直接子节点**，多一层壳会让
            // 「行件 = 一个 flex 行」的网格对不上（也不该多一个盒子）。
            return (
              <Fragment key={key}>
                {renderRow(item, key, {
                  index,
                  isActive: index === activeIndex,
                  hasSubmenu,
                  submenuOpen: submenuIndex === index,
                  onActivate: (el) => {
                    setActiveIndex(index);
                    if (hasSubmenu) {
                      const rect = el.getBoundingClientRect();
                      setSubmenuIndex(index);
                      setSubmenuPos({ x: rect.right - 4, y: rect.top - 5 });
                    } else {
                      setSubmenuIndex(null);
                    }
                  },
                })}

                {hasSubmenu && submenuIndex === index && submenuPos && (
                  <div
                    role="menu"
                    className={`${isMobile ? "m-pop-float" : "d-pop-float"} is-open context-menu context-menu-submenu`}
                    style={{
                      ...(isMobile ? { position: "fixed", right: "auto" } : null),
                      top: submenuPos.y,
                      left: submenuPos.x,
                      minWidth: MIN_WIDTH - 24,
                      maxWidth: "min(320px, calc(100vw - 12px))",
                    }}
                    onMouseLeave={() => setSubmenuIndex(null)}
                  >
                    {item.submenu!.map((sub, subIndex) => (
                      renderRow(sub, `sub-${key}-${subIndex}`, {})
                    ))}
                  </div>
                )}
              </Fragment>
            );
          })}
          {menu.footer && <div className="d-pop-foot">{menu.footer}</div>}
        </div>,
        document.body,
      )}
    </ContextMenuContext.Provider>
  );
}
