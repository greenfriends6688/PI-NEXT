"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { AnsiText } from "@/components/AnsiText";
import type { ExtensionWidgetItem } from "@/lib/types";

export const DEFAULT_EXPANDED_WIDGET_LINES = 3;
export const WIDGET_UPDATE_IDLE_MS = 1100;

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
  const { t } = useI18n();
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

  if (widgets.length === 0) return null;

  const expandedWidget = widgets.find((widget) => (
    widget.key === expandedWidgetKey
    && widget.lines.length > 0
  ));

  const toggleWidget = (widget: ExtensionWidgetItem) => {
    setExpandedWidgetKey((current) => getNextExpandedWidgetKey(current, widget.key));
  };

  return (
    <>
      {expandedWidget && (
        <div className="extension-widget-panels">
          {(() => {
            const widget = expandedWidget;
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
            return (
              /* fork:v5-landing —— 展开面板 = v5 画板 D-02b 帧 C「插件状态浮窗」里那张真实的
                 扩展 widget 卡（BOARDS.md 把 ExtensionWidgets 归到 D-25 的「扩展小部件」，
                 但 D-25 只声明插槽、不画运行时 widget；真正渲染 widget 的 DOM 在 D-02b）：
                 `.d-card` > `.d-card-head`（blocks 图标 + 等宽键名 + 行数徽章 + chevron 收起钮）
                 + `.d-card-body`（等宽正文）。`.extension-widget-content` 仍挂着 —— 它带用户的
                 「扩展 widget 字号」设置（--extension-widget-font-size）。 */
              <section
                key={widget.key}
                id={panelId}
                className="extension-widget-panel d-card"
                aria-labelledby={triggerId}
              >
                <div className="d-card-head">
                  <i data-ico="blocks" data-size="14" aria-hidden="true"></i>
                  <span className="d-mono d-t-xs">{widget.key}</span>
                  <span className="d-grow" />
                  <span className="d-badge mute">{widget.lines.length}</span>
                  <button
                    type="button"
                    className="d-iconbtn"
                    onClick={() => toggleWidget(widget)}
                    title={t("i18n.collapse")}
                    aria-label={t("i18n.collapse")}
                  >
                    <i data-ico="chevron-up" data-size="14" aria-hidden="true"></i>
                  </button>
                </div>
                <pre className="d-card-body d-mono extension-widget-content">
                  <AnsiText text={formatExtensionWidgetContent(widget.lines)} />
                </pre>
              </section>
            );
          })()}
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
              className={`extension-widget-trigger${updating ? " is-updating" : ""}`}
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
