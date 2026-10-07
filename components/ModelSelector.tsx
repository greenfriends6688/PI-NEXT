"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import {
  favoriteModelKey,
  getFavoriteModelsServerSnapshot,
  getFavoriteModelsSnapshot,
  subscribeFavoriteModels,
  toggleFavoriteModel,
} from "@/lib/favorite-models";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ModelIcon } from "./ProviderIcon";
import { TEXT } from "@/lib/typography";
// fork:v5-wave-b —— 窄屏（PWA 形态）的模型选择：画板 M-01 帧 C 的底部面板
// （`.m-sheet` + `.m-group-title` 分节 + `.m-sheet-row` 一行一个模型 + `.m-pickbar` 动作行）。
import { PwaComposerSheet, PwaComposerSheetRow } from "./pwa/PwaComposerSheet";

export interface ModelSelectorOption {
  provider: string;
  modelId: string;
  name: string;
}

interface ModelSelectorProps {
  options: ModelSelectorOption[];
  value?: { provider: string; modelId: string } | null;
  onChange: (provider: string, modelId: string) => void;
  onClear?: () => void;
  emptyLabel?: string;
  selectedLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  isAutoSelection?: boolean;
  ariaLabel?: string;
  variant?: "toolbar" | "field";
  placement?: "up" | "auto";
  /**
   * fork:thinking-in-model-pop（用户 2026-10-07「把这个思考强度也帮我融合进这浮窗中，
   * 我感觉不需要占这么多位置」）—— 输入区（ChatInput）构造好的「思考强度」那一段，
   * 挂在这里由模型浮窗渲染，好让输入卡那一行少一枚芯片。
   *
   * 为什么是 ReactNode 而不是一串档位数据：思考档那一套（翻卡 `.d-flap`、档位尺
   * `.d-seg`、`fork:thinking-level-while-running` 的运行中语义、`thinkPopMaxWidth`
   * 的宽度测量）全部长在 ChatInput 里，浮窗只负责给它一个**位置**；在这里重开一份
   * 状态就是两套真相。
   *
   * 不传 = 一个字都不渲染（设置页的 `variant="field"`、窄屏的 `.m-sheet-row` 调用点
   * 都不传）。
   */
  thinkingSection?: ReactNode;
}

const MODEL_FILTER_THRESHOLD = 8;
const MODEL_OPTION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelOptions(a: ModelSelectorOption, b: ModelSelectorOption): number {
  return MODEL_OPTION_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId)
    || MODEL_OPTION_COLLATOR.compare(a.provider, b.provider)
    || MODEL_OPTION_COLLATOR.compare(a.modelId, b.modelId);
}

