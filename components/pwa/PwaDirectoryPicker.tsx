"use client";

import { type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { useI18n } from "@/hooks/useI18n";

/*
 * fork:v5-wave-b-sysstate —— 手机上的目录选择器 = M-10 帧 C-1「这个目录」那张
 * sheet 的壳 + M-06 的 `.m-list` / `.m-group-title` / `.m-trow` 目录列表。
 *
 * 形态分工（M-10 / M-11）：
 *   · 壳：`.m-scrim.is-open` + `.m-sheet.is-open`（不是 `.m-modal`）—— 选择目录
 *     是可回退的导航动作，底部 sheet 才能一路往下走；
 *   · 路径行：`.m-searchfield`（+ `.m-touch-44`，因为它可聚焦可提交）；
 *   · 目录动作：`.m-tray` + `.m-tray-chip`（M-10 帧 D 的托盘），不用 hover ——
 *     触摸没有 hover，所以**动作常驻**，这是与桌面唯一的结构差别；
 *   · 载：`.m-skel-list` + `.m-skel .m-skel-50`（M-11 帧 D ② 骨架：
 *     形状要等于将来的内容 —— 将来是一行行 44px 高的目录行）；
 *   · 错：`.m-banner.err`（M-11 帧 D ③）；
 *   · 删除二次确认就地长在那一行上（`.m-perm` + `.m-pickbar` 的
 *     取消 / 删除），与桌面同构，不弹第二个模态；
 *   · 底栏：`.m-pickbar` + `.m-picktag`（44px 天然达标）。
 *
 * 行为零变化：所有回调都由 `components/DirectoryPicker.tsx` 传进来，
 * 接口调用、键盘提交、Esc / 点遮罩关闭都在那边，本组件只换 DOM。
 *
 * fork:v5-wave-n1 · M-11 帧 C 的 48 档（`.m-touch-48` = `--nx-ctl-lg`）挂在
 * 底栏那颗主按钮上 —— 它是这张 sheet 的一级行动钮。其余仍按帧 C 的
 * 44 硬下限：搜索行 / 托盘 chip / 行内图标钮。
 */

export interface PwaDirectoryEntry {
  name: string;
  path: string;
}

export interface PwaDirectoryOperation {
  kind: "create" | "rename";
  name: string;
  path?: string;
}

export interface PwaDirectoryPickerProps {
  currentPath: string;
  pathInput: string;
  onPathInputChange: (value: string) => void;
  onPathSubmit: (event: FormEvent<HTMLFormElement>) => void;
  parentPath: string | null;
  canNavigateUp: boolean;
  onNavigate: (path?: string) => void;
  loading: boolean;
  drives: PwaDirectoryEntry[] | null;
  directories: PwaDirectoryEntry[];
  hasUncommittedPath: boolean;
  pickerBusy: boolean;
  busy: boolean;
  canSelect: boolean;
  /** create 表单 */
  operation: PwaDirectoryOperation | null;
  operationBusy: boolean;
  onOperationNameChange: (name: string) => void;
  onOperationSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOperationCancel: () => void;
  /** 重命名输入框的 ref 与事件（复用父组件的 ref，focus/select 行为不变） */
  renameInputRef: RefObject<HTMLInputElement | null>;
  onRenameNameChange: (name: string) => void;
  onRenameBlur: () => void;
  onRenameKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** 删除确认 */
  confirmDeletePath: string | null;
  deleteBusy: boolean;
  onDeleteCancel: () => void;
  onDeleteConfirm: (entry: PwaDirectoryEntry) => void;
  onRenameStart: (entry: PwaDirectoryEntry) => void;
  onDeleteStart: (entry: PwaDirectoryEntry) => void;
  /** 新建文件夹（父组件内部有 loading / busy / 无 currentPath 的守卫） */
  onCreateStart: () => void;
  /** 错误：加载 / 上层传入 / 建改名 / 删除，取第一个非空 */
  errorText: string | null;
  onCancel: () => void;
  onSelect: () => void;
}

export function PwaDirectoryPicker(props: PwaDirectoryPickerProps) {
  const { t } = useI18n();
  const {
    currentPath,
    pathInput,
    onPathInputChange,
    onPathSubmit,
    parentPath,
    canNavigateUp,
    onNavigate,
    loading,
    drives,
    directories,
    hasUncommittedPath,
    pickerBusy,
    busy,
    canSelect,
    operation,
    operationBusy,
    onOperationNameChange,
    onOperationSubmit,
    onOperationCancel,
    renameInputRef,
    onRenameNameChange,
    onRenameBlur,
    onRenameKeyDown,
    confirmDeletePath,
    deleteBusy,
    onDeleteCancel,
    onDeleteConfirm,
    onRenameStart,
    onDeleteStart,
    onCreateStart,
    errorText,
    onCancel,
    onSelect,
  } = props;

  return (
    <>
      <div
        className="m-scrim is-open"
        onClick={() => {
          if (!pickerBusy) onCancel();
        }}
      />
      {/* role / aria-modal 由外层宿主（`useDialogA11y` 的 dialogProps）承担，
          这里只把标题指回去 —— 两层 role="dialog" 会让读屏读两遍。 */}
      <div className="m-sheet is-open">
        {/* 抓手可点即收（div→button 的既定换法）；pickerBusy 中不许收，与遮罩同一守卫。
            命中区在 `app/design/v5-forms.css` 的接线层放大。 */}
        <button
          type="button"
          className="m-sheet-grab"
          aria-label={t("chat.close")}
          onClick={() => {
            if (!pickerBusy) onCancel();
          }}
        />
        <div className="m-sheet-title" id="directory-picker-title">
          {t("directoryPicker.selectDirectory")}
        </div>
        <div className="m-sheet-body">
          {/* 路径行：`.m-searchfield` 抄 M-10 帧 C-1，右侧那颗提交钮补 44 命中区。 */}
          <form onSubmit={onPathSubmit} className="m-searchfield m-touch-44">
            <i data-ico="folder" data-size="14" aria-hidden="true" />
            <label
              htmlFor="directory-path"
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                padding: 0,
                margin: -1,
                overflow: "hidden",
                clip: "rect(0, 0, 0, 0)",
                whiteSpace: "nowrap",
                border: 0,
              }}
            >
              {t("directoryPicker.directoryPath")}
            </label>
            <input
              id="directory-path"
              className="m-mono"
              type="text"
              value={pathInput}
              placeholder="/path/to/project or ~/project"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                onPathInputChange(event.target.value);
              }}
            />
            <button
              type="submit"
              className="m-iconbtn m-touch-44"
              disabled={loading || pickerBusy || !pathInput.trim()}
              title={t("directoryPicker.goToDirectory")}
              aria-label={t("directoryPicker.goToDirectory")}
            >
              <i data-ico="corner-down-right" data-size="15" aria-hidden="true" />
            </button>
          </form>

          {/* 动作常驻：触摸没有 hover（桌面是悬浮出 `.d-iconbtn` 那一组）。 */}
          <div className="m-tray" style={{ padding: "8px 4px" }}>
            <button
              type="button"
              className="m-tray-chip m-touch-44"
              onClick={() => onNavigate(parentPath ?? undefined)}
              disabled={loading || pickerBusy || !canNavigateUp}
              title={t("directoryPicker.goToParent")}
            >
              <i data-ico="arrow-up" data-size="13" aria-hidden="true" />
              {t("directoryPicker.goToParent")}
            </button>
            <button
              type="button"
              className="m-tray-chip m-touch-44"
              onClick={operation?.kind === "create" ? onOperationCancel : onCreateStart}
              disabled={loading || pickerBusy || operationBusy || !currentPath || operation?.kind === "rename"}
              title={t("directoryPicker.newFolder")}
            >
              <i data-ico="folder-plus" data-size="13" aria-hidden="true" />
              {t("directoryPicker.newFolder")}
            </button>
            <button
              type="button"
              className="m-tray-chip m-touch-44"
              onClick={onCancel}
              disabled={pickerBusy}
              title={t("i18n.close")}
            >
              <i data-ico="x" data-size="13" aria-hidden="true" />
              {t("i18n.close")}
            </button>
          </div>

          {operation?.kind === "create" && (
            <form onSubmit={onOperationSubmit} className="m-searchfield m-touch-44">
              <i data-ico="folder-plus" data-size="14" aria-hidden="true" />
              <input
                id="directory-operation-name"
                className="m-mono"
                type="text"
                value={operation.name}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => onOperationNameChange(event.target.value)}
              />
              <button type="button" className="m-btn sm m-touch-44" onClick={onOperationCancel} disabled={operationBusy}>
                {t("i18n.cancel")}
              </button>
              <button
                type="submit"
                className="m-btn sm primary m-touch-44"
                disabled={operationBusy || !operation.name.trim()}
              >
                <i data-ico="check" data-size="13" aria-hidden="true" />
                {operationBusy ? t("i18n.saving") : t("directoryPicker.create")}
              </button>
            </form>
          )}

          {hasUncommittedPath && (
            <div className="m-banner warn">
              <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
              <span className="m-grow">{t("directoryPicker.openBeforeSelecting")}</span>
            </div>
          )}

          <div className="m-list">
            {loading ? (
              <div className="m-skel-list" role="status" aria-live="polite" aria-label={t("directoryPicker.loadingDirectories")}>
                <div className="m-skel m-skel-50" />
                <div className="m-skel m-skel-50" />
                <div className="m-skel m-skel-50" />
              </div>
            ) : drives !== null ? (
              drives.length > 0 ? (
                drives.map((drive) => (
                  <div className="m-trow" key={drive.path} style={{ padding: 0 }}>
                    <button
                      className="m-trow"
                      type="button"
                      style={{ flex: 1, minWidth: 0 }}
                      onClick={() => onNavigate(drive.path)}
                      disabled={pickerBusy}
                      title={drive.path}
                    >
                      <i data-ico="hard-drive" data-size="15" aria-hidden="true" />
                      <span className="m-grow">{drive.name}</span>
                    </button>
                  </div>
                ))
              ) : (
                <div className="m-trow m-t-faint" role="status">
                  {t("directoryPicker.noDrives")}
                </div>
              )
            ) : directories.length > 0 ? (
              directories.map((entry) => {
                const isRenaming = operation?.kind === "rename" && operation.path === entry.path;
                const isConfirmingDelete = confirmDeletePath === entry.path;

                if (isConfirmingDelete) {
                  return (
                    <div className="m-perm" key={entry.path} role="alert">
                      <div className="m-setrow-body">
                        <span className="m-setrow-t m-t-xs">
                          {t("directoryPicker.confirmDeleteFolder", {
                            name: entry.name.slice(0, 22) + (entry.name.length > 22 ? "…" : ""),
                          })}
                        </span>
                        <span className="m-setrow-s m-t-xs">{entry.path}</span>
                      </div>
                      <div className="m-pickbar" style={{ padding: 0 }}>
                        <button type="button" className="m-picktag" onClick={onDeleteCancel} disabled={deleteBusy}>
                          {t("sidebar.cancel")}
                        </button>
                        <button
                          type="button"
                          className="m-picktag danger is-on"
                          onClick={() => onDeleteConfirm(entry)}
                          disabled={deleteBusy}
                          title={t("directoryPicker.deleteFolder")}
                        >
                          <i data-ico="trash-2" data-size="13" aria-hidden="true" />
                          {t("sidebar.delete")}
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="m-trow" key={entry.path} style={{ padding: 0 }}>
                    {isRenaming ? (
                      <>
                        <input
                          ref={renameInputRef}
                          className="m-input m-touch-44 m-mono"
                          value={operation.name}
                          style={{ flex: 1, minWidth: 0 }}
                          onChange={(event) => onRenameNameChange(event.target.value)}
                          onBlur={onRenameBlur}
                          onKeyDown={onRenameKeyDown}
                          autoFocus
                          aria-label={`${t("i18n.rename")}: ${entry.name}`}
                        />
                      </>
                    ) : (
                      <button
                        className="m-trow"
                        type="button"
                        style={{ flex: 1, minWidth: 0 }}
                        onClick={() => onNavigate(entry.path)}
                        disabled={pickerBusy}
                        title={entry.path}
                      >
                        <i data-ico="folder" data-size="15" aria-hidden="true" />
                        <span className="m-grow">{entry.name}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="m-iconbtn m-touch-44"
                      onClick={() => onRenameStart(entry)}
                      disabled={pickerBusy || Boolean(operation)}
                      title={`${t("i18n.rename")}: ${entry.name}`}
                      aria-label={`${t("i18n.rename")}: ${entry.name}`}
                    >
                      <i data-ico="square-pen" data-size="15" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="m-iconbtn m-touch-44"
                      onClick={() => onDeleteStart(entry)}
                      disabled={pickerBusy || deleteBusy || Boolean(operation)}
                      title={t("directoryPicker.deleteFolder")}
                      aria-label={`${t("directoryPicker.deleteFolder")}: ${entry.name}`}
                    >
                      <i data-ico="trash-2" data-size="15" aria-hidden="true" />
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="m-trow m-t-faint" role="status">
                {t("directoryPicker.noSubdirectories")}
              </div>
            )}
            {errorText && (
              <div className="m-banner err" role="alert">
                <i data-ico="circle-alert" data-size="14" aria-hidden="true" />
                <span className="m-grow">{errorText}</span>
              </div>
            )}
          </div>
        </div>

        <div className="m-pickbar">
          <button type="button" className="m-picktag" onClick={onCancel} disabled={pickerBusy}>
            {t("i18n.cancel")}
          </button>
          <button
            type="button"
            className="m-picktag is-on m-touch-48"
            onClick={onSelect}
            disabled={!canSelect}
            title={hasUncommittedPath ? t("directoryPicker.openBeforeSelecting") : t("directoryPicker.selectCurrentDirectory")}
          >
            {busy ? t("i18n.checking") : t("directoryPicker.selectThisFolder")}
          </button>
        </div>
      </div>
    </>
  );
}
