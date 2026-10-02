"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getFileDirectory, getFileName, getRelativeFilePath } from "@/lib/file-paths";
import type { ChangeEntry, ProjectChanges } from "@/lib/change-sources";
import type { GitFileStatusKind } from "@/lib/git-types";
import type { WrittenFile } from "@/lib/turn-written-files";
import { getFileIcon } from "../FileIcons";

/**
 * fork:proma-39-changes — 右栏「改动」面板。
 *
 * 依据 Proma `components/diff/DiffChangesList.tsx`，只取与本仓数据模型对得上的部分：
 * 一张合并后的改动列表（Git 工作区 / 非 Git 会话写入 / 项目记忆），每行可点开预览、
 * 可在文件管理器中定位。目录分组、worktree 选择器、搜索、revert 都不做 —— 本仓没有
 * 对应的授权面（revert 会写工作区，不在本 PR 范围）。
 *
 * 两条行为契约：
 *
 * 1. **绝不自动跳转**（Proma v0.19.1 专门回退的行为）。轮询到新改动时只累加
 *    未读计数并上报给 AppShell 画圆点，不碰 activeTabId。用户点进来（`active`
 *    变 true）才把当前列表标记为已读。
 * 2. **刷新只发生在数据层**。合并按 `samePath()` 去重在服务端做（`/api/changes`），
 *    这里不自己比路径，避免客户端拿 Node 的 `path`。
 *
 * 过滤（dotfile 目录）也全部在 `lib/change-sources.ts`：面板拿到的已经是最终列表。
 */

const REFRESH_INTERVAL_MS = 4_000;

const STATUS_KEYS: Record<GitFileStatusKind, string> = {
  modified: "files.modified",
  added: "files.added",
  deleted: "files.deleted",
  renamed: "files.renamed",
  untracked: "files.untracked",
  conflict: "files.conflict",
};

const SOURCE_KEYS: Record<ChangeEntry["source"], string> = {
  git: "changes.sourceGit",
  session: "changes.sourceSession",
  memory: "changes.sourceMemory",
};

interface Props {
  /** 会话工作目录；空串时不请求（新会话还没落 cwd）。 */
  cwd: string;
  /** 本会话工具写入的文件（AppShell 从 ChatWindow 聚合上来）。 */
  writtenFiles: WrittenFile[];
  /** 当前这条 tab 是否可见；可见即视为已读。 */
  active: boolean;
  /** 打开预览：Git 行给 diff 模式，会话 / 记忆行给普通预览。 */
  onOpenFile: (filePath: string, modeHint: "preview" | "diff") => void;
  /** 未读计数上报（0 = 无新改动）。 */
  onUnseenChange?: (unseen: number) => void;
}

