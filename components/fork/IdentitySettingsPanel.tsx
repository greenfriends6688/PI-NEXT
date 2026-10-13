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
// fork:fastvibe-stack (L1) —— 迁到 FastVibe 的行原语。
// 旧形态是 `d-set-inner` › `d-set-sec` › `d-set-row` + 手写 `d-set-row-box/t/s`；
// 新形态是 `SettingsGroup` › `SettingsRow`（逐条对应 FastVibe 的 settings-group.tsx）。
// 两者**并存**：这一页先迁作为 L1 的样板，其余分节跟 L4+/L9 逐个走。
import { SettingsGroup, SettingsRow } from "../settings/SettingsRow";

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
        <SettingsGroup>
          <SettingsRow
            title={t("settings.identity")}
            control={(
              <span className="text-xs text-destructive">
                {t("settings.identityLoadFailed")}: {loadError}
              </span>
            )}
          />
        </SettingsGroup>
      </SettingsPage>
    );
  }
  if (!identity) return null;

  const view = resolveIdentityView(identity, userName);
  const initialsStyle = identityInitialsStyle(userName || identity.name || DEFAULT_AGENT_NAME);
  const dirty = draftName.trim().slice(0, IDENTITY_NAME_MAX_CHARS) !== identity.name;

  return (
    <SettingsPage title={t("settings.identity")}>
      <div className="flex flex-col gap-6">
        {saveError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {saveError}
          </div>
        ) : null}

        {/* 头像 + 两个动作：FastVibe 的 SettingsRow 的 title 是节点，这里把预览
            放在 title 位（它本来就是「这一行说的是什么」）。 */}
        <SettingsGroup>
          <SettingsRow
            align="start"
            title={(
              <span className="flex items-center gap-3">
                {view.initialsOnly ? (
                  <span
                    aria-hidden="true"
                    style={{ ...initialsStyle, display: "grid", placeItems: "center", fontWeight: 600 }}
                    className="size-10 shrink-0 rounded-full"
                  >
                    {view.initials}
                  </span>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element -- 头像是用户自己的 dataURL，不走优化器 */
                  <img
                    src={view.imageUrl ?? DEFAULT_AGENT_AVATAR_URL}
                    alt=""
                    className="size-10 shrink-0 rounded-full object-cover"
                  />
                )}
                <span>{t("settings.identityChangeAvatar")}</span>
              </span>
            )}
            control={
              <span className="flex flex-col gap-2">
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
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs hover:bg-muted disabled:opacity-50"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  <i data-ico="upload" data-size="14"></i>
                  {t("settings.identityChangeAvatar")}
                </button>
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                  disabled={busy || (!identity.avatar && !identity.syncWithUserProfile)}
                  onClick={() => void save({ avatar: "", syncWithUserProfile: false })}
                >
                  {t("settings.identityResetAvatar")}
                </button>
              </span>
            }
          />

          <SettingsRow
            align="start"
            title={t("settings.identityName")}
            description={t("settings.identityNameHint")}
            control={
              <input
                value={draftName}
                maxLength={IDENTITY_NAME_MAX_CHARS}
                placeholder={t("settings.identityNamePlaceholder")}
                aria-label={t("settings.identityName")}
                className="h-7 w-56 rounded-md border border-border bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && dirty) void save({ name: draftName.trim() });
                }}
              />
            }
          />

          <SettingsRow
            title={t("settings.identitySync")}
            description={userName
              ? t("settings.identitySyncHint", { name: userName })
              : t("settings.identitySyncUnavailable")}
            control={(
              <button
                type="button"
                role="switch"
                aria-checked={identity.syncWithUserProfile}
                aria-label={t("settings.identitySync")}
                disabled={busy}
                onClick={() => void save({ syncWithUserProfile: !identity.syncWithUserProfile })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${identity.syncWithUserProfile ? "bg-primary" : "bg-muted"}`}
              >
                <span
                  className={`block size-4 rounded-full bg-white shadow transition-transform ${identity.syncWithUserProfile ? "translate-x-4.5" : "translate-x-0.5"}`}
                />
              </button>
            )}
          />
        </SettingsGroup>

        {/* 预览说明 + 保存。用户 2026-10-07 裁定「菜单下面那种提示文字全部去掉」，
            所以说明留在这一行的 description 里（它解释的是这个动作，不是「这页是干嘛的」）。
            这里**不传 title**：FastVibe 的 SettingsRow 的 title 是必填的，但那是它自己的
            契约（每行都有个名字）；本行只有一句说明 + 一个动作钮，硬塞一个空标题
            会多出一行空白。所以用 description 占标题位。 */}
        <SettingsGroup>
          <SettingsRow
            title={t("settings.identityPreviewHint")}
            control={(
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/85 disabled:opacity-50"
                disabled={busy || !dirty}
                onClick={() => void save({ name: draftName.trim() })}
              >
                {t("settings.identitySave")}
              </button>
            )}
          />
        </SettingsGroup>

        <p className="px-1 text-xs text-muted-foreground">{t("settings.identityFooter")}</p>
      </div>
    </SettingsPage>
  );
}
