"use client";

import { useState, type ReactNode } from "react";
import { PluginsConfig } from "../PluginsConfig";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { PwaBanner, PwaSetRow } from "@/components/pwa/PwaPage";
import type { McpServerInfo } from "@/lib/api-types";
import { copyText } from "@/lib/clipboard";
import {
  buildMcpAuthCommand,
  buildMcpLogoutCommand,
  isRemoteMcpServer,
} from "@/lib/mcp-auth-command-shared";
// fork:proma-46-mcp-catalog — 「连接目录」入口（预设卡片 + 一键 OAuth + 必选冷却）。
import { McpCatalogEntry } from "./McpCatalog";

/*
 * fork:mcp-section — MCP server management as its own settings entry.
 *
 * The implementation lives in PluginsConfig (its loaders, action plumbing and the
 * add/edit forms are shared), which exposes an `only="mcp"` mode: this page renders
 * the MCP half with the plugin half hidden, and the plug-ins page renders the
 * reverse. Splitting the 500 lines of MCP code into a second file was possible but
 * would have duplicated the request plumbing for no user-visible gain.
 */

type CopyKind = "auth" | "logout";

/*
 * fork:zc-18 — MCP OAuth entry point for the detail view.
 *
 * pi 1.0 的内置 `mcp` 扩展已经接管 OAuth（PKCE、凭据、按 URL 复用 token，以及
 * 「把 callback URL 粘回来」那条无回调分支），并注册 `/mcp login <server>` 与
 * `/mcp logout <server>`（旧版的 `/mcp-auth` 已不存在）。pi-web 不重复实现任何一块：
 * 这个组件只负责复制用户在会话里要跑的那条命令，并说清扩展接下来会做什么。
 *
 * Only URL-based servers get the affordance (see isRemoteMcpServer): stdio and
 * socket servers are local processes, and OAuth support cannot be read reliably
 * from the stored config shape, so "remote URL" is the conservative filter.
 */
