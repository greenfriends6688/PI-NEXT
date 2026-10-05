"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { AnsiText } from "@/components/AnsiText";
import type { ExtensionWidgetItem } from "@/lib/types";

export const DEFAULT_EXPANDED_WIDGET_LINES = 3;
export const WIDGET_UPDATE_IDLE_MS = 1100;

/* fork:v5-boards D-25 帧 C/D —— 面板收起后再卸轨道的收钟（`.d-row-x` 退场动画 225ms，
   留一点余量；退场必须比进场快，板面注记）。 */
const ROW_X_CLOSING_MS = 260;

/**
 * fork:v5-boards D-25 帧 C/D —— 扩展块的插槽语义。widget 数据源只有 SDK 的两个
 * 落点（`placement`），各自对到画板声明的产品插槽：
 *   · `aboveEditor` → `chat.composer.top`（输入框正上方；帧 C 的撞车规则：确认后替换）
 *   · `belowEditor` → `chat.list.end`（转录尾端 / 紧贴输入框上方；先到先得）
 * 画板帧 D 另标了 `chat.top` / `chat.list.start` 两个位置，但本 fork 的 widget
 * 数据流没有通往它们的 placement，也没有 widget 宿主 —— 不造空壳，不把它们画进 DOM。
 */
export function extensionWidgetSlot(placement: ExtensionWidgetItem["placement"]): string {
  return placement === "belowEditor" ? "chat.list.end" : "chat.composer.top";
}

/* 撞车规则文本（帧 C 的「撞车怎么办」列）。三个语言包在产品里都有，但不进
   `lib/i18n/messages/**`（本组件只借这一句），与 UsageStatsPanel 的 CACHE_BILLING_NOTE
   同一做法：本地三语表，不新开 i18n key。 */
const WIDGET_SLOT_MARKS: Record<string, Record<string, string>> = {
  "chat.composer.top": {
    en: "replace after confirm",
    "zh-CN": "确认后替换",
    "zh-TW": "確認後替換",
  },
  "chat.list.end": {
    en: "first come, first served",
    "zh-CN": "先到先得",
    "zh-TW": "先到先得",
  },
};

function extensionWidgetSlotMark(slotName: string, locale: string): string {
  return WIDGET_SLOT_MARKS[slotName]?.[locale] ?? WIDGET_SLOT_MARKS[slotName]?.en ?? "";
}

export function formatExtensionWidgetContent(lines: string[]): string {
  return lines.join("\n");
}

export function snapshotExtensionWidgetContents(
  widgets: ExtensionWidgetItem[],
): Map<string, string[]> {
  return new Map(widgets.map((widget) => [widget.key, [...widget.lines]]));
}

export function getUpdatedExtensionWidgetKeys(
  previous: ReadonlyMap<string, readonly string[]> | null,
  next: ReadonlyMap<string, readonly string[]>,
): string[] {
  if (!previous) return [];
  return Array.from(next, ([key, lines]) => {
    const previousLines = previous.get(key);
    if (!previousLines || previousLines.length !== lines.length) {
      return previousLines ? key : null;
    }
    return lines.some((line, index) => line !== previousLines[index]) ? key : null;
  }).filter((key): key is string => key !== null);
}

function getDefaultExpandedWidgetKey(widgets: ExtensionWidgetItem[]): string | null {
  return widgets.find((widget) => {
    const lineCount = widget.lines.length;
    return lineCount > 1 && lineCount <= DEFAULT_EXPANDED_WIDGET_LINES;
  })?.key ?? null;
}

export function getNextExpandedWidgetKey(
  currentKey: string | null,
  requestedKey: string,
): string | null {
  return currentKey === requestedKey ? null : requestedKey;
}

