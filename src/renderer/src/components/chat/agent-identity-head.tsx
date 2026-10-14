import type { JSX } from "react";
import { AppLogo } from "@/components/app-logo";
import { useSettingsStore } from "@/stores/settings";
import { useUserName } from "@/lib/identity-user";
import {
  DEFAULT_AGENT_NAME,
  identityInitialsStyle,
  resolveIdentity,
  resolveIdentityView,
} from "@shared/identity";

/**
 * fork:ai-identity —— 聊天里助手那一行的身份头（头像 + 名字）。
 *
 * 读的是「设置 → AI 身份」的同一份三态：名字空→默认名、头像空→品牌图、开同步→
 * 本机用户名首字母。设置页的预览也读同一份，所以预览与实际不会说两套话。
 */
export function AgentAvatar({ className }: { className?: string }): JSX.Element {
  const stored = useSettingsStore((state) => state.settings.agentIdentity);
  const userName = useUserName();
  const identity = resolveIdentity(stored);
  const view = resolveIdentityView(identity, userName);

  if (view.initialsOnly) {
    return (
      <span
        aria-hidden
        style={{ ...identityInitialsStyle(userName || identity.name || DEFAULT_AGENT_NAME), display: "grid", placeItems: "center", fontWeight: 600 }}
        className={className}
      >
        {view.initials}
      </span>
    );
  }
  if (view.imageUrl) {
    return <img src={view.imageUrl} alt="" draggable={false} className={className} />;
  }
  return (
    <span className={`grid place-items-center overflow-hidden rounded-full bg-muted ${className ?? ""}`}>
      <AppLogo className="size-[70%]" />
    </span>
  );
}

/** 完整一行：头像 + 名字。 */
export function AgentIdentityHead(): JSX.Element {
  const stored = useSettingsStore((state) => state.settings.agentIdentity);
  const userName = useUserName();
  const view = resolveIdentityView(resolveIdentity(stored), userName);
  return (
    <div className="flex items-center gap-1.5 pb-0.5 text-xs text-muted-foreground">
      <AgentAvatar className="size-5 shrink-0 rounded-full text-[10px]" />
      <span className="truncate font-medium">{view.label}</span>
    </div>
  );
}
