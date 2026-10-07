"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import { SettingsPage } from "../SettingsUi";

/**
 * fork:imagegen —— 设置 → 生图模型（画板 D-31）。
 *
 * 生图模型是**独立于对话模型的档案**：它不进对话模型选择器、不吃 `enabledModels`，
 * 每个预设档（Agnes 国内/国际、火山方舟、Google AI Studio、OpenAI、自定义）各有自己的
 * 端点、密钥、模型名与默认尺寸 —— 预设表与三种请求方言照抄参考项目的实测实现
 * （见 `lib/imagegen-shared.ts` 头注）。会话里的 `generate_image` 工具与标书配图读同一份
 * `~/.pi/agent/imagegen.json`（0600，密钥掩码存取）。
 *
 * DOM 照 `design/v5/web/boards/D-31-settings-imagegen.html` 抄：
 * `.d-set-sec` / `.d-grid2` / `.d-field` / `.d-input` / `.d-select` / `.d-banner`，
 * 不新增任何 `d-*` 类，也不写内联几何（style-literal 基线只减不增）。
 *
 * 密钥交互与 im-bridge 同一条铁律：页面拿到的永远是掩码（`••••••••`），
 * 保存时把掩码原样传回 = 沿用已存密钥；显式清空才是「清掉了」。
 */

interface ProviderProfileView {
  baseUrl: string;
  apiKey: string;
  model: string;
  size: string;
  concurrency: number;
  status: {
    state: "untested" | "available" | "unavailable";
    testedAt: string | null;
    lastError: string | null;
    lastDurationMs: number | null;
  };
}

interface ImageGenConfigView {
  active: string;
  providers: Record<string, ProviderProfileView>;
}

const PRESETS = ["agnes", "agnes-global", "volcengine", "google", "openai", "custom"] as const;
type Preset = (typeof PRESETS)[number];

/** 像素尺寸（OpenAI 兼容那一套）。 */
const PIXEL_SIZES = ["auto", "512x512", "1024x1024", "1024x768", "768x1024", "1536x1024", "1024x1536", "2048x2048"];
/** Agnes 2.1 是档位（1K/2K/3K/4K），2.0 是像素（照参考项目的白名单）。 */
const AGNES_SIZES = ["1K", "2K", "3K", "4K", "1024x768", "1024x1024", "768x1024"];

