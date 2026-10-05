"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
// fork:pwa-sidebar —— 触控档把行内动作从 hover 改成常驻（与侧栏其它行同一口径）。
import { useIsCompact, useIsMobile } from "@/hooks/useIsMobile";

/*
 * 聊天 分区标题行（fork feature: `docs/patches/0001-chat-workspace.md`）。
 *
 * fork:v5-landing —— 结构照画板 D-02d 帧 A 的聊天 pane 工作区行抄：
 *   `.d-group-title`（chevron-down 折叠 / 名称 / 计数 / `.d-iconbtn` 新建与设置目录）。
 * 行为一字不动：
 * - 点行        -> 切到聊天工作区（文件树、标签、每工作区会话记忆一起跟着走）
 * - `+`         -> 在聊天工作区直接开新对话
 * - folder-cog  -> 换聊天目录
 * - 折叠箭头    -> 展开/收起它下面的会话列表
 *
 * fork:v5-wave-b —— 窄屏分支照画板 **M-04 帧 A/B** 的抽屉行抄 DOM：
 *   `.m-row`（`.m-row-t` 名称 + `.m-row-m` 读数与动作），动作钮换 `.m-iconbtn`。
 *   四个回调（切工作区 / 折叠 / 新建聊天 / 换聊天目录）与忙态原样接回，DOM 之外零变化。
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
  const touchActions = useIsCompact();
  // fork:v5-wave-b —— 形态判据必须是 `useIsMobile`（≤640，与 pwa/system.css 的
  // @import 媒体条件同断点）：d-* 只在 ≥641 生效，平板档（641–1024）仍是 d-* DOM。
  const isPhone = useIsMobile();

  if (isPhone) {
    return (
      <div className="m-row">
        {/* 画板 M-04 的行是「标题行 + 副行」两层；第一层就是切换工作区的主触发钮。
            它用 `.m-row-t`（库里的 span 件）+ role=button，与同一条抽屉里的项目行
            同一写法（span 不需要按钮 UA 归零，内联只留 cursor）。 */}
        <span
          role="button"
          tabIndex={0}
          onClick={onSelect}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onSelect();
          }}
          title={title}
          aria-current={selected ? "page" : undefined}
          className="m-row-t"
          style={{ cursor: "pointer" }}
        >
          <i data-ico="messages-square" data-size="14" aria-hidden="true"></i>
          {label}
        </span>
        {/* 第二行是行内动作（折叠 / 新建聊天 / 换聊天目录）+ 未读读数：画板 M-04 的
            会话行没有行内动作，但它们在产品里是既有行为，所以照 `.m-row-m` +
            `.m-iconbtn` / `.m-badge` 的画板件摆，不新造类、不改回调。 */}
        <span className="m-row-m">
          {activity && activity.unread > 0 && (
            <span className="m-badge ok" title={t("sidebar.newSessionActivity")} aria-label={`${t("sidebar.newSessionActivity")} (${activity.unread})`}>
              <i data-ico="circle" data-size="8"></i>
              {activity.unread}
            </span>
          )}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            title={t(expanded ? "sidebar.collapseSubagents" : "sidebar.expandSubagents")}
            aria-label={t(expanded ? "sidebar.collapseSubagents" : "sidebar.expandSubagents")}
            className="m-iconbtn"
          >
            <i data-ico={expanded ? "chevron-down" : "chevron-right"} data-size="12"></i>
          </button>
          <button
            type="button"
            onClick={onNewChat}
            disabled={busy}
            title={t("sidebar.newChat")}
            aria-label={t("sidebar.newChat")}
            className="m-iconbtn"
          >
            <i data-ico="plus" data-size="13"></i>
          </button>
          <button
            type="button"
            onClick={onConfigure}
            disabled={busy}
            title={t("sidebar.setChatWorkspace")}
            aria-label={t("sidebar.setChatWorkspace")}
            className="m-iconbtn"
          >
            <i data-ico="folder-cog" data-size="13"></i>
          </button>
        </span>
      </div>
    );
  }

  return (
    // fork:v5-frame-audit-2026-10-05 —— 聊天工作区行照画板 D-02d 帧 A「聊天 pane」的原文：
    //   `<div class="d-group-title"><i chevron><span class="d-grow">随手问</span><span class="d-t-xs">4</span>`
    //   `<button class="d-iconbtn" ＋><button class="d-iconbtn" folder-cog></div>`
    // 板面上名字是一个 `span.d-grow`，折叠箭头是一枚裸 `<i>`；产品此前把整块做成
    // `button.d-row.d-grow` 并给名字前面多加了一枚 `messages-square` 图标。
    // 现在头行是 div + role=button（Enter / 空格等价），四个回调原样接回。
    <div
      role="button"
      tabIndex={0}
      className="d-group-title"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
      aria-current={selected ? "page" : undefined}
      style={{ width: "100%", cursor: "pointer" }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        aria-expanded={expanded}
        title={t(expanded ? "sidebar.collapseSubagents" : "sidebar.expandSubagents")}
        aria-label={t(expanded ? "sidebar.collapseSubagents" : "sidebar.expandSubagents")}
        className="d-iconbtn"
      >
        <i data-ico={expanded ? "chevron-down" : "chevron-right"} data-size="12"></i>
      </button>

      <span className="d-grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>

      {activity && activity.unread > 0 && (
        <span className="d-badge ok" title={t("sidebar.newSessionActivity")} aria-label={`${t("sidebar.newSessionActivity")} (${activity.unread})`}>
          <i data-ico="circle" data-size="8"></i>
          {activity.unread}
        </span>
      )}

      <span className={`d-msg-acts${hovered || touchActions ? " is-on" : ""}`}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNewChat(); }}
          disabled={busy}
          title={t("sidebar.newChat")}
          aria-label={t("sidebar.newChat")}
          className="d-iconbtn"
        >
          <i data-ico="plus" data-size="13"></i>
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onConfigure(); }}
          disabled={busy}
          title={t("sidebar.setChatWorkspace")}
          aria-label={t("sidebar.setChatWorkspace")}
          className="d-iconbtn"
        >
          <i data-ico="folder-cog" data-size="13"></i>
        </button>
      </span>
    </div>
  );
}