export function ExtensionWidgets({ widgets }: { widgets: ExtensionWidgetItem[] }) {
  const { t, locale } = useI18n();
  const mobile = useIsMobile();
  const idPrefix = useId();
  const previousContentsRef = useRef<Map<string, string[]> | null>(null);
  const updateClearTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [expandedWidgetKey, setExpandedWidgetKey] = useState<string | null>(
    () => getDefaultExpandedWidgetKey(widgets),
  );
  const [updatingWidgetKeys, setUpdatingWidgetKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  /* fork:v5-boards D-27 帧 D / D-29 帧 E —— `.d-row-x.is-open`（进）/
     `.d-row-x.is-closing`（出）：展开下一个面板时，上一个面板不能瞬间消失，
     要沿 grid 轨道 1fr→0fr 退场（225ms）后再卸。这一格存退场中的那个 widget。 */
  const [closingWidget, setClosingWidget] = useState<ExtensionWidgetItem | null>(null);
  const lastExpandedWidgetRef = useRef<ExtensionWidgetItem | null>(null);

  useEffect(() => {
    const nextContents = snapshotExtensionWidgetContents(widgets);
    const updatedKeys = getUpdatedExtensionWidgetKeys(
      previousContentsRef.current,
      nextContents,
    );
    previousContentsRef.current = nextContents;

    for (const [key, timer] of updateClearTimersRef.current) {
      if (nextContents.has(key)) continue;
      clearTimeout(timer);
      updateClearTimersRef.current.delete(key);
    }

    setUpdatingWidgetKeys((current) => {
      const next = new Set(Array.from(current).filter((key) => nextContents.has(key)));
      for (const key of updatedKeys) next.add(key);
      if (
        next.size === current.size
        && Array.from(next).every((key) => current.has(key))
      ) return current;
      return next;
    });

    for (const key of updatedKeys) {
      const currentTimer = updateClearTimersRef.current.get(key);
      if (currentTimer) clearTimeout(currentTimer);
      updateClearTimersRef.current.set(key, setTimeout(() => {
        updateClearTimersRef.current.delete(key);
        setUpdatingWidgetKeys((current) => {
          if (!current.has(key)) return current;
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }, WIDGET_UPDATE_IDLE_MS));
    }
  }, [widgets]);

  useEffect(() => () => {
    for (const timer of updateClearTimersRef.current.values()) clearTimeout(timer);
    updateClearTimersRef.current.clear();
  }, []);

  /* 当前展开的 widget（面板正文非空才算展开）。放到早退之前：收起轨道的 effect
     需要在 widgets 为空（widget 被扩展移除）时也能拿到上一帧的展开项。 */
  const expandedWidget = widgets.find((widget) => (
    widget.key === expandedWidgetKey
    && widget.lines.length > 0
  ));

  useEffect(() => {
    const last = lastExpandedWidgetRef.current;
    lastExpandedWidgetRef.current = expandedWidget ?? null;
    if (!last || last.key === expandedWidget?.key) return;
    setClosingWidget(last);
    const timer = setTimeout(() => {
      setClosingWidget((current) => (current?.key === last.key ? null : current));
    }, ROW_X_CLOSING_MS);
    return () => clearTimeout(timer);
  }, [expandedWidget]);

  if (widgets.length === 0) return null;

  const toggleWidget = (widget: ExtensionWidgetItem) => {
    setExpandedWidgetKey((current) => getNextExpandedWidgetKey(current, widget.key));
  };

  /** 展开面板。桌面形态把它放进 `.d-row-x`（`.is-open` 进场 / `.is-closing` 退场），
   *  窄屏形态没有对应的 m-* 收放容器，保持原样（形态类不混用）。 */
  const renderWidgetPanel = (widget: ExtensionWidgetItem, closing: boolean) => {
    const index = widgets.indexOf(widget);
    const triggerId = `${idPrefix}-trigger-${index}`;
    const panelId = `${idPrefix}-panel-${index}`;
    // fork:v5-landing Wave B · M-11：窄屏的展开面板 = `.m-collapse`
    // （`.m-collapse-head` 头行 + `.m-code-body` 等宽正文）。
    // `.extension-widget-content` 仍挂着 —— 它带用户的「扩展 widget 字号」设置。
    if (mobile) {
      return (
        <section
          key={widget.key}
          id={panelId}
          className="extension-widget-panel m-collapse"
          aria-labelledby={triggerId}
        >
          <div className="m-collapse-head">
            <i data-ico="blocks" data-size="14" aria-hidden="true"></i>
            <span className="m-mono m-grow">{widget.key}</span>
            <span className="m-badge mute">{widget.lines.length}</span>
            <button
              type="button"
              className="m-top-btn"
              onClick={() => toggleWidget(widget)}
              title={t("i18n.collapse")}
              aria-label={t("i18n.collapse")}
            >
              <i data-ico="chevron-up" data-size="15" aria-hidden="true"></i>
            </button>
          </div>
          <pre className="m-code-body extension-widget-content">
            <AnsiText text={formatExtensionWidgetContent(widget.lines)} />
          </pre>
        </section>
      );
    }
    const slotName = extensionWidgetSlot(widget.placement);
    const slotMark = extensionWidgetSlotMark(slotName, locale);
    /* 轨道：外层 `.d-row-x` 一张 grid（is-open 1fr / is-closing 0fr），
       `.d-row-x-track` 裁溢出，里面永远留一层普通 div 承接淡入（板面结构）。
       fork:v5-landing —— 展开面板 = v5 画板 D-02b 帧 C「插件状态浮窗」里那张真实的
       扩展 widget 卡（BOARDS.md 把 ExtensionWidgets 归到 D-25 的「扩展小部件」，
       真正渲染 widget 的 DOM 在 D-02b）：`.d-card` > `.d-card-head` +
       `.d-card-body`。`.extension-widget-content` 仍挂着 —— 它带用户的
       「扩展 widget 字号」设置（--extension-widget-font-size）。
       fork:v5-boards D-25 帧 C/D 在这张真卡上补插槽语义：
         · `.d-slotname` = 这个块挂在哪个插槽（真实来自 widget.placement）；
         · `.d-slotmark` = 该插槽的撞车规则（帧 C 的「撞车怎么办」列）；
         · `.d-slotact` = 动作列（这里的真动作就是收起）；
         · `.d-slotoverlay` = 已挂载的正文块（帧 D 的「悬浮区」）。 */
    return (
      <div
        key={`${closing ? "closing:" : ""}${widget.key}`}
        className={`d-row-x${closing ? " is-closing" : " is-open"}`}
      >
        <div className="d-row-x-track">
          <div>
            <section
              key={widget.key}
              id={panelId}
              className="extension-widget-panel d-card"
              aria-labelledby={triggerId}
            >
              <div className="d-card-head" style={{ flexWrap: "wrap" }}>
                <i data-ico="blocks" data-size="14" aria-hidden="true"></i>
                <span className="d-slotname">{slotName}</span>
                <span className="d-mono d-t-xs">{widget.key}</span>
                <span className="d-grow" />
                <span className="d-slotmark">{slotMark}</span>
                <span className="d-badge mute">{widget.lines.length}</span>
                <span className="d-slotact">
                  <button
                    type="button"
                    className="d-iconbtn"
                    onClick={() => toggleWidget(widget)}
                    title={t("i18n.collapse")}
                    aria-label={t("i18n.collapse")}
                  >
                    <i data-ico="chevron-up" data-size="14" aria-hidden="true"></i>
                  </button>
                </span>
              </div>
              <pre className="d-card-body d-mono extension-widget-content d-slotoverlay">
                <AnsiText text={formatExtensionWidgetContent(widget.lines)} />
              </pre>
            </section>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {(expandedWidget || (!mobile && closingWidget)) && (
        <div className="extension-widget-panels">
          {expandedWidget && renderWidgetPanel(expandedWidget, false)}
          {/* 退场面板只在桌面形态保留：PWA 没有 `.m-row-x`，不在窄屏上做双面板。 */}
          {!mobile && closingWidget && closingWidget.key !== expandedWidget?.key
            && renderWidgetPanel(closingWidget, true)}
        </div>
      )}
      <div className="extension-widget-triggers" aria-label={t("chat.extensionWidgets")}>
        {widgets.map((widget, index) => {
          const expandable = widget.lines.length > 0;
          const expanded = expandable && widget.key === expandedWidget?.key;
          const updating = updatingWidgetKeys.has(widget.key);
          const lineCountLabel = t(
            widget.lines.length === 1 ? "chat.extensionWidgetLine" : "chat.extensionWidgetLines",
            { count: widget.lines.length },
          );
          const placementLabel = t(
            widget.placement === "belowEditor"
              ? "chat.extensionWidgetBelow"
              : "chat.extensionWidgetAbove",
          );
          const triggerId = `${idPrefix}-trigger-${index}`;
          const panelId = `${idPrefix}-panel-${index}`;
          const content = (
            <>
              <span className="extension-widget-update-pulse" aria-hidden="true" />
              {/* fork:v5-landing —— 方位三角保留画板图标槽：编辑器下方 = chevron-down、
                  上方 = chevron-up（画板图标集里没有实心三角，`triangle-alert` 是警告语义，
                  不能借用）。外层 `.extension-widget-placement` 仍是产品为 108px 固定格做的
                  定位槽，只去掉旧库的 `pw-ico pw-dim`，图形走 `i[data-ico]`。 */}
              <span className="extension-widget-placement" aria-hidden="true">
                <i data-ico={widget.placement === "belowEditor" ? "chevron-down" : "chevron-up"} data-size="12"></i>
              </span>
              <span className="extension-widget-key">{widget.key}</span>
            </>
          );

          return expandable ? (
            <button
              key={widget.key}
              id={triggerId}
              type="button"
              className={`extension-widget-trigger${expanded ? " is-expanded" : ""}${updating ? " is-updating" : ""}`}
              aria-controls={panelId}
              aria-expanded={expanded}
              aria-label={`${placementLabel}: ${widget.key}, ${lineCountLabel}`}
              title={`${widget.key} - ${placementLabel} - ${expanded ? t("i18n.collapse") : t("i18n.expand")}`}
              onClick={() => toggleWidget(widget)}
            >
              {content}
            </button>
          ) : (
            <div
              key={widget.key}
              /* fork:v5-boards D-25 帧 C/D —— 空 widget = 「插槽声明了、这一格没有内容」：
                 挂上 `.d-slotcard`（板面把「不在本帧」的那张卡画成虚线框），只在桌面形态。 */
              className={`extension-widget-trigger${updating ? " is-updating" : ""}${!mobile ? " d-slotcard" : ""}`}
              aria-label={`${placementLabel}: ${widget.key}, ${lineCountLabel}`}
              title={`${widget.key} - ${placementLabel}`}
            >
              {content}
            </div>
          );
        })}
      </div>
    </>
  );
}