function sizeOptions(preset: Preset): string[] {
  return preset === "agnes" || preset === "agnes-global" ? AGNES_SIZES : PIXEL_SIZES;
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function ImageGenSettingsPanel() {
  const { t } = useI18n();
  const [config, setConfig] = useState<ImageGenConfigView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testState, setTestState] = useState<"idle" | "running">("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [testImage, setTestImage] = useState<string | null>(null);
  const [testDuration, setTestDuration] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/imagegen");
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${response.status}`);
      }
      const data = await response.json() as ImageGenConfigView;
      setConfig(data);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeId = (config?.active ?? "agnes") as Preset;
  const active = config?.providers[activeId];

  const patchActive = (patch: Partial<ProviderProfileView>) => {
    setConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        providers: {
          ...current.providers,
          [activeId]: { ...current.providers[activeId], ...patch },
        },
      };
    });
    setSaveState("idle");
  };

  const save = async () => {
    if (!config) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const response = await fetch("/api/imagegen", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: activeId, providers: config.providers }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      // 重新读一遍：掩码与「换端点/换模型就重置状态」都是服务端算的。
      await load();
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  const runTest = async () => {
    if (!config) return;
    setTestState("running");
    setTestError(null);
    setTestImage(null);
    try {
      // 先落盘再测：测试用的是**已存**的密钥（掩码不会发给后端当明文用）。
      const saveResponse = await fetch("/api/imagegen", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: activeId, providers: config.providers }),
      });
      if (!saveResponse.ok) {
        const data = await saveResponse.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${saveResponse.status}`);
      }
      const response = await fetch("/api/imagegen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: activeId }),
      });
      const data = await response.json() as { ok?: boolean; image?: string; durationMs?: number; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setTestImage(data.image ?? null);
      setTestDuration(data.durationMs ?? null);
      await load();
    } catch (error) {
      setTestError(error instanceof Error ? error.message : String(error));
      await load();
    } finally {
      setTestState("idle");
    }
  };

  if (loadError) {
    return (
      <SettingsPage title={t("settings.imagegen")}>
        <div className="d-set-inner">
          <div className="d-set-sec">
            <div className="d-banner err">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{t("settings.imagegenLoadFailed")}: {loadError}</span>
            </div>
          </div>
        </div>
      </SettingsPage>
    );
  }
  if (!config || !active) return null;

  const statusBadge = active.status.state === "available"
    ? <span className="d-badge ok">{t("settings.imagegenStatus.available")}</span>
    : active.status.state === "unavailable"
      ? <span className="d-badge bad">{t("settings.imagegenStatus.unavailable")}</span>
      : <span className="d-badge mute">{t("settings.imagegenStatus.untested")}</span>;

  const missing = !active.baseUrl || !active.apiKey || !active.model;
  const sizes = sizeOptions(activeId);

  return (
    <SettingsPage
      title={t("settings.imagegen")}
      actions={
        <>
          <button type="button" className="d-btn sm" onClick={() => void runTest()} disabled={testState === "running"}>
            <i data-ico="image" data-size="13" aria-hidden="true" />
            {testState === "running" ? t("settings.imagegenTesting") : t("settings.imagegenTestBtn")}
          </button>
          <button type="button" className="d-btn sm primary" onClick={() => void save()} disabled={saveState === "saving"}>
            <i data-ico="check" data-size="13" aria-hidden="true" />
            {saveState === "saving" ? t("settings.imagegenSaving") : t("settings.imagegenSave")}
          </button>
        </>
      }
    >
      <div className="d-set-inner">
        <div className="d-set-sec">
          <div className="d-set-sec-t">{t("settings.imagegenProviderSection")}</div>
          <div className="d-grid2">
            <div className="d-field">
              <span className="d-field-t">{t("settings.imagegenProvider")}</span>
              <select
                className="d-select"
                value={activeId}
                aria-label={t("settings.imagegenProvider")}
                onChange={(event) => {
                  const preset = event.target.value as Preset;
                  setConfig((current) => (current ? { ...current, active: preset } : current));
                  setSaveState("idle");
                  setTestImage(null);
                  setTestDuration(null);
                }}
              >
                {PRESETS.map((preset) => (
                  <option key={preset} value={preset}>{t(`settings.imagegenPreset.${preset}`)}</option>
                ))}
              </select>
            </div>
            <div className="d-field">
              <span className="d-field-t">{t("settings.imagegenBaseUrl")}</span>
              <input
                className="d-input d-mono"
                value={active.baseUrl}
                placeholder={activeId === "google" ? "https://generativelanguage.googleapis.com/v1beta" : "https://api.example.com/v1"}
                onChange={(event) => patchActive({ baseUrl: event.target.value })}
              />
            </div>
            <div className="d-field">
              <span className="d-field-t">{t("settings.imagegenApiKey")}</span>
              <input
                className="d-input d-mono"
                type="password"
                value={active.apiKey}
                placeholder={t("settings.imagegenApiKeyPlaceholder")}
                onChange={(event) => patchActive({ apiKey: event.target.value })}
              />
            </div>
            <div className="d-field">
              <span className="d-field-t">{t("settings.imagegenModel")}</span>
              <input
                className="d-input d-mono"
                value={active.model}
                onChange={(event) => patchActive({ model: event.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="d-set-sec">
          <div className="d-set-sec-t">{t("settings.imagegenParamsSection")}</div>
          <div className="d-grid2">
            <div className="d-field">
              <span className="d-field-t">{t("settings.imagegenSize")}</span>
              <select
                className="d-select"
                value={active.size}
                aria-label={t("settings.imagegenSize")}
                onChange={(event) => patchActive({ size: event.target.value })}
              >
                {(sizes.includes(active.size) ? sizes : [active.size, ...sizes]).map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
            <div className="d-field">
              <span className="d-field-t">{t("settings.imagegenConcurrency")}</span>
              <input
                className="d-input d-mono"
                type="number"
                min={1}
                max={4}
                value={active.concurrency}
                onChange={(event) => patchActive({ concurrency: Number(event.target.value) || 1 })}
              />
            </div>
          </div>
        </div>

        <div className="d-set-sec">
          <div className="d-set-sec-t">{t("settings.imagegenTestSection")}</div>
          {testError ? (
            <div className="d-banner err">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{testError}</span>
            </div>
          ) : active.status.state === "unavailable" && active.status.lastError ? (
            <div className="d-banner err">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{active.status.lastError}</span>
            </div>
          ) : active.status.state === "available" ? (
            <div className="d-banner ok">
              <i data-ico="circle-check" data-size="14"></i>
              <span>
                {t("settings.imagegenStatus.available")}
                {active.status.lastDurationMs !== null ? ` · ${formatDuration(active.status.lastDurationMs)}` : ""}
                {active.status.testedAt ? ` · ${new Date(active.status.testedAt).toLocaleString()}` : ""}
              </span>
            </div>
          ) : (
            <div className="d-banner warn">
              <i data-ico="triangle-alert" data-size="14"></i>
              <span>{t("settings.imagegenUntestedHint")}</span>
            </div>
          )}

          {missing ? (
            <div className="d-banner warn">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{t("settings.imagegenMissing")}</span>
            </div>
          ) : null}

          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.imagegenTestTitle")}</div>
            </div>
            <span className="d-grow-last">{statusBadge}</span>
          </div>

          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t d-t-dim">{t("settings.imagegenPreviewTitle")}</div>
              {testDuration !== null ? (
                <div className="d-set-row-s">{t("settings.imagegenLastTest")}: {formatDuration(testDuration)}</div>
              ) : null}
            </div>
            {testImage ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={testImage} alt={t("settings.imagegenPreviewTitle")} className="d-test-img" />
            ) : (
              <span className="d-t-xs d-t-faint">{t("settings.imagegenPreviewEmpty")}</span>
            )}
          </div>

          {saveError ? (
            <div className="d-banner err">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{saveError}</span>
            </div>
          ) : saveState === "saved" ? (
            <div className="d-banner ok">
              <i data-ico="circle-check" data-size="14"></i>
              <span>{t("settings.imagegenSaved")}</span>
            </div>
          ) : null}
        </div>
      </div>
    </SettingsPage>
  );
}
