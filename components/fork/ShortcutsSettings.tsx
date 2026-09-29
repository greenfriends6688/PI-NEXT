"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useShortcutBindings } from "@/hooks/useShortcutBindings";
import {
  ConfigButton,
  ConfigDetailActions,
  ConfigEmptyState,
  ConfigField,
  ConfigSectionTitle,
  PwCtl,
  PwPageHead,
} from "../SettingsUi";
import {
  SHORTCUT_COMMANDS,
  SHORTCUT_GROUPS,
  SHORTCUT_GROUP_LABEL_KEYS,
  buildShortcutOverridesAfterSteal,
  checkShortcutBindingConflict,
  formatShortcutBindingLabel,
  formatShortcutBindingLabelParts,
  isSamePhysicalBinding,
  recordShortcutBinding,
  setShortcutRecordingActive,
  type ShortcutCommandDefinition,
  type ShortcutCommandId,
  type ShortcutConflict,
  type ShortcutPlatformInfo,
} from "@/lib/shortcuts";

/*
 * fork:zc-04 — the settings table for the central shortcut kernel.
 *
 * Every row is rendered from `SHORTCUT_COMMANDS`, so adding a command in
 * `lib/shortcuts.ts` makes it appear here, in the conflict checker and in the
 * storage parser at once. The recording flow is the reference project's:
 * Escape cancels, Backspace/Delete restores the default, a chord that another
 * command already uses shows the owner and offers an explicit "use anyway"
 * (read-only commands — the palette and find rows other features still own —
 * cannot be stolen). IME composition and key repeat never record because the
 * kernel filters them before this component sees a binding.
 */

interface RecordingState {
  commandId: ShortcutCommandId;
  /** Binding formatted for display while the chord is being chosen. */
  preview: string | null;
  error: string | null;
  conflict: ShortcutConflict | null;
}

/* fork:design-system —— 画板 45 的键帽是 `.pw-kbd`（mono + 发丝边框），一个组合键
   的每个键符一枚；产品用真 `<kbd>`（语义保留），类名与画板一致。 */
function PlatformKeycaps({ binding, platform }: { binding: string; platform: ShortcutPlatformInfo }): ReactNode {
  const parts = formatShortcutBindingLabelParts(binding, platform);
  return (
    <span className="pw-inline">
      {parts.map((part, index) => (
        <kbd className="pw-kbd" key={`${part}-${index}`}>{part}</kbd>
      ))}
    </span>
  );
}

