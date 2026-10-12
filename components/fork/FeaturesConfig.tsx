"use client";

/**
 * fork:feature-toggles —— 「设置 → 界面与功能」。
 *
 * 用户 2026-10-13 的原话：「右侧边栏和顶部的各种 icon 的显示或功能的启用，我想让你在
 * 设置中帮我加个开关，这样的话我好去进行控制」。
 *
 * 这一页只做一件事：把 `lib/feature-toggles.ts` 里那张表渲染成开关。表是单一真值，
 * 这个文件**不硬编码任何开关名** —— 加一个开关是改那张表 + 三语文案，不是改这里。
 *
 * 两个不骗人的地方：
 *  · 每一行按 `scope` 显示**生效时机**徽标（`session` = 新会话生效，`ui` = 立即生效）。
 *    扩展是会话启动时加载的，做成「界面变了、行为没变」的假开关比不做更糟。
 *  · 关掉工具类开关时**真的不注册那个工具**（接线在 `lib/rpc-manager.ts`）；这一页
 *    只负责把选择写进 `pi-web-preferences.json`。
 *
 * DOM 全部取自画板 `design/v5/web/boards/D-39-settings-features.html`
 * （`.d-set-inner` / `.d-set-sec` / `.d-set-row` / `.d-switch` / `.d-badge`），
 * 没有新造 `.d-*` 类。
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import {
  FEATURE_DESCRIPTORS,
  resolveFeatureFlags,
  type FeatureFlags,
  type FeatureId,
} from "@/lib/feature-toggles";
import { SettingsPage } from "../SettingsUi";

interface FeaturesResponse {
  flags?: unknown;
  error?: string;
}

export function FeaturesConfig() {
  const { t } = useI18n();
  const [flags, setFlags] = useState<FeatureFlags | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<FeatureId | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/features");
      const data = await response.json().catch(() => null) as FeaturesResponse | null;
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      setFlags(resolveFeatureFlags(data?.flags));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (id: FeatureId, enabled: boolean) => {
    // 乐观更新：开关是单值，失败就整表读回来（服务端是权威）。
    setFlags((current) => (current ? { ...current, [id]: enabled } : current));
    setBusyId(id);
    setSaveError(null);
    try {
      const response = await fetch("/api/features", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, enabled }),
      });
      const data = await response.json().catch(() => null) as FeaturesResponse | null;
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      setFlags(resolveFeatureFlags(data?.flags));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      await load();
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const groups = useMemo(() => ([
    {
      key: "session",
      titleKey: "settings.featuresGroupSession",
      badgeKey: "settings.featuresBadgeSession",
      badgeTone: "mute",
      ids: FEATURE_DESCRIPTORS.filter((descriptor) => descriptor.scope === "session"),
    },
    {
      key: "ui",
      titleKey: "settings.featuresGroupUi",
      badgeKey: "settings.featuresBadgeUi",
      badgeTone: "ok",
      ids: FEATURE_DESCRIPTORS.filter((descriptor) => descriptor.scope === "ui"),
    },
  ]), []);

  if (loadError) {
    return (
      <SettingsPage title={t("settings.features")}>
        <div className="d-set-inner">
          <div className="d-set-sec">
            <div className="d-banner err">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{t("settings.featuresLoadFailed")}: {loadError}</span>
            </div>
          </div>
        </div>
      </SettingsPage>
    );
  }
  if (!flags) return null;

  return (
    <SettingsPage title={t("settings.features")}>
      <div className="d-set-inner">
        {saveError ? (
          <div className="d-set-sec">
            <div className="d-banner err">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{saveError}</span>
            </div>
          </div>
        ) : null}

        {groups.map((group) => (
          <div className="d-set-sec" key={group.key}>
            <div className="d-set-sec-t">
              {t(group.titleKey)}
              <span className={`d-badge ${group.badgeTone}`}>{t(group.badgeKey)}</span>
            </div>
            {group.ids.map((descriptor) => (
              <div className="d-set-row" key={descriptor.id}>
                <div className="d-set-row-box">
                  <div className="d-set-row-t">{t(descriptor.labelKey)}</div>
                  <div className="d-set-row-s">{t(descriptor.hintKey)}</div>
                </div>
                <span className="d-grow-last">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={flags[descriptor.id]}
                    aria-busy={busyId === descriptor.id || undefined}
                    aria-label={t(descriptor.labelKey)}
                    title={t(descriptor.labelKey)}
                    disabled={busyId === descriptor.id}
                    className={`d-switch${flags[descriptor.id] ? " on" : ""}`}
                    onClick={() => void toggle(descriptor.id, !flags[descriptor.id])}
                  />
                </span>
              </div>
            ))}
          </div>
        ))}

        <div className="d-set-sec">
          <span className="d-t-xs d-t-faint">{t("settings.featuresFooter")}</span>
        </div>
      </div>
    </SettingsPage>
  );
}
