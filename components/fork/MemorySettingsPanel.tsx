"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import { SettingsPage } from "../SettingsUi";

/**
 * fork:memory —— 设置 → 记忆（画板 D-36）。
 *
 * 记忆能力整个来自第三方扩展 `pi-hermes-memory`（`pi install npm:pi-hermes-memory`）。
 * 这一页的开关是**本应用自己的**偏好（`~/.pi/agent/pi-web-preferences.json` 的
 * `memoryExtensionEnabled`）：关着时 PI NEXT 在会话创建时把这个扩展从加载结果里摘掉，
 * **不动 pi 的 `packages`** —— 终端与其它运行时照旧用它自己的那份记忆
 * （用户 2026-10-07 裁定：「只影响 PI NEXT」）。包里那条全局状态只读地摆在下面。
 *
 * **默认关着**：开之前它一个字节都不会写进 `~/.pi/agent/pi-hermes-memory/`。
 * 切换对**新会话**生效（扩展是会话启动时加载的），所以开关旁常驻「新会话生效」徽标。
 *
 * DOM 照 `design/v5/web/boards/D-36-settings-memory.html` 抄：
 * `.d-set-sec` / `.d-set-row` / `.d-grow-last` / `.d-badge` / `.d-switch` / `.d-banner`，
 * 不新增任何 `d-*` 类，也不写内联几何。
 */

interface MemoryStateView {
  source: string;
  installed: boolean;
  /** 本应用的开关（默认关）。 */
  enabled: boolean;
  /** pi 的 packages 里那一条开着吗（终端 / 其它运行时）—— 只读。 */
  packageEnabled: boolean;
  version: string | null;
  memoryDir: string;
  memoryDirExists: boolean;
  files: { name: string; bytes: number }[];
  projectsDir: string;
  configPath: string;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function MemorySettingsPanel() {
  const { t } = useI18n();
  const [state, setState] = useState<MemoryStateView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/memory");
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${response.status}`);
      }
      setState(await response.json() as MemoryStateView);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setToggleError(null);
    try {
      const response = await fetch("/api/memory", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as MemoryStateView & { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setState(data);
    } catch (error) {
      setToggleError(error instanceof Error ? error.message : String(error));
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <SettingsPage title={t("settings.memory")} sub={t("settings.memorySub")}>
        <div className="d-set-inner">
          <div className="d-set-sec">
            <div className="d-banner err">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{t("settings.memoryLoadFailed")}: {loadError}</span>
            </div>
          </div>
        </div>
      </SettingsPage>
    );
  }
  if (!state) return null;

  const fileList = state.files.map((file) => `${file.name} · ${formatBytes(file.bytes)}`).join(" · ");

  return (
    <SettingsPage title={t("settings.memory")} sub={t("settings.memorySub")}>
      <div className="d-set-inner">
        <div className="d-set-sec">
          <div className="d-set-sec-t">{t("settings.memoryExtSection")}</div>
          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.memoryExtTitle")}</div>
            </div>
            {/* 切换后要新开（或重载）会话才生效 —— 常驻徽标，面板不假装它当场生效。 */}
            <span className="d-grow-last">
              {state.installed
                ? <span className="d-badge mute">{t("settings.memoryVersion", { version: state.version ?? "" })}</span>
                : <span className="d-badge bad">{t("settings.memoryNotInstalled")}</span>}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={state.enabled}
              aria-busy={busy || undefined}
              aria-label={t("settings.memoryToggle")}
              title={t("settings.memoryToggle")}
              disabled={busy || !state.installed}
              className={`d-switch${state.enabled ? " on" : ""}`}
              onClick={() => void toggle(!state.enabled)}
            />
          </div>

          {toggleError ? (
            <div className="d-banner err">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{toggleError}</span>
            </div>
          ) : null}

          {!state.installed ? (
            <div className="d-banner warn">
              <i data-ico="triangle-alert" data-size="14"></i>
              <span>{t("settings.memoryInstallHint")}</span>
            </div>
          ) : null}

          {/* 这个开关只影响 PI NEXT —— 包里那条全局状态只读地摆出来（终端 / 其它运行时）。 */}
          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.memoryScopeTitle")}</div>
            </div>
            <span className="d-grow-last">
              {state.packageEnabled
                ? <span className="d-badge ok">{t("settings.memoryScopeOn")}</span>
                : <span className="d-badge mute">{t("settings.memoryScopeOff")}</span>}
            </span>
          </div>
          {!state.packageEnabled ? (
            <div className="d-banner warn">
              <i data-ico="triangle-alert" data-size="14"></i>
              <span>{t("settings.memoryPackageDisabledHint")}</span>
            </div>
          ) : null}

          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.memoryReloadTitle")}</div>
            </div>
            <span className="d-grow-last"><span className="d-badge mute">{t("settings.memoryReloadBadge")}</span></span>
          </div>
        </div>

        <div className="d-set-sec">
          <div className="d-set-sec-t">{t("settings.memoryStorageSection")}</div>
          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.memoryDirTitle")}</div>
              <div className="d-set-row-s d-mono">{state.memoryDir}</div>
            </div>
            <span className="d-grow-last">
              {state.memoryDirExists && state.files.length > 0
                ? <span className="d-badge ok">{t("settings.memoryFileCount", { count: state.files.length })}</span>
                : <span className="d-badge mute">{t("settings.memoryEmpty")}</span>}
            </span>
          </div>
          {fileList ? <span className="d-t-xs d-t-faint d-mono">{fileList}</span> : null}

          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.memoryProjectsTitle")}</div>
              <div className="d-set-row-s d-mono">{state.projectsDir}</div>
            </div>
          </div>

          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.memoryConfigTitle")}</div>
              <div className="d-set-row-s d-mono">{state.configPath}</div>
            </div>
          </div>
        </div>
      </div>
    </SettingsPage>
  );
}