export function filterModelOptions(options: ModelSelectorOption[], query: string): ModelSelectorOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return options;

  return options.filter((option) => (
    `${option.name} ${option.modelId}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  ));
}

export function ModelSelector({
  options,
  value,
  onChange,
  onClear,
  emptyLabel,
  selectedLabel,
  disabled = false,
  busy = false,
  isAutoSelection = false,
  ariaLabel,
  variant = "toolbar",
  placement = "auto",
  thinkingSection,
}: ModelSelectorProps) {
  const { t } = useI18n();
  // fork:ui — 行内星标的数据源（与设置页 ModelsConfig / 输入框菜单共用同一 store）。
  const favorites = useSyncExternalStore(
    subscribeFavoriteModels,
    getFavoriteModelsSnapshot,
    getFavoriteModelsServerSnapshot,
  );
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<{ top: number; right: number; bottom: number; left: number; width: number } | null>(null);
  const [filter, setFilter] = useState("");
  const locked = disabled || busy;
  const sortedOptions = useMemo(() => [...options].sort(compareModelOptions), [options]);
  const filteredOptions = filterModelOptions(sortedOptions, filter);
  const showFilter = sortedOptions.length > MODEL_FILTER_THRESHOLD;
  const modelsByProvider: { provider: string; options: ModelSelectorOption[] }[] = [];

  // fork:ui — 收藏的模型单独成组置顶（见下方渲染），分组时先排除它们。
  const favoriteOptions = filteredOptions.filter((option) =>
    favorites.has(favoriteModelKey(option.provider, option.modelId)),
  );
  const unfavoritedOptions = filteredOptions.filter(
    (option) => !favorites.has(favoriteModelKey(option.provider, option.modelId)),
  );

  for (const option of unfavoritedOptions) {
    const group = modelsByProvider.find((item) => item.provider === option.provider);
    if (group) group.options.push(option);
    else modelsByProvider.push({ provider: option.provider, options: [option] });
  }

  const currentOption = value
    ? sortedOptions.find((option) => option.modelId === value.modelId && option.provider === value.provider)
    : undefined;
  const currentName = selectedLabel ?? (currentOption?.name ?? (value
    ? value.modelId
    : emptyLabel ?? (sortedOptions.length > 0 ? "Select model" : "No models")));

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

  useEffect(() => {
    if (!locked) return;
    setOpen(false);
    setFilter("");
  }, [locked]);

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
        borderRadius: "var(--radius-xs)",
        background: locked ? "var(--bg-panel)" : "var(--bg)",
        color: locked ? "var(--text-dim)" : "var(--text)",
        cursor: locked ? "default" : "pointer",
        fontSize: TEXT.sm,
        textAlign: "left",
      }
    : {
        // fork:v5-skin D-04 —— 工具栏形态的尺寸 / 颜色 / 圆角 / 间隙全部来自
        // 画板的 .d-select（system.css），这里只留布局与禁用态。
        display: "flex",
        alignItems: "center",
        justifyContent: isMobile ? "flex-start" : undefined,
        width: isMobile ? "100%" : undefined,
        maxWidth: isMobile ? "100%" : 220,
        overflow: "hidden",
        cursor: locked ? "not-allowed" : "pointer",
        opacity: locked ? 0.5 : 1,
      };

  const choose = (option: ModelSelectorOption) => {
    const active = option.modelId === value?.modelId && option.provider === value?.provider;
    setOpen(false);
    setFilter("");
    if (!active || isAutoSelection) onChange(option.provider, option.modelId);
  };

  /* fork:v5-wave-b —— 窄屏分支（M-01 帧 C）。
   *
   * 窄屏不在工具条上摆一枚 `.d-select`：模型只从输入卡那枚「能力」钮的面板里进来
   * （M-01 注：「模型不在顶上也不在卡面上」，同一件事只留一个出口），所以触发器是
   * 面板里的一行 `.m-sheet-row`，展开是一整块 `.m-sheet` 底部面板。
   * 行为一行没改：同一个 `choose`、同一个收藏 store、同一个过滤阈值与 onClear。
   */
  if (isMobile && variant === "toolbar") {
    return (
      <>
        <button
          type="button"
          className="m-sheet-row"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={locked}
          title={currentName}
          onClick={() => setOpen((current) => { if (current) setFilter(""); return !current; })}
        >
          <ModelIcon
            provider={value?.provider ?? ""}
            modelId={value?.modelId ?? ""}
            modelName={currentOption?.name}
            size={16}
          />
          <span className="m-setrow-body">
            <span className="m-setrow-t">{t("common.models")}</span>
            {/* fork:v5-frame-audit —— 画板 M-01 帧 C / M-03 帧 A 的模型行副行是
                `.m-setrow-s`（补全面板的行才是 `.m-sheet-row-desc`）。 */}
            <span className="m-setrow-s">{currentName}</span>
          </span>
          {busy ? (
            <i data-ico="loader-circle" data-size="16" aria-hidden="true" style={{ animation: "spin var(--motion-spin) linear infinite" }} />
          ) : null}
          <i data-ico="chevron-right" data-size="14" aria-hidden="true" />
        </button>
        <PwaComposerSheet
          open={open}
          title={t("common.models")}
          label={ariaLabel}
          onClose={() => { setOpen(false); setFilter(""); }}
          footer={(
            <>
              <button
                type="button"
                className="m-picktag"
                onClick={() => { setOpen(false); setFilter(""); }}
              >
                {t("chat.cancel")}
              </button>
              <button
                type="button"
                className="m-picktag is-on"
                onClick={() => { setOpen(false); setFilter(""); }}
              >
                {t("chat.confirm")}
              </button>
            </>
          )}
        >
          {showFilter && (
            <div className="m-searchfield" style={{ margin: "0 0 var(--nx-sp-2)" }}>
              <i data-ico="search" data-size="14"></i>
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t("chat.filterModels")}
                aria-label={t("chat.filterModels")}
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}
          {onClear && !filter.trim() && (
            <PwaComposerSheetRow
              title={emptyLabel ?? "Default"}
              on={!value}
              onClick={() => {
                setOpen(false);
                setFilter("");
                onClear();
              }}
            />
          )}
          {favoriteOptions.length > 0 && (
            <>
              <div className="m-group-title">{t("models.favorites")}</div>
              {favoriteOptions.map((option) => (
                <ModelSheetRow
                  key={`fav:${option.provider}:${option.modelId}`}
                  option={option}
                  active={option.modelId === value?.modelId && option.provider === value?.provider}
                  favorite
                  onToggleFavorite={() => toggleFavoriteModel(option.provider, option.modelId)}
                  onPick={() => choose(option)}
                />
              ))}
            </>
          )}
          {modelsByProvider.length === 0 && favoriteOptions.length === 0 ? (
            <div className="m-sheet-row m-t-xs m-t-faint">
              {filter.trim() ? t("chat.noMatchingModels") : "No available models"}
            </div>
          ) : modelsByProvider.map((group) => (
            <Fragment key={group.provider}>
              {modelsByProvider.length > 1 && <div className="m-group-title">{group.provider}</div>}
              {group.options.map((option) => (
                <ModelSheetRow
                  key={`${option.provider}:${option.modelId}`}
                  option={option}
                  active={option.modelId === value?.modelId && option.provider === value?.provider}
                  favorite={favorites.has(favoriteModelKey(option.provider, option.modelId))}
                  onToggleFavorite={() => toggleFavoriteModel(option.provider, option.modelId)}
                  onPick={() => choose(option)}
                />
              ))}
            </Fragment>
          ))}
        </PwaComposerSheet>
      </>
    );
  }

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
        /* fork:v5-skin D-04 —— 触发钮挂画板 .d-select（system.css）：图标 + 名称 +
           chevron；hover 由 CSS 给，不再用 onMouseEnter 写内联底色。 */
        className="d-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={busy || undefined}
        disabled={locked}
        title={busy ? "Switching model" : locked ? currentName : sortedOptions.length > 0 || onClear ? "Change model" : "No available models"}
        style={buttonStyle}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchorRect({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width });
          setOpen((current) => {
            if (current) setFilter("");
            return !current;
          });
        }}
      >
        {busy ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ animation: "spin var(--motion-spin) linear infinite", flexShrink: 0 }} aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          </svg>
        ) : (
          <ModelIcon
            provider={value?.provider ?? ""}
            modelId={value?.modelId ?? ""}
            modelName={currentOption?.name}
            size={11}
          />
        )}
        <span style={{ flex: variant === "field" ? 1 : "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentName}</span>
        {variant !== "field" && (
          <i data-ico="chevron-down" data-size="14"></i>
        )}
      </button>

      {open && anchorRect && (() => {
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
        const spaceAbove = anchorRect.top - 8;
        const spaceBelow = viewportHeight - anchorRect.bottom - 8;
        // fork:popover-anchor — 原来是 `spaceAbove > spaceBelow`，而 composer 就在视口底部，
        // 于是「上方空间大」永远成立，下拉每次都朝上展开，而且 `maxHeight` 取的是整个上方空间，
        // 弹层会一直顶到屏幕顶部（用户：「浮窗距离那么远干啥」）。
        // fork:model-pop-size（用户 2026-10-07「这个模型的悬浮窗…占这么多位置」）——
        // ① 默认 `placement` 从 `"up"` 收到 `"auto"`：贴着触发点开，只有下面真的放不下
        //    （< MIN_BELOW 且上方更大）才朝上；② 高度在视口 60% 之外再封顶 400px ——
        //    实测 1440×900 下旧值是 540px、一路顶到屏幕顶，长名单交给内部滚动区滚动。
        const MIN_BELOW = 260;
        const POPOVER_MAX_HEIGHT = 400;
        const openAbove = placement === "up" || (spaceBelow < MIN_BELOW && spaceAbove > spaceBelow);
        const maxHeight = Math.max(180, Math.min(openAbove ? spaceAbove : spaceBelow, viewportHeight * 0.6, POPOVER_MAX_HEIGHT));
        const verticalPosition = openAbove
          ? { bottom: viewportHeight - anchorRect.top + 6 }
          : { top: anchorRect.bottom + 6 };
        const horizontalPosition: CSSProperties = isMobile
          ? { left: "var(--s2)", right: "var(--s2)", maxWidth: "calc(100vw - 16px)" }
          : {
            // fork:popover-anchor — clamp the left edge so a trigger near the right edge
            // does not push a `max-content` popover off screen.
            left: Math.max(8, Math.min(anchorRect.left, viewportWidth - anchorRect.width - 8)),
            width: "max-content",
            minWidth: anchorRect.width,
            maxWidth: Math.max(anchorRect.width, viewportWidth - Math.max(8, Math.min(anchorRect.left, viewportWidth - anchorRect.width - 8)) - 8),
          };

        // fork:model-pop-portal —— 浮窗原来是 `position: fixed` 却**渲染在触发点所在的
        // 子树里**。主题皮肤给 `.d-composer`（app/fork-ui.css）加了 `backdrop-filter`，
        // 而带 `backdrop-filter` 的祖先会成为后代 `position: fixed` 的包含块 ——
        // anchorRect 算出来的视口坐标于是被整棵子树再偏移一次：
        // 实测同一触发点，无皮肤浮窗 x=517、有皮肤 x=992（偏右 475）。
        // 挂到 body 之后 fixed 重新相对视口，anchorRect 那套算法一个字都不用改。
        return createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label={ariaLabel}
            className={`d-pop is-open${openAbove ? " up" : ""}`}
            style={{
              position: "fixed",
              ...verticalPosition,
              ...horizontalPosition,
              zIndex: 500,
              display: "flex",
              flexDirection: "column",
              maxHeight,
              overflow: "hidden",
              transformOrigin: openAbove ? "bottom center" : "top center",
            }}
          >
            {showFilter && (
              <div className="d-searchfield" style={{ margin: "var(--nx-sp-1)", flexShrink: 0 }}>
                <i data-ico="search" data-size="13"></i>
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={t("chat.filterModels")}
                  aria-label={t("chat.filterModels")}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )}
            {/* fork:v5-frame-audit D-04 帧 A（`m-model`）—— 补画板那一行计数说明
                （`.d-pop-body .d-t-xs .d-t-faint`：搜索框下面先说清楚「这里有多少」，
                再 `.d-sep`，然后才是模型行），并且**放在滚动区之外** ——
                板上这两件是浮窗的固定头，翻模型列表时它们不动；改前整个浮窗只有一块
                输入框当头，一滚动连「搜的是啥」都跟着跑了。数量用已有的 `chat.match` /
                `chat.matches` 键（就是 @ 菜单用的那句），不新增语包条目。 */}
            <div className="d-pop-body d-t-xs d-t-faint" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
              {filter.trim()
                ? (filteredOptions.length === 1 ? t("chat.match") : t("chat.matches", { count: filteredOptions.length }))
                : (sortedOptions.length === 1 ? t("chat.match") : t("chat.matches", { count: sortedOptions.length }))}
            </div>
            <div className="d-sep" style={{ flexShrink: 0 }} />
            <div style={{ minHeight: 0, overflowY: "auto", padding: "var(--nx-sp-1)" }}>
              {onClear && !filter.trim() && (
                <ModelOptionButton active={!value} label={emptyLabel ?? "Default"} onClick={() => {
                  setOpen(false);
                  setFilter("");
                  onClear();
                }} />
              )}
              {/* fork:ui — 收藏的模型置顶成组（用户要求「收藏的排序往前排」）。 */}
              {favoriteOptions.length > 0 && (
                <div>
                  <div className="d-pop-title">
                    {t("models.favorites")}
                  </div>
                  {favoriteOptions.map((option) => (
                    <ModelOptionButton
                      key={`fav:${option.provider}:${option.modelId}`}
                      active={option.modelId === value?.modelId && option.provider === value?.provider}
                      label={option.name}
                      provider={option.provider}
                      modelId={option.modelId}
                      isFavorite
                      onToggleFavorite={() => toggleFavoriteModel(option.provider, option.modelId)}
                      onClick={() => choose(option)}
                    />
                  ))}
                </div>
              )}
              {/* 注意：收藏的已从 modelsByProvider 里排除，所以「无结果」要两边都看。 */}
              {modelsByProvider.length === 0 && favoriteOptions.length === 0 ? (
                <div className="d-pop-body d-t-xs d-t-faint" style={{ whiteSpace: "nowrap" }}>
                  {filter.trim() ? t("chat.noMatchingModels") : "No available models"}
                </div>
              ) : modelsByProvider.map((group) => (
                <div key={group.provider}>
                  {modelsByProvider.length > 1 && (
                    <div className="d-pop-title">
                      {group.provider}
                    </div>
                  )}
                  {group.options.map((option) => {
                    const favKey = favoriteModelKey(option.provider, option.modelId);
                    return (
                      <ModelOptionButton
                        key={`${option.provider}:${option.modelId}`}
                        active={option.modelId === value?.modelId && option.provider === value?.provider}
                        label={option.name}
                        provider={option.provider}
                        modelId={option.modelId}
                        isFavorite={favorites.has(favKey)}
                        onToggleFavorite={() => toggleFavoriteModel(option.provider, option.modelId)}
                        onClick={() => choose(option)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            {/* fork:thinking-in-model-pop —— 「思考强度」那一段由输入区传进来，只挂
                **宽屏浮窗**；窄屏仍走能力面板里那块既有的思考面板（见 ChatInput），
                所以这里不重复。放滚动区之外的页脚：芯片那枚 `.d-pop` 是向上开的
                （`bottom: calc(100% + 6px)`），页脚在底部才不会被 `overflow:hidden` 裁掉。 */}
            {thinkingSection && (
              <>
                <div className="d-sep" style={{ flexShrink: 0 }} />
                <div className="d-pop-body" style={{ flexShrink: 0 }}>{thinkingSection}</div>
              </>
            )}
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}

/**
 * fork:v5-wave-b —— 窄屏面板里的一行模型（M-01 帧 C）：
 * `<i data-ico>` 换成 `<ModelIcon>` 的供应商字形 + `.m-setrow-body`（模型名 + 副行）
 * + 收藏星标 + 选中对勾。副行写的是「模型 id · 供应商」—— 画板那行写的是「什么时候用
 * 它划算」，本仓没有这份文案数据源，所以给真实可得的区分信息，不编。
 */
function ModelSheetRow({
  option,
  active,
  favorite,
  onToggleFavorite,
  onPick,
}: {
  option: ModelSelectorOption;
  active: boolean;
  favorite: boolean;
  onToggleFavorite: () => void;
  onPick: () => void;
}) {
  const { t } = useI18n();
  return (
    <PwaComposerSheetRow
      title={(
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--nx-sp-1)", minWidth: 0 }}>
          <ModelIcon provider={option.provider} modelId={option.modelId} modelName={option.name} size={16} />
          <span className="m-setrow-t">{option.name}</span>
        </span>
      )}
      desc={`${option.modelId} · ${option.provider}`}
      descClass="m-setrow-s"
      on={active}
      onClick={onPick}
      trailing={(
        <span
          role="button"
          tabIndex={0}
          aria-label={favorite ? t("models.unfavoriteModel") : t("models.favoriteModel")}
          title={favorite ? t("models.unfavoriteModel") : t("models.favoriteModel")}
          onClick={(event) => { event.stopPropagation(); onToggleFavorite(); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onToggleFavorite();
            }
          }}
          className={`m-iconbtn fork-star${favorite ? " is-on" : ""}`}
        >
          {/* fork:star-solid —— 一枚 `star` 走两态：空心 = 未收藏，实心 = 已收藏（CSS 填色）。 */}
          <i data-ico="star" data-size="16" aria-hidden="true"></i>
        </span>
      )}
    />
  );
}

function ModelOptionButton({ active, label, provider, modelId, isFavorite, onToggleFavorite, onClick }: { active: boolean; label: string; provider?: string; modelId?: string; isFavorite?: boolean; onToggleFavorite?: () => void; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className="d-menu-row"
    >
      <ModelIcon provider={provider ?? ""} modelId={modelId ?? ""} modelName={label} size={14} />
      <span title={label} className={`d-grow${active ? " d-t-b" : ""}`} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      {active && <i data-ico="check" data-size="14"></i>}
      {/* fork:ui — 行内星标（收藏）。用 <span role="button"> 而不是 <button>：
          嵌套 button 是非法 HTML，会触发 hydration 报错（本仓补丁 0019 修过一次）。 */}
      {onToggleFavorite && (
        <span
          role="button"
          tabIndex={0}
          aria-label={isFavorite ? t("models.unfavoriteModel") : t("models.favoriteModel")}
          title={isFavorite ? t("models.unfavoriteModel") : t("models.favoriteModel")}
          onClick={(event) => { event.stopPropagation(); onToggleFavorite(); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onToggleFavorite();
            }
          }}
          className={`d-iconbtn fork-star${isFavorite ? " is-on" : ""}`}
          style={{ cursor: "pointer" }}
        >
          {/* fork:star-solid（用户 2026-10-06）—— 收藏只有**一档**读法：空心 = 未收藏、
              实心 = 已收藏。原来是 `star`（收藏）/ `star-off`（一颗**划掉**的星）两枚图标，
              于是每一行末尾都挂着一颗带斜线的星，行尾还并排一枚当前模型的 ✓，读成两套状态。
              lucide 只有描边图标，所以实心靠 CSS 给同一个 svg 填色（`fill="none"` 是呈现
              属性，样式说算）。 */}
          <i data-ico="star" data-size="14"></i>
        </span>
      )}
    </button>
  );
}