export function ChangesPanel({ cwd, writtenFiles, active, onOpenFile, onUnseenChange }: Props) {
  const { t } = useI18n();
  const [changes, setChanges] = useState<ChangeEntry[]>([]);
  const [isGitRepository, setIsGitRepository] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [failedPath, setFailedPath] = useState<string | null>(null);

  // 已读路径集合与「是否已经拿到过第一批数据」分开：首帧不把整张列表算成未读。
  const seenRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const requestSeqRef = useRef(0);

  const writtenKey = useMemo(() => writtenFiles.map((file) => file.filePath).join("\n"), [writtenFiles]);

  const fetchChanges = useCallback(async () => {
    if (!cwd) return;
    const requestId = ++requestSeqRef.current;
    try {
      const res = await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, writtenFiles: writtenKey ? writtenKey.split("\n") : [] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ProjectChanges;
      if (requestId !== requestSeqRef.current) return;
      setChanges(data.changes);
      setIsGitRepository(data.isGitRepository);
      setError(false);
      setLoading(false);

      const paths = data.changes.map((change) => change.filePath);
      if (!initializedRef.current) {
        initializedRef.current = true;
        for (const filePath of paths) seenRef.current.add(filePath);
      } else if (activeRef.current) {
        for (const filePath of paths) seenRef.current.add(filePath);
        setUnseen(0);
      } else {
        const fresh = paths.filter((filePath) => !seenRef.current.has(filePath));
        if (fresh.length > 0) setUnseen(fresh.length);
      }
    } catch {
      if (requestId !== requestSeqRef.current) return;
      setError(true);
      setLoading(false);
    }
  }, [cwd, writtenKey]);

  // 轮询的引用永远指向最新一次闭包，这样 cwd / writtenKey 变化不会重建 interval，
  // 也就不会把「已读」集合和未读计数反复清零。
  const fetchRef = useRef(fetchChanges);
  fetchRef.current = fetchChanges;

  useEffect(() => {
    if (!cwd) {
      setLoading(false);
      return;
    }
    initializedRef.current = false;
    seenRef.current = new Set();
    setUnseen(0);
    setLoading(true);
    void fetchRef.current();
    const timer = window.setInterval(() => void fetchRef.current(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [cwd]);

  // 会话新写入的文件立刻触发一次刷新（非 Git 项目的来源）。首批由上面的 effect 负责，
  // 这里只看「已经初始化过」之后的变化，避免挂载时重复请求。
  useEffect(() => {
    if (!cwd || !initializedRef.current) return;
    void fetchRef.current();
  }, [cwd, writtenKey]);

  // 用户切到这条 tab：当前列表全部视为已读。
  useEffect(() => {
    if (!active) return;
    for (const change of changes) seenRef.current.add(change.filePath);
    setUnseen(0);
  }, [active, changes]);

  useEffect(() => {
    onUnseenChange?.(unseen);
  }, [unseen, onUnseenChange]);

  const reveal = useCallback(async (filePath: string) => {
    try {
      const res = await fetch("/api/files/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, action: "reveal" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFailedPath((current) => (current === filePath ? null : current));
    } catch {
      setFailedPath(filePath);
      window.setTimeout(() => setFailedPath((current) => (current === filePath ? null : current)), 2600);
    }
  }, []);

  const emptyMessage = error
    ? t("changes.error")
    : loading
      ? t("changes.loading")
      : isGitRepository
        ? t("changes.empty")
        : t("changes.emptyNonGit");

  return (
    <div className="fork-changes">
      <div className="fork-changes-head pw-panel-head">
        <span className="pw-ico">
          <i data-ico="file-diff" data-size="14" aria-hidden="true"></i>
        </span>
        <span className="fork-changes-title">{t("changes.title")}</span>
        {!loading && !error && changes.length > 0 && (
          <span className="pw-badge count">{t("process.summaryFiles", { count: changes.length })}</span>
        )}
        {unseen > 0 && (
          <span className="pw-badge accent count" title={t("changes.unseen", { count: unseen })}>
            {unseen}
          </span>
        )}
        <span className="grow" />
        <button
          type="button"
          className="pw-iconbtn sm"
          onClick={() => void fetchChanges()}
          title={t("changes.refresh")}
          aria-label={t("changes.refresh")}
        >
          <i data-ico="refresh-cw" data-size="14" aria-hidden="true"></i>
        </button>
      </div>

      {changes.length === 0 ? (
        <div className="fork-changes-empty pw-empty">
          <div className="pw-empty-inner">
            <p>{emptyMessage}</p>
          </div>
        </div>
      ) : (
        <div className="fork-changes-list">
          {changes.map((change) => {
            const name = getFileName(change.filePath);
            const relative = getRelativeFilePath(change.filePath, cwd);
            const directory = getFileDirectory(relative);
            return (
              <div key={change.filePath} className="fork-changes-row" data-source={change.source}>
                <button
                  type="button"
                  className="fork-changes-open"
                  title={change.filePath}
                  aria-label={t("changes.openFile", { name })}
                  onClick={() => onOpenFile(change.filePath, change.source === "git" ? "diff" : "preview")}
                >
                  <span className="pw-ico">{getFileIcon(name, 14)}</span>
                  <span className="fork-changes-name">{name}</span>
                  {directory && directory !== "." && <span className="fork-changes-dir">{directory}</span>}
                </button>
                <span className="fork-changes-source pw-badge">{t(SOURCE_KEYS[change.source])}</span>
                {(change.additions ?? 0) > 0 && (
                  <span className="fork-changes-stat fork-changes-add">+{change.additions}</span>
                )}
                {(change.deletions ?? 0) > 0 && (
                  <span className="fork-changes-stat fork-changes-del">-{change.deletions}</span>
                )}
                {change.status && (
                  <span
                    className="fork-changes-status"
                    data-status={change.status}
                    title={t(STATUS_KEYS[change.status])}
                    aria-label={t(STATUS_KEYS[change.status])}
                  >
                    {change.status.charAt(0).toUpperCase()}
                  </span>
                )}
                <button
                  type="button"
                  className={`pw-iconbtn sm fork-changes-reveal${failedPath === change.filePath ? " danger" : ""}`}
                  onClick={() => void reveal(change.filePath)}
                  title={failedPath === change.filePath ? t("files.pathActionFailed") : t("files.revealPath")}
                  aria-label={t("files.revealPath")}
                >
                  <i data-ico="folder-search" data-size="13" aria-hidden="true"></i>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
