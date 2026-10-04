"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useIsMobile } from "@/hooks/useIsMobile";
import { PwaDirectoryPicker } from "./pwa/PwaDirectoryPicker";

interface DirectoryEntry {
  name: string;
  path: string;
}

interface BrowseResponse {
  path?: string;
  parentPath?: string | null;
  directories?: DirectoryEntry[];
  drives?: DirectoryEntry[];
  error?: string;
}

type DirectoryOperation =
  | { kind: "create"; name: string }
  | { kind: "rename"; path: string; name: string };

async function loadDirectories(directory?: string): Promise<BrowseResponse> {
  const query = directory ? `?path=${encodeURIComponent(directory)}` : "";
  const response = await fetch(`/api/cwd/browse${query}`);
  const data = await response.json() as BrowseResponse;
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

/* fork:design-components —— 图标改画板图标集（`data-ico` + icons.js 水合），手绘 SVG 全部退役。
 * 实名与画板 D-26b 帧 A / 50 的 D 段一致：目录列表 folder / 盘符 hard-drive、
 * 上一级 arrow-up、新建 folder-plus、重命名 square-pen、删除 trash-2、关闭 x。 */

function isWindowsDriveRoot(directory: string): boolean {
  return /^[a-zA-Z]:[\\/]?$/.test(directory);
}

interface Props {
  onCancel: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  busy?: boolean;
  error?: string | null;
}

export function DirectoryPicker({ onCancel, onSelect, initialPath, busy = false, error }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [parentDirectory, setParentDirectory] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState(initialPath ?? "");
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [drives, setDrives] = useState<DirectoryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operation, setOperation] = useState<DirectoryOperation | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [hoveredDirectoryPath, setHoveredDirectoryPath] = useState<string | null>(null);
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const operationBusyRef = useRef(false);
  const deleteBusyRef = useRef(false);
  const skipRenameBlurRef = useRef(false);
  const [loading, setLoading] = useState(true);

  const navigateTo = useCallback(async (directory?: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await loadDirectories(directory);
      const nextPath = data.path ?? directory ?? "/";
      setCurrentPath(nextPath);
      setParentDirectory(data.parentPath ?? null);
      setPathInput(nextPath);
      setDirectories(data.directories ?? []);
      setDrives(data.drives ?? null);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPortalTarget(document.body);
    void navigateTo(initialPath || undefined);
  }, [initialPath, navigateTo]);

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = pathInput.trim();
    if (candidate) void navigateTo(candidate);
  };

  const beginCreate = () => {
    if (loading || busy || operationBusy || !currentPath) return;
    setOperation({ kind: "create", name: "" });
    setOperationError(null);
  };

  const beginRename = (entry: DirectoryEntry) => {
    if (loading || busy || operationBusy) return;
    setConfirmDeletePath(null);
    setDeleteError(null);
    setOperation({ kind: "rename", path: entry.path, name: entry.name });
    setOperationError(null);
  };

  const beginDelete = (entry: DirectoryEntry) => {
    if (loading || busy || operationBusy || deleteBusy) return;
    setOperation(null);
    setOperationError(null);
    setConfirmDeletePath(entry.path);
    setDeleteError(null);
  };

  const submitOperation = useCallback(async (activeOperation: DirectoryOperation) => {
    if (busy || operationBusyRef.current) return;
    const name = activeOperation.name.trim();
    if (!name) {
      setOperationError(t("directoryPicker.folderNameRequired"));
      return;
    }

    operationBusyRef.current = true;
    setOperationBusy(true);
    setOperationError(null);
    try {
      const isRename = activeOperation.kind === "rename";
      const response = await fetch("/api/cwd/directories", {
        method: isRename ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isRename
          ? { path: activeOperation.path, name }
          : { parentPath: currentPath, name }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);

      setOperation(null);
      await navigateTo(currentPath);
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      operationBusyRef.current = false;
      setOperationBusy(false);
    }
  }, [busy, currentPath, navigateTo, t]);

  const handleOperationSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!operation || operation.kind !== "create" || busy || operationBusy) return;
    await submitOperation(operation);
  };

  const performDelete = useCallback(async (entry: DirectoryEntry) => {
    if (busy || deleteBusyRef.current || confirmDeletePath !== entry.path) return;

    deleteBusyRef.current = true;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const response = await fetch("/api/cwd/directories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: entry.path }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);

      setConfirmDeletePath(null);
      await navigateTo(currentPath);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      deleteBusyRef.current = false;
      setDeleteBusy(false);
    }
  }, [busy, confirmDeletePath, currentPath, navigateTo]);

  const renamingPath = operation?.kind === "rename" ? operation.path : null;

  useEffect(() => {
    if (!renamingPath) return;
    const id = requestAnimationFrame(() => renameInputRef.current?.select());
    return () => cancelAnimationFrame(id);
  }, [renamingPath]);

  const hasUncommittedPath = pathInput.trim() !== currentPath;
  const pickerBusy = busy || operationBusy || deleteBusy;
  const canSelect = Boolean(currentPath) && !hasUncommittedPath && !pickerBusy;
  const canNavigateUp = Boolean(parentDirectory) || isWindowsDriveRoot(currentPath);

  // fork:dsn-dialog-a11y — 补焦点约束。这个弹层走 createPortal（挂在 body 下），
  // 所以 hook 的"兄弟节点 inert"正好作用到应用根节点上，背景对键盘与读屏同时失效。
  // hooks 必须在下面的早退之前调用，否则违反 hooks 规则。
  const { dialogRef, dialogProps } = useDialogA11y({ open: true, onClose: onCancel });

  if (!portalTarget) return null;

  /* fork:v5-wave-b-sysstate —— 窄屏 = M-10 帧 C-1 的 `.m-scrim` + `.m-sheet`
     （DOM 在 `components/pwa/PwaDirectoryPicker.tsx`）。系统原生选框那条主路径
     （/api/cwd/pick）不受影响，仍然在桌面分派；本文件两个分支共享同一份状态
     与回调，接口调用与快捷键零变化。 */
  if (isMobile) {
    return createPortal(
      <div
        ref={dialogRef}
        {...dialogProps}
        className="directory-picker-backdrop"
        aria-labelledby="directory-picker-title"
        style={{ position: "fixed", inset: 0, zIndex: "var(--nx-z-modal)" }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !pickerBusy) onCancel();
        }}
      >
        <PwaDirectoryPicker
          currentPath={currentPath}
          pathInput={pathInput}
          onPathInputChange={(value) => {
            setPathInput(value);
            setLoadError(null);
          }}
          onPathSubmit={handlePathSubmit}
          parentPath={parentDirectory}
          canNavigateUp={canNavigateUp}
          onNavigate={(path) => void navigateTo(path)}
          loading={loading}
          drives={drives}
          directories={directories}
          hasUncommittedPath={hasUncommittedPath}
          pickerBusy={pickerBusy}
          busy={busy}
          canSelect={canSelect}
          operation={operation}
          operationBusy={operationBusy}
          onOperationNameChange={(name) => {
            setOperation((current) => (current ? { ...current, name } : current));
            setOperationError(null);
          }}
          onOperationSubmit={handleOperationSubmit}
          onOperationCancel={() => {
            setOperation(null);
            setOperationError(null);
          }}
          renameInputRef={renameInputRef}
          onRenameNameChange={(name) => {
            setOperation((current) => (current?.kind === "rename" ? { ...current, name } : current));
            setOperationError(null);
          }}
          onRenameBlur={() => {
            if (skipRenameBlurRef.current) {
              skipRenameBlurRef.current = false;
              return;
            }
            const activeOperation = operation;
            if (activeOperation?.kind === "rename" && activeOperation.path === renamingPath) {
              void submitOperation(activeOperation);
            }
          }}
          onRenameKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              const activeOperation = operation;
              if (activeOperation?.kind === "rename" && activeOperation.path === renamingPath) {
                void submitOperation(activeOperation);
              }
            }
            if (event.key === "Escape") {
              event.stopPropagation();
              skipRenameBlurRef.current = true;
              setOperation(null);
              setOperationError(null);
            }
          }}
          confirmDeletePath={confirmDeletePath}
          deleteBusy={deleteBusy}
          onDeleteCancel={() => {
            setConfirmDeletePath(null);
            setDeleteError(null);
          }}
          onDeleteConfirm={(entry) => void performDelete(entry)}
          onRenameStart={beginRename}
          onDeleteStart={beginDelete}
          onCreateStart={beginCreate}
          errorText={loadError ?? error ?? operationError ?? deleteError}
          onCancel={onCancel}
          onSelect={() => onSelect(currentPath)}
        />
      </div>,
      portalTarget,
    );
  }

  return createPortal(
    <div
      ref={dialogRef}
      {...dialogProps}
      className="directory-picker-backdrop d-modal is-open"
      aria-label={t("directoryPicker.selectDirectory")}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pickerBusy) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pickerBusy) onCancel();
      }}
    >
      {/* fork:design-components —— 自绘降级态 = 画板 D-26b 帧 A「回退 · 自绘浏览器」：
        * `.d-modal.is-open` › `.d-modal-box` › `.d-modal-head`（folder-open 图标 + 标题 +
        * grow + 「转到上级目录」`.d-btn.sm` + `.d-iconbtn` 关闭）› `.d-modal-body`
        * （路径行 `.d-searchfield` / 目录树 `.d-tree` + `.d-trow.l1` / 错误 `.d-banner.err`）
        * › `.d-modal-foot`（取消 `.d-btn` + 选中 `.d-btn.primary`）。
        * 系统原生选择器那条主路径（/api/cwd/pick）不在本文件，不受本段影响。
        * directory-picker-* 仍是产品侧钩子（app/fork-ui.css 窄屏底部抽屉、board-specs 选择器）。 */}
      <div
        className="directory-picker-panel d-modal-box"
        style={{ width: 520, maxWidth: "calc(100vw - 16px)", height: "min(620px, calc(100dvh - 16px))", maxHeight: "calc(100dvh - 16px)" }}
      >
        <div className="d-modal-head d-row">
          <i data-ico="folder-open" data-size="16" aria-hidden="true" />
          <span className="d-grow">{t("directoryPicker.selectDirectory")}</span>
          <button
            className="directory-picker-back d-btn sm"
            type="button"
            onClick={() => void navigateTo(parentDirectory ?? undefined)}
            disabled={loading || pickerBusy || !canNavigateUp}
            title={t("directoryPicker.goToParent")}
            aria-label={t("directoryPicker.goToParent")}
          >
            <i data-ico="arrow-up" data-size="13" aria-hidden="true" />
            {t("directoryPicker.goToParent")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pickerBusy}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
            className="d-iconbtn"
            style={pickerBusy ? { opacity: 0.5 } : undefined}
          >
            <i data-ico="x" data-size="14" aria-hidden="true" />
          </button>
        </div>

        <div className="d-modal-body" style={{ flex: "1 1 auto" }}>
          <form onSubmit={handlePathSubmit} className="d-searchfield">
            <i data-ico="folder" data-size="13" aria-hidden="true" />
            <label htmlFor="directory-path" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
              {t("directoryPicker.directoryPath")}
            </label>
            <input
              className="directory-picker-path d-mono"
              id="directory-path"
              type="text"
              value={pathInput}
              placeholder="/path/to/project or ~/project"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setPathInput(event.target.value);
                setLoadError(null);
              }}
            />
            <button
              className="directory-picker-new d-btn sm"
              type="button"
              onClick={beginCreate}
              disabled={loading || pickerBusy || !currentPath}
              title={t("directoryPicker.newFolder")}
              aria-label={t("directoryPicker.newFolder")}
            >
              <i data-ico="folder-plus" data-size="13" aria-hidden="true" />
              {t("directoryPicker.newFolder")}
            </button>
            <button
              className="directory-picker-action d-btn sm"
              type="submit"
              disabled={loading || pickerBusy || !pathInput.trim()}
              title={t("directoryPicker.goToDirectory")}
            >
              {t("directoryPicker.go")}
            </button>
          </form>

          {operation?.kind === "create" && (
            <form onSubmit={handleOperationSubmit} className="d-searchfield">
              <i data-ico="folder-plus" data-size="13" aria-hidden="true" />
              <input
                id="directory-operation-name"
                className="d-mono"
                type="text"
                value={operation.name}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setOperation((current) => current ? { ...current, name: event.target.value } : current);
                  setOperationError(null);
                }}
              />
              <button className="directory-picker-action d-btn sm ghost" type="button" onClick={() => { setOperation(null); setOperationError(null); }} disabled={operationBusy}>
                {t("i18n.cancel")}
              </button>
              <button className="directory-picker-action d-btn sm primary" type="submit" disabled={operationBusy || !operation.name.trim()}>
                <i data-ico="check" data-size="13" aria-hidden="true" />
                {operationBusy ? t("i18n.saving") : t("directoryPicker.create")}
              </button>
            </form>
          )}

          {hasUncommittedPath && (
            <div className="d-banner warn">
              <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
              <span className="d-grow">{t("directoryPicker.openBeforeSelecting")}</span>
            </div>
          )}

          {/* fork:v5-wave-n1 · 画板 D-26b 帧 A「未提交」面板的第二段：
              <div class="d-empty compact">
                <div class="d-empty-ico"><i data-ico="folder-search" data-size="20"></i></div>
                <div class="d-empty-t">选择前请先打开此路径</div>
                <div class="d-empty-s">…不可点的按钮必须说清为什么…</div>
              </div>
              类名 / 嵌套 / 图标照原文，`.d-empty-t` 用**既有** key
              `directoryPicker.openBeforeSelecting`（值就是画板那一行）。
              两处有意的偏差，都记在这里：
              ① `.d-empty-s` 那句是**规格解释**而不是产品状态，且本波不许新增
                 i18n key，所以这一段留空（需新 key：`directoryPicker.openBeforeSelectingWhy`）；
              ② 画板在该面板里用这块空态**替换**了目录列表，产品保留列表 ——
                 路径没回车时用户仍要能点别的目录去「转到」，删掉列表是减功能。
              横幅与空态都保留：横幅说「出了什么事」，空态说「现在能做什么」。 */}
          {hasUncommittedPath && (
            <div className="d-empty compact">
              <div className="d-empty-ico">
                <i data-ico="folder-search" data-size="20" aria-hidden="true" />
              </div>
              <div className="d-empty-t">{t("directoryPicker.openBeforeSelecting")}</div>
            </div>
          )}

          <div className="directory-picker-list d-tree" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {loading ? (
              <div className="d-trow l1 d-t-dim" role="status">{t("directoryPicker.loadingDirectories")}</div>
            ) : drives !== null ? (
              <>
                {drives.length > 0 ? (
                  drives.map((drive) => (
                    <button
                      key={drive.path}
                      className="directory-picker-entry d-trow l1"
                      type="button"
                      onClick={() => void navigateTo(drive.path)}
                      disabled={pickerBusy}
                      title={drive.path}
                    >
                      <i data-ico="hard-drive" data-size="14" aria-hidden="true" />
                      <span className="d-grow">{drive.name}</span>
                    </button>
                  ))
                ) : (
                  <div className="d-trow l1 d-t-dim" role="status">{t("directoryPicker.noDrives")}</div>
                )}
              </>
            ) : directories.length > 0 ? (
              directories.map((entry) => {
                const isRenaming = operation?.kind === "rename" && operation.path === entry.path;
                const isConfirmingDelete = confirmDeletePath === entry.path;
                const isHovered = hoveredDirectoryPath === entry.path;
                return (
                  <div
                    key={entry.path}
                    className="directory-picker-row d-trow l1"
                    onMouseEnter={() => setHoveredDirectoryPath(entry.path)}
                    onMouseLeave={() => setHoveredDirectoryPath(null)}
                    style={isConfirmingDelete ? { background: "color-mix(in srgb, var(--nx-danger) 7%, transparent)" } : undefined}
                  >
                    {isConfirmingDelete ? (
                      <>
                        <i data-ico="trash-2" data-size="14" aria-hidden="true" style={{ color: "var(--nx-danger)", flexShrink: 0 }} />
                        <span className="d-grow">{t("directoryPicker.confirmDeleteFolder", { name: entry.name.slice(0, 22) + (entry.name.length > 22 ? "…" : "") })}</span>
                        <button
                          className="directory-picker-action d-btn sm ghost"
                          type="button"
                          onClick={() => { setConfirmDeletePath(null); setDeleteError(null); }}
                          disabled={deleteBusy}
                        >
                          {t("sidebar.cancel")}
                        </button>
                        <button
                          className="directory-picker-delete d-btn sm danger"
                          type="button"
                          onClick={() => void performDelete(entry)}
                          disabled={deleteBusy}
                          title={t("directoryPicker.deleteFolder")}
                        >
                          <i data-ico="trash-2" data-size="13" aria-hidden="true" />
                          {t("sidebar.delete")}
                        </button>
                      </>
                    ) : isRenaming ? (
                      <input
                        ref={renameInputRef}
                        className="directory-picker-rename-input d-input d-mono"
                        value={operation.name}
                        onChange={(event) => {
                          setOperation((current) => current?.kind === "rename" ? { ...current, name: event.target.value } : current);
                          setOperationError(null);
                        }}
                        onBlur={() => {
                          if (skipRenameBlurRef.current) {
                            skipRenameBlurRef.current = false;
                            return;
                          }
                          const activeOperation = operation;
                          if (activeOperation?.kind === "rename" && activeOperation.path === entry.path) void submitOperation(activeOperation);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            const activeOperation = operation;
                            if (activeOperation?.kind === "rename" && activeOperation.path === entry.path) void submitOperation(activeOperation);
                          }
                          if (event.key === "Escape") {
                            event.stopPropagation();
                            skipRenameBlurRef.current = true;
                            setOperation(null);
                            setOperationError(null);
                          }
                        }}
                        autoFocus
                        aria-label={`${t("i18n.rename")}: ${entry.name}`}
                        style={{ flex: 1, minWidth: 0, height: "var(--nx-ctl-sm)" }}
                      />
                    ) : (
                      <>
                        <button
                          className="directory-picker-entry d-trow l1"
                          type="button"
                          onClick={() => void navigateTo(entry.path)}
                          disabled={pickerBusy}
                          title={entry.path}
                          style={{ flex: 1, width: "auto", minWidth: 0, paddingLeft: 0 }}
                        >
                          <i data-ico="folder" data-size="14" aria-hidden="true" />
                          <span className="d-grow">{entry.name}</span>
                        </button>
                        {isHovered && !pickerBusy && (
                          <div className="directory-picker-actions d-row" style={{ flexShrink: 0 }}>
                            <button
                              className="directory-picker-rename d-iconbtn"
                              type="button"
                              onClick={() => beginRename(entry)}
                              title={`${t("i18n.rename")}: ${entry.name}`}
                              aria-label={`${t("i18n.rename")}: ${entry.name}`}
                            >
                              <i data-ico="square-pen" data-size="13" aria-hidden="true" />
                            </button>
                            <button
                              className="directory-picker-delete d-iconbtn"
                              type="button"
                              onClick={() => beginDelete(entry)}
                              title={t("directoryPicker.deleteFolder")}
                              aria-label={`${t("directoryPicker.deleteFolder")}: ${entry.name}`}
                            >
                              <i data-ico="trash-2" data-size="13" aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="d-trow l1 d-t-dim" role="status">{t("directoryPicker.noSubdirectories")}</div>
            )}
            {(loadError || error || operationError || deleteError) && (
              <div className="d-banner err" role="alert">
                <i data-ico="circle-alert" data-size="14" aria-hidden="true" />
                <span className="d-grow">{loadError ?? error ?? operationError ?? deleteError}</span>
              </div>
            )}
          </div>
        </div>
 
        <div className="directory-picker-footer d-modal-foot">
          <button className="directory-picker-action d-btn" type="button" onClick={onCancel} disabled={pickerBusy}>
            {t("i18n.cancel")}
          </button>
          <span className="d-grow" />
          <button
            className="directory-picker-action d-btn primary"
            type="button"
            onClick={() => onSelect(currentPath)}
            disabled={!canSelect}
            title={hasUncommittedPath ? t("directoryPicker.openBeforeSelecting") : t("directoryPicker.selectCurrentDirectory")}
          >
            {busy ? t("i18n.checking") : t("directoryPicker.selectThisFolder")}
          </button>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
