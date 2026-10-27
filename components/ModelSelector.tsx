"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ProviderIcon } from "./ProviderIcon";
import { Icon } from "./v3/Icon";
import { SelectorRow } from "./SelectorRow";

export interface ModelSelectorOption {
  provider: string;
  modelId: string;
  name: string;
}

interface ModelSelectorProps {
  options: ModelSelectorOption[];
  value?: { provider: string; modelId: string } | null;
  onChange: (provider: string, modelId: string) => void;
  /** Live sessions can reapply saved metadata by choosing their current model again. */
  onReselect?: (provider: string, modelId: string) => void;
  onClear?: () => void;
  emptyLabel?: string;
  selectedLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  isAutoSelection?: boolean;
  ariaLabel?: string;
  variant?: "toolbar" | "field";
  placement?: "up" | "auto";
  /** The model new sessions start with; its row gets a filled star. */
  defaultValue?: { provider: string; modelId: string } | null;
  /** Shows a star on every row that saves it as the default. */
  onSetDefault?: (provider: string, modelId: string) => void;
  /** The reasoning level, as the board's `.chip__eff` shows it ("中", "max"). */
  effortLabel?: string;
  /** Below the model list: the reasoning slider stays reachable while the list scrolls. */
  menuFooter?: ReactNode;
}

const MODEL_FILTER_THRESHOLD = 8;

