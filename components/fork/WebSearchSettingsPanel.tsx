"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import { SettingsPage } from "../SettingsUi";

/**
 * fork:websearch —— 设置 → 联网搜索（画板 D-37）。
 *
 * 免 API key 的联网搜索：provider 链（Bing / DuckDuckGo / Mojeek / 多引擎聚合）+
 * 自建 SearXNG（端点不需要 key）。开关**默认关**，开着才出网。
 *
 * 与别的分节不同的一点：工具是在**每次调用时**读这份设置的，所以开关与 provider
 * 改完立刻生效 —— 不需要「新会话生效」那套徽标。
 *
 * DOM 照 `design/v5/web/boards/D-37-settings-websearch.html` 抄：`.d-set-sec` /
 * `.d-set-row` / `.d-grow-last` / `.d-switch` / `.d-field` / `.d-select` / `.d-input` /
 * `.d-banner`，不新增 `d-*` 类、不写内联几何。
 */

interface ProviderMeta {
  id: string;
  label: string;
  description: string;
  requires: string | null;
}

interface SettingsView {
  enabled: boolean;
  provider: string;
  fallbackToPublic: boolean;
  timeoutSeconds: number;
  searxngEndpoint: string;
  searxngToken: string;
  searxngLanguage: string;
  allowPrivateEndpoint: boolean;
  providers?: ProviderMeta[];
}

interface TestResult {
  ok: boolean;
  provider?: string;
  results?: { title: string; url: string; snippet?: string; source: string }[];
  failures?: { provider: string; message: string }[];
  durationMs?: number;
  error?: string;
}

