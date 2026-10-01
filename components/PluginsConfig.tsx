"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import type { McpResponse, McpScope, McpServerInfo, PluginPackageInfo, PluginStandaloneExtensionInfo, PluginUpdateResult, PluginsResponse } from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";
import type { McpDiscoveredServer as DiscoveredMcpServer } from "@/lib/mcp-discovery";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import {
  ConfigBadge,
  ConfigButton,
  ConfigControl,
  ConfigDetail,
  ConfigDetailActions,
  ConfigKv,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigField,
  ConfigPanelShell,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSectionTitle,
  ConfigSplitView,
  ConfigStatusDot,
  ConfigSwitch,
  SettingsPage,
} from "./SettingsUi";

type PluginScope = PluginPackageInfo["scope"];
type PluginAction = "install" | "remove" | "update" | "disable" | "enable";

function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function normalizePluginSourceInput(value: string): string {
  const match = value.trim().match(/^\$?\s*pi\s+install\s+(\S+)\s*$/);
  return match?.[1] ?? value;
}

function packageKey(pkg: Pick<PluginPackageInfo, "source" | "scope">): string {
  return `${pkg.scope}\0${pkg.source}`;
}

function extensionKey(extension: PluginStandaloneExtensionInfo): string {
  return `extension\0${extension.path}`;
}

