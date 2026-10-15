import type { JSX } from "react";
import { AppLogo } from "@/components/app-logo";
import { useSettingsStore } from "@/stores/settings";
import { useUserName } from "@/lib/identity-user";
import { cn } from "@/lib/utils";
import {
  DEFAULT_AGENT_NAME,
  identityInitialsStyle,
  resolveIdentity,
  resolveIdentityView,
} from "@shared/identity";

/**
 * fork:ai-identity —— 侧栏 / 顶栏左上角那个「logo + 名字」。
 *
 * 读的是「设置 → AI 身份」的同一份三态：没传 logo → 品牌图；传了 → 用户自己的图
 * （**原样显示**，不套灰底、不强制成圆形）；开了同步 → 本机用户名首字母。
 * 设置页的预览读同一份，所以预览与实际不会说两套话。
 */
export function IdentityLogo({ className }: { className?: string }): JSX.Element {
  const stored = useSettingsStore((state) => state.settings.agentIdentity);
  const userName = useUserName();
  const identity = resolveIdentity(stored);
  const view = resolveIdentityView(identity, userName);

  if (view.initialsOnly) {
    return (
      <span
        aria-hidden
        style={{ ...identityInitialsStyle(userName || identity.name || DEFAULT_AGENT_NAME), display: "grid", placeItems: "center", fontWeight: 600 }}
        className={cn("shrink-0 rounded-full", className)}
      >
        {view.initials}
      </span>
    );
  }
  if (view.imageUrl) {
    return <img src={view.imageUrl} alt="" draggable={false} className={cn("shrink-0 object-contain", className)} />;
  }
  return <AppLogo className={className} />;
}

/** The name next to the logo. */
export function IdentityName({ className }: { className?: string }): JSX.Element {
  const stored = useSettingsStore((state) => state.settings.agentIdentity);
  const userName = useUserName();
  const view = resolveIdentityView(resolveIdentity(stored), userName);
  return <span className={className}>{view.label}</span>;
}
