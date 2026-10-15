import { useRef, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Upload01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AppLogo } from "@/components/app-logo";
import { useSettingsStore } from "@/stores/settings";
import { useUserName } from "@/lib/identity-user";
import {
  DEFAULT_AGENT_NAME,
  IDENTITY_AVATAR_MAX_CHARS,
  IDENTITY_NAME_MAX_CHARS,
  avatarRejectionReason,
  identityInitialsStyle,
  resolveIdentity,
  resolveIdentityView,
} from "@shared/identity";
import { SettingsGroup, SettingsRow } from "./settings-group";

/**
 * 设置 → AI 身份：聊天里那个助手叫什么、长什么样。
 *
 * 三态（名字 / 头像 / 同步本机用户）收敛在 `resolveIdentityView` 一个纯函数里，
 * **聊天里的身份行读的就是同一份** —— 预览与实际不一致是这类页面最常见的谎。
 *
 * 只影响显示：agent 在系统提示词里的自我描述不由这里决定。
 */
export function IdentitySettings(): JSX.Element {
  const { t } = useTranslation("settings");
  const stored = useSettingsStore((state) => state.settings.agentIdentity);
  const userName = useUserName();
  const identity = resolveIdentity(stored);
  const [draftName, setDraftName] = useState(identity.name);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const view = resolveIdentityView(identity, userName);
  const initialsStyle = identityInitialsStyle(userName || identity.name || DEFAULT_AGENT_NAME);
  const dirty = draftName.trim().slice(0, IDENTITY_NAME_MAX_CHARS) !== identity.name;

  const save = (patch: Partial<typeof identity>): void => {
    useSettingsStore.getState().update({ agentIdentity: resolveIdentity({ ...identity, ...patch }) });
  };

  const onPickFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      const reason = avatarRejectionReason(dataUrl);
      if (reason === "too-large") {
        toast.error(
          t("identity.avatarTooLarge", { kb: Math.round(dataUrl.length / 1024), max: IDENTITY_AVATAR_MAX_CHARS / 1024 }),
        );
        return;
      }
      if (reason) {
        toast.error(t("identity.avatarNotImage"));
        return;
      }
      save({ avatar: dataUrl, syncWithUserProfile: false });
    };
    reader.onerror = () => toast.error(t("identity.avatarNotImage"));
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      <SettingsGroup>
        <SettingsRow
          align="start"
          title={
            <span className="flex items-center gap-3">
              <AvatarPreview view={view} initialsStyle={initialsStyle} />
              <span>{t("identity.avatar")}</span>
            </span>
          }
          control={
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) onPickFile(file);
                }}
              />
              <Button size="xs" variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()}>
                <HugeiconsIcon strokeWidth={2} icon={Upload01Icon} className="size-3.5" />
                {t("identity.changeAvatar")}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={!identity.avatar && !identity.syncWithUserProfile}
                onClick={() => save({ avatar: "", syncWithUserProfile: false })}
              >
                {t("identity.resetAvatar")}
              </Button>
            </div>
          }
        />

        <SettingsRow
          title={t("identity.name")}
          description={t("identity.nameHint")}
          control={
            <div className="flex items-center gap-2">
              <Input
                className="w-56"
                maxLength={IDENTITY_NAME_MAX_CHARS}
                placeholder={DEFAULT_AGENT_NAME}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && dirty) save({ name: draftName.trim() });
                }}
              />
              <Button size="xs" disabled={!dirty} onClick={() => save({ name: draftName.trim() })}>
                {t("identity.save")}
              </Button>
            </div>
          }
        />

        <SettingsRow
          title={t("identity.sync")}
          description={userName ? t("identity.syncHint", { name: userName }) : t("identity.syncUnavailable")}
          control={
            <Switch
              checked={identity.syncWithUserProfile}
              disabled={!userName}
              onCheckedChange={(checked) => save({ syncWithUserProfile: checked })}
            />
          }
        />
      </SettingsGroup>

      <p className="px-1 text-xs text-muted-foreground">{t("identity.footer")}</p>
    </div>
  );
}

/** 头像预览：initials（同步态）→ 用户 dataURL → 品牌 logo。 */
function AvatarPreview({
  view,
  initialsStyle,
}: {
  view: ReturnType<typeof resolveIdentityView>;
  initialsStyle: { background: string; color: string };
}): JSX.Element {
  if (view.initialsOnly) {
    return (
      <span
        aria-hidden
        style={{ ...initialsStyle, display: "grid", placeItems: "center", fontWeight: 600 }}
        className="size-10 shrink-0 rounded-full text-sm"
      >
        {view.initials}
      </span>
    );
  }
  if (view.imageUrl) {
    // 上传的 logo **原样显示**：不套灰底、不强制成圆形。
    return <img src={view.imageUrl} alt="" className="size-10 shrink-0 object-contain" />;
  }
  return <AppLogo className="size-10 shrink-0" />;
}
