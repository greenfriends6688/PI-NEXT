"use client";

/**
 * fork:ai-identity —— 「设置 → AI 身份」。
 *
 * 用户 2026-10-13：「AI 身份我觉得可以随时换 logo 和名称」。形态照参考项目那一页：
 * 左列头像 + 「更换头像 / 恢复默认头像」，右列「名字」输入框 + 「同步用户头像与名称」
 * + 保存。
 *
 * 三条不骗人的地方：
 *  · 头像读成 **dataURL** 再落盘，并且**限长 512 KB** —— 它写在
 *    `~/.pi/agent/pi-web-preferences.json`，那是本应用的偏好文件，塞一张几 MB 的原图
 *    会连累同一文件里其它开关的读写。超了就在页面上说清楚，不静默截断。
 *  · 「同步用户头像与名称」打开时，名字与头像都跟随本机用户名（initials + 确定性配色），
 *    **此时 `name` / `avatar` 都不参与渲染** —— 否则用户会以为自己填的名字没生效。
 *  · 保存后 `setIdentity()` 立刻同步给客户端 store，聊天里的身份行当场变，不必刷新。
 *
 * 这一页**只影响聊天里显示成谁**：agent 在系统提示词里的自我描述由 `AGENTS.md` 决定。
 *
 * DOM 取自画板 `design/v5/web/boards/D-40-settings-identity.html`
 * （`.d-set-*` / `.d-ava` / `.d-input` / `.d-btn`），没有新造 `.d-*` 类。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import { setIdentity } from "@/hooks/useIdentity";
import {
  DEFAULT_AGENT_AVATAR_URL,
  DEFAULT_AGENT_NAME,
  IDENTITY_AVATAR_MAX_CHARS,
  IDENTITY_NAME_MAX_CHARS,
  avatarRejectionReason,
  identityInitialsStyle,
  resolveIdentity,
  resolveIdentityView,
  type AgentIdentity,
} from "@/lib/identity";
import { SettingsPage } from "../SettingsUi";

interface IdentityResponse {
  identity?: unknown;
  userName?: unknown;
  error?: string;
  reason?: string;
}

export function IdentitySettingsPanel() {
  const { t } = useI18n();
  const [identity, setLocal] = useState<AgentIdentity | null>(null);
  const [userName, setUserName] = useState("");
  const [draftName, setDraftName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/identity");
      const data = await response.json().catch(() => null) as IdentityResponse | null;
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      const next = resolveIdentity(data?.identity);
      setLocal(next);
      setDraftName(next.name);
      setUserName(typeof data?.userName === "string" ? data.userName : "");
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (patch: Partial<AgentIdentity>) => {
    if (!identity) return;
    const optimistic = resolveIdentity({ ...identity, ...patch });
    setLocal(optimistic);
    setBusy(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/identity", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json().catch(() => null) as IdentityResponse | null;
      if (!response.ok) {
        // 超长 / 不是图片：如实说清是哪一种，不静默按小的存。
        if (data?.reason === "too-large") throw new Error(t("settings.identityAvatarTooLarge"));
        if (data?.reason === "not-an-image") throw new Error(t("settings.identityAvatarNotImage"));
        throw new Error(data?.error ?? `HTTP ${response.status}`);
      }
      const next = resolveIdentity(data?.identity);
      setLocal(next);
      setDraftName(next.name);
      setIdentity(next);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      await load();
    } finally {
      setBusy(false);
    }
  }, [identity, load, t]);

  const onPickFile = useCallback(async (file: File) => {
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(file);
    }).catch(() => "");
    if (!dataUrl) {
      setSaveError(t("settings.identityAvatarNotImage"));
      return;
    }
    const reason = avatarRejectionReason(dataUrl);
    if (reason === "too-large") {
      setSaveError(`${t("settings.identityAvatarTooLarge")} (${Math.round(dataUrl.length / 1024)} KB > ${IDENTITY_AVATAR_MAX_CHARS / 1024} KB)`);
      return;
    }
    if (reason) {
      setSaveError(t("settings.identityAvatarNotImage"));
      return;
    }
    await save({ avatar: dataUrl });
  }, [save, t]);

  if (loadError) {
    return (
      <SettingsPage title={t("settings.identity")}>
        <div className="d-set-inner">
          <div className="d-set-sec">
            <div className="d-banner err">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{t("settings.identityLoadFailed")}: {loadError}</span>
            </div>
          </div>
        </div>
      </SettingsPage>
    );
  }
  if (!identity) return null;

  const view = resolveIdentityView(identity, userName);
  const initialsStyle = identityInitialsStyle(userName || identity.name || DEFAULT_AGENT_NAME);
  const dirty = draftName.trim().slice(0, IDENTITY_NAME_MAX_CHARS) !== identity.name;

  return (
    <SettingsPage title={t("settings.identity")}>
      <div className="d-set-inner">
        {saveError ? (
          <div className="d-set-sec">
            <div className="d-banner err">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{saveError}</span>
            </div>
          </div>
        ) : null}

        <div className="d-set-sec">
          <div className="d-set-row">
            <div className="d-set-row-box">
              {/* 左列：头像 + 两个动作。预览与聊天里的身份行读的是同一份 resolveIdentityView。 */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--nx-sp-3)" }}>
                {view.initialsOnly ? (
                  <span
                    className="d-ava"
                    aria-hidden="true"
                    style={{ ...initialsStyle, display: "grid", placeItems: "center", fontWeight: 600 }}
                  >
                    {view.initials}
                  </span>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element -- 头像是用户自己的 dataURL，不走优化器 */
                  <img className="d-ava" src={view.imageUrl ?? DEFAULT_AGENT_AVATAR_URL} alt="" />
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--nx-sp-2)" }}>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void onPickFile(file);
                    }}
                  />
                  <button
                    type="button"
                    className="d-btn sm ghost"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                  >
                    <i data-ico="upload" data-size="14"></i>
                    {t("settings.identityChangeAvatar")}
                  </button>
                  <button
                    type="button"
                    className="d-btn sm ghost"
                    disabled={busy || (!identity.avatar && !identity.syncWithUserProfile)}
                    onClick={() => void save({ avatar: "", syncWithUserProfile: false })}
                  >
                    {t("settings.identityResetAvatar")}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.identityName")}</div>
              <input
                className="d-input"
                value={draftName}
                maxLength={IDENTITY_NAME_MAX_CHARS}
                placeholder={t("settings.identityNamePlaceholder")}
                aria-label={t("settings.identityName")}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && dirty) void save({ name: draftName.trim() });
                }}
              />
              <div className="d-set-row-s">{t("settings.identityNameHint")}</div>
            </div>
          </div>

          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.identitySync")}</div>
              <div className="d-set-row-s">
                {userName ? t("settings.identitySyncHint", { name: userName }) : t("settings.identitySyncUnavailable")}
              </div>
            </div>
            <span className="d-grow-last">
              <button
                type="button"
                role="switch"
                aria-checked={identity.syncWithUserProfile}
                aria-label={t("settings.identitySync")}
                disabled={busy}
                className={`d-switch${identity.syncWithUserProfile ? " on" : ""}`}
                onClick={() => void save({ syncWithUserProfile: !identity.syncWithUserProfile })}
              />
            </span>
          </div>

          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-s">{t("settings.identityPreviewHint")}</div>
            </div>
            <span className="d-grow-last">
              <button
                type="button"
                className="d-btn sm primary"
                disabled={busy || !dirty}
                onClick={() => void save({ name: draftName.trim() })}
              >
                {t("settings.identitySave")}
              </button>
            </span>
          </div>
        </div>

        <div className="d-set-sec">
          <span className="d-t-xs d-t-faint">{t("settings.identityFooter")}</span>
        </div>
      </div>
    </SettingsPage>
  );
}