function McpAuthActions({ server }: { server: McpServerInfo }): ReactNode {
  const { t } = useI18n();
  const mobile = useIsMobile();
  // fork:fix-clipboard —— 成功/失败同一个 state：按钮文案仍然是「已复制」，
  // 失败挂画板的 .danger + 一枚 role=status 徽标（和 PathActions / TodoChip 同一套）。
  const [copyState, setCopyState] = useState<{ kind: CopyKind; status: "copied" | "failed" } | null>(null);
  const failed = copyState?.status === "failed";

  if (!isRemoteMcpServer(server)) return null;
  const authCommand = buildMcpAuthCommand(server.name);
  const logoutCommand = buildMcpLogoutCommand(server.name);
  // Untrusted name (newline / control character): never copy a command that
  // could carry a second slash command — hide the affordance instead.
  if (!authCommand || !logoutCommand) return null;

  // fork:fix-clipboard —— 之前那句 `.catch(() => {})` 已经是**死代码**：
  // `copyText` 永不 reject，失败是一个明确结果，不会变成 rejection。
  // 它当初的理由（“被拒的剪贴板写入没有有用的恢复，静默好过一个 toast”）建立在
  // “除了放弃没有别的办法”之上，而 copyText 现在有 execCommand 真兜底，走到这里的
  // 失败是真的什么都没复制 —— 而这一行复制的是 OAuth 命令：用户拿着空剪贴板把命令
  // 粘回会话，代价是发一条跑不起来的 /mcp login。所以这里必须说人话。
  const copy = (kind: CopyKind, command: string) => {
    void copyText(command).then((result) => {
      const next = { kind, status: result.ok ? "copied" as const : "failed" as const };
      setCopyState(next);
      // 只复位自己刚写下的那一档：连点两次时旧定时器不能把新状态抹掉。
      window.setTimeout(() => setCopyState((current) => (current === next ? null : current)), result.ok ? 1600 : 2600);
    });
  };

  // fork:v5-landing Wave B · M-09 帧 B 表格行的同构 —— 窄屏上这一段是
  // `.m-cardgroup` › `.m-setrow`（图标 + 名字 + 右侧按钮）+ 末尾一条 `.m-banner`。
  // 两个命令与它们的剪贴板行为一字不变。
  if (mobile) {
    return (
      <div className="m-cardgroup">
        <div className="m-group-title">{t("mcp.authTitle")}</div>
        <PwaSetRow
          icon="key-round"
          label={t("mcp.authAuthorize")}
          trailing={
            <button
              type="button"
              className={`m-btn sm${failed && copyState.kind === "auth" ? " danger" : ""}`}
              onClick={() => copy("auth", authCommand)}
              title={authCommand}
            >
              <i data-ico="key-round" data-size="14" aria-hidden="true" />
              {copyState?.kind === "auth" && !failed ? t("mcp.authCopied") : t("mcp.authAuthorize")}
            </button>
          }
        />
        <PwaSetRow
          icon="log-out"
          label={t("mcp.authLogout")}
          trailing={
            <button
              type="button"
              className={`m-btn sm${failed && copyState.kind === "logout" ? " danger" : ""}`}
              onClick={() => copy("logout", logoutCommand)}
              title={logoutCommand}
            >
              <i data-ico="log-out" data-size="14" aria-hidden="true" />
              {copyState?.kind === "logout" && !failed ? t("mcp.authCopied") : t("mcp.authLogout")}
            </button>
          }
        />
        {failed && <PwaSetRow icon="triangle-alert" label={t("chat.todosCopyFailed")} />}
        <PwaBanner icon="info">{t("mcp.authHint", { name: server.name })}</PwaBanner>
      </div>
    );
  }

  // fork:v5-landing D-15 帧 D「登录态」—— 分节标题 + 一行动作 + 一条 info 横幅，
  // 全部走 system.css 已有的 `.d-set-sec-t` / `.d-row` / `.d-btn` / `.d-banner`。
  return (
    <div className="d-set-sec">
      <div className="d-set-sec-t">{t("mcp.authTitle")}</div>
      <div className="d-row">
        <button
          type="button"
          className={`d-btn sm${failed && copyState.kind === "auth" ? " danger" : ""}`}
          onClick={() => copy("auth", authCommand)}
          title={authCommand}
        >
          <i data-ico="key-round" data-size="14" aria-hidden="true" />
          {copyState?.kind === "auth" && !failed ? t("mcp.authCopied") : t("mcp.authAuthorize")}
        </button>
        <button
          type="button"
          className={`d-btn sm${failed && copyState.kind === "logout" ? " danger" : ""}`}
          onClick={() => copy("logout", logoutCommand)}
          title={logoutCommand}
        >
          <i data-ico="log-out" data-size="14" aria-hidden="true" />
          {copyState?.kind === "logout" && !failed ? t("mcp.authCopied") : t("mcp.authLogout")}
        </button>
        {failed && <span role="status" className="d-badge bad">{t("chat.todosCopyFailed")}</span>}
      </div>
      <div className="d-banner info">
        <i data-ico="info" data-size="14" aria-hidden="true" />
        <span className="d-grow">{t("mcp.authHint", { name: server.name })}</span>
      </div>
    </div>
  );
}

export function McpConfig({
  cwd,
  sessionId,
  onClose,
  onReloaded,
}: {
  cwd: string | null;
  sessionId: string | null;
  onClose: () => void;
  onReloaded?: () => void;
}): ReactNode {
  return (
    <PluginsConfig
      embedded
      only="mcp"
      cwd={cwd ?? ""}
      sessionId={sessionId}
      onClose={onClose}
      onReloaded={onReloaded}
      // fork:zc-18 — the OAuth affordance is defined in this file; the shared
      // PluginsConfig only exposes the detail slot it renders into.
      renderMcpAuthActions={(server) => <McpAuthActions server={server} />}
      // fork:proma-46-mcp-catalog — 目录入口只加这一行接线，不改 PluginsConfig 的结构。
      renderMcpCatalogEntry={({ reload }) => (
        <McpCatalogEntry cwd={cwd} onReloaded={() => { reload(); onReloaded?.(); }} />
      )}
    />
  );
}
