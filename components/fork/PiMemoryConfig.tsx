"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  ConfigButton,
  ConfigDetail,
  ConfigDetailActions,
  ConfigDetailHeader,
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigField,
  ConfigSidebar,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSplitView,
  ConfigSwitch,
  PwBlock,
  PwCtl,
  PwPageHead,
} from "../SettingsUi";
import { PI_MEMORY_PACKAGE_SOURCE, PI_MEMORY_TEMPLATES, PI_MEMORY_TOOLS } from "@/lib/pi-memory";
import { filterMemoryEntries, isWritableMemoryPath, type MemoryCatalogEntry } from "@/lib/memory-catalog";

/*
 * fork:memory-panel — settings page for the pi-memory package.
 *
 * This fork does not implement memory itself: `npm:pi-memory` (official pi package
 * directory) provides the tools, the markdown files and the injection, and it works
 * in the TUI too. What the panel adds is the three things a UI is good at:
 *
 *   1. one switch that says whether memory is on (the package's enabled flag, so a
 *      disabled memory means the tools are not even registered);
 *   2. the *shape* of the memory — MEMORY.md / SCRATCHPAD.md / today's log are listed
 *      even before they exist, with a one-click create, because an empty directory
 *      used to make the whole feature look missing;
 *   3. reading and hand-editing those files, and opening them in the main file
 *      viewer where the markdown editor lives.
 *
 * fork:zc-20 — (3) grew into a directory view: the panel now renders the
 * read-only catalog of `~/.pi/agent/memory/` (root files plus `daily/` and
 * `recovery/`) with a filename filter and mtime, while the create/edit actions
 * are still restricted to the paths pi-memory itself manages. The catalog
 * never changes the storage layout: `lib/memory-catalog.ts` only lists.
 */

interface MemoryFileInfo {
  path: string;
  size: number;
  mtime: string;
  exists: boolean;
}

interface PluginPackageView {
  source: string;
  version?: string;
  disabled?: boolean;
}

