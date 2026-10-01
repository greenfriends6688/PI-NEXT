"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";

/*
 * fork:zc-02 — the in-conversation find bar (⌘F), mounted by ChatWindow.
 *
 * Why a custom bar instead of the browser's native find: native find cannot
 * count model-level hits that live outside the paged render window, cannot walk
 * the "load earlier" flow to reach them, and its selection model fights this
 * app's per-message memoization. This component owns only the input, counter
 * and stepper. Searching, paging and painting live in lib/conversation-find.ts
 * and ChatWindow so the bar stays small and the pure logic stays testable.
 *
 * Focus contract: ChatWindow stores the element that had focus before opening
 * and restores it on close; this bar only autofocuses its input (and refocuses
 * when ChatWindow bumps `focusSignal`, e.g. a second ⌘F).
 */

export interface ConversationFindBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  hitCount: number;
  /** Zero-based index of the active hit; -1 when nothing is active. */
  activeIndex: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  /** Results are capped or some indexed text was clipped. */
  truncated?: boolean;
  /** Incremented by ChatWindow on each ⌘F so focus returns to the input. */
  focusSignal?: number;
}

/**
 * fork:design-components —— 三个步进/关闭钮 = 画板 22 查找条的 `.pw-iconbtn.sm`
 * （22px 方钮 / radius-4 / hover 出容器），图标走 `<i data-ico>`，零手绘 svg。
 * 画板里是 `<span>`（静态件），产品要键盘可达，所以换成 `button`；UA 归零由
 * fork-ui.css 的 `@layer fork-reset`（`button.pw-iconbtn`）承担。
 */
function FindIcon({ ico, label, disabled, onClick }: {
  ico: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className="pw-iconbtn sm"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="pw-ico"><i data-ico={ico} data-size="13" aria-hidden="true"></i></span>
    </button>
  );
}

export function ConversationFindBar({
  query,
  onQueryChange,
  hitCount,
  activeIndex,
  onNext,
  onPrevious,
  onClose,
  truncated = false,
  focusSignal = 0,
}: ConversationFindBarProps): ReactNode {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasQuery = query.trim().length > 0;
  const hasHits = hitCount > 0;
  const countText = hasHits ? `${activeIndex + 1}/${hitCount}` : "0/0";

  // Autofocus on mount; `focusSignal` re-runs it when ⌘F is pressed again while
  // the bar is already open (the global listener ignores input-originated keys,
  // so the input itself cannot rely on it).
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusSignal]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    // Let the IME own Enter/Escape while a CJK candidate window is open.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      // Keep Esc from reaching the global abort handler: closing find must not
      // also stop the running turn.
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onPrevious();
      else onNext();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.currentTarget.select();
    }
  }, [onClose, onNext, onPrevious]);

  /* fork:design-components —— 画板 22「会话内查找条」：外壳 `.pw-pop`（padding 0），
     内层一行 `.pw-inline`，输入框 `.pw-input`，三个步进/关闭钮 `.pw-iconbtn.sm`，
     命中计数 `.pw-mono`（等宽 + tabular-nums）。无结果时整条转 warning 色
     （画板 22 第二帧的 border-color: var(--warning) + 警告色图标/文案）。
     只有「悬浮在转录右上」的定位留内联 —— 它是挂点行为，不是视觉。 */
  const noResults = hasQuery && !hasHits;
  return (
    <div
      role="search"
      aria-label={t("chat.findLabel")}
      className={`pw-pop conversation-find-bar${noResults ? " is-empty" : ""}`}
      style={{
        position: "absolute",
        top: 10,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 60,
        width: "min(430px, calc(100% - 20px))",
        padding: 0,
        borderColor: noResults ? "var(--warning)" : undefined,
      }}
    >
      <div className="pw-inline" style={{ padding: "var(--s1) var(--s2)" }}>
        <span className="pw-ico" style={noResults ? { color: "var(--warning)" } : undefined}>
          <i data-ico="search" data-size="14" aria-hidden="true"></i>
        </span>

        <input
          ref={inputRef}
          className="pw-input"
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("chat.findPlaceholder")}
          aria-label={t("chat.findLabel")}
          spellCheck={false}
          autoComplete="off"
          style={{ minWidth: 0, flex: 1, height: "var(--control-xs)", border: 0, background: "transparent" }}
        />

        {truncated && hasQuery && (
          <span className="pw-mono" title={t("chat.findTruncatedHint")} style={{ flexShrink: 0, color: "var(--warning)", fontSize: "var(--text-meta)" }}>
            {t("chat.findTruncated")}
          </span>
        )}

        {noResults ? (
          <span
            role="status"
            aria-live="polite"
            className="pw-mono"
            style={{ flexShrink: 0, color: "var(--warning)", fontSize: "var(--text-meta)", whiteSpace: "nowrap" }}
          >
            {t("chat.findNoResults")}
          </span>
        ) : (
          <span
            role="status"
            aria-live="polite"
            className="pw-mono pw-dim"
            style={{ flexShrink: 0, minWidth: 48, textAlign: "center", fontSize: "var(--text-meta)" }}
          >
            {countText}
          </span>
        )}

        <FindIcon ico="chevron-up" label={t("chat.findPrevious")} disabled={!hasHits} onClick={onPrevious} />
        <FindIcon ico="chevron-down" label={t("chat.findNext")} disabled={!hasHits} onClick={onNext} />
        <FindIcon ico="x" label={t("chat.findClose")} onClick={onClose} />
      </div>
    </div>
  );
}
