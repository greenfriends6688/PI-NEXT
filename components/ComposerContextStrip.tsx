"use client";

import { useState } from "react";
import type { SelectionContext, SessionReference } from "@/lib/composer-context";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";

/*
 * fork:v5-skin D-04 —— 引用芯片条换画板 DOM：
 *   · 容器 = .d-chips（画板 20「附件与引用」的同一条芯片行）；
 *   · 每枚 = .d-chipbtn（图标 + 文案，选中挂 .is-on）；
 *   · 移除钮 = .d-iconbtn，图标一律 <i data-ico="x">，不再手绘 SVG。
 * 交互契约（定位、打开引用、移除、清选区）原样保留。
 *
 * fork:v5-wave-b —— 窄屏（PWA 形态）换成 M-03 的 `.m-tray` + `.m-tray-chip`
 * （「能力一律收成同一种 chip」那条纪律）：桌面那一套 DOM 一字不动，
 * 手机那一套照画板另写一份 —— 两套基件同名同义不同形，混用反而会漂。
 * 行为（定位 / 打开引用 / 移除 / 清选区）两边完全一致。
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
        className={`d-chipbtn${active ? " is-on" : ""}`}
      >
        <i data-ico={icon} data-size="12"></i>
        {label}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        title={removeLabel}
        aria-label={removeLabel}
        style={{ opacity: active ? 1 : 0, pointerEvents: active ? "auto" : "none" }}
        className="d-iconbtn"
      >
        <i data-ico="x" data-size="11"></i>
      </button>
    </span>
  );
}

/** fork:v5-wave-b —— 同上，M-03 的 `.m-tray-chip` 一行。悬停语义在触屏上没有，
    所以「当前这枚」一律看得见移除钮 —— 那是 M-03 的 `.m-touch-44` 档要求。 */
function PwaContextChip({
  icon,
  title,
  label,
  removeLabel,
  active,
  disabled,
  onOpen,
  onRemove,
}: Omit<ChipProps, "onHoverStart" | "onHoverEnd" | "onFocusCapture" | "onBlurCapture">) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "2px", minWidth: 0 }}>
      <button
        type="button"
        disabled={disabled}
        onPointerDown={() => window.getSelection()?.removeAllRanges()}
        onClick={onOpen}
        title={title}
        className={`m-tray-chip${active ? " is-on" : ""}`}
      >
        <i data-ico={icon} data-size="14"></i>
        {label}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        title={removeLabel}
        aria-label={removeLabel}
        className="m-iconbtn"
      >
        <i data-ico="x" data-size="12"></i>
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
  const isMobile = useIsMobile();
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

  if (isMobile) {
    return (
      <div role="group" aria-label={t("chat.quotedContext")} className="m-tray">
        {contexts.map((context, index) => (
          <PwaContextChip
            key={`selection:${context.id}`}
            icon="quote"
            title={`${t("chat.quotedContext")}: ${contextSummary(context.text)}`}
            label={t("chat.quotedContextLabel", { count: index + 1 })}
            removeLabel={t("chat.removeQuotedContext")}
            active={false}
            disabled={disabled}
            onOpen={() => handleContextClick(context)}
            onRemove={() => onRemove(context.id)}
          />
        ))}
        {sessionReferences.map((reference, index) => (
          <PwaContextChip
            key={`session:${reference.id}`}
            icon="message-square"
            title={sessionSummary(reference)}
            label={t("chat.sessionReferenceLabel", { count: index + 1 })}
            removeLabel={t("chat.removeSessionReference")}
            active={false}
            disabled={disabled}
            onOpen={() => onOpenSessionReference?.(reference)}
            onRemove={() => onRemoveSessionReference?.(reference.id)}
          />
        ))}
      </div>
    );
  }

  return (
    <div role="group" aria-label={t("chat.quotedContext")} className="d-chips">
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