export function PiMemoryConfig({
  cwd,
  onOpenFile,
}: {
  cwd?: string | null;
  onOpenFile?: (path: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const [pkg, setPkg] = useState<PluginPackageView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [files, setFiles] = useState<MemoryFileInfo[]>([]);
  const [catalog, setCatalog] = useState<MemoryCatalogEntry[]>([]);
  const [fileQuery, setFileQuery] = useState("");
  const [dir, setDir] = useState("");
  // fork:fix-memory-ui — 自动保存 + 冲突保护：openFile 是磁盘上的已存内容（含读时的
  // mtime 基线），draft 是编辑中的草稿；draft 变更后防抖自动保存；磁盘被 agent
  // 或另一个窗口改过时服务器 409，面板提示冲突而不是盲写覆盖。
  const [openFile, setOpenFile] = useState<{ path: string; content: string; mtime: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [conflict, setConflict] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const [pluginsRes, filesRes] = await Promise.all([
        fetch(`/api/plugins?cwd=${encodeURIComponent(cwd ?? "")}`, { cache: "no-store" }),
        fetch("/api/memory/files", { cache: "no-store" }),
      ]);
      const plugins = await pluginsRes.json() as { packages?: PluginPackageView[] };
      const filesData = await filesRes.json() as {
        dir?: string;
        files?: MemoryFileInfo[];
        catalog?: { entries?: MemoryCatalogEntry[] };
      };
      setPkg((plugins.packages ?? []).find((entry) => entry.source === PI_MEMORY_PACKAGE_SOURCE) ?? null);
      setFiles(filesData.files ?? []);
      setCatalog(filesData.catalog?.entries ?? []);
      setDir(filesData.dir ?? "");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  // fork:fix-memory-ui — 自动保存：draft 偏离基线后防抖 800ms 写盘；冲突时停下，
  // 等用户点「重新加载」再继续。write 未列入依赖：它每次渲染重建，列入会重置防抖计时。
  // fork:zc-20 — recovery/ 等非 pi-memory 管理的文件只读，绝不触发自动保存。
  useEffect(() => {
    if (!openFile || conflict || draft === openFile.content) return;
    if (!isWritableMemoryPath(openFile.path)) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void write(openFile.path, draft, undefined, openFile.mtime);
    }, 800);
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, openFile, conflict]);

  // fork:fix-memory-refresh — 用户点「标记已整理」：把现在记为冷却起点，
  // 周检邀请接下来 7 天安静。只记时间，不碰记忆内容。
  const markTidied = async () => {
    try {
      const res = await fetch("/api/memory/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tidied" }),
      });
      if (res.ok) setMessage(t("memory.tidyMarked"));
    } catch {
      // 静默：这个按钮本身也只是辅助。
    }
  };

  const act = async (action: "install" | "enable" | "disable") => {
    if (!cwd) return;
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, source: PI_MEMORY_PACKAGE_SOURCE, scope: "global", cwd }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setMessage(t(`memory.${action}Done`));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const read = async (path: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/memory/files?path=${encodeURIComponent(path)}`, { cache: "no-store" });
      const data = await res.json() as { content?: string; mtime?: string; error?: string };
      if (!res.ok || typeof data.content !== "string") {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setConflict(false);
      setOpenFile({ path, content: data.content, mtime: data.mtime ?? "" });
      setDraft(data.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const write = async (path: string, content: string, note?: string, expectedMtime?: string) => {
    setBusy(path);
    setError(null);
    try {
      const res = await fetch("/api/memory/files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content, expectedMtime }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; conflict?: boolean; file?: MemoryFileInfo };
      if (res.status === 409 && data.conflict) {
        // fork:fix-memory-ui — 外部冲突：agent（或另一个窗口）改过同一个文件，
        // 绝不静默覆盖；提示用户刷新后重编。
        setConflict(true);
        return false;
      }
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return false;
      }
      setConflict(false);
      if (note) setMessage(note);
      // 保存成功：基线推进到新写入的内容与 mtime，自动保存才会安静下来。
      if (openFile?.path === path) {
        setOpenFile({ path, content, mtime: data.file?.mtime ?? openFile.mtime });
      }
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const installed = Boolean(pkg);
  const enabled = installed && pkg?.disabled !== true;
  const missingFiles = files.filter((file) => !file.exists);
  const visibleCatalog = useMemo(() => filterMemoryEntries(catalog, fileQuery), [catalog, fileQuery]);
  const openFileWritable = openFile ? isWritableMemoryPath(openFile.path) : false;

  /* fork:design-system —— 画板 44 的记忆页：两块 `.pw-block`（开关与状态 / 记忆
     工具）+ 一组 `.pw-cols`（左：过滤 + `.pw-list` 文件目录；右：`.pw-detail`
     编辑器）。原先是页面自有的 section / option 类 + 一堆内联盒子。 */
  const statusText = loading
    ? t("i18n.loading")
    : installed
      ? `${PI_MEMORY_PACKAGE_SOURCE} · ${pkg?.version ?? "?"} · ${enabled ? t("memory.stateOn") : t("memory.stateDisabled")}`
      : t("memory.stateMissing");

  return (
    <>
      <PwPageHead title={t("memory.title")} sub={t("memory.subtitle")} />

      <ConfigDetailActions>
        <ConfigButton variant="ghost" size="small" onClick={() => void markTidied()}>
          {t("memory.tidyMark")}
        </ConfigButton>
        <span className="pw-grow" aria-hidden="true" />
        {message && <span className="pw-hint" role="status">{message}</span>}
      </ConfigDetailActions>

      <PwBlock icon="brain" title={t("memory.switches")}>
        <ConfigField label={t("memory.enable")}>
          {installed ? (
            <ConfigSwitch
              label={t("memory.enable")}
              checked={enabled}
              loading={busy === "enable" || busy === "disable"}
              onChange={(next) => void act(next ? "enable" : "disable")}
            />
          ) : (
            <ConfigButton variant="primary" size="small" disabled={busy !== null || !cwd} onClick={() => void act("install")}>
              {busy === "install" ? t("memory.installing") : t("memory.install")}
            </ConfigButton>
          )}
        </ConfigField>
        <ConfigField label={PI_MEMORY_PACKAGE_SOURCE}>
          <PwCtl>
            <span className={enabled ? "pw-badge ok" : "pw-badge"} role="status">{statusText}</span>
          </PwCtl>
        </ConfigField>
        <p className="pw-hint">{t("memory.enableHint")}</p>
      </PwBlock>

      <PwBlock icon="wrench" title={t("memory.tools")}>
        <ConfigSidebarList>
          {PI_MEMORY_TOOLS.map((tool) => (
            <div className="pw-litem" key={tool}>
              <span className="pw-ico"><i data-ico="wrench" data-size="14" aria-hidden="true" /></span>
              <span className="grow">
                <span className="pw-lname pw-mono">{tool}</span>
              </span>
            </div>
          ))}
        </ConfigSidebarList>
        <p className="pw-hint">{t("memory.toolsHint")}</p>
      </PwBlock>

      <ConfigSplitView>
        <ConfigSidebar>
          {/* 画板 44 的文件列表头：`.pw-inline` 里是过滤框 + 计数徽章 */}
          <ConfigDetailHeader>
            <span className="pw-ico"><i data-ico="search" data-size="14" aria-hidden="true" /></span>
            <input
              className="pw-input"
              type="search"
              value={fileQuery}
              onChange={(event) => setFileQuery(event.target.value)}
              placeholder={t("memory.fileSearch")}
              aria-label={t("memory.fileSearch")}
              maxLength={60}
              style={{ minWidth: 0, flex: 1 }}
            />
            <span className="pw-badge count">{t("memory.fileCount", { count: catalog.length })}</span>
          </ConfigDetailHeader>
          {dir && <p className="pw-mono pw-dim">{dir}</p>}

          {/* 还没建出来的 pi-memory 文件：给一个一键创建，别让空目录像功能缺失 */}
          {missingFiles.length > 0 && (
            <ConfigSidebarList>
              {missingFiles.map((file) => (
                <div className="pw-litem" key={file.path}>
                  <span className="pw-ico"><i data-ico="file-plus" data-size="14" aria-hidden="true" /></span>
                  <span className="grow">
                    <span className="pw-lname pw-mono">{file.path}</span>
                    <span className="pw-lsub">{t("memory.fileMissing")}</span>
                  </span>
                  <ConfigButton
                    variant="secondary"
                    size="small"
                    disabled={busy === file.path}
                    onClick={() => void write(file.path, PI_MEMORY_TEMPLATES[file.path] ?? `# ${file.path}\n`, t("memory.fileCreated"))}
                  >
                    {t("memory.createFile")}
                  </ConfigButton>
                </div>
              ))}
            </ConfigSidebarList>
          )}

          <ConfigSidebarList>
            {visibleCatalog.map((file) => (
              <ConfigSidebarItem
                key={file.path}
                active={openFile?.path === file.path}
                disabled={busy === file.path}
                onClick={() => void read(file.path)}
              >
                <span className="pw-ico"><i data-ico="file-text" data-size="14" aria-hidden="true" /></span>
                <span className="grow">
                  <span className="pw-lname pw-mono">{file.path}</span>
                  <span className="pw-lsub">{`${file.size} B · ${new Date(file.mtime).toLocaleString()}`}</span>
                </span>
                {!isWritableMemoryPath(file.path) && <span className="pw-badge warn">{t("memory.readOnlyFile")}</span>}
              </ConfigSidebarItem>
            ))}
          </ConfigSidebarList>

          {!loading && visibleCatalog.length === 0 && (
            <ConfigEmptyState>
              <p>{fileQuery.trim() ? t("memory.fileNoMatch") : t("memory.filesEmpty")}</p>
            </ConfigEmptyState>
          )}
          <p className="pw-hint">{t("memory.filesHint")}</p>
        </ConfigSidebar>

        <ConfigDetail>
          {openFile ? (
            <>
              <ConfigDetailHeader>
                <ConfigDetailTitle><span className="pw-mono">{openFile.path}</span></ConfigDetailTitle>
                <span className="pw-grow" aria-hidden="true" />
                {!openFileWritable && <span className="pw-badge warn">{t("memory.readOnlyFile")}</span>}
                {onOpenFile && (
                  <ConfigButton variant="ghost" size="small" onClick={() => onOpenFile(`${dir}/${openFile.path}`)}>
                    <span className="pw-ico"><i data-ico="external-link" data-size="13" aria-hidden="true" /></span>
                    {t("memory.openInEditor")}
                  </ConfigButton>
                )}
                <ConfigButton variant="ghost" size="small" onClick={() => setOpenFile(null)}>
                  {t("i18n.close")}
                </ConfigButton>
                {openFileWritable && (
                  <ConfigButton
                    variant="primary"
                    size="small"
                    disabled={busy === openFile.path || draft === openFile.content}
                    onClick={() => void write(openFile.path, draft, t("memory.fileSaved"), openFile.mtime)}
                  >
                    {t("i18n.save")}
                  </ConfigButton>
                )}
              </ConfigDetailHeader>

              {/* fork:fix-memory-ui — 外部冲突横幅：磁盘上的文件在读取后变了（多半是
                  agent 刚写完记忆），编辑器里的草稿不会自动覆盖它；重新加载后重编。 */}
              {conflict && (
                <div className="pw-alert" role="alert">
                  <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
                  <span className="grow">{t("memory.conflict")}</span>
                  <ConfigButton variant="secondary" size="small" onClick={() => void read(openFile.path)}>
                    {t("memory.reload")}
                  </ConfigButton>
                </div>
              )}

              <textarea
                className="pw-textarea"
                aria-label={openFile.path}
                value={draft}
                spellCheck={false}
                readOnly={!openFileWritable}
                onChange={(event) => setDraft(event.target.value)}
                style={{ minHeight: 340 }}
              />
              {openFileWritable && <p className="pw-hint">{t("memory.autoSaveHint")}</p>}
            </>
          ) : (
            <ConfigEmptyState>
              <p>{t("memory.filesHint")}</p>
            </ConfigEmptyState>
          )}
        </ConfigDetail>
      </ConfigSplitView>

      {error && (
        <div className="pw-alert" role="alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
          <span className="grow">{error}</span>
        </div>
      )}
    </>
  );
}