export function ShortcutsSettings(): ReactNode {
  const { t } = useI18n();
  const { overrides, effective, updateBindings, resetBindings } = useShortcutBindings();
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [query, setQuery] = useState("");

  const platform = useMemo<ShortcutPlatformInfo>(() => ({
    platform: typeof navigator !== "undefined" ? navigator.platform : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  }), []);

  const commandLabel = useCallback(
    (id: ShortcutCommandId) => t(SHORTCUT_COMMANDS.find((entry) => entry.id === id)?.labelKey ?? id),
    [t],
  );

  const applyBinding = useCallback(
    (commandId: ShortcutCommandId, binding: string) => {
      updateBindings(buildShortcutOverridesAfterSteal(overrides, commandId, binding, platform));
      setRecording(null);
    },
    [overrides, platform, updateBindings],
  );

  const resetCommand = useCallback(
    (commandId: ShortcutCommandId) => {
      const next = { ...overrides };
      delete next[commandId];
      updateBindings(next);
    },
    [overrides, updateBindings],
  );

  // Recording owns the keyboard: the global dispatcher short-circuits while the
  // flag is set, otherwise the chord being recorded would first fire whatever
  // the command is currently bound to.
  useEffect(() => {
    if (!recording) return;
    setShortcutRecordingActive(true);

    const handler = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecording(null);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        resetCommand(recording.commandId);
        setRecording(null);
        return;
      }
      if (event.repeat) return;

      const result = recordShortcutBinding(event, platform);
      if (result.kind === "pending") {
        // A bare modifier means the user is still building the chord; clear any
        // stale error so the input visibly keeps listening.
        if (recording.error !== null || recording.preview !== null || recording.conflict !== null) {
          setRecording({ ...recording, preview: null, error: null, conflict: null });
        }
        return;
      }
      if (result.kind === "invalid") {
        setRecording({
          ...recording,
          preview: null,
          conflict: null,
          error: t(result.reason === "no-modifier" ? "settings.shortcuts.invalidNoModifier" : "settings.shortcuts.invalidKey"),
        });
        return;
      }

      // Same command, same physical chord: nothing to gain, reject loudly.
      const ownBindings = effective[recording.commandId] ?? [];
      if (ownBindings.some((binding) => isSamePhysicalBinding(binding, result.binding, platform))) {
        setRecording({
          ...recording,
          preview: formatShortcutBindingLabel(result.binding, platform),
          conflict: null,
          error: t("settings.shortcuts.duplicateBinding"),
        });
        return;
      }

      const conflict = checkShortcutBindingConflict(recording.commandId, result.binding, overrides, platform);
      if (conflict) {
        const owner = conflict.kind === "occupied" ? commandLabel(conflict.ownerCommandId) : "";
        setRecording({
          ...recording,
          preview: formatShortcutBindingLabel(result.binding, platform),
          conflict,
          error: conflict.kind === "reserved"
            ? t("settings.shortcuts.conflictReserved")
            : conflict.kind === "occupied" && !conflict.ownerManaged
              ? t("settings.shortcuts.conflictReadonly", { command: owner })
              : t("settings.shortcuts.conflictOccupied", { command: owner }),
        });
        return;
      }

      applyBinding(recording.commandId, result.binding);
    };

    window.addEventListener("keydown", handler, true);
    return () => {
      window.removeEventListener("keydown", handler, true);
      setShortcutRecordingActive(false);
    };
  }, [applyBinding, commandLabel, effective, overrides, platform, recording, resetCommand, t]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleCommands = normalizedQuery
    ? SHORTCUT_COMMANDS.filter((entry) =>
        t(entry.labelKey).toLowerCase().includes(normalizedQuery)
        || entry.id.toLowerCase().includes(normalizedQuery)
        || (effective[entry.id] ?? []).some((binding) => binding.toLowerCase().includes(normalizedQuery)))
    : SHORTCUT_COMMANDS;

  return (
    <>
      {/* fork:design-system —— 画板 45：页头 + 搜索/重置工具条 + 两列分组，
          每行是 `.pw-field`（左标签、右 `.pw-ctl` 里的 `.pw-kbd` 与 `.pw-btn.sm`）。 */}
      <PwPageHead title={t("settings.shortcuts.title")} sub={t("settings.shortcuts.description")} />

      <ConfigDetailActions>
        <span className="pw-ico"><i data-ico="search" data-size="14" aria-hidden="true" /></span>
        <input
          className="pw-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("settings.shortcuts.searchPlaceholder")}
          aria-label={t("settings.shortcuts.searchPlaceholder")}
          maxLength={60}
          style={{ minWidth: 0, flex: 1 }}
        />
        <span className="pw-badge count">{visibleCommands.length}</span>
        <ConfigButton
          variant="secondary"
          size="small"
          disabled={Object.keys(overrides).length === 0}
          onClick={() => resetBindings()}
        >
          <span className="pw-ico"><i data-ico="undo-2" data-size="13" aria-hidden="true" /></span>
          {t("settings.shortcuts.resetAll")}
        </ConfigButton>
      </ConfigDetailActions>

      <div className="pw-grid2">
        {SHORTCUT_GROUPS.map((group) => {
          const commands = visibleCommands.filter((entry) => entry.group === group);
          if (commands.length === 0) return null;
          return (
            <Fragment key={group}>
              <ConfigSectionTitle>{t(SHORTCUT_GROUP_LABEL_KEYS[group])}</ConfigSectionTitle>
              <div>
                {commands.map((entry) => (
                  <ShortcutRow
                    key={entry.id}
                    entry={entry}
                    label={t(entry.labelKey)}
                    bindings={effective[entry.id] ?? []}
                    isOverridden={overrides[entry.id] !== undefined}
                    isRecording={recording?.commandId === entry.id}
                    recording={recording?.commandId === entry.id ? recording : null}
                    platform={platform}
                    onStartRecording={() => setRecording({ commandId: entry.id, preview: null, error: null, conflict: null })}
                    onReset={() => resetCommand(entry.id)}
                    onSteal={(binding) => applyBinding(entry.id, binding)}
                    onCancel={() => setRecording(null)}
                  />
                ))}
              </div>
            </Fragment>
          );
        })}
      </div>

      {visibleCommands.length === 0 && (
        <ConfigEmptyState>
          <p>{t("settings.shortcuts.searchEmpty")}</p>
        </ConfigEmptyState>
      )}
    </>
  );
}

