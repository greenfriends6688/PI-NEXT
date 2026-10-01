"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { TEXT } from "@/lib/typography";
import type { SessionStatsInfo } from "@/lib/pi-types";
// fork:zm-04 — token / 成本 / 耗时这些数字变化时逐位滚动，而不是整串跳。
import { RollingNumber } from "./fork/RollingNumber";

/**
 * fork:ui-stats-ring —— 会话统计的展示形态（用户裁定，2026-09-29）：
 * composer 下方的常显长条删除，完整统计收进输入框工具条右下角的**上下文环浮窗**
 * （画板 01 帧 C / 画板 20 的「用量收进圆环」路线）。本文件只剩浮窗用的
 * 明细组件与格式化助手；折叠长条（.pw-stats）随旧形态一起删除。
 */

type SessionCopyField = "file" | "id" | "projectDir" | "gitBranch" | "gitWorktree";

export interface ContextUsageInfo {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

/** 只取面板要展示的字段，避免把整个 SessionInfo 拖进这个纯展示组件。 */
export interface SessionStatsSessionInfo {
  projectRoot?: string | null;
  cwd: string;
  branch?: string | null;
  isWorktree?: boolean;
}

export function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return String(value);
}

export function formatStatsDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
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
  session: SessionStatsSessionInfo | null;
}

/**
 * 浮窗里的三栏明细：会话信息（名称 / 文件 / ID / 活跃时长 / 项目目录 / Git 分支，
 * 带复制钮）· 消息计数 · Token / 费用 / 上下文 / 命中率。
 * 数据与旧展开面板完全一致，只是宿主从「输入框下方的展开面板」换成了环浮窗。
 */
export function SessionStatsDetails({ sessionStats, contextUsage, session }: SessionStatsDetailsProps) {
  const { t, locale } = useI18n();
  const [copiedField, setCopiedField] = useState<SessionCopyField | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const handleCopy = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      setCopiedField(field);
      copyTimerRef.current = setTimeout(() => setCopiedField(null), 1400);
    });
  }, []);

  const tokens = sessionStats?.tokens;
  const cost = sessionStats?.cost ?? 0;
  const totalMessages = sessionStats?.totalMessages ?? 0;
  const ctx = contextUsage ?? sessionStats?.contextUsage ?? null;

  // 会话文件随消息数增长；几千条之后打开/切换会肉眼可见变慢，这里把阈值做成颜色提示。
  const messageCountColor = totalMessages > 5000
    ? "var(--danger)"
    : totalMessages > 2000
      ? "var(--warning)"
      : "var(--text)";

  const hitRate = tokens ? cacheHitRate(tokens) : null;

  const formatNumber = (value: number) => value.toLocaleString(locale);

  const rows: Array<[string, ReactNode, SessionCopyField | null]> = [];
  if (sessionStats) {
    if (sessionStats.sessionName) rows.push([t("session.name"), sessionStats.sessionName, null]);
    rows.push([t("session.file"), sessionStats.sessionFile ?? t("session.inMemory"), "file"]);
    rows.push([t("session.id"), sessionStats.sessionId, "id"]);
    // fork:zm-04 — 耗时每秒都在变，滚动比跳字更不容易看成「页面在闪」。
    if ((sessionStats.totalActiveMs ?? 0) > 0) {
      rows.push([t("session.totalActive"), <RollingNumber key="active" value={formatStatsDuration(sessionStats.totalActiveMs ?? 0)} />, null]);
    }
    if (session) {
      rows.push([t("session.projectDir"), session.projectRoot ?? session.cwd, "projectDir"]);
      if (session.branch) rows.push([t("session.gitBranch"), session.branch, "gitBranch"]);
      if (session.isWorktree) rows.push([t("session.gitWorktree"), session.cwd, "gitWorktree"]);
    }
  }

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

  const copyTitleKey: Record<SessionCopyField, string> = {
    file: "session.copyFile",
    id: "session.copyId",
    projectDir: "session.copyProjectDir",
    gitBranch: "session.copyGitBranch",
    gitWorktree: "session.copyGitWorktree",
  };

  const renderSection = (title: string, sectionRows: Array<[string, ReactNode, SessionCopyField | null]>, titleColor?: string) => (
    <div key={title} style={{ minWidth: 168, maxWidth: 320 }}>
      {/* fork:design-components —— 会话文件越大切换越慢，这一档提醒放在「消息」小节标题上。 */}
      <div style={{ fontSize: TEXT.xs, fontWeight: 700, color: titleColor ?? "var(--text)", marginBottom: 6 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", columnGap: "var(--s3)", rowGap: "var(--s1)" }}>
        {sectionRows.map(([label, value, copyField]) => (
          <div key={`${title}:${label}`} style={{ display: "contents" }}>
            <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{label}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, minWidth: 0 }}>
              <span style={{
                color: "var(--text-muted)",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontVariantNumeric: "tabular-nums",
              }} title={typeof value === "string" ? value : undefined}>{value}</span>
              {copyField && typeof value === "string" && (
                <button
                  type="button"
                  title={copiedField === copyField ? t("session.copied") : t(copyTitleKey[copyField])}
                  aria-label={copiedField === copyField ? t("session.copied") : t(copyTitleKey[copyField])}
                  onClick={() => handleCopy(copyField, value)}
                  style={{
                    flex: "0 0 auto",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 20,
                    height: 20,
                    padding: 0,
                    color: copiedField === copyField ? "var(--accent)" : "var(--text-dim)",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-xs)",
                    cursor: "pointer",
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {copiedField === copyField
                      ? <path d="m5 13 4 4L19 7" />
                      : <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>}
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  if (!sessionStats && !ctx) return null;

  return (
    <>
      {rows.length > 0 && renderSection(t("session.infoSection"), rows)}
      {messageRows.length > 0 && renderSection(t("session.messages"), messageRows.map(([label, value]) => [label, value, null] as [string, string, SessionCopyField | null]), messageCountColor)}
      {tokenRows.length > 0 && renderSection(t("session.tokens"), tokenRows.map(([label, value]) => [label, value, null] as [string, string, SessionCopyField | null]))}
    </>
  );
}
