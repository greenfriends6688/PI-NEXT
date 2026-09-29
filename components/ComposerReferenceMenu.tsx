"use client";

import type { CSSProperties, MutableRefObject, RefObject } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ComposerReferenceItem, ComposerReferenceKind } from "@/lib/composer-references";

/*
 * fork:gap06-references — `&` 会话 / `#` MCP / `~` 待办 的建议浮层。
 *
 * 与 `@` 文件菜单（`ChatInput.tsx` 内联的那段 JSX）是**同一个视觉外壳**：
 * 位置、圆角、阴影、头部提示行都对齐，因为它们会出现在同一个位置、被同一组按键驱动。
 * 区别只在行内容 —— 文件菜单是「路径 + 文件图标」，这里是三类各不相同的行。
 *
 * 抽成独立组件（而不是继续往 ChatInput 里塞第四段内联 JSX）是本仓补丁约定的第 2 条：
 * 新能力放进新文件，上游文件只留接线。ChatInput 因此只多了些状态和一次渲染。
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

/* fork:design-system SW-02 —— 外壳与行换画板 21 的 pw-pop / pw-pop-title /
   pw-prow(.is-on) / pw-desc：定位仍由 SHELL 给（贴 composer 上沿、同宽），
   视觉全部来自 board.css。 */
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




/** 三类行的前置图标，沿用应用内手写 SVG 的既有词汇（不引图标依赖）。 */
function ReferenceIcon({ item }: { item: ComposerReferenceItem }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (item.kind === "session") {
    return (
      <svg {...common}>
        <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
      </svg>
    );
  }
  if (item.kind === "mcp") {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="7" rx="2" />
        <rect x="3" y="13" width="18" height="7" rx="2" />
        <path d="M7 7.5h.01M7 16.5h.01" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="m4 6 2 2 3-4M13 7h7M4 17l2 2 3-4M13 18h7" />
    </svg>
  );
}

/** 行的第二段（副标题）：会话给 cwd，MCP 给作用域+传输方式，待办给 id。 */
function itemDetail(item: ComposerReferenceItem): string | undefined {
  if (item.kind === "session") return item.cwd;
  if (item.kind === "mcp") return [item.scope, item.transport].filter(Boolean).join(" · ") || undefined;
  return `#${item.id}`;
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
  const countLabel = items.length === 1 ? t("chat.match") : t("chat.matches", { count: items.length });
  const titleKey = kind === "session"
    ? "chat.referenceSessions"
    : kind === "mcp"
      ? "chat.referenceMcp"
      : "chat.referenceTodos";

  return (
    <div
      ref={menuRef}
      className="pw-pop anim-popover"
      role="listbox"
      aria-label={t(titleKey, { label: countLabel })}
      style={{
        ...SHELL,
        maxHeight: maxHeight === null
          ? "min(48vh, 400px)"
          : `min(48vh, 400px, ${maxHeight}px)`,
      }}
    >
      <div className="pw-pop-title" style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {loading ? t("chat.referenceLoading") : t(titleKey, { label: countLabel })}
        </span>
        <span className="grow" />
        <span className="pw-kbd">{t("chat.tabEnter")}</span>
      </div>
      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "0 4px 4px" }}>
        {!loading && items.length === 0 ? (
          <div className="pw-prow pw-desc">{t("chat.referenceEmpty")}</div>
        ) : (
          items.map((item, index) => {
            const active = index === activeIndex;
            const detail = itemDetail(item);
            const disabled = item.kind === "mcp" && item.disabled;
            const done = item.kind === "todo" && item.done;
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
                className={`pw-prow${active ? " is-on" : ""}`}
                style={{
                  width: "100%",
                  // 画板 21 的「未连接」行：整行弱化。
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                <span className="pw-ico" style={{ flexShrink: 0 }}>
                  <ReferenceIcon item={item} />
                </span>
                <span className="grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.kind === "todo" ? item.text : item.kind === "mcp" ? item.name : item.title}
                </span>
                {detail && (
                  <span
                    className="pw-desc"
                    style={{
                      flexShrink: 0,
                      maxWidth: "45%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {detail}
                  </span>
                )}
                {disabled && <span className="pw-desc" style={{ flexShrink: 0 }}>{t("chat.referenceDisabled")}</span>}
                {done && <span className="pw-desc" style={{ flexShrink: 0 }}>{t("chat.referenceTodoDone")}</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
