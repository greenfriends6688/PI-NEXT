"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";

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

/* fork:design-system —— 图标改画板图标集（`data-ico` + icons.js 水合），手绘 SVG 全部退役。
 * 实名与画板 50 的 D 段一致：目录列表 folder / 盘符 hard-drive、上一级 arrow-up、
 * 新建 folder-plus、重命名 square-pen、删除 trash-2、关闭 x。 */
function Icon({ name, size = 14 }: { name: string; size?: number }) {
  return <span className="pw-ico"><i data-ico={name} data-size={size}></i></span>;
}

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

  return createPortal(
    <div
      ref={dialogRef}
      {...dialogProps}
      className="directory-picker-backdrop"
      aria-label={t("directoryPicker.selectDirectory")}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pickerBusy) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pickerBusy) onCancel();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--scrim)" }}
    >
      {/* fork:design-system —— 自绘降级态 = 画板 50 的 D 段「目录选择 · 回退：自绘浏览器」：
        * pw-modal 壳 › pw-modal-head（folder-open 图标 + 标题 + grow + 「上一级」pw-btn.sm +
        * pw-iconbtn.sm 关闭）› pw-modal-body（路径行 / 目录列表 pw-list + pw-litem /
        * 错误 pw-alert）› pw-modal-foot（取消 pw-btn + 选中 pw-btn.primary）。
        * 系统原生选择器那条主路径（/api/cwd/pick）不在本文件，不受本段影响。 */}
      <div className="directory-picker-panel pw-modal" style={{ width: 520, maxWidth: "calc(100vw - 16px)", height: "min(620px, calc(100dvh - 16px))", maxHeight: "calc(100dvh - 16px)", display: "flex", flexDirection: "column" }}>
        <div className="pw-modal-head">
          <span className="pw-ico"><i data-ico="folder-open" data-size="16"></i></span>
          <span className="grow">{t("directoryPicker.selectDirectory")}</span>
          <button
            className="directory-picker-back pw-btn sm"
            type="button"
            onClick={() => void navigateTo(parentDirectory ?? undefined)}
            disabled={loading || pickerBusy || !canNavigateUp}
            title={t("directoryPicker.goToParent")}
            aria-label={t("directoryPicker.goToParent")}
            style={canNavigateUp && !pickerBusy ? undefined : { opacity: 0.45 }}
          >
            <span className="pw-ico"><i data-ico="arrow-up" data-size="13"></i></span>
            {t("directoryPicker.goToParent")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pickerBusy}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
            className="pw-iconbtn sm"
            style={pickerBusy ? { opacity: 0.5 } : undefined}
          >
            <span className="pw-ico"><i data-ico="x" data-size="14"></i></span>
          </button>
        </div>

        <div className="pw-modal-body" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--s2)" }}>
          <form onSubmit={handlePathSubmit} className="pw-inline">
            <span className="pw-ico pw-dim"><i data-ico="folder" data-size="13"></i></span>
            <label htmlFor="directory-path" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
              {t("directoryPicker.directoryPath")}
            </label>
            <input
              className="directory-picker-path pw-input"
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
              style={{ minWidth: 0, flex: 1, fontFamily: "var(--font-mono)", fontSize: "var(--text-meta)" }}
            />
            <button
              className="directory-picker-new pw-btn sm"
              type="button"
              onClick={beginCreate}
              disabled={loading || pickerBusy || !currentPath}
              title={t("directoryPicker.newFolder")}
              aria-label={t("directoryPicker.newFolder")}
              style={loading || pickerBusy || !currentPath ? { opacity: 0.45 } : undefined}
            >
              <span className="pw-ico"><i data-ico="folder-plus" data-size="13"></i></span>
              {t("directoryPicker.newFolder")}
            </button>
            <button
              className="directory-picker-action pw-btn sm"
              type="submit"
              disabled={loading || pickerBusy || !pathInput.trim()}
              title={t("directoryPicker.goToDirectory")}
            >
              {t("directoryPicker.go")}
            </button>
          </form>

          {operation?.kind === "create" && (
            <form onSubmit={handleOperationSubmit} className="pw-inline">
              <span className="pw-ico pw-dim"><i data-ico="folder-plus" data-size="13"></i></span>
              <input
                id="directory-operation-name"
                className="pw-input"
                type="text"
                value={operation.name}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setOperation((current) => current ? { ...current, name: event.target.value } : current);
                  setOperationError(null);
                }}
                style={{ minWidth: 0, flex: 1, fontFamily: "var(--font-mono)", fontSize: "var(--text-meta)" }}
              />
              <button className="directory-picker-action pw-btn sm" type="button" onClick={() => { setOperation(null); setOperationError(null); }} disabled={operationBusy}>
                {t("i18n.cancel")}
              </button>
              <button className="directory-picker-action pw-btn sm primary" type="submit" disabled={operationBusy || !operation.name.trim()}>
                {operationBusy ? t("i18n.saving") : t("directoryPicker.create")}
              </button>
            </form>
          )}

          <div className="directory-picker-list pw-list" style={{ flex: 1, minHeight: 0, overflow: "auto", alignContent: "start" }}>
            {loading ? (
              <div className="pw-litem pw-dim" role="status">{t("directoryPicker.loadingDirectories")}</div>
            ) : drives !== null ? (
              <>
                {drives.length > 0 ? (
                  drives.map((drive) => (
                    <button
                      key={drive.path}
                      className="directory-picker-entry pw-litem"
                      type="button"
                      onClick={() => void navigateTo(drive.path)}
                      disabled={pickerBusy}
                      title={drive.path}
                    >
                      <Icon name="hard-drive" />
                      <span className="grow"><span className="pw-lname">{drive.name}</span></span>
                    </button>
                  ))
                ) : (
                  <div className="pw-litem pw-dim" role="status">{t("directoryPicker.noDrives")}</div>
                )}
              </>
            ) : directories.length > 0 ? (
              directories.map((entry) => (
                (() => {
                  const isRenaming = operation?.kind === "rename" && operation.path === entry.path;
                  const isConfirmingDelete = confirmDeletePath === entry.path;
                  const isHovered = hoveredDirectoryPath === entry.path;
                  return (
                    <div
                      key={entry.path}
                      className="directory-picker-row pw-litem"
                      onMouseEnter={() => setHoveredDirectoryPath(entry.path)}
                      onMouseLeave={() => setHoveredDirectoryPath(null)}
                      style={isConfirmingDelete ? { boxShadow: "inset 2px 0 0 var(--error)" } : undefined}
                    >
                      {isConfirmingDelete ? (
                        <>
                          <span className="pw-ico" style={{ color: "var(--error)" }}>
                            <i data-ico="trash-2" data-size="14"></i>
                          </span>
                          <span className="grow">
                            <span className="pw-lname">
                              {t("directoryPicker.confirmDeleteFolder", { name: entry.name.slice(0, 22) + (entry.name.length > 22 ? "…" : "") })}
                            </span>
                          </span>
                          <button
                            className="pw-btn sm"
                            type="button"
                            onClick={() => void performDelete(entry)}
                            disabled={deleteBusy}
                            title={t("directoryPicker.deleteFolder")}
                            style={{ background: "var(--error)", color: "var(--accent-on)" }}
                          >
                            <span className="pw-ico"><i data-ico="trash-2" data-size="13"></i></span>
                            {t("sidebar.delete")}
                          </button>
                          <button
                            className="pw-btn sm outline"
                            type="button"
                            onClick={() => { setConfirmDeletePath(null); setDeleteError(null); }}
                            disabled={deleteBusy}
                          >
                            {t("sidebar.cancel")}
                          </button>
                        </>
                      ) : isRenaming ? (
                        <input
                          ref={renameInputRef}
                          className="pw-input"
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
                          style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: "var(--text-meta)" }}
                        />
                      ) : (
                        <>
                          <button
                            className="directory-picker-entry pw-litem"
                            type="button"
                            onClick={() => void navigateTo(entry.path)}
                            disabled={pickerBusy}
                            title={entry.path}
                            style={{ flex: 1, minWidth: 0, margin: 0, padding: 0 }}
                          >
                            <Icon name="folder" />
                            <span className="grow"><span className="pw-lname">{entry.name}</span></span>
                          </button>
                          {isHovered && !pickerBusy && (
                            <div style={{ display: "flex", gap: "var(--s1)", flexShrink: 0 }}>
                              <button
                                className="directory-picker-rename pw-iconbtn sm"
                                type="button"
                                onClick={() => beginRename(entry)}
                                title={`${t("i18n.rename")}: ${entry.name}`}
                                aria-label={`${t("i18n.rename")}: ${entry.name}`}
                              >
                                <span className="pw-ico"><i data-ico="square-pen" data-size="13"></i></span>
                              </button>
                              <button
                                className="pw-iconbtn sm"
                                type="button"
                                onClick={() => beginDelete(entry)}
                                title={t("directoryPicker.deleteFolder")}
                                aria-label={`${t("directoryPicker.deleteFolder")}: ${entry.name}`}
                              >
                                <span className="pw-ico"><i data-ico="trash-2" data-size="13"></i></span>
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()
              ))
            ) : (
              <div className="pw-litem pw-dim" role="status">{t("directoryPicker.noSubdirectories")}</div>
            )}
            {(loadError || error || operationError || deleteError) && (
              <div className="pw-alert" role="alert">
                <span className="pw-ico"><i data-ico="circle-alert" data-size="14"></i></span>
                <span className="grow">{loadError ?? error ?? operationError ?? deleteError}</span>
              </div>
            )}
          </div>
        </div>
 
        <div className="directory-picker-footer pw-modal-foot">
          <button className="directory-picker-action pw-btn" type="button" onClick={onCancel} disabled={pickerBusy}>
            {t("i18n.cancel")}
          </button>
          <button
            className="directory-picker-action pw-btn primary"
            type="button"
            onClick={() => onSelect(currentPath)}
            disabled={!canSelect}
            title={hasUncommittedPath ? t("directoryPicker.openBeforeSelecting") : t("directoryPicker.selectCurrentDirectory")}
            style={canSelect ? undefined : { opacity: 0.6 }}
          >
            {busy ? t("i18n.checking") : t("directoryPicker.selectThisFolder")}
          </button>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
