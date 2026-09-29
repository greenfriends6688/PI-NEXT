"use client";

import { useState, type ReactNode } from "react";
import { PluginsConfig } from "../PluginsConfig";
import { ConfigButton, ConfigSectionTitle } from "../SettingsUi";
import { useI18n } from "@/hooks/useI18n";
import type { McpServerInfo } from "@/lib/api-types";
import { copyText } from "@/lib/clipboard";
import {
  buildMcpAuthCommand,
  buildMcpLogoutCommand,
  isRemoteMcpServer,
} from "@/lib/mcp-auth-command";

/*
 * fork:mcp-section — MCP server management as its own settings entry.
 *
 * The implementation lives in PluginsConfig (its loaders, action plumbing and the
 * add/edit forms are shared), which exposes an `only="mcp"` mode: this page renders
 * the MCP half with the plugin half hidden, and the plug-ins page renders the
 * reverse. Splitting the 500 lines of MCP code into a second file was possible but
 * would have duplicated the request plumbing for no user-visible gain.
 */

/*
 * fork:zc-18 — MCP OAuth entry point for the detail view.
 *
 * `pi-mcp-adapter` already owns OAuth end to end (PKCE, OS-keychain credentials,
 * URL-bound token reuse, and the headless "paste the callback URL back" flow)
 * and registers `/mcp-auth <server>` plus `/mcp logout <server>`. pi-web does
 * not reimplement any of it: this component only copies the exact command the
 * user runs in their session, and explains what the extension will do next.
 *
 * Only URL-based servers get the affordance (see isRemoteMcpServer): stdio and
 * socket servers are local processes, and OAuth support cannot be read reliably
 * from the stored config shape, so "remote URL" is the conservative filter.
 */
function McpAuthActions({ server }: { server: McpServerInfo }): ReactNode {
  const { t } = useI18n();
  const [copied, setCopied] = useState<"auth" | "logout" | null>(null);

  if (!isRemoteMcpServer(server)) return null;
  const authCommand = buildMcpAuthCommand(server.name);
  const logoutCommand = buildMcpLogoutCommand(server.name);
  // Untrusted name (newline / control character): never copy a command that
  // could carry a second slash command — hide the affordance instead.
  if (!authCommand || !logoutCommand) return null;

  const copy = (kind: "auth" | "logout", command: string) => {
    void copyText(command)
      .then(() => {
        setCopied(kind);
        window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1600);
      })
      // A denied clipboard write has no useful recovery; staying silent beats a toast.
      .catch(() => {});
  };

  return (
    <div className="pw-rowgap">
      <ConfigSectionTitle>{t("mcp.authTitle")}</ConfigSectionTitle>
      <div className="pw-wrap">
        <ConfigButton
          size="small"
          onClick={() => copy("auth", authCommand)}
          title={authCommand}
        >
          <span className="pw-ico"><i data-ico="key-round" data-size="13"></i></span>
          {copied === "auth" ? t("mcp.authCopied") : t("mcp.authAuthorize")}
        </ConfigButton>
        <ConfigButton
          size="small"
          onClick={() => copy("logout", logoutCommand)}
          title={logoutCommand}
        >
          <span className="pw-ico"><i data-ico="log-out" data-size="13"></i></span>
          {copied === "logout" ? t("mcp.authCopied") : t("mcp.authLogout")}
        </ConfigButton>
      </div>
      {/* fork:design-system SW-14 —— 画板 43 的 OAuth 提示是 `.pw-alert info` 一行。 */}
      <div className="pw-alert info">
        <span className="pw-ico"><i data-ico="info" data-size="14"></i></span>
        <span className="pw-grow">{t("mcp.authHint", { name: server.name })}</span>
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
    />
  );
}