export function WebSearchSettingsPanel() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/websearch");
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${response.status}`);
      }
      setSettings(await response.json() as SettingsView);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = async (next: Partial<SettingsView>) => {
    if (!settings) return;
    const optimistic = { ...settings, ...next };
    setSettings(optimistic);
    setBusy(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/websearch", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: next }),
      });
      const data = await response.json() as SettingsView & { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSettings(data);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const response = await fetch("/api/websearch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      setTest(await response.json() as TestResult);
    } catch (error) {
      setTest({ ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  if (loadError) {
    return (
      <SettingsPage title={t("settings.websearch")}>
        <div className="d-set-inner">
          <div className="d-set-sec">
            <div className="d-banner err">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{t("settings.websearchLoadFailed")}: {loadError}</span>
            </div>
          </div>
        </div>
      </SettingsPage>
    );
  }
  if (!settings) return null;

  const providers = settings.providers ?? [];
  const active = providers.find((provider) => provider.id === settings.provider);
  const searxngSelected = settings.provider === "searxng";

  return (
    <SettingsPage
      title={t("settings.websearch")}
      actions={(
        <button type="button" className="d-btn sm" onClick={() => void runTest()} disabled={testing}>
          <i data-ico="globe" data-size="13" aria-hidden="true" />
          {testing ? t("settings.websearchTesting") : t("settings.websearchTestBtn")}
        </button>
      )}
    >
      <div className="d-set-inner">
        <div className="d-set-sec">
          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.websearchToggle")}</div>
              <div className="d-set-row-s">{t("settings.websearchToggleDesc")}</div>
            </div>
            <span className="d-grow-last">
              {settings.enabled
                ? <span className="d-badge ok">{t("settings.websearchOn")}</span>
                : <span className="d-badge mute">{t("settings.websearchOff")}</span>}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.enabled}
              aria-busy={busy || undefined}
              aria-label={t("settings.websearchToggle")}
              title={t("settings.websearchToggle")}
              disabled={busy}
              className={`d-switch${settings.enabled ? " on" : ""}`}
              onClick={() => void patch({ enabled: !settings.enabled })}
            />
          </div>
          <div className="d-banner">
            <i data-ico="info" data-size="14"></i>
            <span>{t("settings.websearchImmediateHint")}</span>
          </div>
        </div>

        <div className="d-set-sec">
          <div className="d-set-sec-t">{t("settings.websearchProviderSection")}</div>
          <div className="d-grid2">
            <div className="d-field">
              <span className="d-field-t">{t("settings.websearchProvider")}</span>
              <select
                className="d-select"
                value={settings.provider}
                aria-label={t("settings.websearchProvider")}
                onChange={(event) => void patch({ provider: event.target.value })}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.label}</option>
                ))}
              </select>
              <span className="d-t-xs d-t-faint">{active?.description ?? ""}</span>
            </div>
            <div className="d-field">
              <span className="d-field-t">{t("settings.websearchTimeout")}</span>
              <input
                className="d-input d-mono"
                type="number"
                min={5}
                max={120}
                value={settings.timeoutSeconds}
                onChange={(event) => void patch({ timeoutSeconds: Number(event.target.value) || 30 })}
              />
              <span className="d-t-xs d-t-faint">{t("settings.websearchTimeoutHint")}</span>
            </div>
          </div>

          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.websearchFallback")}</div>
              <div className="d-set-row-s">{t("settings.websearchFallbackDesc")}</div>
            </div>
            <span className="d-grow-last" />
            <button
              type="button"
              role="switch"
              aria-checked={settings.fallbackToPublic}
              aria-label={t("settings.websearchFallback")}
              title={t("settings.websearchFallback")}
              disabled={busy}
              className={`d-switch${settings.fallbackToPublic ? " on" : ""}`}
              onClick={() => void patch({ fallbackToPublic: !settings.fallbackToPublic })}
            />
          </div>

          {searxngSelected ? (
            <div className="d-banner warn">
              <i data-ico="triangle-alert" data-size="14"></i>
              <span>{t("settings.websearchSearxngMissing")}</span>
            </div>
          ) : null}
        </div>

        <div className="d-set-sec">
          <div className="d-set-sec-t">{t("settings.websearchSearxngSection")}</div>
          <div className="d-grid2">
            <div className="d-field">
              <span className="d-field-t">{t("settings.websearchEndpoint")}</span>
              <input
                className="d-input d-mono"
                value={settings.searxngEndpoint}
                placeholder="https://searx.example.org"
                onChange={(event) => void patch({ searxngEndpoint: event.target.value })}
              />
              <span className="d-t-xs d-t-faint">{t("settings.websearchEndpointHint")}</span>
            </div>
            <div className="d-field">
              <span className="d-field-t">{t("settings.websearchToken")}</span>
              <input
                className="d-input d-mono"
                type="password"
                value={settings.searxngToken}
                placeholder={t("settings.websearchTokenPlaceholder")}
                onChange={(event) => void patch({ searxngToken: event.target.value })}
              />
              <span className="d-t-xs d-t-faint">{t("settings.websearchTokenHint")}</span>
            </div>
            <div className="d-field">
              <span className="d-field-t">{t("settings.websearchLanguage")}</span>
              <input
                className="d-input d-mono"
                value={settings.searxngLanguage}
                placeholder="zh-CN"
                onChange={(event) => void patch({ searxngLanguage: event.target.value })}
              />
              <span className="d-t-xs d-t-faint">{t("settings.websearchLanguageHint")}</span>
            </div>
          </div>
          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.websearchAllowPrivate")}</div>
              <div className="d-set-row-s">{t("settings.websearchAllowPrivateDesc")}</div>
            </div>
            <span className="d-grow-last" />
            <button
              type="button"
              role="switch"
              aria-checked={settings.allowPrivateEndpoint}
              aria-label={t("settings.websearchAllowPrivate")}
              title={t("settings.websearchAllowPrivate")}
              disabled={busy}
              className={`d-switch${settings.allowPrivateEndpoint ? " on" : ""}`}
              onClick={() => void patch({ allowPrivateEndpoint: !settings.allowPrivateEndpoint })}
            />
          </div>
          <span className="d-t-xs d-t-faint">{t("settings.websearchSsrfHint")}</span>
        </div>

        <div className="d-set-sec">
          <div className="d-set-sec-t">{t("settings.websearchTestSection")}</div>
          {test ? (
            test.ok ? (
              <div className="d-banner ok">
                <i data-ico="circle-check" data-size="14"></i>
                <span>
                  {t("settings.websearchTestOk", { count: test.results?.length ?? 0, provider: test.provider ?? "", ms: test.durationMs ?? 0 })}
                </span>
              </div>
            ) : (
              <div className="d-banner err">
                <i data-ico="circle-alert" data-size="14"></i>
                <span>{test.error ?? t("settings.websearchTestFailed")}</span>
              </div>
            )
          ) : (
            <div className="d-banner warn">
              <i data-ico="triangle-alert" data-size="14"></i>
              <span>{t("settings.websearchTestHint")}</span>
            </div>
          )}
          {test?.results && test.results.length > 0 ? (
            <div className="d-col">
              {test.results.map((result) => (
                <div className="d-set-row" key={result.url}>
                  <div className="d-set-row-box">
                    <div className="d-set-row-t">{result.title}</div>
                    <div className="d-set-row-s d-mono">{result.url}</div>
                  </div>
                  <span className="d-grow-last"><span className="d-badge mute">{result.source}</span></span>
                </div>
              ))}
            </div>
          ) : null}
          {test?.failures && test.failures.length > 0 ? (
            <span className="d-t-xs d-t-faint">
              {test.failures.map((failure) => `${failure.provider}: ${failure.message}`).join(" · ")}
            </span>
          ) : null}
          {saveError ? (
            <div className="d-banner err">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{saveError}</span>
            </div>
          ) : null}
        </div>
      </div>
    </SettingsPage>
  );
}
