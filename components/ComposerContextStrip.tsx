"use client";

import { useState } from "react";
import type { SelectionContext, SessionReference } from "@/lib/composer-context";
import { useI18n } from "@/hooks/useI18n";

/*
 * fork:design-components —— 引用芯片条钉在画板件上。
 *
 * 迁移前这一段是整段自绘：外层 flex + 每枚芯片一套 26px 高 / accent 描边 / 绝对定位的
 * 圆形移除钮 + 两枚手绘 SVG。现在结构就是画板 20 的 `.pw-chips` + `.pw-chip`
 * （+ `.accent` 状态），移除钮是画板的 `.pw-iconbtn.sm`，图标一律 `<i data-ico>`。
 * 交互契约（定位、打开引用、移除、清选区）原样保留。
 */

interface Props {
  contexts: SelectionContext[];
  sessionReferences?: SessionReference[];
  disabled?: boolean;
  onLocate?: (context: SelectionContext) => void;
  onOpenSessionReference?: (reference: SessionReference) => void;
  onRemove: (id: string) => void;
  onRemoveSessionReference?: (id: string) => void;
}

function contextSummary(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 36 ? `${compact.slice(0, 33)}...` : compact;
}

function sessionSummary(reference: SessionReference): string {
  return [
    reference.title?.trim() || reference.id.slice(0, 12),
    reference.cwd,
    `ID: ${reference.id}`,
  ].filter(Boolean).join("\n");
}

interface ChipProps {
  icon: "quote" | "message-square";
  /** 悬停 / 聚焦时显示的完整文本。 */
  title: string;
  label: string;
  removeLabel: string;
  active: boolean;
  disabled: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onFocusCapture: () => void;
  onBlurCapture: (event: React.FocusEvent<HTMLSpanElement>) => void;
}

function ContextChip({
  icon,
  title,
  label,
  removeLabel,
  active,
  disabled,
  onOpen,
  onRemove,
  onHoverStart,
  onHoverEnd,
  onFocusCapture,
  onBlurCapture,
}: ChipProps) {
  return (
    <span
      className="pw-inline"
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
    >
      <button
        type="button"
        disabled={disabled}
        onPointerDown={() => window.getSelection()?.removeAllRanges()}
        onClick={onOpen}
        title={title}
        className={`pw-chip${active ? " accent" : ""}`}
      >
        <span className="pw-ico"><i data-ico={icon} data-size="12"></i></span>
        <span className="pw-mono">{label}</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        title={removeLabel}
        aria-label={removeLabel}
        style={{ opacity: active ? 1 : 0, pointerEvents: active ? "auto" : "none" }}
        className="pw-iconbtn sm"
      >
        <span className="pw-ico"><i data-ico="x" data-size="11"></i></span>
      </button>
    </span>
  );
}

export function ComposerContextStrip({
  contexts,
  sessionReferences = [],
  disabled = false,
  onLocate,
  onOpenSessionReference,
  onRemove,
  onRemoveSessionReference,
}: Props) {
  const { t } = useI18n();
  const [activeContextId, setActiveContextId] = useState<string | null>(null);

  if (contexts.length === 0 && sessionReferences.length === 0) return null;

  const handleContextClick = (context: SelectionContext) => {
    if (disabled) return;
    if ((context.sourceEntryId || context.sourceFilePath) && onLocate) {
      onLocate(context);
    }
  };

  const hoverProps = (itemId: string) => ({
    onHoverStart: () => setActiveContextId(itemId),
    onHoverEnd: () => setActiveContextId((current) => (current === itemId ? null : current)),
    onFocusCapture: () => setActiveContextId(itemId),
    onBlurCapture: (event: React.FocusEvent<HTMLSpanElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setActiveContextId((current) => (current === itemId ? null : current));
      }
    },
  });

  return (
    <div role="group" aria-label={t("chat.quotedContext")} className="pw-chips">
      {contexts.map((context, index) => {
        const itemId = `selection:${context.id}`;
        return (
          <ContextChip
            key={itemId}
            icon="quote"
            title={`${t("chat.quotedContext")}: ${contextSummary(context.text)}`}
            label={t("chat.quotedContextLabel", { count: index + 1 })}
            removeLabel={t("chat.removeQuotedContext")}
            active={activeContextId === itemId}
            disabled={disabled}
            onOpen={() => handleContextClick(context)}
            onRemove={() => onRemove(context.id)}
            {...hoverProps(itemId)}
          />
        );
      })}

      {sessionReferences.map((reference, index) => {
        const itemId = `session:${reference.id}`;
        return (
          <ContextChip
            key={itemId}
            icon="message-square"
            title={sessionSummary(reference)}
            label={t("chat.sessionReferenceLabel", { count: index + 1 })}
            removeLabel={t("chat.removeSessionReference")}
            active={activeContextId === itemId}
            disabled={disabled}
            onOpen={() => onOpenSessionReference?.(reference)}
            onRemove={() => onRemoveSessionReference?.(reference.id)}
            {...hoverProps(itemId)}
          />
        );
      })}
    </div>
  );
}
