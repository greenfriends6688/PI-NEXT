"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { stripAnsi } from "@/lib/ansi";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import { AnsiText } from "./AnsiText";
import { ExtensionWidgets } from "./ExtensionWidgets";

export function sanitizeExtensionStatusText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").replace(/ +/g, " ").trim())
    .join("\n")
    .trim();
}

export function formatExtensionStatusLine(statuses: ExtensionStatusItem[]): string {
  return [...statuses]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ text }) => sanitizeExtensionStatusText(text))
    .join(" ");
}

export function ExtensionStatusBar({
  statuses,
  widgets = [],
  trailing,
}: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
  /** fork:ui-stats-inline — 挂在状态条右端的额外内容（会话统计）。 */
  trailing?: ReactNode;
}) {
  if (statuses.length === 0 && widgets.length === 0 && !trailing) return null;

  const statusLine = formatExtensionStatusLine(statuses);
  const plainStatusLine = stripAnsi(statusLine);

  return (
    <div
      className={`extension-status-shelf${widgets.length > 0 ? " has-widgets" : ""}${statuses.length > 0 ? " has-status" : ""}`}
    >
      {widgets.length > 0 && <ExtensionWidgets widgets={widgets} />}
      {statuses.length > 0 && (
        <div
          role="status"
          className="extension-status-line"
          aria-label={plainStatusLine}
          title={plainStatusLine}
        >
          <span className="extension-status-text">
            <AnsiText text={statusLine} />
          </span>
        </div>
      )}
      {trailing && (
        <div className="extension-status-trailing">{trailing}</div>
      )}
    </div>
  );
}

/**
 * fork:ui-ext-float —— 扩展状态的**右上角浮标**形态（用户裁定，2026-09-29）：
 * 输入框下方不再有任何常驻行，MCP / ponytail 状态收成聊天区右上角的一枚
 * 胶囊浮标；带插件 widget 时点击展开面板（widget 触发行 + 面板都在浮层里）。
 * 定位（absolute top-right）由宿主提供，本组件只负责胶囊本体与展开面板。
 */
export function ExtensionStatusFloat({
  statuses,
  widgets = [],
}: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
}) {
  const [open, setOpen] = useState(false);

  if (statuses.length === 0 && widgets.length === 0) return null;

  const statusLine = formatExtensionStatusLine(statuses);
  const plainStatusLine = stripAnsi(statusLine);
  const expandable = widgets.length > 0;

  return (
    <div style={{ position: "relative", pointerEvents: "auto" }}>
      <button
        type="button"
        className="ext-float-pill"
        onClick={expandable ? () => setOpen((v) => !v) : undefined}
        aria-expanded={expandable ? open : undefined}
        aria-label={plainStatusLine}
        title={plainStatusLine}
        style={{ cursor: expandable ? "pointer" : "default" }}
      >
        <span className="ext-float-text">
          <AnsiText text={statusLine} />
        </span>
        {expandable && (
          <span className="pw-ico" style={{ display: "inline-flex", flexShrink: 0 }}>
            <i data-ico={open ? "chevron-up" : "chevron-down"} data-size="12"></i>
          </span>
        )}
      </button>
      {open && expandable && (
        <div
          className="ext-float-panel"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 40,
            width: "min(420px, calc(100vw - 32px))",
          }}
        >
          <ExtensionWidgets widgets={widgets} />
        </div>
      )}
    </div>
  );
}