function resourceSummary(pkg: PluginPackageInfo, t: ReturnType<typeof useI18n>["t"]): string {
  if (pkg.disabled) return t("i18n.disabled");
  const parts = [
    pkg.counts.extensions ? t("i18n.resourceCount", { count: pkg.counts.extensions, label: t("i18n.extensionShort") }) : "",
    pkg.counts.skills ? t("i18n.resourceCount", { count: pkg.counts.skills, label: t("i18n.skillShort") }) : "",
    pkg.counts.prompts ? t("i18n.resourceCount", { count: pkg.counts.prompts, label: t("i18n.promptShort") }) : "",
    pkg.counts.themes ? t("i18n.resourceCount", { count: pkg.counts.themes, label: t("i18n.themeShort") }) : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("i18n.noResources");
}

function versionSummary(pkg: PluginPackageInfo, t: ReturnType<typeof useI18n>["t"]): string {
  const parts = [];
  if (pkg.version) parts.push(t("i18n.installedVersion", { version: pkg.version }));
  if (pkg.configuredVersion) parts.push(t("i18n.configuredVersion", { version: pkg.configuredVersion }));
  return parts.length ? parts.join(" · ") : t("i18n.unknown");
}

function installLocation(scope: PluginScope, cwd: string): string {
  return scope === "project"
    ? `${shortenPath(cwd)}/.pi/agent/{npm,git}`
    : "~/.pi/agent/{npm,git}";
}

function findInstalledPackage(
  packages: PluginPackageInfo[],
  source: string,
  scope: PluginScope,
): PluginPackageInfo | undefined {
  const trimmed = source.trim();
  const withoutNpmPrefix = trimmed.startsWith("npm:") ? trimmed.slice(4) : trimmed;
  return packages.find((pkg) => pkg.scope === scope && pkg.source === trimmed)
    ?? packages.find((pkg) => pkg.scope === scope && pkg.source === `npm:${withoutNpmPrefix}`)
    ?? packages.find((pkg) => pkg.scope === scope && pkg.source.endsWith(trimmed));
}

function statusColor(status: PluginPackageInfo["status"]): string {
  if (status === "loaded") return "var(--accent)";
  if (status === "installed") return "var(--warning)";
  if (status === "disabled") return "var(--text-dim)";
  return "var(--danger)";
}

/** fork:design-system SW-14 —— 资源类型 → 画板 43 已解析资源行里的图标名。 */
const RESOURCE_ICONS: Record<string, string> = {
  extension: "blocks",
  skill: "box",
  prompt: "message-square",
  theme: "palette",
};

function ResourceList({ pkg }: { pkg: PluginPackageInfo }) {
  const { t } = useI18n();
  const groups = ([
    ["extension", t("i18n.extensions")],
    ["skill", t("i18n.skills")],
    ["prompt", t("i18n.prompts")],
    ["theme", t("i18n.themes")],
  ] as const)
    .map(([kind, label]) => ({
      kind,
      label,
      resources: pkg.resources.filter((resource) => resource.kind === kind),
    }))
    .filter((group) => group.resources.length > 0);

  if (groups.length === 0) {
    return (
      <div className="pw-alert info">
        <span className="pw-ico"><i data-ico="info" data-size="14"></i></span>
        <span className="pw-grow">
          {pkg.disabled ? t("i18n.packageDisabled") : t("i18n.noResolvedResources")}
        </span>
      </div>
    );
  }

  // fork:design-system SW-14 —— 画板 43 的「已解析资源」：每个分组一个 `.pw-sec-title`，
  // 分组下是 `.pw-list` + `.pw-litem`（名称 + 等宽相对路径副标题）。
  return (
    <div className="pw-rowgap">
      {groups.map((group) => (
        <div key={group.kind}>
          <ConfigSectionTitle>{group.label}</ConfigSectionTitle>
          <div className="pw-list">
            {group.resources.map((resource) => (
              <div key={`${resource.kind}:${resource.path}`} className="pw-litem" title={resource.path}>
                <span className="pw-ico"><i data-ico={RESOURCE_ICONS[group.kind] ?? "blocks"} data-size="14"></i></span>
                <span className="grow">
                  <span className="pw-lname">{resource.name}</span>
                  <span className="pw-lsub">{resource.relativePath}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** fork:design-system SW-14 —— 作用域是状态徽章：项目级 `.pw-badge accent`，其余 `.pw-badge`。 */
function ScopeTag({ scope }: { scope: PluginScope }) {
  return (
    <ConfigBadge tone={scope === "project" ? "accent" : undefined}>
      {scope}
    </ConfigBadge>
  );
}

/** fork:design-system SW-14 —— 作用域切换 = 画板 43 的 `.pw-radio` 芯片组（产品是 role=radio 按钮）。 */
function SegmentedScope({
  value,
  projectResourcesLoaded,
  onChange,
}: {
  value: PluginScope;
  projectResourcesLoaded: boolean;
  onChange: (scope: PluginScope) => void;
}) {
  const { t } = useI18n();
  return (
    <span className="pw-radio" role="radiogroup" aria-label={t("i18n.scope")}>
      {(["global", "project"] as PluginScope[]).map((scope) => {
        const active = value === scope;
        const disabled = scope === "project" && !projectResourcesLoaded;
        return (
          <button
            key={scope}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={disabled ? t("trust.projectScopeUnavailable") : undefined}
            className={active ? "is-on" : undefined}
            onClick={() => {
              if (!disabled) onChange(scope);
            }}
          >
            {scope}
          </button>
        );
      })}
    </span>
  );
}

function AddPluginPanel({
  cwd,
  source,
  scope,
  projectResourcesLoaded,
  busy,
  actionError,
  onSourceChange,
  onScopeChange,
  onInstall,
}: {
  cwd: string;
  source: string;
  scope: PluginScope;
  projectResourcesLoaded: boolean;
  busy: boolean;
  actionError: string | null;
  onSourceChange: (value: string) => void;
  onScopeChange: (scope: PluginScope) => void;
  onInstall: () => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const examples = ["npm:@scope/pi-plugin", "git:https://github.com/user/repo", "/absolute/path/to/plugin"];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <ConfigDetailStack>
      <div className="pw-rowgap">
        <div className="pw-inline">
          <ConfigDetailTitle>{t("i18n.addPlugin")}</ConfigDetailTitle>
          <span className="pw-grow" />
          <a
            href="https://pi.dev/packages"
            target="_blank"
            rel="noopener noreferrer"
            className="pw-mono pw-dim"
          >
            <svg width="28" height="28" viewBox="0 0 800 800" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
              <path
                fill="#000"
                fillRule="evenodd"
                d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
              />
              <path fill="#000" d="M517.36 400H634.72V634.72H517.36Z" />
            </svg>
            pi.dev/packages
          </a>
        </div>
        <span className="pw-mono pw-dim">
          {installLocation(scope, cwd)}
        </span>
      </div>

      <ConfigField label="Source">
        <input
          id="plugin-source"
          ref={inputRef}
          value={source}
          onChange={(e) => onSourceChange(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            const normalized = normalizePluginSourceInput(pasted);
            if (normalized === pasted) return;
            e.preventDefault();
            onSourceChange(normalized);
          }}
          onBlur={(e) => onSourceChange(normalizePluginSourceInput(e.currentTarget.value))}
          placeholder="npm:@scope/package"
          className="pw-input pw-mono"
          onKeyDown={(e) => {
            if (e.key === "Enter" && source.trim() && !busy) onInstall();
          }}
        />
      </ConfigField>

      <div className="pw-inline">
        <SegmentedScope
          value={scope}
          projectResourcesLoaded={projectResourcesLoaded}
          onChange={onScopeChange}
        />
        <ConfigButton
          variant="primary"
          onClick={onInstall}
          disabled={busy || !source.trim()}
          // fork:fix-disabled-title（2026-10-01）—— 禁用原因写 title。
          // 对照正例：MCP 导入条目 title="已被同名条目遮蔽"、插件页「重新加载会话」
          // title="打开会话后才能重新加载"。
          title={!source.trim() ? t("i18n.installNeedsSource") : undefined}
          className="is-pushed-right"
        >
          {busy ? t("i18n.installing") : t("i18n.install")}
        </ConfigButton>
      </div>

      <div>
        <ConfigSectionTitle>Examples</ConfigSectionTitle>
        <div className="pw-list">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              className="pw-litem"
              onClick={() => onSourceChange(example)}
            >
              <span className="pw-ico"><i data-ico="package" data-size="14"></i></span>
              <span className="pw-lname pw-mono">{example}</span>
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <div className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
          <span className="pw-grow">{actionError}</span>
        </div>
      )}
    </ConfigDetailStack>
  );
}

function PackageDetail({
  pkg,
  cwd,
  busyKey,
  actionError,
  actionMessage,
  sessionId,
  updateStatus,
  checkingUpdate,
  updateError,
  onAction,
  onCheckUpdate,
  onReloadSession,
}: {
  pkg: PluginPackageInfo;
  cwd: string;
  busyKey: string | null;
  actionError: string | null;
  actionMessage: string | null;
  sessionId: string | null;
  updateStatus?: PluginUpdateResult;
  checkingUpdate: boolean;
  updateError: string | null;
  onAction: (action: PluginAction, pkg: PluginPackageInfo) => void;
  onCheckUpdate: () => void;
  onReloadSession: () => void;
}) {
  const { t } = useI18n();
  const key = packageKey(pkg);
  const busy = busyKey?.endsWith(key) ?? false;
  const reloadBusy = busyKey === "reload";
  const enabled = !pkg.disabled;
  const description = pkg.description?.trim();
  const canCheckForUpdates = pkg.canCheckForUpdates;
  const updateAvailable = updateStatus?.state === "update-available";

  return (
    <ConfigDetailStack>
      <ConfigDetailHeader className="is-top-aligned">
        <ConfigDetailHeaderInfo>
          <ScopeTag scope={pkg.scope} />
          {/* fork:design-system SW-14 —— 画板 43 的详情头：状态徽章 + 包名等宽串。 */}
          {pkg.disabled ? (
            <ConfigBadge>{t("i18n.disabled")}</ConfigBadge>
          ) : pkg.filtered && (
            <ConfigBadge tone="warn">{t("i18n.filtered")}</ConfigBadge>
          )}
          <span className="pw-mono pw-grow">
            {pkg.source}
          </span>
        </ConfigDetailHeaderInfo>

        <ConfigDetailActions>
          <ConfigButton
            size="small"
            variant={updateAvailable ? "primary" : undefined}
            onClick={updateAvailable || !canCheckForUpdates
              ? () => onAction("update", pkg)
              : onCheckUpdate}
            disabled={busy || reloadBusy || checkingUpdate}
            title={updateAvailable ? t("i18n.updateAvailable") : undefined}
          >
             {busyKey === `update:${key}`
               ? t("i18n.updating")
               : checkingUpdate
                 ? t("i18n.checking")
                 : updateAvailable || !canCheckForUpdates
                   ? t("i18n.update")
                   : t("i18n.check")}
          </ConfigButton>
          <ConfigButton
            size="small"
            onClick={onReloadSession}
            disabled={!sessionId || reloadBusy || busy}
             title={sessionId ? t("i18n.reloadSession") : t("i18n.openSessionToReload")}
          >
             {reloadBusy ? t("i18n.reloading") : t("i18n.reloadSession")}
          </ConfigButton>
          <ConfigButton
            variant="danger"
            size="small"
            onClick={() => onAction("remove", pkg)}
            disabled={busy || reloadBusy}
          >
             {busyKey === `remove:${key}` ? t("i18n.removing") : t("i18n.remove")}
          </ConfigButton>
          <ConfigSwitch
            checked={enabled}
            loading={busy || reloadBusy}
            onChange={() => onAction(pkg.disabled ? "enable" : "disable", pkg)}
            label={pkg.disabled ? t("i18n.enablePackage") : t("i18n.disablePackage")}
          />
        </ConfigDetailActions>
      </ConfigDetailHeader>

      {/* fork:design-system SW-14 —— 画板 43 的属性表是 `.pw-kv`（dt 键 / dd 值）。 */}
      <ConfigKv>
        {description && (
          <>
            <dt>{t("i18n.description")}</dt>
            <dd>{description}</dd>
          </>
        )}
        <dt>{t("i18n.status")}</dt>
        <dd><ConfigBadge>{pkg.status}</ConfigBadge></dd>
        <dt>{t("i18n.version")}</dt>
        <dd>
          <ConfigControl>
            <span className="pw-mono">{versionSummary(pkg, t)}</span>
            {updateAvailable && (
              <ConfigBadge tone="warn" title={updateStatus.displayName}>
                {t("i18n.updateAvailable")}
              </ConfigBadge>
            )}
            {canCheckForUpdates && (checkingUpdate || (updateStatus && !updateAvailable)) && (
              <ConfigBadge
                tone={checkingUpdate
                  ? undefined
                  : updateStatus?.state === "up-to-date"
                    ? "ok"
                    : updateStatus?.state === "error"
                      ? "bad"
                      : undefined}
              >
                {checkingUpdate
                  ? t("i18n.checking")
                  : updateStatus?.state === "up-to-date"
                    ? t("i18n.upToDate")
                    : updateStatus?.state === "unsupported"
                      ? t("i18n.automaticChecksUnavailable")
                      : updateStatus?.message || t("i18n.checkFailed")}
              </ConfigBadge>
            )}
          </ConfigControl>
          {updateError && <ConfigBadge tone="bad">{updateError}</ConfigBadge>}
        </dd>
        <dt>{t("i18n.package")}</dt>
        <dd className="pw-mono">{pkg.packageName ?? t("i18n.unknown")}</dd>
        <dt>{t("i18n.resources")}</dt>
        <dd>{resourceSummary(pkg, t)}</dd>
        <dt>{t("i18n.installedPath")}</dt>
        <dd className="pw-mono">{pkg.installedPath ? shortenPath(pkg.installedPath) : t("i18n.notFound")}</dd>
        <dt>{t("i18n.cwd")}</dt>
        <dd className="pw-mono">{shortenPath(cwd)}</dd>
      </ConfigKv>

      <div>
        <ConfigSectionTitle>{t("i18n.resolvedResources")}</ConfigSectionTitle>
        <ResourceList pkg={pkg} />
      </div>

      {actionMessage && (
        <div className="pw-alert info">
          <span className="pw-ico"><i data-ico="check" data-size="14"></i></span>
          <span className="pw-grow">{actionMessage}</span>
        </div>
      )}
      {actionError && (
        <div className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
          <span className="pw-grow">{actionError}</span>
        </div>
      )}
    </ConfigDetailStack>
  );
}

function StandaloneExtensionDetail({ extension }: { extension: PluginStandaloneExtensionInfo }) {
  const { t } = useI18n();
  const status = extension.enabled ? "loaded" : "disabled";

  return (
    <ConfigDetailStack>
      <ConfigDetailHeader>
        <ConfigDetailHeaderInfo>
          <ScopeTag scope={extension.scope} />
          <ConfigDetailTitle>{extension.name}</ConfigDetailTitle>
        </ConfigDetailHeaderInfo>
      </ConfigDetailHeader>
      <ConfigKv>
        <dt>{t("i18n.status")}</dt>
        <dd><ConfigBadge>{status}</ConfigBadge></dd>
        <dt>{t("i18n.installedPath")}</dt>
        <dd className="pw-mono">{shortenPath(extension.path)}</dd>
      </ConfigKv>
    </ConfigDetailStack>
  );
}

function McpServerDetail({
  server,
  cwd,
  busy,
  actionError,
  actionMessage,
  onToggle,
  onRemove,
  onMove,
  onTest,
  onEdit,
  authActions,
}: {
  server: McpServerInfo;
  cwd: string;
  busy: boolean;
  actionError: string | null;
  actionMessage: string | null;
  onToggle: () => void;
  onRemove: () => void;
  onMove: () => void;
  onTest: () => void;
  onEdit: () => void;
  /** fork:zc-18 — optional OAuth entry slot; rendered by fork/McpConfig.tsx. */
  authActions?: ReactNode;
}) {
  const { t } = useI18n();
  const enabled = !server.disabled;
  const otherScope: McpScope = server.scope === "project" ? "global" : "project";
  const target =
    server.kind === "url" ? server.url : server.kind === "socket" ? server.socket : server.command;

  return (
    <ConfigDetailStack>
      <ConfigDetailHeader className="is-top-aligned">
        <ConfigDetailHeaderInfo>
          <ScopeTag scope={server.scope} />
          {/* fork:design-system SW-14 —— 画板 43 的 MCP 详情头：作用域 / 禁用徽章 / 等宽名。 */}
          {server.disabled && (
            <ConfigBadge>{t("mcp.disabledBadge")}</ConfigBadge>
          )}
          <span className="pw-mono pw-grow">
            {server.name}
          </span>
        </ConfigDetailHeaderInfo>

        <ConfigDetailActions>
          <ConfigButton size="small" onClick={onTest} disabled={busy}>
            {busy ? t("mcp.testing") : t("mcp.test")}
          </ConfigButton>
          <ConfigButton size="small" onClick={onEdit} disabled={busy}>
            {t("mcp.edit")}
          </ConfigButton>
          <ConfigButton size="small" onClick={onMove} disabled={busy}>
            {otherScope === "project" ? t("mcp.moveToProject") : t("mcp.moveToGlobal")}
          </ConfigButton>
          <ConfigButton variant="danger" size="small" onClick={onRemove} disabled={busy}>
            {t("mcp.delete")}
          </ConfigButton>
          <ConfigSwitch
            checked={enabled}
            loading={busy}
            onChange={() => onToggle()}
            label={enabled ? t("mcp.disable") : t("mcp.enable")}
          />
        </ConfigDetailActions>
      </ConfigDetailHeader>

      <ConfigKv>
        <dt>{t("mcp.fieldType")}</dt>
        <dd className="pw-mono">{server.kind}</dd>
        <dt>
          {server.kind === "url"
            ? t("mcp.kindUrl")
            : server.kind === "socket"
              ? t("mcp.kindSocket")
              : t("mcp.kindCommand")}
        </dt>
        <dd className="pw-mono">{target ?? "—"}</dd>
        {server.kind === "command" && (
          <>
            <dt>{t("mcp.fieldArgs")}</dt>
            <dd className="pw-mono">{server.args.length ? server.args.join(" ") : "—"}</dd>
          </>
        )}
        <dt>{t("mcp.fieldEnv")}</dt>
        <dd className="pw-mono">{server.envKeys.length ? server.envKeys.join(", ") : "—"}</dd>
        <dt>{t("mcp.fieldOptions")}</dt>
        <dd className="pw-mono">{Object.keys(server.options).length ? JSON.stringify(server.options) : "—"}</dd>
        <dt>{t("mcp.fieldSource")}</dt>
        <dd className="pw-mono">{shortenPath(server.source)}</dd>
        <dt>{t("mcp.fieldCwd")}</dt>
        <dd className="pw-mono">{shortenPath(cwd)}</dd>
      </ConfigKv>

      {authActions}

      {actionMessage && (
        <div className="pw-alert info">
          <span className="pw-ico"><i data-ico="check" data-size="14"></i></span>
          <span className="pw-grow">{actionMessage}</span>
        </div>
      )}
      {actionError && (
        <div className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
          <span className="pw-grow">{actionError}</span>
        </div>
      )}
    </ConfigDetailStack>
  );
}

function AddMcpServer({
  cwd,
  scope,
  projectResourcesLoaded,
  busy,
  actionError,
  initial,
  onScopeChange,
  onSave,
  onFetchDef,
  onCancel,
}: {
  cwd: string;
  scope: McpScope;
  projectResourcesLoaded: boolean;
  busy: boolean;
  actionError: string | null;
  initial?: McpServerInfo | null;
  onScopeChange: (scope: McpScope) => void;
  onSave: (name: string, def: Record<string, unknown>) => void;
  onFetchDef: (name: string, serverScope: McpScope) => Promise<Record<string, unknown> | null>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const isEdit = !!initial;
  const [name, setName] = useState(isEdit && initial ? initial.name : "");
  const [spec, setSpec] = useState(() => {
    if (!initial) return "";
    if (initial.kind === "command") return [initial.command, ...initial.args].join(" ");
    return initial.url ?? initial.socket ?? "";
  });
  const [argsText, setArgsText] = useState("");
  const [mode, setMode] = useState<"basic" | "json">("basic");
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [loadingJson, setLoadingJson] = useState(false);

  const isUrl = /^https?:\/\//.test(spec.trim());

  const buildBasicDef = (): Record<string, unknown> => {
    const specTrim = spec.trim();
    if (/^https?:\/\//.test(specTrim)) return { url: specTrim };
    const tokens = specTrim.split(/\s+/);
    const command = tokens[0] ?? "";
    const extra = argsText.trim() ? argsText.trim().split(/\s+/) : [];
    return { command, args: [...tokens.slice(1), ...extra] };
  };

  const switchToJson = async (): Promise<void> => {
    setJsonError(null);
    if (jsonText !== null) {
      setMode("json");
      return;
    }
    if (isEdit && initial) {
      setMode("json");
      setLoadingJson(true);
      try {
        const def = await onFetchDef(initial.name, initial.scope);
        // Do NOT fall back to the basic form here: that definition is lossy (no env,
        // timeout, lifecycle, …), and saving it would overwrite the real config entry.
        // Leave the editor empty so Save stays disabled until a refetch succeeds.
        if (!def) {
          setJsonText(null);
          setJsonError(t("mcp.loadDefFailed"));
          return;
        }
        setJsonError(null);
        setJsonText(JSON.stringify(def, null, 2));
      } finally {
        setLoadingJson(false);
      }
    } else {
      setJsonText(JSON.stringify(buildBasicDef(), null, 2));
      setMode("json");
    }
  };

  const handleSave = (): void => {
    setJsonError(null);
    if (mode === "json") {
      const text = jsonText ?? "";
      if (!text.trim()) {
        setJsonError(t("mcp.jsonEmpty"));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        setJsonError(t("mcp.jsonParseError", { message: error instanceof Error ? error.message : String(error) }));
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setJsonError(t("mcp.jsonNotObject"));
        return;
      }
      const def = parsed as Record<string, unknown>;
      if (!def.command && !def.url && !def.socket) {
        setJsonError(t("mcp.jsonNeedsEntry"));
        return;
      }
      onSave(name, def);
      return;
    }
    onSave(name, buildBasicDef());
  };

  const canSave = Boolean(
    name.trim() && (mode === "json" ? (jsonText ?? "").trim().length > 0 : spec.trim().length > 0),
  );

  return (
    <ConfigDetailStack>
      <div>
        <ConfigDetailTitle>
          {isEdit ? t("mcp.editTitle", { name: initial?.name ?? "" }) : t("mcp.addTitle")}
        </ConfigDetailTitle>
        <span className="pw-mono pw-dim">
          {scope === "project" ? `${shortenPath(cwd)}/.pi/mcp.json` : "~/.pi/agent/mcp.json"}
        </span>
      </div>

      {/* fork:design-system SW-14 —— 画板 43 的 Basic / JSON 切换是 `.pw-radio` 芯片组。 */}
      <div className="pw-inline">
        <span className="pw-radio" role="radiogroup" aria-label={t("mcp.sectionTitle")}>
          {(["basic", "json"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={mode === m ? "is-on" : undefined}
              onClick={() => (m === "json" ? void switchToJson() : setMode("basic"))}
            >
              {m === "basic" ? t("mcp.modeBasic") : t("mcp.modeJson")}
            </button>
          ))}
        </span>
      </div>

      <ConfigField label={t("mcp.nameLabel")}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("mcp.namePlaceholder")}
          className="pw-input pw-mono"
        />
      </ConfigField>

      {mode === "json" ? (
        <ConfigField label={t("mcp.jsonLabel")}>
          {loadingJson ? (
            <div className="pw-alert info">
              <span className="pw-ico"><i data-ico="loader-circle" data-size="14" className="pw-anim-spin"></i></span>
              <span className="pw-grow">{t("mcp.loadingDef")}</span>
            </div>
          ) : (
            <textarea
              value={jsonText ?? ""}
              onChange={(e) => setJsonText(e.target.value)}
              spellCheck={false}
              placeholder={
                '{\n  "command": "npx",\n  "args": ["-y", "@modelcontextprotocol/server-github"],\n  "env": {}\n}'
              }
              className="pw-textarea pw-mono"
            />
          )}
        </ConfigField>
      ) : (
        <>
          <ConfigField label={t("mcp.specLabel")}>
            <input
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              placeholder={t("mcp.specPlaceholder")}
              className="pw-input pw-mono"
            />
          </ConfigField>

          {!isUrl && (
            <ConfigField label={t("mcp.argsLabel")}>
              <input value={argsText} onChange={(e) => setArgsText(e.target.value)} className="pw-input pw-mono" />
            </ConfigField>
          )}
        </>
      )}

      {jsonError && (
        <div className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
          <span className="pw-grow">{jsonError}</span>
        </div>
      )}

      <div className="pw-inline">
        <SegmentedScope
          value={scope}
          projectResourcesLoaded={projectResourcesLoaded}
          onChange={onScopeChange}
        />
        <ConfigButton variant="primary" onClick={handleSave} disabled={busy || !canSave}>
          {busy ? t("mcp.saving") : isEdit ? t("mcp.saveEdit") : t("mcp.save")}
        </ConfigButton>
        <ConfigButton onClick={onCancel}>{t("mcp.cancel")}</ConfigButton>
      </div>

      {actionError && (
        <div className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
          <span className="pw-grow">{actionError}</span>
        </div>
      )}
    </ConfigDetailStack>
  );
}

export function PluginsConfig({
  cwd,
  sessionId,
  onClose,
  onReloaded,
  embedded = false,
  only,
  renderMcpAuthActions,
}: {
  cwd: string;
  sessionId: string | null;
  onClose: () => void;
  onReloaded?: () => void;
  embedded?: boolean;
  /**
   * fork:mcp-section — `"mcp"` renders this component as the standalone MCP page
   * (its own settings entry) and hides everything plugin-related; the default hides
   * the MCP half. Both halves share the loaders and the action plumbing, which is
   * why this is a mode rather than a second copy of 500 lines.
   */
  only?: "mcp";
  /**
   * fork:zc-18 — optional OAuth entry slot for the MCP detail view. The MCP
   * panel (fork/McpConfig.tsx) supplies the implementation; this shared
   * component stays free of OAuth-command copy.
   */
  renderMcpAuthActions?: (server: McpServerInfo) => ReactNode;
}) {
  const mcpOnly = only === "mcp";
  const { t } = useI18n();
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => getLastSettingsSelection("plugins", cwd));
  const [addMode, setAddMode] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [installScope, setInstallScope] = useState<PluginScope>("global");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, PluginUpdateResult>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  // MCP server state
  const [view, setView] = useState<"plugins" | "mcp">(mcpOnly ? "mcp" : "plugins");
  const [mcpData, setMcpData] = useState<McpResponse | null>(null);
  const [mcpLoading, setMcpLoading] = useState(true);
  const [mcpSelected, setMcpSelected] = useState<string | null>(null);
  const [mcpAddMode, setMcpAddMode] = useState(false);
  // fork:mcp-import — servers found in other agents' config files.
  const [mcpImportOpen, setMcpImportOpen] = useState(false);
  const [mcpDiscovered, setMcpDiscovered] = useState<DiscoveredMcpServer[]>([]);
  const [mcpDiscovering, setMcpDiscovering] = useState(false);
  const [mcpImporting, setMcpImporting] = useState<string | null>(null);
  const [mcpScope, setMcpScope] = useState<McpScope>("global");
  const [mcpEditTarget, setMcpEditTarget] = useState<McpServerInfo | null>(null);
  const [mcpActionError, setMcpActionError] = useState<string | null>(null);
  const [mcpActionMessage, setMcpActionMessage] = useState<string | null>(null);
  const [mcpTesting, setMcpTesting] = useState<string | null>(null);

  const packages = useMemo(() => data?.packages ?? [], [data?.packages]);
  const standaloneExtensions = useMemo(() => data?.standaloneExtensions ?? [], [data?.standaloneExtensions]);
  const selectedPackage = packages.find((pkg) => packageKey(pkg) === selected) ?? null;
  const selectedExtension = standaloneExtensions.find((extension) => extensionKey(extension) === selected) ?? null;
  const projectResourcesLoaded = data?.projectResourcesLoaded ?? true;
  const selectedMcp = useMemo(
    () => mcpData?.servers.find((s) => s.name === mcpSelected) ?? null,
    [mcpData, mcpSelected],
  );
  const groupedMcp = useMemo(() => {
    return (["project", "global"] as McpScope[])
      .map((scope) => ({ scope, servers: (mcpData?.servers ?? []).filter((s) => s.scope === scope) }))
      .filter((group) => group.servers.length > 0);
  }, [mcpData]);

  const groupedPackages = useMemo(() => {
    return (["project", "global"] as PluginScope[])
      .map((scope) => ({ scope, packages: packages.filter((pkg) => pkg.scope === scope) }))
      .filter((group) => group.packages.length > 0);
  }, [packages]);

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/plugins?cwd=${encodeURIComponent(cwd)}`);
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      setAddMode((current) => (next.packages.length === 0 && next.standaloneExtensions.length === 0) || current);
      setSelected((current) => {
        if (current && (
          next.packages.some((pkg) => packageKey(pkg) === current)
          || next.standaloneExtensions.some((extension) => extensionKey(extension) === current)
        )) return current;
        return next.packages[0]
          ? packageKey(next.packages[0])
          : next.standaloneExtensions[0]
            ? extensionKey(next.standaloneExtensions[0])
            : null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setUpdateStatuses({});
    setUpdateError(null);
    void loadPlugins();
  }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDiscovered = useCallback(async () => {
    if (!cwd) return;
    setMcpDiscovering(true);
    try {
      const res = await fetch(`/api/mcp/discover?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const data = await res.json() as { servers?: DiscoveredMcpServer[]; error?: string };
      if (!res.ok) {
        setMcpActionError(data.error ?? `HTTP ${res.status}`);
        setMcpDiscovered([]);
        return;
      }
      setMcpDiscovered(data.servers ?? []);
    } catch (e) {
      setMcpActionError(e instanceof Error ? e.message : String(e));
      setMcpDiscovered([]);
    } finally {
      setMcpDiscovering(false);
    }
  }, [cwd]);

  const loadMcp = useCallback(async () => {
    setMcpLoading(true);
    setMcpActionError(null);
    try {
      const res = await fetch(`/api/mcp?cwd=${encodeURIComponent(cwd)}`);
      const next = (await res.json()) as McpResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setMcpData(next);
      setMcpSelected((current) =>
        current && next.servers.some((s) => s.name === current)
          ? current
          : next.servers[0]?.name ?? null,
      );
    } catch (err) {
      setMcpActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpLoading(false);
    }
  }, [cwd]);

  const importDiscovered = useCallback(async (server: DiscoveredMcpServer) => {
    if (!cwd) return;
    setMcpImporting(server.name);
    setMcpActionError(null);
    try {
      // Import into the scope the entry came from: a project server belongs to the
      // project, a user one to the user config — reusing the existing write path,
      // including its project-trust check.
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", cwd, scope: server.scope, name: server.name, def: server.def }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setMcpActionError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setMcpActionMessage(t("mcp.importDone", { name: server.name }));
      await loadMcp();
    } finally {
      setMcpImporting(null);
    }
  }, [cwd, loadMcp, t]);


  useEffect(() => {
    void loadMcp();
  }, [loadMcp]);

  const runMcpAction = useCallback(
    async (action: string, payload: Record<string, unknown>): Promise<McpResponse | null> => {
      setBusyKey(`mcp:${action}`);
      setMcpActionError(null);
      setMcpActionMessage(null);
      try {
        const res = await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, action, ...payload }),
        });
        const next = (await res.json()) as McpResponse & { error?: string };
        if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
        setMcpData(next);
        return next;
      } catch (err) {
        setMcpActionError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setBusyKey(null);
      }
    },
    [cwd],
  );

  const toggleMcp = useCallback(
    async (server: McpServerInfo) => {
      let next = await runMcpAction(server.disabled ? "enable" : "disable", {
        name: server.name,
        scope: server.scope,
      });
      // fork:gap-mcp-handshake — 启用前服务端会做一次真实握手（initialize + tools/list）。
      // 握手失败说明"现在还用不了"，默认就停在这里；但配好配置、服务稍后才起的场景
      // 确实存在，所以给一个显式确认的逃生口，而不是让用户去改 JSON。
      if (!next && server.disabled && typeof window !== "undefined"
        && window.confirm(t("mcp.handshakeForceConfirm", { name: server.name }))) {
        next = await runMcpAction("enable", { name: server.name, scope: server.scope, force: true });
      }
      if (next) {
        setMcpActionMessage(
          server.disabled
            ? t("mcp.msgEnabled", { name: server.name })
            : t("mcp.msgDisabled", { name: server.name }),
        );
      }
    },
    [runMcpAction], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const removeMcp = useCallback(
    async (server: McpServerInfo) => {
      const next = await runMcpAction("remove", { name: server.name, scope: server.scope });
      if (next) {
        setMcpSelected(next.servers[0]?.name ?? null);
        setMcpActionMessage(t("mcp.msgDeleted", { name: server.name }));
        if (next.servers.length === 0) setMcpAddMode(true);
      }
    },
    [runMcpAction], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const moveMcp = useCallback(
    async (server: McpServerInfo) => {
      const to = server.scope === "project" ? "global" : "project";
      const next = await runMcpAction("move", {
        name: server.name,
        fromScope: server.scope,
        toScope: to,
      });
      if (next) setMcpActionMessage(t("mcp.msgMoved", { name: server.name, scope: to }));
    },
    [runMcpAction], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const saveMcp = useCallback(
    async (name: string, def: Record<string, unknown>) => {
      const isEdit = !!mcpEditTarget;
      const action = isEdit ? "update" : "add";
      const nameFinal = isEdit && mcpEditTarget ? mcpEditTarget.name : name.trim();
      const next = await runMcpAction(action, { name: nameFinal, scope: mcpScope, def });
      if (next) {
        setMcpSelected(nameFinal);
        setMcpAddMode(false);
        setMcpEditTarget(null);
        setMcpActionMessage(
          isEdit
            ? t("mcp.msgUpdated", { name: nameFinal })
            : t("mcp.msgAdded", { name: nameFinal }),
        );
      }
    },
    [mcpScope, mcpEditTarget, runMcpAction], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const fetchMcpDef = useCallback(
    async (name: string, serverScope: McpScope): Promise<Record<string, unknown> | null> => {
      try {
        const res = await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, action: "get", name, scope: serverScope }),
        });
        const json = (await res.json()) as { def?: Record<string, unknown>; error?: string };
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        return json.def ?? null;
      } catch {
        return null;
      }
    },
    [cwd],
  );

  const testMcp = useCallback(
    async (server: McpServerInfo) => {
      setMcpTesting(server.name);
      setMcpActionError(null);
      setMcpActionMessage(null);
      try {
        const res = await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, action: "test", name: server.name, scope: server.scope }),
        });
        const json = (await res.json()) as { ok?: boolean; message?: string; error?: string };
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        // The route answers 200 with { ok: false } when the MCP handshake itself fails
        // (e.g. the command is not an MCP server). `ok` has to be honoured explicitly,
        // otherwise a failed probe is rendered as a green success message.
        if (json.ok === false) {
          setMcpActionError(
            t("mcp.msgTestError", { name: server.name, error: json.message ?? "" }),
          );
        } else {
          setMcpActionMessage(t("mcp.msgTestResult", { name: server.name, result: json.message ?? "" }));
        }
      } catch (err) {
        setMcpActionError(
          t("mcp.msgTestError", {
            name: server.name,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      } finally {
        setMcpTesting(null);
      }
    },
    [cwd], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (selected) setLastSettingsSelection("plugins", selected, cwd);
  }, [cwd, selected]);

  const checkForUpdates = useCallback(async (pkg?: PluginPackageInfo) => {
    const targets = pkg ? [pkg] : packages.filter((item) => item.canCheckForUpdates);
    const keys = targets.map(packageKey);
    if (keys.length === 0) return;

    setUpdateError(null);
    setCheckingUpdates((current) => new Set([...current, ...keys]));
    if (!pkg) setCheckingAll(true);
    try {
      const res = await fetch("/api/plugins/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          source: pkg?.source,
          scope: pkg?.scope,
        }),
      });
      const data = (await res.json()) as {
        updates?: PluginUpdateResult[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUpdateStatuses((current) => {
        const next = { ...current };
        for (const update of data.updates ?? []) {
          next[packageKey(update)] = update;
        }
        return next;
      });
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingUpdates((current) => {
        const next = new Set(current);
        for (const key of keys) next.delete(key);
        return next;
      });
      if (!pkg) setCheckingAll(false);
    }
  }, [cwd, packages]);

  const updateAllPluginsAction = useCallback(async () => {
    setUpdatingAll(true);
    setActionError(null);
    setActionMessage(null);
    setUpdateError(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", cwd }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      setUpdateStatuses({});
      setActionMessage(t("i18n.packagesUpdated"));
      if (sessionId) {
        setActionMessage(`${t("i18n.packagesUpdated")} ${t("agents.reloadRequired")}`);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdatingAll(false);
    }
  }, [cwd, sessionId, t]);

  const runAction = useCallback(async (action: PluginAction, pkg: PluginPackageInfo) => {
    const key = packageKey(pkg);
    setBusyKey(`${action}:${key}`);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, source: pkg.source, scope: pkg.scope, cwd }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      if (action === "remove") {
        setSelected(next.packages[0]
          ? packageKey(next.packages[0])
          : next.standaloneExtensions[0]
            ? extensionKey(next.standaloneExtensions[0])
            : null);
        if (next.packages.length === 0 && next.standaloneExtensions.length === 0) setAddMode(true);
        setActionMessage("Package removed.");
        setUpdateStatuses((current) => {
          const nextStatuses = { ...current };
          delete nextStatuses[key];
          return nextStatuses;
        });
      } else {
        const messages: Record<Exclude<PluginAction, "remove">, string> = {
          install: "Package installed.",
          update: "Package updated.",
          disable: "Package disabled.",
          enable: "Package enabled.",
        };
        setActionMessage(messages[action]);
        if (action === "update") {
          setUpdateStatuses((current) => {
            const nextStatuses = { ...current };
            delete nextStatuses[key];
            return nextStatuses;
          });
        }
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [cwd]);

  const installPlugin = useCallback(async () => {
    const source = normalizePluginSourceInput(installSource).trim();
    if (!source) return;
    setInstallSource(source);
    const key = `${installScope}\0${source}`;
    setBusyKey(`install:${key}`);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install", source, scope: installScope, cwd }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      const installed = findInstalledPackage(next.packages, source, installScope);
      setSelected(installed ? packageKey(installed) : key);
      setAddMode(false);
      setInstallSource("");
      setActionMessage("Package installed.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [cwd, installScope, installSource]);

  const reloadSession = useCallback(async () => {
    if (!sessionId) return;
    setBusyKey("reload");
    setActionError(null);
    setActionMessage(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      onReloaded?.();
      await loadPlugins();
      setActionMessage("Session reloaded.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [loadPlugins, onReloaded, sessionId]);

  const addBusy = busyKey?.startsWith("install:") ?? false;
  const mcpBusy = busyKey?.startsWith("mcp:") ?? false;
  const availableUpdateCount = Object.values(updateStatuses).filter(
    (status) => status.state === "update-available",
  ).length;
  const hasCheckablePackages = packages.some((pkg) => pkg.canCheckForUpdates);
  const footerBusy = loading || busyKey !== null || checkingUpdates.size > 0 || updatingAll;

  return (
    <ConfigPanelShell
      embedded={embedded}
      title={mcpOnly ? t("mcp.sectionTitle") : t("common.plugins")}
      subtitle={shortenPath(cwd)}
      closeLabel={t("i18n.close")}
      onClose={onClose}
    >
      {/* fork:settings-frame（画板 62）—— 插件页与 MCP 页共用这一份实现，
          所以三件套的文案与动作按 `mcpOnly` 分叉。

          页脚整块删掉了：它原来同时干三件事 —— 放统计（`4 ext · 7 skills …`）、
          放动作（检查更新 / 刷新）、并且**在 MCP 页原样显示插件页的统计**
          （`only="mcp"` 模式没把它一起关掉）。现在统计进工具栏的等宽徽章，
          动作按级别归位，页脚不再存在。 */}
      <SettingsPage
        title={mcpOnly ? t("mcp.sectionTitle") : t("common.plugins")}
        sub={mcpOnly ? t("mcp.pageSub") : t("plugins.pageSub")}
        actions={
          mcpOnly ? (
            <>
              <ConfigButton
                variant="secondary"
                size="small"
                onClick={() => {
                  setView("mcp");
                  setMcpAddMode(false);
                  setMcpImportOpen(true);
                  setMcpActionError(null);
                  void loadDiscovered();
                }}
              >
                <span className="pw-ico"><i data-ico="import" data-size="13" aria-hidden="true" /></span>
                {t("mcp.importButton")}
              </ConfigButton>
              <ConfigButton
                variant="primary"
                size="small"
                onClick={() => {
                  setView("mcp");
                  setMcpAddMode(true);
                  setMcpEditTarget(null);
                  setMcpActionError(null);
                  setMcpActionMessage(null);
                }}
              >
                <span className="pw-ico"><i data-ico="plus" data-size="13" aria-hidden="true" /></span>
                {t("mcp.addButton")}
              </ConfigButton>
            </>
          ) : (
            <>
              {hasCheckablePackages && (
                <ConfigButton
                  variant={availableUpdateCount > 0 ? "primary" : "secondary"}
                  size="small"
                  onClick={() => void (availableUpdateCount > 0 ? updateAllPluginsAction() : checkForUpdates())}
                  disabled={footerBusy}
                  title={availableUpdateCount > 0 ? t("i18n.updateAllPluginsHint") : undefined}
                >
                  <span className="pw-ico"><i data-ico="refresh-cw" data-size="13" aria-hidden="true" /></span>
                  {updatingAll
                    ? t("i18n.updating")
                    : checkingAll
                      ? t("i18n.checking")
                      : availableUpdateCount > 0
                        ? `${t("i18n.updateAllPlugins")} (${availableUpdateCount})`
                        : t("i18n.checkUpdates")}
                </ConfigButton>
              )}
              <ConfigButton
                variant="primary"
                size="small"
                onClick={() => {
                  setView("plugins");
                  setAddMode(true);
                  setActionError(null);
                  setActionMessage(null);
                }}
              >
                <span className="pw-ico"><i data-ico="plus" data-size="13" aria-hidden="true" /></span>
                {t("i18n.addPlugin")}
              </ConfigButton>
            </>
          )
        }
        toolbar={
          <>
            <span className="pw-grow" aria-hidden="true" />
            {mcpOnly ? (
              <ConfigBadge tone="count">{t("mcp.count", { count: String(mcpData?.servers.length ?? 0) })}</ConfigBadge>
            ) : (
              <>
                {data?.diagnostics.length ? (
                  <ConfigBadge
                    tone={data.diagnostics.some((d) => d.type === "error") ? "bad" : "warn"}
                    title={data.diagnostics.map((d) => `${d.type}: ${d.source ? `${d.source}: ` : ""}${d.message}`).join("\n")}
                  >
                    {data.diagnostics.length} diagnostic{data.diagnostics.length === 1 ? "" : "s"}
                  </ConfigBadge>
                ) : null}
                <ConfigBadge tone="count">
                  {data ? `${data.totals.extensions} ext · ${data.totals.skills} skills` : ""}
                </ConfigBadge>
              </>
            )}
            {/* fix:mcp-refresh-target —— MCP 分节那枚「刷新」原来调的是 loadPlugins()：
                它只打 /api/plugins、写的是插件页状态，于是右侧列表、顶部「N 个服务器」
                徽章、错误态一个字都不动（手工改过 mcp.json 回来点刷新也永远看不到新条目）。
                MCP 模式改调 loadMcp()，置灰也跟着 MCP 自己的状态（加载中 / MCP 动作在飞），
                不再被插件页的 loading 牵连。 */}
            {mcpOnly ? (
              <ConfigButton size="small" onClick={() => void loadMcp()} disabled={mcpLoading || mcpBusy}>
                {t("i18n.refresh")}
              </ConfigButton>
            ) : (
              <ConfigButton size="small" onClick={() => void loadPlugins()} disabled={footerBusy}>
                {t("i18n.refresh")}
              </ConfigButton>
            )}
          </>
        }
        fill
      >
        {/* fork:design-system SW-14 —— 画板 42 / 43 的信任提示是 `.pw-alert info` 一行。 */}
        {!projectResourcesLoaded && (
          <div role="status" className="pw-alert info">
            <span className="pw-ico"><i data-ico="info" data-size="14"></i></span>
            <span className="pw-grow">{t("trust.pluginsNotLoaded")}</span>
          </div>
        )}

        <ConfigSplitView>
          <ConfigSidebar>
            <ConfigSidebarList>
              {mcpOnly ? null : (<>
              {loading ? (
                <div className="pw-alert info">
                  <span className="pw-ico"><i data-ico="loader-circle" data-size="14" className="pw-anim-spin"></i></span>
                  <span className="pw-grow">Loading...</span>
                </div>
              ) : error ? (
                <div className="pw-alert">
                  <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
                  <span className="pw-grow">{error}</span>
                </div>
              ) : packages.length === 0 && standaloneExtensions.length === 0 ? (
                <div className="pw-alert info">
                  <span className="pw-ico"><i data-ico="blocks" data-size="14"></i></span>
                  <span className="pw-grow">No plugins configured</span>
                </div>
              ) : (
                <>
                  {standaloneExtensions.length > 0 && (
                    // fork:design-system —— 画板 42/43 的分组标题就是 `.pw-list` 的直接
                    // 子元素（pw-group-title），不再包自绘的 config-sidebar-group 层。
                    <>
                      <ConfigSidebarGroupLabel>{t("i18n.extensions")}</ConfigSidebarGroupLabel>
                      {standaloneExtensions.map((extension) => {
                        const key = extensionKey(extension);
                        return (
                          <ConfigSidebarItem
                            key={key}
                            active={!addMode && selected === key}
                            title={extension.path}
                            onClick={() => {
                              setSelected(key);
                              setAddMode(false);
                              setActionError(null);
                              setActionMessage(null);
                            }}
                          >
                            <ConfigStatusDot active={extension.enabled} />
                            <ConfigSidebarText className={`is-grow${extension.enabled ? "" : " is-muted"}`}>
                              {extension.name}
                            </ConfigSidebarText>
                          </ConfigSidebarItem>
                        );
                      })}
                    </>
                  )}
                  {groupedPackages.map((group) => (
                    <Fragment key={group.scope}>
                      <ConfigSidebarGroupLabel>
                        {group.scope}
                      </ConfigSidebarGroupLabel>
                      {group.packages.map((pkg) => {
                        const key = packageKey(pkg);
                        const isSelected = !addMode && selected === key;
                        return (
                          <ConfigSidebarItem
                            key={key}
                            active={isSelected}
                            title={pkg.description ?? pkg.source}
                            onClick={() => {
                              setView("plugins");
                              setSelected(key);
                              setAddMode(false);
                              setActionError(null);
                              setActionMessage(null);
                            }}
                          >
                            <ConfigStatusDot active={!pkg.disabled} color={statusColor(pkg.status)} />
                            <ConfigSidebarText className={`is-grow${pkg.disabled ? " is-muted" : ""}`}>
                              {pkg.source}
                            </ConfigSidebarText>
                            {updateStatuses[packageKey(pkg)]?.state === "update-available" && (
                              <span title={t("i18n.updateAvailable")} className="pw-ico">
                                <i data-ico="arrow-up" data-size="12"></i>
                              </span>
                            )}
                          </ConfigSidebarItem>
                        );
                      })}
                    </Fragment>
                  ))}
                </>
              )}
              </>)}
                  {mcpOnly && <>
                    <ConfigSidebarGroupLabel>
                      {t("mcp.sectionTitle")}
                    </ConfigSidebarGroupLabel>
                    {mcpLoading ? (
                      <div className="pw-alert info">
                        <span className="pw-ico"><i data-ico="loader-circle" data-size="14" className="pw-anim-spin"></i></span>
                        <span className="pw-grow">{t("i18n.loading")}</span>
                      </div>
                    ) : !mcpData && mcpActionError ? (
                      <div className="pw-alert">
                        <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
                        <span className="pw-grow">{mcpActionError}</span>
                      </div>
                    ) : (mcpData?.servers.length ?? 0) === 0 ? (
                      <div className="pw-alert info">
                        <span className="pw-ico"><i data-ico="server" data-size="14"></i></span>
                        <span className="pw-grow">{t("mcp.emptyList")}</span>
                      </div>
                    ) : (
                      <>
                        {groupedMcp.map((group) => (
                          <Fragment key={group.scope}>
                            <ConfigSidebarGroupLabel>{group.scope}</ConfigSidebarGroupLabel>
                            {group.servers.map((server) => {
                              const isMcpSelected =
                                view === "mcp" && !mcpAddMode && mcpSelected === server.name;
                              return (
                                <ConfigSidebarItem
                                  key={server.name}
                                  active={isMcpSelected}
                                  title={shortenPath(server.source)}
                                  onClick={() => {
                                    setView("mcp");
                                    setMcpSelected(server.name);
                                    setMcpAddMode(false);
                                    setMcpEditTarget(null);
                                    setMcpActionError(null);
                                    setMcpActionMessage(null);
                                  }}
                                >
                                  <ConfigStatusDot
                                    active={!server.disabled}
                                    color={server.disabled ? undefined : "var(--accent)"}
                                  />
                                  <ConfigSidebarText className={`is-grow${server.disabled ? " is-muted" : ""}`}>
                                    {server.name}
                                  </ConfigSidebarText>
                                </ConfigSidebarItem>
                              );
                            })}
                          </Fragment>
                        ))}
                      </>
                    )}
                  </>}
            </ConfigSidebarList>
          </ConfigSidebar>

          <ConfigDetail>
            <ConfigDetailStack>
              {view === "mcp" && mcpImportOpen ? (
                <div className="pw-rowgap">
                  <div className="pw-inline">
                    <ConfigDetailTitle>{t("mcp.importTitle")}</ConfigDetailTitle>
                    <span className="pw-grow" />
                    <ConfigButton variant="ghost" size="small" onClick={() => setMcpImportOpen(false)}>{t("mcp.cancel")}</ConfigButton>
                  </div>
                  {/* fork:design-system —— 说明 / 加载 / 空态都是画板的 `.pw-alert info`
                      一行（画板 42 安装对话框的「安装会走 npx skills add」同款），
                      不再用自绘的 range-hint 类。 */}
                  <div className="pw-alert info">
                    <span className="pw-ico"><i data-ico="info" data-size="14"></i></span>
                    <span className="pw-grow">{t("mcp.importHint")}</span>
                  </div>
                  {mcpDiscovering && (
                    <div className="pw-alert info">
                      <span className="pw-ico"><i data-ico="loader-circle" data-size="14" className="pw-anim-spin"></i></span>
                      <span className="pw-grow">{t("i18n.loading")}</span>
                    </div>
                  )}
                  {!mcpDiscovering && mcpDiscovered.length === 0 && (
                    <div className="pw-alert info">
                      <span className="pw-ico"><i data-ico="info" data-size="14"></i></span>
                      <span className="pw-grow">{t("mcp.importEmpty")}</span>
                    </div>
                  )}
                  <div className="pw-pop">
                    {mcpDiscovered.map((server) => (
                      <div
                        key={`${server.path}:${server.name}`}
                        className="pw-prow"
                        style={{ opacity: server.shadowed || server.disabled ? 0.6 : 1 }}
                      >
                        <span className="pw-ico"><i data-ico="server" data-size="14"></i></span>
                        <span className="grow">
                          <b style={{ fontWeight: 500 }}>{server.name}</b>
                          <span className="pw-desc" style={{ display: "block" }}>
                            {server.tool} · {server.scope === "project" ? t("mcp.scopeProject") : t("mcp.scopeGlobal")}
                            {server.disabled ? ` · ${t("mcp.itemDisabled")}` : ""}
                            {server.shadowed ? ` · ${t("mcp.importShadowed")}` : ""}
                          </span>
                          {/* 命令行可能很长：单行省略是行为语义（pw 只有 .pw-litem 里有
                              ellipsis），保留最小 inline，没有可用的 pw 基件。 */}
                          <span className="pw-mono pw-dim" title={server.path} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {server.def.command ? `${server.def.command} ${(server.def.args as string[] | undefined)?.join(" ") ?? ""}`.trim() : String(server.def.url ?? server.def.socket ?? "")}
                          </span>
                        </span>
                        <ConfigButton
                          variant="secondary"
                          size="small"
                          disabled={mcpImporting === server.name || server.shadowed}
                          title={server.shadowed ? t("mcp.importShadowedTitle") : undefined}
                          onClick={() => void importDiscovered(server)}
                        >
                          {mcpImporting === server.name ? t("mcp.saving") : t("mcp.importOne")}
                        </ConfigButton>
                      </div>
                    ))}
                  </div>
                </div>
              ) : view === "mcp" ? (
                mcpAddMode ? (
                  <AddMcpServer
                    cwd={cwd}
                    scope={mcpScope}
                    projectResourcesLoaded={projectResourcesLoaded}
                    busy={mcpBusy}
                    actionError={mcpActionError}
                    initial={mcpEditTarget}
                    onScopeChange={setMcpScope}
                    onSave={(name, def) => void saveMcp(name, def)}
                    onFetchDef={fetchMcpDef}
                    onCancel={() => {
                      setMcpAddMode(false);
                      setMcpEditTarget(null);
                    }}
                  />
                ) : selectedMcp ? (
                  <McpServerDetail
                    key={selectedMcp.name}
                    server={selectedMcp}
                    cwd={cwd}
                    busy={mcpBusy || mcpTesting === selectedMcp.name}
                    actionError={mcpActionError}
                    actionMessage={mcpActionMessage}
                    onToggle={() => void toggleMcp(selectedMcp)}
                    onRemove={() => void removeMcp(selectedMcp)}
                    onMove={() => void moveMcp(selectedMcp)}
                    onTest={() => void testMcp(selectedMcp)}
                    onEdit={() => {
                      setMcpEditTarget(selectedMcp);
                      // The scope switch has to follow the server being edited: `update`
                      // writes into whichever scope the switch reports, so leaving it at the
                      // default would silently COPY the definition (env values included) into
                      // the other scope's mcp.json while the original stayed untouched.
                      setMcpScope(selectedMcp.scope);
                      setMcpAddMode(true);
                      setMcpActionError(null);
                      setMcpActionMessage(null);
                    }}
                    authActions={renderMcpAuthActions?.(selectedMcp)}
                  />
                ) : (
                  <ConfigEmptyState>{t("mcp.emptyDetail")}</ConfigEmptyState>
                )
              ) : addMode ? (
              <AddPluginPanel
                cwd={cwd}
                source={installSource}
                scope={installScope}
                projectResourcesLoaded={projectResourcesLoaded}
                busy={addBusy}
                actionError={actionError}
                onSourceChange={setInstallSource}
                onScopeChange={setInstallScope}
                onInstall={installPlugin}
              />
            ) : loading ? null : selectedExtension ? (
              <StandaloneExtensionDetail extension={selectedExtension} />
            ) : selectedPackage ? (
              <PackageDetail
                key={packageKey(selectedPackage)}
                pkg={selectedPackage}
                cwd={cwd}
                busyKey={busyKey}
                actionError={actionError}
                actionMessage={actionMessage}
                sessionId={sessionId}
                updateStatus={updateStatuses[packageKey(selectedPackage)]}
                checkingUpdate={checkingUpdates.has(packageKey(selectedPackage))}
                updateError={updateError}
                onAction={runAction}
                onCheckUpdate={() => void checkForUpdates(selectedPackage)}
                onReloadSession={reloadSession}
              />
              ) : (
                <ConfigEmptyState>{t("i18n.selectPackage")}</ConfigEmptyState>
              )}
            </ConfigDetailStack>
          </ConfigDetail>
        </ConfigSplitView>
      </SettingsPage>
    </ConfigPanelShell>
  );
}
