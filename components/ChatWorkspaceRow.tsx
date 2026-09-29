"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";

/**
 * 聊天 分区标题行（fork feature: `docs/patches/0001-chat-workspace.md`）。
 *
 * fork:design-components —— 结构与样式**直接取画板 02 的 B 帧**：
 * 工作区行 = `.pw-row`（folder 换成 messages-square + 名称 + 计数 + `.pw-acts`），
 * 下面的会话列表由 SessionSidebar 用同一套 `.pw-session` 渲染。
 *
 * 交互分工：
 * - 点行        -> 切到聊天工作区（文件树、标签、每工作区会话记忆一起跟着走）
 * - `+`         -> 在聊天工作区直接开新对话
 * - 齿轮        -> 换聊天目录
 * - 折叠箭头    -> 展开/收起它下面的会话列表
 */
export function ChatWorkspaceRow({
  label,
  title,
  selected,
  expanded,
  activity,
  onSelect,
  onToggle,
  onNewChat,
  onConfigure,
  busy = false,
}: {
  label: string;
  title: string;
  selected: boolean;
  expanded: boolean;
  activity?: { running: number; unread: number };
  onSelect: () => void;
  onToggle: () => void;
  onNewChat: () => void;
  onConfigure: () => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="pw-row"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: "100%" }}
    >
      <button
        type="button"
        onClick={onSelect}
        title={title}
        aria-current={selected ? "page" : undefined}
        className="pw-inline"
        style={{ flex: 1, minWidth: 0, background: "none", border: 0, padding: 0, cursor: "pointer", color: "inherit", font: "inherit" }}
      >
        <span className="pw-ico"><i data-ico="messages-square" data-size="14"></i></span>
        <span className="pw-name">{label}</span>
        <span className="grow" />
      </button>

      {activity && (activity.running > 0 || activity.unread > 0) && (
        <span className="pw-inline" style={{ gap: 4, flexShrink: 0 }}>
          {activity.running > 0 && (
            <span className="pw-badge accent count" title={t("sidebar.agentRunning")}>
              <span className="pw-ico"><i data-ico="loader-circle" data-size="11"></i></span>
              {activity.running}
            </span>
          )}
          {activity.unread > 0 && (
            <span className="pw-badge ok count" title={t("sidebar.newSessionActivity")}>
              <span className="pw-ico"><i data-ico="circle" data-size="8"></i></span>
              {activity.unread}
            </span>
          )}
        </span>
      )}

      <span className="pw-acts" style={{ opacity: hovered ? 1 : 0, flexShrink: 0 }}>
        <button
          type="button"
          onClick={onNewChat}
          disabled={busy}
          title={t("sidebar.newChat")}
          aria-label={t("sidebar.newChat")}
          className="pw-iconbtn sm"
        >
          <span className="pw-ico"><i data-ico="plus" data-size="14"></i></span>
        </button>
        <button
          type="button"
          onClick={onConfigure}
          disabled={busy}
          title={t("sidebar.setChatWorkspace")}
          aria-label={t("sidebar.setChatWorkspace")}
          className="pw-iconbtn sm"
        >
          <span className="pw-ico"><i data-ico="settings" data-size="14"></i></span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? t("sidebar.collapseSubagents") : t("sidebar.expandSubagents")}
          className="pw-iconbtn sm"
        >
          <span className="pw-ico"><i data-ico={expanded ? "chevron-down" : "chevron-right"} data-size="12"></i></span>
        </button>
      </span>
    </div>
  );
}
