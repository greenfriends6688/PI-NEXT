"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  ConfigButton,
  ConfigDetail,
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
  SettingsPage,
} from "../SettingsUi";
import { MEMORY_DIR_NAME, PI_MEMORY_PACKAGE_SOURCE, PI_MEMORY_TEMPLATES, PI_MEMORY_TOOL_HINT_KEYS, PI_MEMORY_TOOLS } from "@/lib/pi-memory";
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

// fix:memory-open-dir —— 「记忆目录」是**目录**，不能交给只看文件的入口（AppShell 的
// 文件查看器）。它由服务端在系统文件管理器里打开：复用 ExplorerPanel / SessionSidebar
// 已经在用的 POST /api/open-in-explorer（GET 先问能力），不在本机或平台不支持时另有出路。
interface FileManagerAvailability {
  supported: boolean;
  reason: string | null;
  platform: string;
}

/** 服务端错误码 → 可翻译文案；未收录的错误码按原文显示（与 ExplorerPanel 同约定）。 */
const FILE_MANAGER_ERROR_KEYS: Record<string, string> = {
  remote: "sidebar.openInExplorerRemoteOnly",
  "unsupported-platform": "sidebar.openInExplorerUnsupported",
};

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
  // fix:memory-open-dir —— 目录打开能力与它在途状态。
  const [fileManager, setFileManager] = useState<FileManagerAvailability | null>(null);
  const [openingDir, setOpeningDir] = useState(false);
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

  // fix:memory-open-dir —— 按钮文案与可用性由服务端说了算：只有服务端能弹系统窗口，
  // 而且只有浏览器跑在同一台机器上才有意义（远程访问时 reason=remote）。问一次即可。
  useEffect(() => {
    let cancelled = false;
    fetch("/api/open-in-explorer")
      .then((res) => (res.ok ? res.json() as Promise<FileManagerAvailability> : null))
      .then((data) => { if (!cancelled && data) setFileManager(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
  // fix:memory-open-dir —— 开不了系统文件管理器时的替代目标：**文件**（相对记忆根目录的
  // 路径），而且优先是用户正在看的那一个，其次是目录里的第一个条目。两个都拿不到时
  // 留空 —— 绝不能把目录（哪怕带个尾斜杠）再交给只看文件的入口。
  const dirFallbackRelative = openFile?.path ?? catalog[0]?.path ?? "";
  const dirFallbackPath = dir && dirFallbackRelative ? `${dir}/${dirFallbackRelative}` : "";
  const fileManagerUnavailable = fileManager?.supported === false;
  const fileManagerUnavailableReason = fileManagerUnavailable
    ? t(FILE_MANAGER_ERROR_KEYS[fileManager?.reason ?? ""] ?? "memory.openDir")
    : null;
  const dirButtonLabel = fileManagerUnavailable
    ? t("memory.openDir")
    : fileManager?.platform === "darwin"
      ? t("sidebar.openInFinder")
      : fileManager?.platform === "win32"
        ? t("sidebar.openInExplorer")
        : t("sidebar.openInFileManager");

  /* fix:memory-layout（画板 44）—— 列表头那枚「新建」把缺失的 pi-memory 文件一次建出来。
     原来是每个缺失文件行尾各挂一枚按钮（新增入口位置与画板不符，行也被按钮挤窄）。 */
  const createMissing = async () => {
    const targets = missingFiles.map((file) => file.path);
    if (targets.length === 0) return;
    for (const path of targets) {
      const ok = await write(path, PI_MEMORY_TEMPLATES[path] ?? `# ${path}\n`, undefined, undefined);
      if (!ok) return;
    }
    setMessage(t("memory.fileCreated"));
  };

  /* fix:memory-open-dir —— 这枚按钮原来把**目录**路径交给 onOpenFile，AppShell 无条件
     开文件标签，于是 `/api/files/<memoryDir>` 404、标签页里只有一行「Not a file」。
     记忆目录该由系统文件管理器打开（项目里已有的能力：ExplorerPanel 的面板头、
     SessionSidebar 的「打开文件夹」打的是同一个 POST /api/open-in-explorer）；
     这台机器上开不了时退到「在编辑器里打开记忆目录下的一个真实文件」，
     并把原因写进页面提示 —— 两条路都不会静默失败。 */
  const openMemoryDir = async () => {
    if (!dir) return;
    setOpeningDir(true);
    setError(null);
    try {
      if (fileManagerUnavailable) {
        if (!onOpenFile || !dirFallbackPath) {
          // 目录里一个可打开的文件都没有：说清楚为什么这枚按钮没能打开什么。
          setError(t("memory.filesEmpty"));
          return;
        }
        setMessage(fileManagerUnavailableReason ?? t("memory.openInEditor"));
        onOpenFile(dirFallbackPath);
        return;
      }
      const res = await fetch("/api/open-in-explorer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: dir }),
      });
      if (res.ok) return;
      const data = await res.json().catch(() => ({})) as { error?: string };
      const reason = data.error ?? `HTTP ${res.status}`;
      setError(t(FILE_MANAGER_ERROR_KEYS[reason] ?? reason));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpeningDir(false);
    }
  };

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
      {/* fork:settings-frame（画板 62）—— 记忆页的三件套。
          「标记已整理」原来孤零零挂在页头下面一行（`ConfigDetailActions` 没有任何
          归属），现在它是页级动作，进页头右端。 */}
      <SettingsPage
        title={t("memory.title")}
        sub={t("memory.subtitle")}
        actions={
          <ConfigButton variant="secondary" size="small" onClick={() => void markTidied()}>
            <span className="pw-ico"><i data-ico="check" data-size="13" aria-hidden="true" /></span>
            {t("memory.tidyMark")}
          </ConfigButton>
        }
      >
      {message && (
        <div className="pw-alert info" role="status">
          <span className="pw-ico"><i data-ico="info" data-size="14" aria-hidden="true" /></span>
          <span className="pw-grow">{message}</span>
        </div>
      )}

      {/* fix:memory-layout —— 画板 44 的状态块是三行 `.pw-field`：
          启用记忆（开关，说明走 `.pw-label small`）/ pi-memory 状态（徽章 + 重新安装）/
          记忆文件目录（等宽路径 + 打开）。原来只有两行 + 块尾一行 `.pw-hint` 段落。
          fork:settings-frame —— 两块收进 `.pw-narrow`（760）：1440 面板下原来是 1160，
          「启用记忆」与它的开关相距 1000px。 */}
      <div className="pw-narrow">
      <PwBlock icon="brain" title={t("memory.switches")}>
        <ConfigField label={t("memory.enable")} hint={t("memory.enableHint")}>
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
        <ConfigField label={t("memory.status")}>
          <PwCtl>
            <span className={enabled ? "pw-badge ok" : "pw-badge"} role="status">{statusText}</span>
            {installed && (
              <ConfigButton variant="ghost" size="small" disabled={busy !== null} onClick={() => void act("install")}>
                {busy === "install" ? t("memory.installing") : t("memory.reinstall")}
              </ConfigButton>
            )}
          </PwCtl>
        </ConfigField>
        <ConfigField label={t("memory.dirLabel")}>
          <PwCtl>
            <span className="pw-mono pw-dim">{dir || `~/.pi/agent/${MEMORY_DIR_NAME}`}</span>
            {/* fix:memory-open-dir —— 目录走系统文件管理器（不再是「把目录当文件打开」）；
                能力探测的结果决定文案：能用就说清是访达 / 资源管理器 / 文件管理器，
                不能用就退回中性的「打开」并在 title 里说明原因。 */}
            {dir && (
              <ConfigButton
                variant="ghost"
                size="small"
                onClick={() => void openMemoryDir()}
                disabled={openingDir}
                aria-busy={openingDir || undefined}
                title={fileManagerUnavailableReason ?? undefined}
              >
                <span className="pw-ico"><i data-ico="external-link" data-size="13" aria-hidden="true" /></span>
                {dirButtonLabel}
              </ConfigButton>
            )}
          </PwCtl>
        </ConfigField>
      </PwBlock>

      {/* 记忆工具：一行一个工具，名字 + 一句说明（`.pw-lname` / `.pw-lsub`）。
          原来只画名字，把整段说明挤成列表下面的 `.pw-hint` 段落 —— 那是「间距特别近」的来源。 */}
      <PwBlock icon="wrench" title={t("memory.tools")}>
        <ConfigSidebarList>
          {PI_MEMORY_TOOLS.map((tool) => (
            <div className="pw-litem" key={tool}>
              <span className="pw-ico"><i data-ico="wrench" data-size="14" aria-hidden="true" /></span>
              <span className="grow">
                <span className="pw-lname pw-mono">{tool}</span>
                <span className="pw-lsub">{t(PI_MEMORY_TOOL_HINT_KEYS[tool])}</span>
              </span>
            </div>
          ))}
        </ConfigSidebarList>
      </PwBlock>
      </div>

      <ConfigSplitView>
        <ConfigSidebar>
          {/* 画板 44 的文件列表头：过滤框 + 计数徽章 + 「新建」图标钮（原来每个缺失文件
              行尾各挂一枚「新建」按钮，位置与画板不符）。 */}
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
            {missingFiles.length > 0 && (
              <button
                type="button"
                className="pw-iconbtn sm"
                title={t("memory.createMissing")}
                aria-label={t("memory.createMissing")}
                disabled={busy !== null}
                onClick={() => void createMissing()}
              >
                <span className="pw-ico"><i data-ico="file-plus" data-size="14" aria-hidden="true" /></span>
              </button>
            )}
          </ConfigDetailHeader>

          {/* 还没建出来的 pi-memory 文件仍然列出来（空目录不该像功能缺失），但行尾不再挂
              按钮 —— 创建入口收到上面那枚图标钮里。 */}
          {missingFiles.length > 0 && (
            <ConfigSidebarList>
              {missingFiles.map((file) => (
                /* 画板 44 的弱化行（`opacity:.6`）：还没建出来的文件弱显示。 */
                <div className="pw-litem" key={file.path} style={{ opacity: 0.6 }}>
                  <span className="pw-ico pw-dim"><i data-ico="file-plus" data-size="14" aria-hidden="true" /></span>
                  <span className="grow">
                    <span className="pw-lname pw-mono">{file.path}</span>
                    <span className="pw-lsub">{t("memory.fileMissing")}</span>
                  </span>
                  <span className="pw-badge">{t("memory.fileMissing")}</span>
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
            /* fork:settings-frame（画板 62 帧 D）—— 列表空态落在列表列内：
               32px 记号图标 + 一句，居中；不再是一行飘字。 */
            <ConfigEmptyState>
              <span className="mark"><i data-ico="file-text" data-size="16" aria-hidden="true" /></span>
              <p>{fileQuery.trim() ? t("memory.fileNoMatch") : t("memory.filesEmpty")}</p>
            </ConfigEmptyState>
          )}
        </ConfigSidebar>

        {/* fix:memory-layout —— 画板 62 帧 D 的「详情未选」空态：`.pw-empty` 的居中
            由 board.css 自己的最小高度（`.pw-detail .pw-empty { min-height:180px }`）
            兜底，组件不再写内联 minHeight —— 那正是 62 诊断里「两栏仅 420 高」的来历。 */}
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
            /* fork:settings-frame（画板 62 帧 D）—— 详情未选：40px 方框记号 + 一句引导，
               在详情列居中（`pw-empty-inner > .mark`，与技能页同形）。 */
            <ConfigEmptyState>
              <span className="mark"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" /></span>
              <p>{t("memory.filesHint")}</p>
            </ConfigEmptyState>
          )}
        </ConfigDetail>
      </ConfigSplitView>

      {error && (
        <div className="pw-alert" role="alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
          <span className="pw-grow">{error}</span>
        </div>
      )}
      </SettingsPage>
    </>
  );
}
