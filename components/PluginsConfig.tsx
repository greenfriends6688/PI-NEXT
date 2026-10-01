"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import type { McpResponse, McpScope, McpServerInfo, PluginPackageInfo, PluginStandaloneExtensionInfo, PluginUpdateResult, PluginsResponse } from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
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
  ConfigSidebarGroupStatus,
  ConfigSidebarGroupSwitch,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSectionTitle,
  ConfigSplitView,
  ConfigStatusDot,
  ConfigSwitch,
  SettingsPage,
  itemsToSwitch,
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

/**
 * fork:group-switch（G4 · 上游 `eceac13` #1020 + `b9622a1` #1021）——
 * 一个作用域的分组开关会改动的包：还没处在目标状态的那些。
 *
 * 「关掉」会额外排除**带资源过滤的包**（`keepOn`）：停用一个包是把它的
 * extensions / skills / prompts / themes 全写成空数组
 * （`app/api/plugins/route.ts:setPackageDisabled`），没有任何东西会把过滤条件
 * 存回去 —— 「全部停用」再「全部启用」就会静默抹掉它。所以这种包保持启用，
 * 由调用方如实报出去，只能用它自己的开关处理。独立扩展没有开关，不在这里。
 */
export function packagesToSwitch<T extends Pick<PluginPackageInfo, "disabled" | "filtered">>(
  packages: readonly T[],
  enabled: boolean,
): T[] {
  return itemsToSwitch(packages, enabled, (pkg) => !pkg.disabled, (pkg) => pkg.filtered);
}