function ShortcutRow({
  entry,
  label,
  bindings,
  isOverridden,
  isRecording,
  recording,
  platform,
  onStartRecording,
  onReset,
  onSteal,
  onCancel,
}: {
  entry: ShortcutCommandDefinition;
  label: string;
  bindings: readonly string[];
  isOverridden: boolean;
  isRecording: boolean;
  recording: RecordingState | null;
  platform: ShortcutPlatformInfo;
  onStartRecording: () => void;
  onReset: () => void;
  onSteal: (binding: string) => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();

  /* fork:design-system —— 画板 45 的快捷键行：`.pw-field` 左标签（不可改的命令
     带 `<small>` 说明）＋右 `.pw-ctl`（`.pw-kbd` 键帽 + `.pw-btn.sm` 动作）。
     录制中的那一行把预览也放进 `.pw-kbd`，冲突 / 错误用 `.pw-alert`。 */
  return (
    <>
      <ConfigField
        label={
          <>
            {label}
            {entry.managed === false && <small>{t("settings.shortcuts.notConfigurable")}</small>}
          </>
        }
      >
        <PwCtl>
          {isRecording ? (
            <>
              {recording?.preview
                ? <kbd className="pw-kbd">{recording.preview}</kbd>
                : <span className="pw-hint">{t("settings.shortcuts.pressKeys")}</span>}
              {recording?.conflict?.kind === "occupied" && recording.conflict.ownerManaged && (
                <ConfigButton
                  variant="primary"
                  size="small"
                  onClick={() => onSteal(recording.conflict!.binding)}
                >
                  {t("settings.shortcuts.steal")}
                </ConfigButton>
              )}
              <ConfigButton variant="ghost" size="small" onClick={onCancel}>
                {t("i18n.cancel")}
              </ConfigButton>
            </>
          ) : (
            <>
              {bindings.length === 0 ? (
                <span className="pw-hint">{t("settings.shortcuts.unassigned")}</span>
              ) : (
                bindings.map((binding) => <PlatformKeycaps key={binding} binding={binding} platform={platform} />)
              )}
              {entry.managed && (
                <>
                  <ConfigButton
                    variant="ghost"
                    size="small"
                    disabled={!isOverridden}
                    onClick={onReset}
                    title={t("settings.shortcuts.reset")}
                    aria-label={t("settings.shortcuts.reset")}
                  >
                    <span className="pw-ico"><i data-ico="x" data-size="13" aria-hidden="true" /></span>
                  </ConfigButton>
                  <ConfigButton variant="secondary" size="small" onClick={onStartRecording}>
                    {t("settings.shortcuts.record")}
                  </ConfigButton>
                </>
              )}
            </>
          )}
        </PwCtl>
      </ConfigField>

      {/* 画板 45 的冲突提示是行下方的一条整宽 `.pw-alert`，不塞进行内的控件列。 */}
      {isRecording && recording?.error && (
        <div className="pw-alert" role="alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
          <span className="grow">{recording.error}</span>
        </div>
      )}
    </>
  );
}
