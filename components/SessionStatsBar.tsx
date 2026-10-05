"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { SessionStatsInfo } from "@/lib/pi-types";

/**
 * fork:ui-stats-ring —— 会话统计的展示形态（用户裁定，2026-09-29）：
 * composer 下方的常显长条删除，完整统计收进输入框工具条右下角的**上下文环浮窗**
 * （画板 01 帧 C / 画板 20 的「用量收进圆环」路线）。本文件只剩浮窗用的
 * 明细组件与格式化助手；旧统计长条随旧形态一起删除。
 *
 * fork:trace-menu（用户 2026-10-02）—— 浮窗只剩**读数**：消息计数、token / 费用 /
 * 上下文 / 命中率。会话文件 / ID / 项目目录 / 分支 / worktree 这些带复制钮的**动作**
 * 搬去了顶栏的 ⋯ 菜单，所以本文件不再持有剪贴板状态与 `session` 入参。
 *
 * 用户裁定（2026-10）——「会话信息」整栏（名称 / 活跃时长）删除：这两条在侧栏行和
 * 顶栏标题处都已在眼前，浮窗只留用量读数。
 */

export interface ContextUsageInfo {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return String(value);
}

/** 缓存命中率 = 缓存读 / (输入 + 缓存写 + 缓存读)，分母覆盖所有输入类 token。 */
export function cacheHitRate(tokens: SessionStatsInfo["tokens"]): number | null {
  const denominator = tokens.cacheRead + tokens.cacheWrite + tokens.input;
  if (tokens.cacheRead + tokens.cacheWrite <= 0 || denominator <= 0) return null;
  return (tokens.cacheRead / denominator) * 100;
}

interface SessionStatsDetailsProps {
  sessionStats: SessionStatsInfo | null;
  contextUsage: ContextUsageInfo | null;
}

/**
 * 浮窗里的两栏明细：消息计数 · Token / 费用 / 上下文 / 命中率。
 * 宿主是输入框右下角上下文环的浮窗；路径类动作在顶栏 ⋯ 菜单。
 */
export function SessionStatsDetails({ sessionStats, contextUsage }: SessionStatsDetailsProps) {
  const { t, locale } = useI18n();
  const isMobile = useIsMobile();

  const tokens = sessionStats?.tokens;
  const cost = sessionStats?.cost ?? 0;
  const totalMessages = sessionStats?.totalMessages ?? 0;
  const ctx = contextUsage ?? sessionStats?.contextUsage ?? null;

  // 会话文件随消息数增长；几千条之后打开/切换会肉眼可见变慢，这里把阈值做成徽章提示。
  const messageCountBadge = totalMessages > 5000 ? (
    <span className="d-badge bad"><i data-ico="triangle-alert" data-size="12"></i></span>
  ) : totalMessages > 2000 ? (
    <span className="d-badge warn"><i data-ico="triangle-alert" data-size="12"></i></span>
  ) : null;

  const hitRate = tokens ? cacheHitRate(tokens) : null;

  const formatNumber = (value: number) => value.toLocaleString(locale);

  const messageRows: Array<[string, string]> = sessionStats ? [
    [t("session.user"), formatNumber(sessionStats.userMessages)],
    [t("session.assistant"), formatNumber(sessionStats.assistantMessages)],
    [t("session.toolCalls"), formatNumber(sessionStats.toolCalls)],
    [t("session.toolResults"), formatNumber(sessionStats.toolResults)],
    [t("session.total"), formatNumber(sessionStats.totalMessages)],
  ] : [];

  const tokenRows: Array<[string, string]> = tokens ? [
    [t("session.input"), formatNumber(tokens.input)],
    [t("session.output"), formatNumber(tokens.output)],
    ...(tokens.cacheRead > 0 ? [[t("session.cacheRead"), formatNumber(tokens.cacheRead)] as [string, string]] : []),
    ...(tokens.cacheWrite > 0 ? [[t("session.cacheWrite"), formatNumber(tokens.cacheWrite)] as [string, string]] : []),
    [t("session.total"), formatNumber(tokens.total)],
    ...(cost > 0 ? [[t("session.cost"), `$${cost.toFixed(4)}`] as [string, string]] : []),
    ...(ctx?.contextWindow
      ? [[t("session.context"), `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompactTokens(ctx.contextWindow)}`] as [string, string]] : []),
    ...(hitRate !== null ? [[t("session.cacheHitRate"), `${hitRate.toFixed(1)}%`] as [string, string]] : []),
  ] : [];

  /* fork:v5-skin D-04 —— 三栏明细换画板基件：.d-col 成节、.d-t-xs.d-t-b 作标题、
     .d-kv-row 承载「标签 → 值」行（值列自动右对齐、等宽数字）。 */
  const renderSection = (title: string, sectionRows: Array<[string, ReactNode]>, badge?: ReactNode) => (
    <div key={title} className="d-col" style={{ minWidth: 168, maxWidth: 320, gap: "var(--nx-sp-1)" }}>
      <div className="d-row">
        <span className="d-t-xs d-t-b">{title}</span>
        {badge}
      </div>
      {sectionRows.map(([label, value]) => (
        <div key={`${title}:${label}`} className="d-kv-row">
          <span>{label}</span>
          <span
            title={typeof value === "string" ? value : undefined}
            style={{ fontVariantNumeric: "tabular-nums", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >{value}</span>
        </div>
      ))}
    </div>
  );

  /* fork:v5-wave-b —— 窄屏（PWA 形态）同一份数据、另一种基件：M-03 / M-08 的
     `.m-group-title` 分节 + `.m-sheet-row` 一行一个读数。手机上没有三栏并排的
     宽度，明细是躺在输入卡上方那块面板里读的 —— 竖着一行一个才读得完。 */
  const renderPwaSection = (title: string, sectionRows: Array<[string, ReactNode]>) => (
    <div key={title}>
      <div className="m-group-title">{title}</div>
      {sectionRows.map(([label, value]) => (
        <div key={`${title}:${label}`} className="m-sheet-row">
          <span className="m-grow m-setrow-t">{label}</span>
          <span className="m-mono">{value}</span>
        </div>
      ))}
    </div>
  );

  if (!sessionStats && !ctx) return null;

  if (isMobile) {
    return (
      <>
        {messageRows.length > 0 && renderPwaSection(t("session.messages"), messageRows)}
        {tokenRows.length > 0 && renderPwaSection(t("session.tokens"), tokenRows)}
      </>
    );
  }

  return (
    <>
      {messageRows.length > 0 && renderSection(t("session.messages"), messageRows, messageCountBadge)}
      {tokenRows.length > 0 && renderSection(t("session.tokens"), tokenRows)}
    </>
  );
}
