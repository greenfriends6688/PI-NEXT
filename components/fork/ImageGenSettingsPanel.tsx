"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import { SettingsPage } from "../SettingsUi";

/**
 * fork:imagegen —— 设置 → 生图模型（画板 D-31）。
 *
 * 生图模型是**独立于对话模型的档案**：不进模型选择器、不吃 `enabledModels`。
 * 会话里的 `generate_image` 工具与标书配图读这里的同一份配置
 * （`~/.pi/agent/imagegen.json`，0600，密钥掩码存取）。
 *
 * DOM 照 `design/v5/web/boards/D-31-settings-imagegen.html` 抄：
 * `.d-set-sec` / `.d-grid2` / `.d-field` / `.d-input` / `.d-select` / `.d-banner`，
 * 不新增任何 `d-*` 类，也不写内联几何（style-literal 基线只减不增）。
 *
 * 密钥交互与 im-bridge 同一条铁律：页面拿到的永远是掩码（`••••••••`），
 * 保存时把掩码原样传回 = 沿用已存密钥；显式清空才是「清掉了」。
 */

interface ProviderProfileView {
  /** 非空 = 引用「设置 → 模型」里那个服务商的端点与密钥（本档不存副本）。 */
  providerId: string;
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

/** 「设置 → 模型」里已配的服务商（`GET /api/imagegen` 附带；不含明文密钥）。 */
interface ModelsProviderView {
  id: string;
  name: string;
  baseUrl: string;
  hasKey: boolean;
}

interface ImageGenConfigView {
  active: string;
  providers: Record<string, ProviderProfileView>;
  modelsProviders?: ModelsProviderView[];
  /** 当前引用的服务商解析不出来时的原因（已从「设置 → 模型」删掉 / 没填密钥）。 */
  refError?: string | null;
}

const PRESETS = ["openai", "jinlong", "siliconflow", "volcengine", "custom"] as const;
type Preset = (typeof PRESETS)[number];

/** 引用态的选项值前缀；`active` 落在 `custom` 档，端点与密钥来自 models.json。 */
const REF_VALUE_PREFIX = "ref:";

const SIZE_OPTIONS = ["auto", "512x512", "1024x1024", "1024x768", "768x1024", "1536x1024", "1024x1536", "2048x2048"];

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
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as ImageGenConfigView;
      setConfig(data);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeId = (config?.active ?? "openai") as Preset;
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
      const data = await response.json() as ImageGenConfigView & { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      // 重新读一遍：引用态的 baseUrl 与密钥掩码是服务端**派生**的，PUT 的回包里没有
      // modelsProviders / refError，直接换上会把下拉清空。
      await load();
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  const runTest = async () => {
    setTestState("running");
    setTestError(null);
    setTestImage(null);
    try {
      // 先落盘再测：测试用的是**已存**的密钥（掩码不会发给后端当明文用）。
      const saveResponse = await fetch("/api/imagegen", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: activeId, providers: config?.providers }),
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
      <SettingsPage title={t("settings.imagegen")} sub={t("settings.imagegenSub")}>
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

  const missing = !active.model || (!active.providerId && (!active.baseUrl || !active.apiKey));

  /* fork:imagegen-ref —— 引用态：端点与密钥来自「设置 → 模型」里那一份，本档不存副本。
     下拉里两组：已配服务商（`ref:<id>`）与内置预设，后者保留给「生图专用端点」
     （金龙中转 / 硅基流动 / 火山方舟那些平时不会加进模型列表的服务商）。
     引用态落在 `custom` 档 —— 四个内置预设各带固定端点，没有可引用的对象。 */
  const refProviders = config.modelsProviders ?? [];
  const activeRef = active.providerId
    ? refProviders.find((provider) => provider.id === active.providerId) ?? null
    : null;
  const selectValue = active.providerId ? `${REF_VALUE_PREFIX}${active.providerId}` : activeId;

  return (
    <SettingsPage
      title={t("settings.imagegen")}
      sub={t("settings.imagegenSub")}
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
                value={selectValue}
                aria-label={t("settings.imagegenProvider")}
                onChange={(event) => {
                  const value = event.target.value;
                  const reference = value.startsWith(REF_VALUE_PREFIX) ? value.slice(REF_VALUE_PREFIX.length) : null;
                  setConfig((current) => {
                    if (!current) return current;
                    // 引用态：落到 custom 档，清空自己那份端点/密钥（服务端也不会存）。
                    if (reference !== null) {
                      return {
                        ...current,
                        active: "custom",
                        providers: {
                          ...current.providers,
                          custom: { ...current.providers.custom, providerId: reference, baseUrl: "", apiKey: "" },
                        },
                      };
                    }
                    const preset = value as Preset;
                    return {
                      ...current,
                      active: preset,
                      providers: {
                        ...current.providers,
                        [preset]: { ...current.providers[preset], providerId: "" },
                      },
                    };
                  });
                  setSaveState("idle");
                  setTestImage(null);
                }}
              >
                <optgroup label={t("settings.imagegenRefGroup")}>
                  {refProviders.length > 0 ? refProviders.map((provider) => (
                    <option key={provider.id} value={`${REF_VALUE_PREFIX}${provider.id}`}>
                      {provider.name} · {provider.baseUrl || "—"}
                    </option>
                  )) : (
                    <option value="" disabled>{t("settings.imagegenRefNone")}</option>
                  )}
                </optgroup>
                <optgroup label={t("settings.imagegenPresetGroup")}>
                  {PRESETS.map((preset) => (
                    <option key={preset} value={preset}>{t(`settings.imagegenPreset.${preset}`)}</option>
                  ))}
                </optgroup>
              </select>
              <span className="d-t-xs d-t-faint">{t("settings.imagegenProviderHint")}</span>
            </div>
            {/* 引用态不摆这两格：端点与密钥去「设置 → 模型」里改。这里再摆一份
                就是要用户复制一次 —— 正是这次要消掉的东西。 */}
            {active.providerId ? null : (
              <div className="d-field">
                <span className="d-field-t">{t("settings.imagegenBaseUrl")}</span>
                <input
                  className="d-input d-mono"
                  value={active.baseUrl}
                  placeholder="https://api.openai.com/v1"
                  onChange={(event) => patchActive({ baseUrl: event.target.value })}
                />
                <span className="d-t-xs d-t-faint">{t("settings.imagegenBaseUrlHint")}</span>
              </div>
            )}
            {active.providerId ? null : (
              <div className="d-field">
                <span className="d-field-t">{t("settings.imagegenApiKey")}</span>
                <input
                  className="d-input d-mono"
                  type="password"
                  value={active.apiKey}
                  placeholder={t("settings.imagegenApiKeyPlaceholder")}
                  onChange={(event) => patchActive({ apiKey: event.target.value })}
                />
                <span className="d-t-xs d-t-faint">{t("settings.imagegenApiKeyHint")}</span>
              </div>
            )}
            <div className="d-field">
              <span className="d-field-t">{t("settings.imagegenModel")}</span>
              <input
                className="d-input d-mono"
                value={active.model}
                onChange={(event) => patchActive({ model: event.target.value })}
              />
              <span className="d-t-xs d-t-faint">{t("settings.imagegenModelHint")}</span>
            </div>
          </div>

          {active.providerId ? (
            <div className="d-set-row">
              <div className="d-set-row-box">
                <div className="d-set-row-t">{t("settings.imagegenRefFrom")}</div>
                <div className="d-set-row-s d-mono">{activeRef?.baseUrl || "—"}</div>
              </div>
              <span className="d-grow-last">{activeRef?.hasKey
                ? <span className="d-badge ok">{t("settings.imagegenRefKeyOk")}</span>
                : <span className="d-badge bad">{t("settings.imagegenRefKeyMissing")}</span>}</span>
            </div>
          ) : null}
          {active.providerId ? (
            <span className="d-t-xs d-t-faint">{t("settings.imagegenRefHint")}</span>
          ) : null}
          {config.refError ? (
            <div className="d-banner err">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{config.refError}</span>
            </div>
          ) : null}
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
                {(SIZE_OPTIONS.includes(active.size) ? SIZE_OPTIONS : [active.size, ...SIZE_OPTIONS]).map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
              <span className="d-t-xs d-t-faint">{t("settings.imagegenSizeHint")}</span>
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
              <span className="d-t-xs d-t-faint">{t("settings.imagegenConcurrencyHint")}</span>
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
              <div className="d-set-row-s">{t("settings.imagegenTestHint")}</div>
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
