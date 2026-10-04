"use client";

import type { CSSProperties, MutableRefObject, RefObject } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { ComposerReferenceItem, ComposerReferenceKind } from "@/lib/composer-references";

/*
 * fork:gap06-references — `&` 会话 / `#` MCP / `~` 待办 的建议浮层。
 *
 * fork:v5-skin D-04 帧 B —— 外壳与行换画板 DOM：.d-pop-float（浮层容器）
 *   + .d-pop-title（标题行）+ .d-kbd（Tab/Enter 提示）+ .d-menu-row(.is-on)；
 *   图标一律 <i data-ico>（会话 message-square / MCP plug / 待办 list-todo），
 *   不再手绘 SVG。定位仍由 SHELL 给（贴 composer 上沿、同宽）。
 *
 * 与 `@` 文件菜单（`ChatInput.tsx` 内联的那段 JSX）是**同一个视觉外壳**。
 */

interface Props {
  kind: ComposerReferenceKind;
  items: ComposerReferenceItem[];
  activeIndex: number;
  loading: boolean;
  /** 由 `subscribeUpwardMenuMaxHeight` 量出来的可用高度（null = 用默认上限）。 */
  maxHeight: number | null;
  menuRef: RefObject<HTMLDivElement | null>;
  itemRefs: MutableRefObject<(HTMLButtonElement | null)[]>;
  onHover: (index: number) => void;
  onPick: (item: ComposerReferenceItem) => void;
}

const SHELL: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: "calc(100% + 8px)",
  zIndex: 120,
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
};

/** 三类行对应的画板图标（lucide，走 data-ico）。 */
function referenceIcon(kind: ComposerReferenceKind): string {
  if (kind === "session") return "message-square";
  if (kind === "mcp") return "plug";
  return "list-todo";
}

/** 行的第二段（副标题）：会话给 cwd，MCP 给作用域+传输方式，待办给 id。 */
function itemDetail(item: ComposerReferenceItem): string | undefined {
  if (item.kind === "session") return item.cwd;
  if (item.kind === "mcp") return [item.scope, item.transport].filter(Boolean).join(" · ") || undefined;
  return `#${item.id}`;
}

/** 一行的图标 + 标题 + 副行，桌面是 `.d-menu-row` 的一段、窄屏是 `.m-sheet-row` 的一段。
    同一份内容（标题 / 副行 / 两个状态标记），两种基件。 */
function rowBody(item: ComposerReferenceItem, isMobile: boolean, t: (key: string) => string) {
  const detail = itemDetail(item);
  const title = item.kind === "todo" ? item.text : item.kind === "mcp" ? item.name : item.title;
  // 判据先落到局部量上，顺带把联合类型收窄（disabled 只在 mcp 上、done 只在 todo 上）。
  const disabled = item.kind === "mcp" && item.disabled;
  const done = item.kind === "todo" && item.done;
  if (isMobile) {
    const note = [
      detail,
      disabled ? t("chat.referenceDisabled") : "",
      done ? t("chat.referenceTodoDone") : "",
    ].filter(Boolean).join(" · ");
    return (
      <>
        <i data-ico={referenceIcon(item.kind)} data-size="16"></i>
        <span className="m-setrow-body">
          <span className="m-setrow-t">{title}</span>
          {note && <span className="m-sheet-row-desc">{note}</span>}
        </span>
      </>
    );
  }
  return (
    <>
      <i data-ico={referenceIcon(item.kind)} data-size="14"></i>
      <span className="d-grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </span>
      {detail && (
        <span
          className="d-t-xs d-t-faint"
          style={{ flexShrink: 0, maxWidth: "45%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {detail}
        </span>
      )}
      {disabled && <span className="d-t-xs d-t-faint" style={{ flexShrink: 0 }}>{t("chat.referenceDisabled")}</span>}
      {done && <span className="d-t-xs d-t-faint" style={{ flexShrink: 0 }}>{t("chat.referenceTodoDone")}</span>}
    </>
  );
}

export function ComposerReferenceMenu({
  kind,
  items,
  activeIndex,
  loading,
  maxHeight,
  menuRef,
  itemRefs,
  onHover,
  onPick,
}: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const countLabel = items.length === 1 ? t("chat.match") : t("chat.matches", { count: items.length });
  const titleKey = kind === "session"
    ? "chat.referenceSessions"
    : kind === "mcp"
      ? "chat.referenceMcp"
      : "chat.referenceTodos";

  /* fork:v5-wave-b —— 窄屏（PWA 形态）换 M-03 帧 D-1 的那一块：
     外壳 `.m-pop-float is-open`（从输入卡上方落下，定位壳与桌面同一套），
     标题 `.m-pop-title`，一行一个候选用 `.m-sheet-row`（`.is-on` 是选中态），
     空态与「未连接 / 已完成」的处理与桌面逐字一致。 */
  if (isMobile) {
    return (
      <div
        ref={menuRef}
        className="m-pop-float is-open"
        role="listbox"
        aria-label={t(titleKey, { label: countLabel })}
        style={{
          ...SHELL,
          maxHeight: maxHeight === null
            ? "min(56vh, 420px)"
            : `min(56vh, 420px, ${maxHeight}px)`,
        }}
      >
        <div className="m-pop-title">
          {loading ? t("chat.referenceLoading") : t(titleKey, { label: countLabel })}
        </div>
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
          {!loading && items.length === 0 ? (
            <div className="m-sheet-row m-t-xs m-t-faint">{t("chat.referenceEmpty")}</div>
          ) : (
            items.map((item, index) => {
              const active = index === activeIndex;
              const disabled = item.kind === "mcp" && item.disabled;
              return (
                <button
                  key={item.kind === "session" ? `s:${item.id}` : item.kind === "mcp" ? `m:${item.name}` : `t:${item.id}`}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onPick(item);
                  }}
                  onMouseEnter={() => onHover(index)}
                  className={`m-sheet-row${active ? " is-on" : ""}`}
                  style={{ opacity: disabled ? 0.5 : 1 }}
                >
                  {rowBody(item, true, t)}
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="d-pop-float"
      role="listbox"
      aria-label={t(titleKey, { label: countLabel })}
      style={{
        ...SHELL,
        maxHeight: maxHeight === null
          ? "min(48vh, 400px)"
          : `min(48vh, 400px, ${maxHeight}px)`,
      }}
    >
      <div className="d-pop-title" style={{ display: "flex", alignItems: "center", gap: "var(--nx-sp-2)", flexShrink: 0 }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {loading ? t("chat.referenceLoading") : t(titleKey, { label: countLabel })}
        </span>
        <span className="d-grow" />
        <span className="d-kbd">{t("chat.tabEnter")}</span>
      </div>
      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "0 var(--nx-sp-1) var(--nx-sp-1)" }}>
        {!loading && items.length === 0 ? (
          <div className="d-pop-body d-t-xs d-t-faint">{t("chat.referenceEmpty")}</div>
        ) : (
          items.map((item, index) => {
            const active = index === activeIndex;
            const disabled = item.kind === "mcp" && item.disabled;
            return (
              <button
                key={item.kind === "session" ? `s:${item.id}` : item.kind === "mcp" ? `m:${item.name}` : `t:${item.id}`}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPick(item);
                }}
                onMouseEnter={() => onHover(index)}
                className={`d-menu-row${active ? " is-on" : ""}`}
                style={{
                  width: "100%",
                  // 画板 21 的「未连接」行：整行弱化。
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                {rowBody(item, false, t)}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
