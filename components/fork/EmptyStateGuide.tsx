"use client";

/**
 * fork:zc-17 — 零会话首屏的三条起步路径 + 能力提示轮播。
 *
 * 为什么需要：一台新机器第一次打开时，侧栏没有任何会话，用户看到的只有一句
 * 「在 … 里做点什么?」和输入框 —— 想开工得先自己找到「选目录」的入口，或者知道
 * 这个应用会扫描别的编辑器最近打开的工作区。这里把「先落到哪里」的三条路直接摆出来。
 *
 * 复用而不是新造：
 *   - 「选目录 / 用最近项目」都走 ChatWindow 已有的 `newSessionTargets`
 *     （`onOpenFolder` / `onPickProject`，与 ProjectChip、侧栏 NewTaskPicker 同一条
 *     `/api/cwd/validate` 注册 allow-root 的路径）；
 *   - 最近项目列表复用 `/api/recent-projects`（`lib/recent-projects.ts`）——只读、
 *     best-effort，打开面板时才请求；
 *   - 能力提示行直接复用 `ComposerTipLine`（MU-33 的轮播实现），ChatWindow 在引导
 *     出现时收掉 composer 上方那一份，避免同一句提示出现两次。
 *
 * 有意保持小巧：只有一个组件、一次懒请求、不引入任何新状态存储。
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { RecentProject } from "@/lib/recent-projects";
import type { NewSessionTargets } from "./ProjectChip";

/** 从会话链接或裸 id 里取出会话 id；解析不出来返回 null（纯函数，便于复用/测试）。 */
export function parseSessionReference(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const fromUrl = /[?&]session=([^&#\s]+)/.exec(value);
  if (fromUrl?.[1]) {
    try {
      return decodeURIComponent(fromUrl[1]);
    } catch {
      return fromUrl[1];
    }
  }
  // 裸 id：pi 的会话 id 是 uuid/hex，允许 . _ - 但不容忍空白或路径分隔符。
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{5,}$/.test(value)) return value;
  return null;
}

function baseName(target: string): string {
  const trimmed = target.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || target;
}

function normalizePathKey(target: string): string {
  return target.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function EmptyStateGuide({
  targets,
  onOpenSession,
  visible = true,
}: {
  targets: NewSessionTargets | null;
  onOpenSession?: (sessionId: string) => void;
  /** ChatWindow 决定是否出现（空新会话 + 尚无任何项目/会话）。 */
  visible?: boolean;
}): ReactNode {
  const { t } = useI18n();
  const [recentOpen, setRecentOpen] = useState(false);
  const [recent, setRecent] = useState<RecentProject[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  // 打开「最近项目」时才请求：平时不发请求，与 NewTaskPicker 同一策略。
  useEffect(() => {
    if (!recentOpen || recent !== null || recentLoading) return;
    let cancelled = false;
    setRecentLoading(true);
    void fetch("/api/recent-projects")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { projects?: RecentProject[] } | null) => {
        if (!cancelled) setRecent(data?.projects ?? []);
      })
      .catch(() => { if (!cancelled) setRecent([]); })
      .finally(() => { if (!cancelled) setRecentLoading(false); });
    return () => { cancelled = true; };
  }, [recent, recentLoading, recentOpen]);

  const pickFromPath = useCallback((path: string) => {
    if (!targets) return;
    const key = normalizePathKey(path);
    const known = targets.projects.find((project) => normalizePathKey(project.root) === key);
    if (known) {
      targets.onPickProject(known);
      return;
    }
    // 不在已知项目里（来自其它编辑器的最近工作区）：root 即身份，
    // AppShell 的 startSessionIn 会先走 /api/cwd/validate 注册 allow-root。
    targets.onPickProject({ key: path, root: path, name: baseName(path) });
  }, [targets]);

  const submitImport = useCallback(() => {
    const sessionId = parseSessionReference(importValue);
    if (!sessionId) {
      setImportError(t("home.guideImportInvalid"));
      return;
    }
    if (!onOpenSession) {
      setImportError(t("home.guideImportUnavailable"));
      return;
    }
    setImportError(null);
    onOpenSession(sessionId);
  }, [importValue, onOpenSession, t]);

  if (!visible || !targets) return null;

  const recentCandidates = (recent ?? []).slice(0, 5);

  // fork:design-components —— 直接照画板 01 的空态：`.pw-empty` 撑满并居中，
  // `.pw-empty-inner` 收拢一条 `.pw-empty-inner h2` + 三张 `.pw-starter`。
  // 展开出来的两块同样只用画板件：最近项目 = `.pw-pop` + `.pw-litem`，
  // 导入 = `.pw-rowgap` + `.pw-input` + `.pw-btn primary sm`，出错是 `.pw-alert`。
  // 三枚图标（folder / clock / import）走 `i[data-ico]`，不再手绘内联 svg；
  // 卡片 hover 由 board.css 的 `.pw-starter:hover` 给，组件里不再改内联底色。
  return (
    <section
      className="pw-empty"
      aria-label={t("home.guideTitle")}
      style={{ padding: "24px 16px 0", overflowY: "auto" }}
    >
      <div className="pw-empty-inner">
        <h2>{t("home.guideTitle")}</h2>
        <div className="pw-starters">
          <button
            type="button"
            className="pw-starter"
            onClick={() => targets.onOpenFolder()}
          >
            <b><span className="pw-ico"><i data-ico="folder" data-size="14"></i></span>{t("home.guidePickFolder")}</b>
            <span>{t("home.guidePickFolderHint")}</span>
          </button>

          <button
            type="button"
            className="pw-starter"
            onClick={() => setRecentOpen((open) => !open)}
            aria-expanded={recentOpen}
          >
            <b><span className="pw-ico"><i data-ico="clock" data-size="14"></i></span>{t("home.guideRecent")}</b>
            <span>{t("home.guideRecentHint")}</span>
          </button>

          <button
            type="button"
            className="pw-starter"
            onClick={() => setImportOpen((open) => !open)}
            aria-expanded={importOpen}
          >
            <b><span className="pw-ico"><i data-ico="import" data-size="14"></i></span>{t("home.guideImport")}</b>
            <span>{t("home.guideImportHint")}</span>
          </button>
        </div>

        {recentOpen && (
          <div className="pw-pop">
            {recentLoading && <span className="pw-pop-title">{t("home.guideRecentLoading")}</span>}
            {!recentLoading && recentCandidates.length === 0 && (
              <span className="pw-pop-title">{t("home.guideRecentEmpty")}</span>
            )}
            {recentCandidates.map((project) => (
              <button
                key={project.path}
                type="button"
                title={project.path}
                onClick={() => pickFromPath(project.path)}
                className="pw-litem"
                style={{ width: "100%" }}
              >
                <span className="pw-ico"><i data-ico="folder" data-size="14"></i></span>
                <span className="grow">
                  <span className="pw-lname">{baseName(project.path)}</span>
                  <span className="pw-lsub">{project.source}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {importOpen && (
          <div className="pw-rowgap" style={{ width: "100%" }}>
            <div className="pw-wrap">
              <input
                className="pw-input"
                style={{ flex: 1, minWidth: 180 }}
                value={importValue}
                onChange={(event) => { setImportValue(event.target.value); setImportError(null); }}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) submitImport(); }}
                placeholder={t("home.guideImportPlaceholder")}
                aria-label={t("home.guideImport")}
                spellCheck={false}
              />
              <button
                type="button"
                className="pw-btn primary sm"
                onClick={submitImport}
              >
                {t("home.guideImportAction")}
              </button>
            </div>
            {importError && (
              <span role="alert" className="pw-alert">{importError}</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