export function filterModelOptions(options: ModelSelectorOption[], query: string): ModelSelectorOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return options;

  return options.filter((option) => (
    `${option.name} ${option.modelId} ${option.provider}/${option.modelId}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  ));
}

/**
 * The model id to show beside each row whose name a sibling shares
 * (case-insensitively: models.json holds `deepseek-v4-flash` and
 * `DeepSeek-V4-Flash-Official-solo`, both named "Deepseek-V4-Flash"). Two
 * identical rows tell the user nothing about which one they are choosing.
 */
export function duplicateModelNameIds(options: ModelSelectorOption[]): Set<string> {
  const seen = new Map<string, number>();
  for (const option of options) {
    const key = `${option.provider}:${option.name.toLocaleLowerCase()}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return new Set(options
    .filter((option) => (seen.get(`${option.provider}:${option.name.toLocaleLowerCase()}`) ?? 0) > 1)
    .map((option) => `${option.provider}:${option.modelId}`));
}

export function ModelSelector({
  options,
  value,
  onChange,
  onReselect,
  onClear,
  emptyLabel,
  selectedLabel,
  disabled = false,
  busy = false,
  isAutoSelection = false,
  ariaLabel,
  variant = "toolbar",
  placement = "up",
  defaultValue,
  onSetDefault,
  effortLabel,
  menuFooter,
}: ModelSelectorProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<{ top: number; right: number; bottom: number; left: number; width: number } | null>(null);
  const [filter, setFilter] = useState("");
  const locked = disabled || busy;
  // Options arrive in pi's /model order (orderSelectorModels()); never re-sort
  // them, or a models.json provider loses the order its file gives (#783).
  const filteredOptions = filterModelOptions(options, filter);
  const duplicatedIds = duplicateModelNameIds(filteredOptions);
  const showFilter = options.length > MODEL_FILTER_THRESHOLD;
  const modelsByProvider: { provider: string; options: ModelSelectorOption[] }[] = [];

  for (const option of filteredOptions) {
    const group = modelsByProvider.find((item) => item.provider === option.provider);
    if (group) group.options.push(option);
    else modelsByProvider.push({ provider: option.provider, options: [option] });
  }

  const currentName = selectedLabel ?? (value
    ? options.find((option) => option.modelId === value.modelId && option.provider === value.provider)?.name ?? value.modelId
    : emptyLabel ?? (options.length > 0 ? t("chat.selectModel") : t("chat.noModels")));

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        rootRef.current && !rootRef.current.contains(event.target as Node)
        && panelRef.current && !panelRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
        setFilter("");
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // While the picker is open, a phone keyboard shrinks the app height
  // (useViewportHeight writes the root's style, sometimes with no viewport
  // event) and moves the trigger; follow it instead of the rect from the tap.
  useEffect(() => {
    if (!open) return;
    const remeasure = () => {
      const rect = rootRef.current?.querySelector("button")?.getBoundingClientRect();
      // A new object even for an unmoved trigger: the panel also reads the
      // visual viewport, which may have changed alone.
      if (rect?.height) setAnchorRect({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width });
    };
    const viewport = window.visualViewport;
    const rootObserver = new MutationObserver(remeasure);
    rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-keyboard-open"] });
    window.addEventListener("resize", remeasure);
    viewport?.addEventListener("resize", remeasure);
    viewport?.addEventListener("scroll", remeasure);
    return () => {
      rootObserver.disconnect();
      window.removeEventListener("resize", remeasure);
      viewport?.removeEventListener("resize", remeasure);
      viewport?.removeEventListener("scroll", remeasure);
    };
  }, [open]);

  useEffect(() => {
    if (!locked) return;
    setOpen(false);
    setFilter("");
  }, [locked]);

  // A models.json provider list is long enough that the menu always starts at
  // the first provider, so the model the composer shows can be far below the
  // fold with nothing highlighted: scroll the current row into view instead.
  useEffect(() => {
    if (!open) return;
    const scroller = listRef.current;
    const row = scroller?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
    if (!scroller || !row) return;
    const rowRect = row.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    scroller.scrollTop += rowRect.top - scrollerRect.top - (scrollerRect.height - rowRect.height) / 2;
  }, [open]);

  const buttonStyle: CSSProperties = variant === "field"
    ? {
        display: "flex",
        alignItems: "center",
        gap: 7,
        width: "100%",
        minWidth: 0,
        height: 34,
        padding: "0 9px",
        overflow: "hidden",
        border: "1px solid var(--border)",
        borderRadius: 5,
        background: locked ? "var(--bg-panel)" : "var(--bg)",
        color: locked ? "var(--text-dim)" : "var(--text)",
        cursor: locked ? "default" : "pointer",
        fontSize: 12,
        textAlign: "left",
      }
    : {
        // design/v3 的 `.chip`（26 高、999 圆、悬停 --fill-2）负责外观，
        // 这里只留产品专属的宽度约束。
        maxWidth: isMobile ? "100%" : 220,
        width: isMobile ? "100%" : undefined,
        justifyContent: isMobile ? "flex-start" : undefined,
        cursor: locked ? "not-allowed" : "pointer",
        opacity: locked ? 0.5 : 1,
      };

  const choose = (option: ModelSelectorOption) => {
    const active = option.modelId === value?.modelId && option.provider === value?.provider;
    setOpen(false);
    setFilter("");
    if (!active || isAutoSelection) onChange(option.provider, option.modelId);
    else onReselect?.(option.provider, option.modelId);
  };

  const saveDefault = (option: ModelSelectorOption) => {
    setOpen(false);
    setFilter("");
    onSetDefault?.(option.provider, option.modelId);
  };

  return (
    <div
      ref={rootRef}
      className={`model-selector is-${variant}${locked ? " is-disabled" : ""}`}
      style={{ position: "relative", width: variant === "field" || isMobile ? "100%" : undefined, minWidth: 0, flex: variant === "toolbar" && isMobile ? "1 1 auto" : undefined }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setFilter("");
        setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={busy || undefined}
        disabled={locked}
        className={variant === "field" ? undefined : "chip"}
        title={busy ? t("chat.switchingModel") : locked ? currentName : options.length > 0 || onClear ? t("chat.changeModel") : t("chat.noModels")}
        style={buttonStyle}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchorRect({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width });
          setOpen((current) => {
            if (current) setFilter("");
            return !current;
          });
        }}
        onMouseEnter={(event) => {
          if (locked || variant !== "field") return;
          event.currentTarget.style.background = "var(--bg-hover)";
          event.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(event) => {
          if (variant !== "field") return;
          if (locked) {
            event.currentTarget.style.background = "var(--bg-panel)";
            event.currentTarget.style.color = "var(--text-dim)";
            return;
          }
          event.currentTarget.style.background = open ? "var(--bg-hover)" : "var(--bg)";
          event.currentTarget.style.color = "var(--text)";
        }}
      >
        {busy ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }} aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          </svg>
        ) : variant === "field" ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
            <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
            <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
            <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
          </svg>
        ) : value ? (
          <ProviderIcon id={value.provider} size={15} />
        ) : null}
        {!(isMobile && variant !== "field" && effortLabel && value) && (
          <span style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentName}</span>
        )}
        {effortLabel && <span className="chip__eff">{effortLabel}</span>}
        {variant !== "field" && <Icon name="chevron-down" />}
      </button>

      {open && anchorRect && (() => {
        // Fixed coordinates belong to the layout viewport, which a phone
        // keyboard does not shrink: measure from the visible part's top and
        // hang an upward panel from `top` rather than from `bottom`.
        const viewportTop = window.visualViewport?.offsetTop ?? 0;
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
        // A trigger the keyboard covers (a Settings field) still gets a
        // panel ending above the keyboard.
        const aboveEnd = Math.min(anchorRect.top - 6, viewportTop + viewportHeight - 8);
        const spaceAbove = aboveEnd - viewportTop - 8;
        const spaceBelow = viewportTop + viewportHeight - anchorRect.bottom - 6 - 8;
        const openAbove = placement === "up" || spaceAbove > spaceBelow;
        const maxHeight = Math.max(120, Math.min(openAbove ? spaceAbove : spaceBelow, viewportHeight * 0.6));
        const verticalPosition: CSSProperties = isMobile
          // design/v3 的 `.m-sheet`（部件 40）：手机上模型选择是一个从底部起来的 sheet。
          ? { bottom: 0, top: "auto", transform: "none" }
          : openAbove
            ? { top: aboveEnd, transform: "translateY(-100%)" }
            : { top: anchorRect.bottom + 6 };
        const horizontalPosition: CSSProperties = isMobile
          ? { left: 0, right: 0, maxWidth: "100vw" }
          : { left: anchorRect.left, width: "max-content", minWidth: anchorRect.width, maxWidth: Math.max(anchorRect.width, viewportWidth - anchorRect.left - 8) };

        // 浮窗挂到 body 上：它在视口坐标里定位（`position: fixed`），但输入区胶囊
        // 带 `backdrop-filter`——那会让胶囊成为固定定位后代的包含块，菜单于是按胶囊
        // 的左上角算坐标，整块飘到窗口右下角（打包后的桌面壳里一直是这样）。
        // portal 出去以后祖先是谁都无所谓了。
        return createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: "fixed",
              ...verticalPosition,
              ...horizontalPosition,
              zIndex: 500,
              display: "flex",
              flexDirection: "column",
              maxHeight: isMobile ? "70dvh" : maxHeight,
              overflow: "hidden",
              border: isMobile ? "0" : "1px solid var(--border)",
              borderRadius: isMobile ? "18px 18px 0 0" : 8,
              background: "var(--bg)",
              boxShadow: isMobile
                ? "0 -24px 60px -34px rgba(0,0,0,0.55), inset 0 0 0 1px var(--glass-rim)"
                : openAbove ? "0 -4px 16px rgba(0,0,0,0.10)" : "0 4px 16px rgba(0,0,0,0.10)",
              paddingBottom: isMobile ? "max(8px, env(safe-area-inset-bottom))" : undefined,
            }}
          >
            {isMobile && (
              <div aria-hidden="true" style={{ display: "grid", placeItems: "center", padding: "8px 0 4px", flexShrink: 0 }}>
                <span style={{ width: 36, height: 4, borderRadius: 2, background: "color-mix(in srgb, var(--ink) 30%, transparent)" }} />
              </div>
            )}
            {showFilter && (
              <div style={{ flexShrink: 0, padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={t("chat.filterModels")}
                  aria-label={t("chat.filterModels")}
                  // On phones, focusing the filter opens the on-screen keyboard,
                  // which shrinks the viewport and pushes the list off-screen
                  // before the user has decided to filter. Tap to filter instead.
                  autoFocus={!isMobile}
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    boxSizing: "border-box",
                    width: "100%",
                    minWidth: isMobile ? 0 : 220,
                    padding: "5px 8px",
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    outline: "none",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                  }}
                />
              </div>
            )}
            <div ref={listRef} style={{ minHeight: 0, overflowY: "auto" }}>
              {onClear && !filter.trim() && (
                <SelectorRow active={!value} gutter={Boolean(onSetDefault)} onSelect={() => {
                  setOpen(false);
                  setFilter("");
                  onClear();
                }}>
                  <OptionLabel label={emptyLabel ?? "Default"} />
                </SelectorRow>
              )}
              {modelsByProvider.length === 0 ? (
                <div style={{ padding: "8px 12px", color: "var(--text-dim)", fontSize: 12, whiteSpace: "nowrap" }}>
                  {filter.trim() ? t("chat.noMatchingModels") : "No available models"}
                </div>
              ) : modelsByProvider.map((group, index) => (
                <div key={group.provider}>
                  {modelsByProvider.length > 1 && (
                    <div style={{ padding: "6px 12px 4px", borderTop: index > 0 || onClear ? "1px solid var(--border)" : "none", color: "var(--text-dim)", fontSize: 10, fontWeight: 600, letterSpacing: 0, textTransform: "uppercase" }}>
                      {group.provider}
                    </div>
                  )}
                  {group.options.map((option) => {
                    return (
                      <SelectorRow
                        key={`${option.provider}:${option.modelId}`}
                        active={option.modelId === value?.modelId && option.provider === value?.provider}
                        onSelect={() => choose(option)}
                        star={onSetDefault ? {
                          isDefault: option.modelId === defaultValue?.modelId && option.provider === defaultValue?.provider,
                          saveLabel: t("chat.saveDefaultModel"),
                          defaultLabel: t("chat.defaultModel"),
                          onSave: () => saveDefault(option),
                        } : undefined}
                      >
                        <OptionLabel
                          label={option.name}
                          hint={duplicatedIds.has(`${option.provider}:${option.modelId}`) ? option.modelId : undefined}
                        />
                      </SelectorRow>
                    );
                  })}
                </div>
              ))}
            </div>
            {menuFooter && (
              <div style={{ flexShrink: 0, borderTop: "1px solid var(--border)" }}>
                {menuFooter}
              </div>
            )}
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}

function OptionLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <span title={hint ? `${label} · ${hint}` : label} style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      {hint && (
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10.5 }}>{hint}</span>
      )}
    </span>
  );
}