/** 分组开关「关掉」时保持启用的包（带资源过滤的那些）。 */
export function filteredPackagesKeptOn<T extends Pick<PluginPackageInfo, "disabled" | "filtered">>(
  packages: readonly T[],
): T[] {
  return packages.filter((pkg) => !pkg.disabled && pkg.filtered);
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
    <ConfigDetailStack className="fork-pwa-detail">
      <div className="pw-rowgap">
        <div className="pw-inline">
          <ConfigDetailTitle>{t("i18n.addPlugin")}</ConfigDetailTitle>
          <span className="pw-grow" />
          {/* fork:design-system（2026-10-01）—— 这里原来是一枚手绘的 npm logo SVG
              （28px + `fill="#000"` 字面色）；设计系统只认 sprite 的 lucide 图标
              （`<i data-ico>`，禁手绘 SVG），换成同一语境的 package 图标。 */}
          <a
            href="https://pi.dev/packages"
            target="_blank"
            rel="noopener noreferrer"
            className="pw-mono pw-dim"
          >
            <span className="pw-ico"><i data-ico="package" data-size="14"></i></span>
            pi.dev/packages
          </a>
        </div>
        <span className="pw-mono pw-dim">
          {installLocation(scope, cwd)}
        </span>
      </div>

      <ConfigField label={t("plugins.sourceLabel")}>
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

      <div className="pw-inline fork-pwa-acts">
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
        <ConfigSectionTitle>{t("plugins.examples")}</ConfigSectionTitle>
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
    <ConfigDetailStack className="fork-pwa-detail">
      <ConfigDetailHeader className="fork-pwa-head">
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
    <ConfigDetailStack className="fork-pwa-detail">
      <ConfigDetailHeader className="fork-pwa-head">
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

/** fork:design-system（画板 62 落位表 + 画板 43）—— MCP 详情的行式字段：
 *  标签左 / 值右。画板的 `.pw-field` 控件侧放的是可编辑控件，这里放只读等宽串，
 *  而参数 / env / JSON 可能很长：值要能收缩折行 —— `minWidth: 0` 是门禁放行的 0 值，
 *  `overflowWrap` 折行是行为语义（flex 子项默认 `min-width:auto` 顶破卡片），
 *  不是画板外观。 */
function McpReadonlyField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <ConfigField label={label}>
      <span className="pw-mono" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {value}
      </span>
    </ConfigField>
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
    <ConfigDetailStack className="fork-pwa-detail">
      <ConfigDetailHeader className="fork-pwa-head">
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

      {/* fork:design-system（画板 62 落位表）—— MCP 详情的属性表从 `.pw-kv` 的
          dt/dd 改成画板 43 的 `.pw-field` 行式字段（标签左 / 值右）。整组包一层
          普通块：`.pw-field + .pw-field` 的发丝线要靠相邻兄弟连续，拆散进
          ConfigDetailStack 的网格会把行距撑成 s3。 */}
      <div>
        <McpReadonlyField label={t("mcp.fieldType")} value={server.kind} />
        <McpReadonlyField
          label={
            server.kind === "url"
              ? t("mcp.kindUrl")
              : server.kind === "socket"
                ? t("mcp.kindSocket")
                : t("mcp.kindCommand")
          }
          value={target ?? "—"}
        />
        {server.kind === "command" && (
          <McpReadonlyField
            label={t("mcp.fieldArgs")}
            value={server.args.length ? server.args.join(" ") : "—"}
          />
        )}
        <McpReadonlyField
          label={t("mcp.fieldEnv")}
          value={server.envKeys.length ? server.envKeys.join(", ") : "—"}
        />
        <McpReadonlyField
          label={t("mcp.fieldOptions")}
          value={Object.keys(server.options).length ? JSON.stringify(server.options) : "—"}
        />
        <McpReadonlyField label={t("mcp.fieldSource")} value={shortenPath(server.source)} />
        <McpReadonlyField label={t("mcp.fieldCwd")} value={shortenPath(cwd)} />
      </div>

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
    <ConfigDetailStack className="fork-pwa-detail">
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

      <div className="pw-inline fork-pwa-acts">
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

/** fork:design-system（画板 43「从其它 agent 导入」帧 + 画板 50 对话框）——
 *  导入从详情列的内联视图改成画板的 pw-modal 弹层：
 *  `.pw-modal-head`（import 图标 + 标题 + 关闭）› `.pw-modal-body`（说明 + 来源
 *  芯片 + `.pw-sep` + `.pw-prow` 行）› `.pw-modal-foot`（计数 + 取消）。
 *  覆盖层的 fixed / 层级画板没有产品等价物（`.pw-scrim` 已被皮肤工作室接线占用
 *  z 序），照 ModelsConfig 的先例保留这组行为 inline。画板 62 上轮裁定：导入要
 *  模态，不再占详情列。
 *
 *  fork:settings-modal-scroll —— 弹层壳另外补了三处滚动语义（实测数据见下）。
 *  画板 50 的 `.pw-modal`（board.css:631）是 **560 定宽、height:auto 的普通确认框**，
 *  产品这个弹层的内容行数是数据（一次能扫到十几个 MCP server），于是：
 *   ① 壳没有高度上限 → `.pw-modal`（`overflow:hidden`）比视口高（900 视口下实测
 *      991px，上下各溢出 45px），底部 `.pw-modal-foot` 被裁在视口外；
 *   ② `.pw-modal-body` 虽然有 `overflow-y:auto`（board.css:643），但它的 height 是
 *      auto = 内容高（实测 clientHeight 887 === scrollHeight 887），**滚动容器没有
 *      确定高度就永远不会滚** —— 用户看到的正是「列了一长串、滑不动」；
 *   ③ `.pw-modal-body` 是 `display:grid`，列宽 auto 取 min-content：导入行里那行
 *      `white-space:nowrap` 的命令行把整条轨道顶到 825px（实测 scrollWidth 857 vs
 *      clientWidth 558），于是连**横向**都溢出，壳 `overflow:hidden` 把右端的
 *      「导入」按钮裁掉。
 *  修法（照 DirectoryPicker.tsx:228/257 的既有写法：壳 inline 一个视口上限 + flex 列，
 *  内容行 `flex:1; min-height:0`）：壳 maxHeight 吃视口、内容行成为唯一的滚动容器、
 *  网格列改 `minmax(0,1fr)` 让行宽回到壳内（长命令在行内单行省略，`.grow` 的
 *  `min-width:0` 已在位）。head / foot 不参与滚动，永远可见。 */
function McpImportModal({
  open,
  discovering,
  discovered,
  importing,
  actionError,
  actionMessage,
  onDismiss,
  onImport,
}: {
  open: boolean;
  discovering: boolean;
  discovered: DiscoveredMcpServer[];
  importing: string | null;
  /** 与详情列共用的动作反馈：弹层开着时失败 / 成功也要在弹层里可见。 */
  actionError: string | null;
  actionMessage: string | null;
  onDismiss: () => void;
  onImport: (server: DiscoveredMcpServer) => void;
}) {
  const { t } = useI18n();
  // fork:dsn-dialog-a11y —— 打开移焦、Tab 循环、Esc 关闭、背景 inert。
  const { dialogRef, dialogProps } = useDialogA11y({ open, onClose: onDismiss });
  if (!open) return null;

  // 画板 43 的来源芯片行：`Claude Code · 4`。计数从发现结果按来源 agent 聚合；
  // 「未找到」的来源服务端不返回（只能列找到的），芯片一律带 check。
  const sourceCounts = new Map<string, number>();
  for (const server of discovered) {
    sourceCounts.set(server.tool, (sourceCounts.get(server.tool) ?? 0) + 1);
  }

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={t("mcp.importTitle")}
      /* fork:pwa-plugins-agents（手机档）—— 覆盖层的 fixed / 层级 / 居中从 inline
         搬进 `.fork-pwa-import-scrim`（值逐条照抄，桌面渲染零变化），手机档才能
         把它从「居中对话框」改成贴底的全屏 sheet —— inline 样式是 CSS 压不过的。 */
      className="fork-pwa-import-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        className="pw-modal fork-pwa-import"
        /* fork:settings-modal-scroll —— 壳要一个确定的高度上限，内容行才有确定的
           可视高度可滚。`- 32px` 是视口边距（沿用 ChatWindow / FileViewer 的
           `calc(var(--app-viewport-height, 100dvh) - 16px)` 写法，留两倍呼吸）。
           maxWidth 同理：560 是画板给桌面确认框的定宽，窄视口下壳不该顶出屏幕。
           fork:pwa-plugins-agents —— 同样搬进 `.fork-pwa-import`（桌面值不变）。 */
      >
        <div className="pw-modal-head">
          <span className="pw-ico"><i data-ico="import" data-size="16"></i></span>
          {t("mcp.importTitle")}
          <span className="pw-grow" aria-hidden="true" />
          <button
            type="button"
            className="pw-iconbtn"
            onClick={onDismiss}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
          >
            <span className="pw-ico"><i data-ico="x" data-size="14"></i></span>
          </button>
        </div>

        {/* fork:settings-modal-scroll —— `flex:1 + min-height:0` 让内容行吃满
            「壳高 − 头 − 脚」，剩下的高度就是它的滚动区（board.css:643 已给
            `overflow-y:auto`）；`minmax(0,1fr)` 把网格列从 min-content 收成壳宽，
            长命令行在行内单行省略而不是把壳顶宽。 */}
        <div className="pw-modal-body" style={{ flex: "1 1 0%", minHeight: 0, gridTemplateColumns: "minmax(0, 1fr)" }}>
          <p className="pw-hint">{t("mcp.importHint")}</p>
          {sourceCounts.size > 0 && (
            <>
              <div className="pw-wrap">
                {[...sourceCounts.entries()].map(([tool, count]) => (
                  <span key={tool} className="pw-chip">
                    <span className="pw-ico"><i data-ico="check" data-size="12"></i></span>
                    {tool} · {count}
                  </span>
                ))}
              </div>
              <div className="pw-sep" aria-hidden="true" />
            </>
          )}
          {discovering ? (
            <div className="pw-alert info">
              <span className="pw-ico"><i data-ico="loader-circle" data-size="14" className="pw-anim-spin"></i></span>
              <span className="pw-grow">{t("i18n.loading")}</span>
            </div>
          ) : discovered.length === 0 ? (
            <div className="pw-alert info">
              <span className="pw-ico"><i data-ico="info" data-size="14"></i></span>
              <span className="pw-grow">{t("mcp.importEmpty")}</span>
            </div>
          ) : (
            discovered.map((server) => (
              <div
                key={`${server.path}:${server.name}`}
                className="pw-prow"
                /* 画板 43 弱化行（已禁用 / 被同名条目遮蔽）的 `opacity:.55`
                   原样 inline —— 画板自身就是这个写法。 */
                style={server.shadowed || server.disabled ? { opacity: 0.55 } : undefined}
              >
                <span className="pw-ico"><i data-ico="server" data-size="14"></i></span>
                {/* grow 允许收缩（flex 子项默认 min-width:auto），下面命令行的
                    单行省略才接得住长值；0 是门禁放行值。 */}
                <span className="grow" style={{ minWidth: 0 }}>
                  {/* 画板 43 导入行的名字就是 `<b style="font-weight:500">`
                      原样 inline（b 默认 700，画板要 500）。 */}
                  <b style={{ fontWeight: 500 }}>{server.name}</b>
                  <div className="pw-desc">
                    {server.tool} · {server.scope === "project" ? t("mcp.scopeProject") : t("mcp.scopeGlobal")}
                  </div>
                  {/* 命令行可能很长：单行省略是行为语义（board.css 只在
                      .pw-litem 这类具体语境里给 ellipsis），没有可用的 pw 基件，
                      保留最小 inline。 */}
                  <div
                    className="pw-mono pw-dim"
                    title={server.path}
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {server.def.command
                      ? `${server.def.command} ${(server.def.args as string[] | undefined)?.join(" ") ?? ""}`.trim()
                      : String(server.def.url ?? server.def.socket ?? "")}
                  </div>
                </span>
                {/* 画板 43：同名冲突给 warning 徽章而不是阻止；已禁用给中性徽章。 */}
                {server.shadowed && (
                  <ConfigBadge tone="warn">{t("mcp.importShadowed")}</ConfigBadge>
                )}
                {server.disabled && <ConfigBadge>{t("mcp.itemDisabled")}</ConfigBadge>}
                <ConfigButton
                  variant="secondary"
                  size="small"
                  disabled={importing === server.name || server.shadowed}
                  title={server.shadowed ? t("mcp.importShadowedTitle") : undefined}
                  onClick={() => onImport(server)}
                >
                  {importing === server.name ? t("mcp.saving") : t("mcp.importOne")}
                </ConfigButton>
              </div>
            ))
          )}
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
        </div>

        <div className="pw-modal-foot">
          <span className="pw-hint">{t("mcp.count", { count: String(discovered.length) })}</span>
          <span className="pw-grow" aria-hidden="true" />
          <ConfigButton onClick={onDismiss}>{t("mcp.cancel")}</ConfigButton>
        </div>
      </div>
    </div>
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
  /* fork:group-switch（G4）—— 上一次分组开关没做完的部分，报在刚跑过的那一组标题下：
     `note` = 保持启用的带过滤包数量，`lines` = 被路由拒掉的包。 */
  const [groupStatus, setGroupStatus] = useState<{ scope: PluginScope; note?: string; lines: string[] } | null>(null);
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
    setGroupStatus(null);
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
        setActionMessage(t("plugins.removed"));
        setUpdateStatuses((current) => {
          const nextStatuses = { ...current };
          delete nextStatuses[key];
          return nextStatuses;
        });
      } else {
        const messages: Record<Exclude<PluginAction, "remove">, string> = {
          install: t("plugins.installed"),
          update: t("plugins.updated"),
          disable: t("plugins.disabled"),
          enable: t("plugins.enabled"),
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

  /* fork:group-switch（G4）—— 一个作用域的分组开关：包里全部启用 / 全部停用。
     我们没有上游那个 `packages: [...]` 批量路由（`POST /api/plugins` 只收一个
     `source`，而路由不在本文件边界内），所以按 `packagesToSwitch` 算出的目标
     **逐条**发：每个包一次 settings.json 的 flush，串行执行才不互相踩。
     每条都是全量 `PluginsResponse` 返回，所以直接拿最后一次成功的响应当列表状态，
     不用再拉一次。被拒的包保持原状，报在该组标题下。 */
  const setGroupPackages = useCallback(async (
    scope: PluginScope,
    groupPackages: PluginPackageInfo[],
    enabled: boolean,
  ) => {
    const targets = packagesToSwitch(groupPackages, enabled);
    const keptOn = enabled ? 0 : filteredPackagesKeptOn(groupPackages).length;
    const note = keptOn > 0 ? t("plugins.groupKeptFiltered", { count: keptOn }) : undefined;
    setActionError(null);
    setActionMessage(null);
    setGroupStatus(null);
    if (targets.length === 0) {
      if (note) setGroupStatus({ scope, note, lines: [] });
      return;
    }
    const action = enabled ? "enable" : "disable";
    setBusyKey(`group:${scope}`);
    let lastPayload: PluginsResponse | null = null;
    const failures: string[] = [];
    try {
      for (const pkg of targets) {
        try {
          const res = await fetch("/api/plugins", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, source: pkg.source, scope: pkg.scope, cwd }),
          });
          const next = (await res.json().catch(() => ({}))) as PluginsResponse & { error?: string };
          if (!res.ok || next.error) {
            failures.push(`${pkg.source}: ${next.error ?? `HTTP ${res.status}`}`);
            continue;
          }
          lastPayload = next;
        } catch (err) {
          failures.push(`${pkg.source}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (lastPayload) {
        setData(lastPayload);
        const message = enabled ? t("plugins.groupEnabled") : t("plugins.groupDisabled");
        setActionMessage(sessionId ? `${message} ${t("agents.reloadRequired")}` : message);
      }
      setGroupStatus({
        scope,
        note,
        lines: failures.length > 0
          ? [
              t("plugins.groupFailed", { count: failures.length, total: targets.length }),
              ...failures,
            ]
          : [],
      });
    } finally {
      setBusyKey(null);
    }
  }, [cwd, sessionId, t]);

  const installPlugin = useCallback(async () => {
    const source = normalizePluginSourceInput(installSource).trim();
    if (!source) return;
    setInstallSource(source);
    const key = `${installScope}\0${source}`;
    setBusyKey(`install:${key}`);
    setActionError(null);
    setActionMessage(null);
    setGroupStatus(null);
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
      setActionMessage(t("plugins.installed"));
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
    setGroupStatus(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      onReloaded?.();
      await loadPlugins();
      setActionMessage(t("plugins.sessionReloaded"));
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
          （`only="mcp"` 模式没把它一起关掉）。现在统计进等宽徽章，
          动作按级别归位，页脚不再存在。

          fork:mcp-head-actions —— MCP 分节**不再有工具栏那一行**：它原来只有
          「N 个服务器」徽章 + 「刷新」两枚东西，被 `.pw-stools`（board.css:698，
          定高 40px + 下边框）撑成一整行，右边一小块、左边一大片空。画板 43 的 MCP
          帧（146–149 行）把计数徽章放在 `.pw-shead-acts` 的**第一位**，primary 的
          「添加服务器」收在最后一位，中间是 outline 的「从其它 agent 导入」；画板 62
          帧 B 的工具栏示例也写着「列表级 · 与计数同排」。所以这里照抄画板 43 的顺序：
          计数徽章 › 刷新 › 导入 › 添加MCP，间距由 `.pw-shead-acts{gap:var(--s2)}`
          （board.css:696）承担，不另加 margin。刷新带 refresh-cw 图标，跟同一排的
          两枚按钮对齐（画板 43:148-149 / 画板 62:146，页头动作都是「图标 + 文案」）。
          〔有意偏离〕SettingsUi 的 actions 契约写「页级动作最多 2 个（1 主 1 次）」：
          这里页头是「1 徽章 + 3 钮」（徽章不是动作）。依据是画板 43 的 MCP 帧本身
          就把徽章放进 `.pw-shead-acts`，加上用户明确要求「计数与刷新并进页头、
          删掉那一整行」；实测 1440 下这排只占 325px（x1075–1400），间距恒 8px，
          900px 窄视口下也仍是单行不换行（`.pw-shead-acts` 是 `flex-wrap:nowrap`）。 */}
      <SettingsPage
        title={mcpOnly ? t("mcp.sectionTitle") : t("common.plugins")}
        sub={mcpOnly ? t("mcp.pageSub") : t("plugins.pageSub")}
        actions={
          mcpOnly ? (
            <>
              {/* 画板 43:147 —— 计数徽章是 `.pw-shead-acts` 的第一枚，不是页头文案：
                  「这页是干嘛的」归 p.sub，数据归徽章（SettingsUi 的 actions 契约）。 */}
              <ConfigBadge tone="count">{t("mcp.count", { count: String(mcpData?.servers.length ?? 0) })}</ConfigBadge>
              {/* fix:mcp-refresh-target —— 位置从工具栏搬进页头动作，行为不变：
                  它原来调 loadPlugins()（只打 /api/plugins、写插件页状态，于是列表、
                  徽章、错误态都不动），MCP 模式调 loadMcp()，置灰跟 MCP 自己的状态
                  （加载中 / MCP 动作在飞），不被插件页的 loading 牵连。 */}
              <ConfigButton
                variant="secondary"
                size="small"
                onClick={() => void loadMcp()}
                disabled={mcpLoading || mcpBusy}
              >
                <span className="pw-ico"><i data-ico="refresh-cw" data-size="13" aria-hidden="true" /></span>
                {t("i18n.refresh")}
              </ConfigButton>
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
                  /* fork:settings-frame（画板 62 帧 D）—— 页级动作只有「1 主 + 1 次」：
                     添加插件是 primary，检查更新恒为 outline。有可用更新时也不抢主色
                     —— 数量进按钮文案，行内还有箭头徽标提醒。 */
                  variant="secondary"
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
        /* fork:mcp-head-actions —— MCP 分节没有工具栏（画板 43 的 MCP 帧在页头与
           内容区之间没有 `.pw-stools`），省略 prop 即不渲染那一行（SettingsUi:442）。
           插件分节的工具栏原样保留：诊断徽章 + 资源计数 + 刷新，那一枚刷新继续调
           loadPlugins()、置灰跟 footerBusy —— 与 MCP 那枚是两回事。 */
        toolbar={mcpOnly ? undefined : (
          <>
            <span className="pw-grow" aria-hidden="true" />
            {data?.diagnostics.length ? (
              <ConfigBadge
                tone={data.diagnostics.some((d) => d.type === "error") ? "bad" : "warn"}
                title={data.diagnostics.map((d) => `${d.type}: ${d.source ? `${d.source}: ` : ""}${d.message}`).join("\n")}
              >
                {t("plugins.diagnostics", { count: data.diagnostics.length })}
              </ConfigBadge>
            ) : null}
            <ConfigBadge tone="count">
              {data ? `${data.totals.extensions} ext · ${data.totals.skills} skills` : ""}
            </ConfigBadge>
            <ConfigButton size="small" onClick={() => void loadPlugins()} disabled={footerBusy}>
              {t("i18n.refresh")}
            </ConfigButton>
          </>
        )}
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
                  {/* 这里原来是硬编码的 "Loading..."；i18n.loading 三语值就是它。 */}
                  <span className="pw-grow">{t("i18n.loading")}</span>
                </div>
              ) : error ? (
                <div className="pw-alert">
                  <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
                  <span className="pw-grow">{error}</span>
                </div>
              ) : packages.length === 0 && standaloneExtensions.length === 0 ? (
                /* fork:settings-frame（画板 62 帧 D）—— 列表空态落在列表列内：
                   记号图标 + 一句，不再是一行 pw-alert 飘字。 */
                <ConfigEmptyState>
                  <span className="mark"><i data-ico="blocks" data-size="16" aria-hidden="true" /></span>
                  <p>No plugins configured</p>
                </ConfigEmptyState>
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
                            {/* fork:design-system —— 行文本包进画板 `.pw-litem .grow`
                                （flex:1 + 省略号生效的前提）；停用走 `.pw-dim`
                                （AgentsConfig 同款），is-grow/is-muted 已随旧族退役。 */}
                            <span className="grow">
                              <ConfigSidebarText className={extension.enabled ? undefined : "pw-dim"}>
                                {extension.name}
                              </ConfigSidebarText>
                            </span>
                          </ConfigSidebarItem>
                        );
                      })}
                    </>
                  )}
                  {groupedPackages.map((group) => {
                    /* fork:group-switch（G4）—— 标题右侧是 `n/m` + 整组开关；
                       只有全开才算开（部分开的组读起来是「关」，点一下补齐）。 */
                    const enabledCount = group.packages.filter((pkg) => !pkg.disabled).length;
                    const allEnabled = enabledCount === group.packages.length;
                    return (
                      <Fragment key={group.scope}>
                        <ConfigSidebarGroupLabel
                          aside={
                            <ConfigSidebarGroupSwitch
                              enabled={enabledCount}
                              total={group.packages.length}
                              disabled={footerBusy}
                              loading={busyKey === `group:${group.scope}`}
                              label={t(allEnabled ? "plugins.groupSwitchDisable" : "plugins.groupSwitchEnable", { group: group.scope })}
                              onChange={(enabled) => void setGroupPackages(group.scope, group.packages, enabled)}
                            />
                          }
                        >
                          {group.scope}
                        </ConfigSidebarGroupLabel>
                        {groupStatus?.scope === group.scope && (
                          <ConfigSidebarGroupStatus note={groupStatus.note} errorLines={groupStatus.lines} />
                        )}
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
                              <span className="grow">
                                <ConfigSidebarText className={pkg.disabled ? "pw-dim" : undefined}>
                                  {pkg.source}
                                </ConfigSidebarText>
                              </span>
                              {updateStatuses[packageKey(pkg)]?.state === "update-available" && (
                                <span title={t("i18n.updateAvailable")} className="pw-ico">
                                  <i data-ico="arrow-up" data-size="12"></i>
                                </span>
                              )}
                            </ConfigSidebarItem>
                          );
                        })}
                      </Fragment>
                    );
                  })}
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
                      /* fork:settings-frame（画板 62 帧 D）—— 列表空态落在列表列内。 */
                      <ConfigEmptyState>
                        <span className="mark"><i data-ico="server" data-size="16" aria-hidden="true" /></span>
                        <p>{t("mcp.emptyList")}</p>
                      </ConfigEmptyState>
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
                                  <span className="grow">
                                    <ConfigSidebarText className={server.disabled ? "pw-dim" : undefined}>
                                      {server.name}
                                    </ConfigSidebarText>
                                  </span>
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
            {/* fork:pwa-plugins-agents（手机档）—— `fork-pwa-detail` 是这台面板的
                作用域钩子：把产品侧接线里那条只在并排两列成立的 `height: 100%`
                在手机档还给内容，滚动仍然只有内容区一个（规则见
                app/pwa-plugins-agents.css 第 2 节）。桌面端该类不参与任何布局。 */}
            <ConfigDetailStack className="fork-pwa-detail">
              {/* fork:design-system（画板 62 上轮裁定）—— 「从其它 agent 导入」是
                  pw-modal 弹层（见下方 McpImportModal），不再占详情列；导入弹层开着
                  时详情列保持原内容。 */}
              {view === "mcp" ? (
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
                  /* fork:settings-frame（画板 62 帧 D）—— 详情未选：40px 方框记号 +
                     一句引导，居中（mark 的 40px 几何在 board.css）。 */
                  <ConfigEmptyState>
                    <span className="mark"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" /></span>
                    <p>{t("mcp.emptyDetail")}</p>
                  </ConfigEmptyState>
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
                /* fork:settings-frame（画板 62 帧 D）—— 详情未选：40px 方框记号 +
                   一句引导，居中。 */
                <ConfigEmptyState>
                  <span className="mark"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" /></span>
                  <p>{t("i18n.selectPackage")}</p>
                </ConfigEmptyState>
              )}
            </ConfigDetailStack>
          </ConfigDetail>
        </ConfigSplitView>
      </SettingsPage>

      {/* fork:design-system（画板 43 导入帧）—— 导入弹层。挂在 SettingsPage 的
          兄弟位（config-panel-surface 的直接子元素），useDialogA11y 的兄弟 inert
          才能罩住页头 / 工具栏 / 内容区整片。 */}
      <McpImportModal
        open={mcpImportOpen}
        discovering={mcpDiscovering}
        discovered={mcpDiscovered}
        importing={mcpImporting}
        actionError={mcpActionError}
        actionMessage={mcpActionMessage}
        onDismiss={() => setMcpImportOpen(false)}
        onImport={(server) => void importDiscovered(server)}
      />
    </ConfigPanelShell>
  );
}
