"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import type { McpReloadReport, McpResponse, McpScope, McpServerInfo, PluginPackageInfo, PluginStandaloneExtensionInfo, PluginUpdateResult, PluginsResponse } from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
// fork:v5-d13-frame-a —— 行尾「更多」与卸载确认都走既有的浮窗菜单（键盘导航 /
// 边缘翻转 / 外面点击关闭都已经在那儿），不另画一个下拉。
import { useContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { useIsMobile } from "@/hooks/useIsMobile";
// 行级动作菜单复用 ContextMenu（键盘导航 / 边缘翻转 / 外面点击关闭都在那儿）。
import { isRemoteMcpServer } from "@/lib/mcp-auth-command-shared";
import { localCopy, type LocalCopy } from "./settings-disabled-reasons";
// fork:mcp-native-exposure —— 「查看 MCP 日志」弹层（读 agent 目录的 mcp.log）。
import { McpLogModal } from "./fork/McpLogModal";
// fork:codemode-settings-ui —— 「代码模式」设置块（自动/始终、mode、工具清单预算）。
import { McpCodemodeSettings } from "./fork/McpCodemodeSettings";
// fork:mcp-paste —— 粘贴添加面板。
import { McpPastePanel } from "./fork/McpPastePanel";
import type { McpImportFieldValue } from "@/lib/mcp-import";
import type { McpDiscoveredServer as DiscoveredMcpServer } from "@/lib/mcp-discovery";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import {
  ConfigPanelShell,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSplitView,
  SettingsPage,
  itemsToSwitch,
} from "./SettingsUi";

/* fork:v5-skin-d-only —— 本地内容基件只吐 d-*（同 SkillsConfig 的同名块）。
 * 页壳 / 列表基件（SettingsPage / ConfigPanelShell / ConfigSplitView / ConfigSidebar /
 * ConfigSidebarList / ConfigSidebarItem / ConfigSidebarText / ConfigSidebarGroupLabel）
 * 仍走 SettingsUi；其余内容控件在本文件用画板类落地。 */function Btn({
  variant = "secondary",
  size = "default",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "small" | "default";
}) {
  const variantClass = variant === "primary" ? "primary"
    : variant === "secondary" ? "outline"
    : variant === "danger" ? "danger"
    : "";
  return (
    <button
      type="button"
      {...props}
      className={["d-btn", variantClass, size === "small" ? "sm" : "", className].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}
function Badge({ tone, className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: string }) {
  return <span {...props} className={["d-badge", tone ?? "", className].filter(Boolean).join(" ")} />;
}
function Switch({ checked, disabled = false, loading = false, label, onChange }: { checked: boolean; disabled?: boolean; loading?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={loading || undefined}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={`d-switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    />
  );
}
function Stack({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className={["d-col", className].filter(Boolean).join(" ")} style={{ gap: "var(--nx-sp-3)", ...style }}>
      {children}
    </div>
  );
}
function Title({ children }: { children: ReactNode }) {
  return <h3 className="d-t-title" style={{ margin: 0 }}>{children}</h3>;
}
function Row({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={["d-row", className].filter(Boolean).join(" ")}>{children}</div>;
}
function RowGrow({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={["d-row", "d-grow", className].filter(Boolean).join(" ")}>{children}</div>;
}
function Field({ label, hint, children, style }: { label: ReactNode; hint?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="d-set-row" style={style}>
      <div className="d-set-row-box">
        <div className="d-set-row-t">{label}</div>
        {hint ? <div className="d-set-row-s">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}
function StatusDot({ active, color }: { active?: boolean; color?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`d-dot${active ? " run" : active === false ? " pending" : ""}`}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}
function EmptyState({ children }: { children: ReactNode }) {
  return <div className="d-empty compact">{children}</div>;
}
function GroupSwitch({
  enabled,
  total,
  label,
  disabled = false,
  loading = false,
  onChange,
}: {
  enabled: number;
  total: number;
  label: string;
  disabled?: boolean;
  loading?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <>
      <span className="d-grow" aria-hidden="true" />
      <span className="d-mono d-t-faint">{`${enabled}/${total}`}</span>
      <button
        type="button"
        role="switch"
        aria-checked={total > 0 && enabled === total}
        aria-busy={loading || undefined}
        aria-label={label}
        title={label}
        disabled={disabled || loading}
        className={`d-switch${total > 0 && enabled === total ? " on" : ""}`}
        onClick={() => onChange(!(total > 0 && enabled === total))}
      />
    </>
  );
}
function GroupStatus({ note, errorLines }: { note?: ReactNode; errorLines?: readonly string[] }) {
  if (!note && !errorLines?.length) return null;
  return (
    <>
      {note ? (
        <div role="status" className="d-banner info">
          <i data-ico="info" data-size="13" aria-hidden="true"></i>
          <span className="d-grow">{note}</span>
        </div>
      ) : null}
      {errorLines && errorLines.length > 0 ? (
        <div role="alert" className="d-banner err">
          <i data-ico="triangle-alert" data-size="13" aria-hidden="true"></i>
          <span className="d-grow">
            {errorLines.map((line, index) => (
              <Fragment key={`${index}:${line}`}>
                {index > 0 ? <br /> : null}
                {line}
              </Fragment>
            ))}
          </span>
        </div>
      ) : null}
    </>
  );
}

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
 * （`app/api/plugins/route.ts:setPackagesDisabled`），没有任何东西会把过滤条件
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

/** fork:bulk-routes（上游 `eceac13` #1020）—— 批量启停里**每一个**包的结果：
 *  `error` 为空即写成功，有值表示该包保持原状。与
 *  `app/api/plugins/route.ts` 的 `PluginToggleResult` 同形。 */
export interface PluginToggleResult {
  source: string;
  scope: PluginScope;
  error?: string;
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
      <div className="d-banner info">
        <i data-ico="info" data-size="14" aria-hidden="true"></i>
        <span className="d-grow">
          {pkg.disabled ? t("i18n.packageDisabled") : t("i18n.noResolvedResources")}
        </span>
      </div>
    );
  }

  // 画板 D-13 帧 C：每组资源一张 `.d-card`（`.d-card-head` 图标 + 标题，
  // `.d-card-body` 里逐行名称 + 相对路径），不再用 v1 的 pw-sec-title/pw-list。
  return (
    <div className="d-col">
      {groups.map((group) => (
        <div key={group.kind} className="d-card">
          <div className="d-card-head">
            <i data-ico={RESOURCE_ICONS[group.kind] ?? "blocks"} data-size="15" aria-hidden="true"></i>
            {group.label}
          </div>
          <div className="d-card-body d-col">
            {group.resources.map((resource) => (
              <div key={`${resource.kind}:${resource.path}`} className="d-row" title={resource.path}>
                <span className="d-mono d-grow">{resource.name}</span>
                <span className="d-t-xs d-t-faint">{resource.relativePath}</span>
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
    <Badge tone={scope === "project" ? "accent" : undefined}>
      {scope}
    </Badge>
  );
}

/** fork:v5-d13-frame-a —— 帧 A「来源」列：板面那一列是来源徽章（官方 / 社区 / 本地）。
 *  产品的来源串已经带了类型前缀（`npm:` / `git:` / 路径），所以徽章说类型、
 *  完整来源串进 title —— 列宽不会被一条长 URL 顶破。 */
function SourceTag({ pkg }: { pkg: PluginPackageInfo }) {
  const { t } = useI18n();
  const isNpm = pkg.source.startsWith("npm:");
  const isGit = pkg.source.startsWith("git:");
  return (
    <span title={pkg.source}>
      {isNpm ? (
        <Badge tone="info">
          <i data-ico="download" data-size="12" aria-hidden="true" />
          npm
        </Badge>
      ) : isGit ? (
        <Badge tone="warn">
          <i data-ico="git-branch" data-size="12" aria-hidden="true" />
          git
        </Badge>
      ) : (
        <Badge tone="mute">
          <i data-ico="folder" data-size="12" aria-hidden="true" />
          {t("plugins.localSource")}
        </Badge>
      )}
    </span>
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
    <div className="d-seg" role="radiogroup" aria-label={t("i18n.scope")}>
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
    </div>
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
    <Stack className="fork-pwa-detail">
      <div className="d-set-sec">
        <div className="d-row">
          <Title>{t("i18n.addPlugin")}</Title>
          <span className="d-grow" />
          {/* 设计系统只认 sprite 的 lucide 图标（`<i data-ico>`，禁手绘 SVG）。 */}
          <a
            href="https://pi.dev/packages"
            target="_blank"
            rel="noopener noreferrer"
            className="d-mono d-t-faint"
          >
            <i data-ico="package" data-size="14" aria-hidden="true"></i>
            pi.dev/packages
          </a>
        </div>
        <span className="d-mono d-t-faint">
          {installLocation(scope, cwd)}
        </span>
      </div>

      <div className="d-field">
        <span className="d-field-t">{t("plugins.sourceLabel")}</span>
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
          className="d-input d-mono"
          onKeyDown={(e) => {
            if (e.key === "Enter" && source.trim() && !busy) onInstall();
          }}
        />
      </div>

      <div className="d-row fork-pwa-acts">
        <SegmentedScope
          value={scope}
          projectResourcesLoaded={projectResourcesLoaded}
          onChange={onScopeChange}
        />
        <Btn
          variant="primary"
          onClick={onInstall}
          disabled={busy || !source.trim()}
          // fork:fix-disabled-title（2026-10-01）—— 禁用原因写 title。
          title={!source.trim() ? t("i18n.installNeedsSource") : undefined}
          className="is-pushed-right"
        >
          {busy ? t("i18n.installing") : t("i18n.install")}
        </Btn>
      </div>

      <div className="d-set-sec">
        <div className="d-set-sec-t">{t("plugins.examples")}</div>
        <div className="d-chips">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              className="d-chipbtn"
              onClick={() => onSourceChange(example)}
            >
              <i data-ico="package" data-size="12" aria-hidden="true"></i>
              <span className="d-mono">{example}</span>
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <div className="d-banner err">
          <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
          <span className="d-grow">{actionError}</span>
        </div>
      )}
    </Stack>
  );
}

/**
 * fork:v5-d13-frame-a —— 「状态」这一枚徽章（帧 A 的表格列与帧 C 的详情行共用）：
 * **更新态优先于加载态** —— 一个「可更新 1.6.0」的包当前仍然是 loaded，所以先答
 * 「有没有更新」，再答「加载了没有」。板面四档：最新 / 可更新 / 自装不检查更新 /
 * 已关掉。
 */
function packageStatusBadge(
  pkg: PluginPackageInfo,
  status: PluginUpdateResult | undefined,
  checking: boolean,
  t: ReturnType<typeof useI18n>["t"],
): ReactNode {
  if (checking) return <Badge>{t("i18n.checking")}</Badge>;
  if (status?.state === "update-available") {
    return (
      <Badge tone="warn" title={status.displayName}>
        <i data-ico="arrow-up" data-size="12" aria-hidden="true" />
        {t("i18n.updateAvailable")}
      </Badge>
    );
  }
  if (status?.state === "up-to-date") return <Badge tone="ok">{t("i18n.upToDate")}</Badge>;
  if (pkg.disabled) return <Badge tone="mute">{t("i18n.disabled")}</Badge>;
  if (status?.state === "error") {
    return <Badge tone="bad" title={status.message}>{status.message || t("i18n.checkFailed")}</Badge>;
  }
  if (status?.state === "unsupported") return <Badge tone="mute">{t("i18n.automaticChecksUnavailable")}</Badge>;
  // 板面把「自装 · 不检查更新」写成 mute 徽章：没有版本可升，只有换包。
  if (!pkg.canCheckForUpdates) return <Badge tone="mute">{t("i18n.automaticChecksUnavailable")}</Badge>;
  if (pkg.status === "missing") return <Badge tone="bad">{t("plugins.statusMissing")}</Badge>;
  if (pkg.status === "loaded") return <Badge tone="ok">{t("plugins.statusLoaded")}</Badge>;
  return <Badge tone="mute">{t("plugins.statusNoResources")}</Badge>;
}

/**
 * fork:v5-d13 —— 帧 A「插件」列与帧 C「来源」行的正文：**包与详情弹层共用一段**。
 * 桌面是弹层（M-05 的内联详情照旧），所以头（标题 / 动作 / 启停）与身（属性行 +
 * 已解析资源）分成两个件，头由各自的外壳摆。
 */
function PackageDetailBody({
  pkg,
  cwd,
  actionError,
  actionMessage,
  updateStatus,
  checkingUpdate,
  updateError,
}: {
  pkg: PluginPackageInfo;
  cwd: string;
  actionError: string | null;
  actionMessage: string | null;
  updateStatus?: PluginUpdateResult;
  checkingUpdate: boolean;
  updateError: string | null;
}) {
  const { t } = useI18n();
  const description = pkg.description?.trim();
  const canCheckForUpdates = pkg.canCheckForUpdates;
  const updateAvailable = updateStatus?.state === "update-available";

  return (
    <>
      {/* 画板 D-13：详情属性用 `.d-set-row`（左标签 / 右徽章或值）。 */}
      <div className="d-set-sec">
        {description && (
          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("i18n.description")}</div>
              <div className="d-set-row-s">{description}</div>
            </div>
          </div>
        )}
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("i18n.status")}</div>
          </div>
          <span className="d-grow-last">
            {packageStatusBadge(pkg, updateStatus, checkingUpdate, t)}
          </span>
        </div>
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("i18n.version")}</div>
            <div className="d-set-row-s d-mono">{versionSummary(pkg, t)}</div>
          </div>
          <span className="d-grow-last">
            {updateAvailable && (
              <Badge tone="warn" title={updateStatus.displayName}>
                {t("i18n.updateAvailable")}
              </Badge>
            )}
            {canCheckForUpdates && (checkingUpdate || (updateStatus && !updateAvailable)) && (
              <Badge
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
              </Badge>
            )}
            {updateError && <Badge tone="bad">{updateError}</Badge>}
          </span>
        </div>
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("i18n.package")}</div>
            <div className="d-set-row-s d-mono">{pkg.packageName ?? t("i18n.unknown")}</div>
          </div>
        </div>
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("i18n.resources")}</div>
            <div className="d-set-row-s">{resourceSummary(pkg, t)}</div>
          </div>
        </div>
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("i18n.installedPath")}</div>
            <div className="d-set-row-s d-mono">{pkg.installedPath ? shortenPath(pkg.installedPath) : t("i18n.notFound")}</div>
          </div>
        </div>
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("i18n.cwd")}</div>
            <div className="d-set-row-s d-mono">{shortenPath(cwd)}</div>
          </div>
        </div>
      </div>

      <div className="d-set-sec">
        <div className="d-set-sec-t">{t("i18n.resolvedResources")}</div>
        <ResourceList pkg={pkg} />
      </div>

      {actionMessage && (
        <div className="d-banner info">
          <i data-ico="check" data-size="14" aria-hidden="true"></i>
          <span className="d-grow">{actionMessage}</span>
        </div>
      )}
      {actionError && (
        <div className="d-banner err">
          <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
          <span className="d-grow">{actionError}</span>
        </div>
      )}
    </>
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
  const canCheckForUpdates = pkg.canCheckForUpdates;
  const updateAvailable = updateStatus?.state === "update-available";

  return (
    <Stack className="fork-pwa-detail">
      <Row className="fork-pwa-head">
        <RowGrow>
          <ScopeTag scope={pkg.scope} />
          {/* 画板 D-13 帧 A/C 的详情头：状态徽章 + 包名等宽串。 */}
          {pkg.disabled ? (
            <Badge>{t("i18n.disabled")}</Badge>
          ) : pkg.filtered && (
            <Badge tone="warn">{t("i18n.filtered")}</Badge>
          )}
          <span className="d-mono d-grow">
            {pkg.source}
          </span>
        </RowGrow>

        <Row>
          <Btn
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
          </Btn>
          <Btn
            size="small"
            onClick={onReloadSession}
            disabled={!sessionId || reloadBusy || busy}
             title={sessionId ? t("i18n.reloadSession") : t("i18n.openSessionToReload")}
          >
             {reloadBusy ? t("i18n.reloading") : t("i18n.reloadSession")}
          </Btn>
          <Btn
            variant="danger"
            size="small"
            onClick={() => onAction("remove", pkg)}
            disabled={busy || reloadBusy}
          >
             {busyKey === `remove:${key}` ? t("i18n.removing") : t("i18n.remove")}
          </Btn>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-busy={busy || reloadBusy || undefined}
            aria-label={pkg.disabled ? t("i18n.enablePackage") : t("i18n.disablePackage")}
            title={pkg.disabled ? t("i18n.enablePackage") : t("i18n.disablePackage")}
            disabled={busy || reloadBusy}
            className={`d-switch${enabled ? " on" : ""}`}
            onClick={() => onAction(pkg.disabled ? "enable" : "disable", pkg)}
          />
        </Row>
      </Row>

      <PackageDetailBody
        pkg={pkg}
        cwd={cwd}
        actionError={actionError}
        actionMessage={actionMessage}
        updateStatus={updateStatus}
        checkingUpdate={checkingUpdate}
        updateError={updateError}
      />
    </Stack>
  );
}

/**
 * fork:v5-d13-frame-c —— 插件详情弹层（画板 D-13 帧 C 的产品形）。
 *
 * 板面帧 C 是**设置弹窗自己**的一个状态（body 里再放一份 `.d-set` 左导航 + 右列
 * 详情 + foot 的「卸载… 完成」）。产品的设置壳已经就是那个弹窗（左导航在外层
 * `SettingsPanel`），所以详情是它上面叠的一层 `d-modal-box wide`：头（作用域 +
 * 状态徽章 + 包名 + 版本 / 检查更新 / 重载会话 / 启停）、身（属性行 + 已解析资源）、
 * 脚（「要重载才生效」+ 卸载… + 完成）—— 头身脚的件与板面一字不差，只是不再抄
 * 第二份左导航。
 *
 * 与板面的偏离（数据面，不是取舍）：帧 C 的四段 tabs（权限 / 概览 / 依赖 / 兼容）
 * 需要 `/api/plugins` 返回权限声明与依赖图，它不返回，所以只落「概览」这一段，
 * 不画点不动的分段器。
 */
function PluginDetailModal({
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
  onUninstall,
  onClose,
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
  /** 卸载走帧 A 的卸载确认浮窗（逐条写后果），所以这里把点击位置交回去定位它。 */
  onUninstall: (event: ReactMouseEvent) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  // fork:dsn-dialog-a11y —— 与设置壳同一套：Esc 关闭、Tab 循环、背景 inert、关闭还焦点。
  const { dialogRef, dialogProps } = useDialogA11y({ open: true, onClose });
  const key = packageKey(pkg);
  const busy = busyKey?.endsWith(key) ?? false;
  const reloadBusy = busyKey === "reload";
  const enabled = !pkg.disabled;
  const canCheckForUpdates = pkg.canCheckForUpdates;
  const updateAvailable = updateStatus?.state === "update-available";

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={pkg.packageName ?? pkg.source}
      className="d-modal is-open"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="d-modal-box wide">
        <div className="d-modal-head">
          {/* 画板帧 C 的 head 就是一行：名称在左，动作在右端（`d-grow` 顶出去）。 */}
          <div className="d-row">
            <ScopeTag scope={pkg.scope} />
            {pkg.disabled ? (
              <Badge>{t("i18n.disabled")}</Badge>
            ) : pkg.filtered ? (
              <Badge tone="warn">{t("i18n.filtered")}</Badge>
            ) : null}
            <span className="d-grow">{pkg.packageName ?? pkg.source}</span>
            {pkg.version && <span className="d-mono d-t-xs d-t-faint">{pkg.version}</span>}
            <Btn
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
            </Btn>
            <Btn
              size="small"
              onClick={onReloadSession}
              disabled={!sessionId || reloadBusy || busy}
              title={sessionId ? t("i18n.reloadSession") : t("i18n.openSessionToReload")}
            >
              {reloadBusy ? t("i18n.reloading") : t("i18n.reloadSession")}
            </Btn>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-busy={busy || reloadBusy || undefined}
              aria-label={pkg.disabled ? t("i18n.enablePackage") : t("i18n.disablePackage")}
              title={pkg.disabled ? t("i18n.enablePackage") : t("i18n.disablePackage")}
              disabled={busy || reloadBusy}
              className={`d-switch${enabled ? " on" : ""}`}
              onClick={() => onAction(pkg.disabled ? "enable" : "disable", pkg)}
            />
          </div>
        </div>
        <div className="d-modal-body">
          <div className="d-set-inner">
            <PackageDetailBody
              pkg={pkg}
              cwd={cwd}
              actionError={actionError}
              actionMessage={actionMessage}
              updateStatus={updateStatus}
              checkingUpdate={checkingUpdate}
              updateError={updateError}
            />
          </div>
        </div>
        <div className="d-modal-foot">
          <span className="d-t-xs d-t-faint d-grow">
            {sessionId ? t("agents.reloadRequired") : t("i18n.openSessionToReload")}
          </span>
          <Btn
            variant="ghost"
            onClick={onUninstall}
            disabled={busy || reloadBusy}
          >
            <i data-ico="trash-2" data-size="14" aria-hidden="true" />
            {t("i18n.remove")}
          </Btn>
          <Btn variant="primary" onClick={onClose}>
            <i data-ico="check" data-size="14" aria-hidden="true" />
            {t("plugins.done")}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/** fork:v5-d13-frame-c —— 独立扩展的详情：同一副弹层壳，正文两行（状态 / 路径）。 */
function ExtensionDetailModal({
  extension,
  onClose,
}: {
  extension: PluginStandaloneExtensionInfo;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { dialogRef, dialogProps } = useDialogA11y({ open: true, onClose });

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={extension.name}
      className="d-modal is-open"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="d-modal-box wide">
        <div className="d-modal-head">
          <div className="d-row">
            <ScopeTag scope={extension.scope} />
            <span className="d-grow">{extension.name}</span>
          </div>
        </div>
        <div className="d-modal-body">
          <div className="d-set-inner">
            <StandaloneExtensionDetail extension={extension} />
          </div>
        </div>
        <div className="d-modal-foot">
          <span className="d-grow" aria-hidden="true" />
          <Btn variant="primary" onClick={onClose}>
            <i data-ico="check" data-size="14" aria-hidden="true" />
            {t("plugins.done")}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/** fork:v5-d13-frame-c —— 独立扩展的属性行（两行：状态 / 路径）。
 *  头（作用域 + 名称）由外壳摆：手机档是 `.fork-pwa-head`，桌面档是弹层 head。 */
function StandaloneExtensionDetail({ extension }: { extension: PluginStandaloneExtensionInfo }) {
  const { t } = useI18n();

  return (
    <div className="d-set-sec">
      <div className="d-set-row">
        <div className="d-set-row-box">
          <div className="d-set-row-t">{t("i18n.status")}</div>
        </div>
        <span className="d-grow-last">
          <Badge tone={extension.enabled ? "ok" : "mute"}>
            {extension.enabled ? t("plugins.statusLoaded") : t("i18n.disabled")}
          </Badge>
        </span>
      </div>
      <div className="d-set-row">
        <div className="d-set-row-box">
          <div className="d-set-row-t">{t("i18n.installedPath")}</div>
          <div className="d-set-row-s d-mono">{shortenPath(extension.path)}</div>
        </div>
      </div>
    </div>
  );
}

/** fork:design-system（画板 62 落位表 + 画板 43）—— MCP 详情的行式字段：
 *  标签左 / 值右。画板的 `.pw-field` 控件侧放的是可编辑控件，这里放只读等宽串，
 *  而参数 / env / JSON 可能很长：值要能收缩折行 —— `minWidth: 0` 是门禁放行的 0 值，
 *  `overflowWrap` 折行是行为语义（flex 子项默认 `min-width:auto` 顶破卡片），
 *  不是画板外观。 */
function McpReadonlyField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Field label={label}>
      <span className="d-mono" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {value}
      </span>
    </Field>
  );
}

/** fork:mcp-native-exposure —— exposure 的四档取值（`core/mcp-servers.d.ts:12`）。 */
const MCP_EXPOSURES = ["codemode", "deferred", "direct", "hidden"] as const;

/**
 * fork:mcp-native-exposure —— 工具曝光档选择器。
 *
 * 这一档决定**模型怎么用到这个 server 的工具**：
 *   · `codemode`（pi 默认）：工具不进模型工具表，模型在 codemode 脚本里 `searchTools()` 找；
 *   · `deferred`：不进工具表，`tool_search` 按需加载后才声明给模型；
 *   · `direct`：像普通工具一样直接声明（老行为的等价物）；
 *   · `hidden`：注册但调不到。
 */
function McpExposureField({
  value,
  disabled,
  onChange,
}: {
  value: NonNullable<McpServerInfo["exposure"]>;
  disabled: boolean;
  onChange: (next: NonNullable<McpServerInfo["exposure"]>) => void;
}) {
  const { t } = useI18n();
  return (
    <Field label={t("mcp.fieldExposure")}>
      <select
        className="d-select"
        value={value}
        disabled={disabled}
        title={t(`mcp.exposureHint.${value}`)}
        aria-label={t("mcp.fieldExposure")}
        onChange={(event) => onChange(event.target.value as NonNullable<McpServerInfo["exposure"]>)}
      >
        {MCP_EXPOSURES.map((option) => (
          <option key={option} value={option}>{t(`mcp.exposure.${option}`)}</option>
        ))}
      </select>
    </Field>
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
  onExposure,
  authActions,
  /** fork:v5-d15-frame-a —— 桌面（D-15 帧 A）上「启用 / 测试 / 编辑 / 移动 / 删除」
   *  都在行尾浮窗里，详情只剩读数与曝光，所以那一排按钮由调用方关掉；手机保留。 */
  headActions = true,
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
  /** fork:mcp-native-exposure — 改工具曝光档。 */
  onExposure: (next: NonNullable<McpServerInfo["exposure"]>) => void;
  /** fork:zc-18 — optional OAuth entry slot; rendered by fork/McpConfig.tsx. */
  authActions?: ReactNode;
  headActions?: boolean;
}) {
  const { t } = useI18n();
  const enabled = !server.disabled;
  const otherScope: McpScope = server.scope === "project" ? "global" : "project";
  const target =
    server.kind === "url" ? server.url : server.kind === "socket" ? server.socket : server.command;

  return (
    <Stack className="fork-pwa-detail">
      <Row className="fork-pwa-head">
        <RowGrow>
          <ScopeTag scope={server.scope} />
          {/* fork:design-system SW-14 —— 画板 43 的 MCP 详情头：作用域 / 禁用徽章 / 等宽名。 */}
          {server.disabled && (
            <Badge>{t("mcp.disabledBadge")}</Badge>
          )}
          <span className="d-mono d-grow">
            {server.name}
          </span>
        </RowGrow>

        {headActions ? (
        <Row>
          <Btn size="small" onClick={onTest} disabled={busy}>
            {busy ? t("mcp.testing") : t("mcp.test")}
          </Btn>
          <Btn size="small" onClick={onEdit} disabled={busy}>
            {t("mcp.edit")}
          </Btn>
          <Btn size="small" onClick={onMove} disabled={busy}>
            {otherScope === "project" ? t("mcp.moveToProject") : t("mcp.moveToGlobal")}
          </Btn>
          <Btn variant="danger" size="small" onClick={onRemove} disabled={busy}>
            {t("mcp.delete")}
          </Btn>
          <Switch
            checked={enabled}
            loading={busy}
            onChange={() => onToggle()}
            label={enabled ? t("mcp.disable") : t("mcp.enable")}
          />
        </Row>
        ) : null}
      </Row>

      {/* fork:design-system（画板 62 落位表）—— MCP 详情的属性表从 `.pw-kv` 的
          dt/dd 改成画板 43 的 `.pw-field` 行式字段（标签左 / 值右）。整组包一层
          普通块：`.pw-field + .pw-field` 的发丝线要靠相邻兄弟连续，拆散进
          Stack 的网格会把行距撑成 s3。 */}
      <div>
        <McpReadonlyField label={t("mcp.fieldType")} value={server.kind} />
        {/* fork:mcp-native-exposure —— 这一行决定模型怎么用到工具；未声明按 pi 默认
            （codemode）显示，避免下拉与文件内容不一致。 */}
        <McpExposureField
          value={server.exposure ?? "codemode"}
          disabled={busy}
          onChange={(next) => onExposure(next)}
        />
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
        <div className="d-banner info">
          <i data-ico="check" data-size="14"></i>
          <span className="d-grow">{actionMessage}</span>
        </div>
      )}
      {actionError && (
        <div className="d-banner err">
          <i data-ico="triangle-alert" data-size="14"></i>
          <span className="d-grow">{actionError}</span>
        </div>
      )}
    </Stack>
  );
}

/* ---------------------------------------------------------------------------
 * fork:v5-d15-frame-a —— 桌面 MCP 列表 = 画板 `D-15-settings-mcp.html` 帧 A 的原文：
 *
 *   .d-set-sec
 *     .d-row            .d-t-xs.d-t-faint.d-grow 计数句 + .d-row[flex:0 0 auto] 两枚钮
 *     .d-slottable
 *       .d-slotrow      .d-col.d-grow（名字 + 曝光徽章 / 等宽副行）
 *                        › .d-badge.mute 传输方式 › .d-badge 认证态
 *                        › .d-switch › .d-iconbtn
 *
 * fork:mcp-switch-right（2026-10-06 用户裁定）—— `.d-switch` 在画板 D-15 帧 A 里
 * 排**行首**，产品挪到行尾（`.d-iconbtn` 之前）：用户要求「开关挪到最右边」，
 * 本仓插件表 / 技能行的开关本来也都在行尾。偏离已登记在 `design/v5/DIVERGENCE.md`。
 *
 * 之前这里是 `ConfigSplitView` 的主从两列（一列 `.d-trow` + 一列详情），
 * 而七枚页级动作挤在页头一行 `nowrap` 的 `.d-row` 里 —— 放不下时按钮文字竖排，
 * 「添加 MCP」还被推出内容列右缘。画板把这两件事分得很清：**页头只有标题**，
 * 列表级动作在内容列第一行，条目级动作在行尾浮窗里。
 * 偏离（产品有能力、画板没有的入口）登记在 `design/v5/DIVERGENCE.md` AG 节。
 * ------------------------------------------------------------------------- */

/** 传输方式徽章的三个字面量：协议名不翻译（画板帧 A 同样直接写 stdio / HTTP）。 */
const MCP_TRANSPORT_LABEL: Record<McpServerInfo["kind"], string> = {
  command: "stdio",
  url: "HTTP",
  socket: "socket",
};

/** 曝光档的徽章调（画板帧 A：codemode=info / direct=ok / deferred=warn / hidden=mute）。 */
const MCP_EXPOSURE_TONE: Record<string, string> = {
  codemode: "info",
  direct: "ok",
  deferred: "warn",
  hidden: "mute",
};

/** 帧 A 的一行。条目级动作全在行尾浮窗里（画板帧 A 的五个 `d-pop` 之一：
 *  浮窗本体是 `ContextMenu` 的 `d-pop-float` + `d-menu-row`，与插件帧 A 的
 *  行尾菜单同一套原语，键盘导航 / 边缘翻转 / 外面点击关闭都在那儿）。 */
function McpSlotRow({ server, selected, busy, onToggle, onMenu }: {
  server: McpServerInfo;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  /** 打开行尾浮窗：`(x, y)` 是指针位置，条目由调用方按 server 拼。 */
  onMenu: (x: number, y: number) => void;
}) {
  const { t } = useI18n();
  const exposure = server.exposure ?? "codemode";
  const target =
    server.kind === "url" ? server.url : server.kind === "socket" ? server.socket : server.command ?? "—";

  return (
    <div className={`d-slotrow${selected ? " is-on" : ""}`}>
      <div className="d-col d-grow">
        <div className="d-row">
          <span className="d-t-b">{server.name}</span>
          <span className={`d-badge ${MCP_EXPOSURE_TONE[exposure]}`}>{exposure}</span>
          {server.disabled && <span className="d-badge mute">{t("mcp.disabledBadge")}</span>}
        </div>
        <span className="d-set-row-s d-mono">
          {[target, ...server.args].join(" ")} ·{" "}
          {server.scope === "project" ? t("mcp.scope.project") : t("mcp.scope.global")}
        </span>
      </div>
      <span className="d-badge mute">{MCP_TRANSPORT_LABEL[server.kind]}</span>
      <span className="d-badge mute">
        {isRemoteMcpServer(server) ? t("mcp.rowAuthRemote") : t("mcp.rowAuthLocal")}
      </span>
      {/* fork:mcp-switch-right（2026-10-06 用户裁定）—— 开关从行首挪到行尾。
          画板 D-15 帧 A 把 `.d-switch` 排在行首，用户要求「挪到最右边」；
          本仓其它列表（插件表的「启用」列、技能行）开关本来就在行尾，
          所以顺带与它们对齐。位置在 `.d-iconbtn` 之前，与插件表同序。 */}
      <button
        type="button"
        role="switch"
        aria-checked={!server.disabled}
        aria-label={`${server.disabled ? t("mcp.enable") : t("mcp.disable")} ${server.name}`}
        title={server.disabled ? t("mcp.enable") : t("mcp.disable")}
        disabled={busy}
        className={`d-switch${server.disabled ? "" : " on"}`}
        onClick={onToggle}
      />
      <button
        type="button"
        className="d-iconbtn"
        aria-label={t("mcp.rowActions", { name: server.name })}
        title={t("mcp.rowActions", { name: server.name })}
        onClick={(event) => onMenu(event.clientX, event.clientY)}
      >
        <i data-ico="ellipsis-vertical" data-size="15" aria-hidden="true" />
      </button>
    </div>
  );
}

/** 帧 A 的列表分节：计数行 + `.d-slottable`。 */
function McpServerList({ data, loading, actionError, actionMessage, busy, selectedName, catalogEntry, onAdd, onPaste, onToggle, onRowMenu, onPageMenu }: {
  data: McpResponse | null;
  loading: boolean;
  actionError: string | null;
  actionMessage: string | null;
  busy: boolean;
  selectedName: string | null;
  catalogEntry: ReactNode;
  onAdd: () => void;
  onPaste: () => void;
  onToggle: (server: McpServerInfo) => void;
  /** 行尾浮窗 / 分节级「更多」浮窗的开口（`ContextMenu` 的 `openMenu`）。 */
  onRowMenu: (x: number, y: number, server: McpServerInfo) => void;
  onPageMenu: (x: number, y: number, refreshDisabled: boolean) => void;
}) {
  const { t } = useI18n();
  const servers = data?.servers ?? [];
  const enabledCount = servers.filter((server) => !server.disabled).length;

  return (
    <div className="d-set-sec">
      {actionMessage && (
        <div role="status" className="d-banner info">
          <i data-ico="check" data-size="14" aria-hidden="true" />
          <span className="d-grow">{actionMessage}</span>
        </div>
      )}
      {actionError && (
        <div role="alert" className="d-banner err">
          <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
          <span className="d-grow">{actionError}</span>
        </div>
      )}

      <div className="d-row">
        <div className="d-t-xs d-t-faint d-grow">
          {t("mcp.listSummary", { count: String(servers.length), enabled: String(enabledCount) })}{" "}
          <span className="d-mono">~/.pi/agent/mcp.json</span>{" "}
          {t("mcp.listSummaryProject")} <span className="d-mono">.pi/mcp.json</span>
        </div>
        <div className="d-row" style={{ flex: "0 0 auto" }}>
          {catalogEntry}
          <Btn size="small" onClick={onPaste}>
            <i data-ico="clipboard-list" data-size="14" aria-hidden="true" />
            {t("mcp.add.pasteButton")}
          </Btn>
          <Btn size="small" variant="primary" onClick={onAdd}>
            <i data-ico="plus" data-size="14" aria-hidden="true" />
            {t("mcp.addButton")}
          </Btn>
          <button
            type="button"
            className="d-iconbtn"
            aria-label={t("mcp.moreActions")}
            title={t("mcp.moreActions")}
            onClick={(event) => onPageMenu(event.clientX, event.clientY, loading || busy)}
          >
            <i data-ico="ellipsis" data-size="14" aria-hidden="true" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="d-banner info">
          <span className="d-run"><i data-ico="loader-circle" data-size="14" aria-hidden="true" /></span>
          <span className="d-grow">{t("i18n.loading")}</span>
        </div>
      ) : servers.length === 0 ? (
        <EmptyState>
          <span className="d-empty-ico"><i data-ico="server" data-size="16" aria-hidden="true" /></span>
          <p className="d-empty-t">{t("mcp.emptyList")}</p>
        </EmptyState>
      ) : (
        <div className="d-slottable">
          {servers.map((server) => (
            <McpSlotRow
              key={`${server.scope}:${server.name}`}
              server={server}
              selected={server.name === selectedName}
              busy={busy}
              onToggle={() => onToggle(server)}
              onMenu={(x, y) => onRowMenu(x, y, server)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* fork:v5-landing · D-15 帧 B 的面包屑末级只有两个词（「添加」/「编辑」），
 * 而 `lib/i18n/messages/**` 里没有对应的通用键（只有 `mcp.addTitle` 这类整句）。
 * 同一波新增的字都先落在这张本地表里（口径与 `settingsHub.ts` /
 * `settings-disabled-reasons.ts` 一致），待办：迁成 `mcp.crumbAdd` / `mcp.crumbEdit`。
 * 「添加 / 编辑」两个词本身已是现有键（`i18n.edit` / `mcp.add.pasteSubmit`）的同义口径，
 * 不引入新语义。 */
const MCP_CRUMB_COPY: Record<"add" | "edit", LocalCopy> = {
  add: { en: "Add", "zh-CN": "添加", "zh-TW": "新增" },
  edit: { en: "Edit", "zh-CN": "编辑", "zh-TW": "編輯" },
};

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
  const { t, locale } = useI18n();
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
    <Stack className="fork-pwa-detail">
      {/* fork:v5-landing · D-15 帧 B —— `.d-crumb` 面包屑是这张板对
          「添加 / 编辑」两态的固定写法：根是分节名（`.is-on` 之外的普通
          `button`，可回列表），末级是当前动作。类名 / 嵌套 / `<i data-ico>`
          原样抄，静态文案换成已有的 `mcp.sectionTitle` 与本地表里的
          「添加 / 编辑」（语言包这一轮不许改，已登记在报告里）。 */}
      <div className="d-crumb">
        <button type="button">{t("mcp.sectionTitle")}</button>
        <i data-ico="chevron-right" data-size="12" aria-hidden="true" />
        <button type="button" className="is-on">
          {localCopy(isEdit ? MCP_CRUMB_COPY.edit : MCP_CRUMB_COPY.add, locale)}
        </button>
      </div>
      <div>
        <Title>
          {isEdit ? t("mcp.editTitle", { name: initial?.name ?? "" }) : t("mcp.addTitle")}
        </Title>
        <span className="d-mono d-t-faint">
          {scope === "project" ? `${shortenPath(cwd)}/.pi/mcp.json` : "~/.pi/agent/mcp.json"}
        </span>
      </div>

      {/* fork:design-system SW-14 —— 画板 43 的 Basic / JSON 切换是 `.pw-radio` 芯片组。 */}
      <div className="d-row">
        <span className="d-seg" role="radiogroup" aria-label={t("mcp.sectionTitle")}>
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

      <Field label={t("mcp.nameLabel")}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("mcp.namePlaceholder")}
          className="d-input d-mono"
        />
      </Field>

      {mode === "json" ? (
        <Field label={t("mcp.jsonLabel")}>
          {loadingJson ? (
            <div className="d-banner info">
              <span className="d-run"><i data-ico="loader-circle" data-size="14" aria-hidden="true"></i></span>
              <span className="d-grow">{t("mcp.loadingDef")}</span>
            </div>
          ) : (
            <textarea
              value={jsonText ?? ""}
              onChange={(e) => setJsonText(e.target.value)}
              spellCheck={false}
              placeholder={
                '{\n  "command": "npx",\n  "args": ["-y", "@modelcontextprotocol/server-github"],\n  "env": {}\n}'
              }
              className="d-textarea d-mono"
            />
          )}
        </Field>
      ) : (
        <>
          <Field label={t("mcp.specLabel")}>
            <input
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              placeholder={t("mcp.specPlaceholder")}
              className="d-input d-mono"
            />
          </Field>

          {!isUrl && (
            <Field label={t("mcp.argsLabel")}>
              <input value={argsText} onChange={(e) => setArgsText(e.target.value)} className="d-input d-mono" />
            </Field>
          )}
        </>
      )}

      {jsonError && (
        <div className="d-banner err">
          <i data-ico="triangle-alert" data-size="14"></i>
          <span className="d-grow">{jsonError}</span>
        </div>
      )}

      <div className="d-row fork-pwa-acts">
        <SegmentedScope
          value={scope}
          projectResourcesLoaded={projectResourcesLoaded}
          onChange={onScopeChange}
        />
        <Btn variant="primary" onClick={handleSave} disabled={busy || !canSave}>
          {busy ? t("mcp.saving") : isEdit ? t("mcp.saveEdit") : t("mcp.save")}
        </Btn>
        <Btn onClick={onCancel}>{t("mcp.cancel")}</Btn>
      </div>

      {actionError && (
        <div className="d-banner err">
          <i data-ico="triangle-alert" data-size="14"></i>
          <span className="d-grow">{actionError}</span>
        </div>
      )}
    </Stack>
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
           fork:pwa-plugins-agents —— 同样搬进 `.fork-pwa-import`（桌面值不变）。
           fork:v5-skin-pw-modal-keep —— `pw-modal` / `pw-modal-head` /
           `pw-modal-body` / `pw-modal-foot` 有意保留：`app/pwa-plugins-agents.css`
           的 `.fork-pwa-import-scrim .pw-modal-foot` 仍以它为选择器；收尾波与那段
           移动 CSS 一并换 `d-modal`。其余 v1 类已全部换成 d-*。 */
      >
        <div className="pw-modal-head">
          <i data-ico="import" data-size="16"></i>
          {t("mcp.importTitle")}
          <span className="d-grow" aria-hidden="true" />
          <button
            type="button"
            className="d-iconbtn"
            onClick={onDismiss}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
          >
            <i data-ico="x" data-size="14"></i>
          </button>
        </div>

        {/* fork:settings-modal-scroll —— `flex:1 + min-height:0` 让内容行吃满
            「壳高 − 头 − 脚」，剩下的高度就是它的滚动区（board.css:643 已给
            `overflow-y:auto`）；`minmax(0,1fr)` 把网格列从 min-content 收成壳宽，
            长命令行在行内单行省略而不是把壳顶宽。 */}
        <div className="pw-modal-body" style={{ flex: "1 1 0%", minHeight: 0, gridTemplateColumns: "minmax(0, 1fr)" }}>
          {sourceCounts.size > 0 && (
            <>
              <div className="d-chips">
                {[...sourceCounts.entries()].map(([tool, count]) => (
                  <span key={tool} className="d-badge mute">
                    <i data-ico="check" data-size="12"></i>
                    {tool} · {count}
                  </span>
                ))}
              </div>
              <div className="d-sep-v" aria-hidden="true" />
            </>
          )}
          {discovering ? (
            <div className="d-banner info">
              <span className="d-run"><i data-ico="loader-circle" data-size="14" aria-hidden="true"></i></span>
              <span className="d-grow">{t("i18n.loading")}</span>
            </div>
          ) : discovered.length === 0 ? (
            <div className="d-banner info">
              <i data-ico="info" data-size="14"></i>
              <span className="d-grow">{t("mcp.importEmpty")}</span>
            </div>
          ) : (
            discovered.map((server) => (
              <div
                key={`${server.path}:${server.name}`}
                className="d-menu-row"
                /* 画板 43 弱化行（已禁用 / 被同名条目遮蔽）的 `opacity:.55`
                   原样 inline —— 画板自身就是这个写法。 */
                style={server.shadowed || server.disabled ? { opacity: 0.55 } : undefined}
              >
                <i data-ico="server" data-size="14"></i>
                {/* grow 允许收缩（flex 子项默认 min-width:auto），下面命令行的
                    单行省略才接得住长值；0 是门禁放行值。 */}
                <span className="grow" style={{ minWidth: 0 }}>
                  {/* 画板 43 导入行的名字就是 `<b style="font-weight:500">`
                      原样 inline（b 默认 700，画板要 500）。 */}
                  <b style={{ fontWeight: 500 }}>{server.name}</b>
                  <div className="d-t-xs d-t-faint">
                    {server.tool} · {server.scope === "project" ? t("mcp.scopeProject") : t("mcp.scopeGlobal")}
                  </div>
                  {/* 命令行可能很长：单行省略是行为语义（board.css 只在
                      .pw-litem 这类具体语境里给 ellipsis），没有可用的 pw 基件，
                      保留最小 inline。 */}
                  <div
                    className="d-mono d-t-faint"
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
                  <Badge tone="warn">{t("mcp.importShadowed")}</Badge>
                )}
                {server.disabled && <Badge>{t("mcp.itemDisabled")}</Badge>}
                <Btn
                  variant="secondary"
                  size="small"
                  disabled={importing === server.name || server.shadowed}
                  title={server.shadowed ? t("mcp.importShadowedTitle") : undefined}
                  onClick={() => onImport(server)}
                >
                  {importing === server.name ? t("mcp.saving") : t("mcp.importOne")}
                </Btn>
              </div>
            ))
          )}
          {actionMessage && (
            <div className="d-banner info">
              <i data-ico="check" data-size="14"></i>
              <span className="d-grow">{actionMessage}</span>
            </div>
          )}
          {actionError && (
            <div className="d-banner err">
              <i data-ico="triangle-alert" data-size="14"></i>
              <span className="d-grow">{actionError}</span>
            </div>
          )}
        </div>

        <div className="pw-modal-foot">
          <span className="d-t-xs d-t-faint">{t("mcp.count", { count: String(discovered.length) })}</span>
          <span className="d-grow" aria-hidden="true" />
          <Btn onClick={onDismiss}>{t("mcp.cancel")}</Btn>
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
  renderMcpCatalogEntry,
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
  /** fork:proma-46-mcp-catalog — optional 连接目录 entry for the MCP page header. */
  renderMcpCatalogEntry?: (context: { reload: () => void }) => ReactNode;
}) {
  const mcpOnly = only === "mcp";
  // fork:v5-d15-frame-a —— 桌面 MCP 分节是 D-15 帧 A 的单列内容；手机保留主从两列。
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => getLastSettingsSelection("plugins", cwd));
  // fork:v5-d13-frame-c —— 桌面档的详情是叠在设置壳上的弹层：「选中哪一条」要跨
  // 开关保留，而「弹层开着」关掉就要真的关，所以是两个状态。手机档仍是内联详情。
  const [detailOpen, setDetailOpen] = useState(false);
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
  // fork:mcp-paste —— 「粘贴添加」与现有表单并列（表单用于手填，这里吃命令/JSON/链接）。
  const [mcpPasteMode, setMcpPasteMode] = useState(false);
  // fork:mcp-native-exposure —— 日志弹层开关。
  const [mcpLogOpen, setMcpLogOpen] = useState(false);
  const [mcpDiscovered, setMcpDiscovered] = useState<DiscoveredMcpServer[]>([]);
  const [mcpDiscovering, setMcpDiscovering] = useState(false);
  const [mcpImporting, setMcpImporting] = useState<string | null>(null);
  const [mcpScope, setMcpScope] = useState<McpScope>("global");
  const [mcpEditTarget, setMcpEditTarget] = useState<McpServerInfo | null>(null);
  const [mcpActionError, setMcpActionError] = useState<string | null>(null);
  const [mcpActionMessage, setMcpActionMessage] = useState<string | null>(null);
  // fork:mcp-undo —— 删除后 60 秒可撤销：服务端只回一个 token，条目原文留在它那边。
  const [mcpUndo, setMcpUndo] = useState<{ token: string; name: string; expiresAt: number; undoing: boolean } | null>(null);
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
        const next = (await res.json()) as McpResponse & { error?: string; reload?: McpReloadReport };
        if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
        setMcpData(next);
        // fork:mcp-auto-reload —— 写完配置服务端会把「多少会话立即重载、多少等这轮
        // 结束」报回来。不说的话用户不知道「刚加的 server 要不要重开会话」——
        // 这是以前最容易被当成 bug 的那一步。
        if (next.reload && (next.reload.reloaded > 0 || next.reload.deferred > 0)) {
          setMcpActionMessage(next.reload.deferred > 0
            ? t("mcp.reloadReportRunning", { reloaded: next.reload.reloaded, deferred: next.reload.deferred })
            : t("mcp.reloadReport", { reloaded: next.reload.reloaded }));
        }
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

  /**
   * fork:mcp-native-exposure —— 改工具曝光档。走 `patch` 动作（pi 自己的
   * `McpServerConfigPatch` 形状）：写默认值等于删键，所以 UI 上「选回 codemode」=
   * 文件里没有这个键，与 pi 的 `/mcp` 完全同一口径。
   */
  const setMcpExposure = useCallback(
    async (server: McpServerInfo, exposure: NonNullable<McpServerInfo["exposure"]>) => {
      const next = await runMcpAction("patch", {
        name: server.name,
        scope: server.scope,
        patch: { exposure },
      });
      if (next) setMcpActionMessage(t("mcp.msgExposure", { name: server.name, exposure: t(`mcp.exposure.${exposure}`) }));
    },
    [runMcpAction], // eslint-disable-line react-hooks/exhaustive-deps
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
        // fork:mcp-undo —— 有 token 就给一条撤销通知，60 秒后自己消失。
        if (next.undo) {
          setMcpUndo({
            token: next.undo.token,
            name: next.undo.name,
            expiresAt: Date.now() + next.undo.expiresInMs,
            undoing: false,
          });
        } else {
          setMcpUndo(null);
        }
      }
    },
    [runMcpAction], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /**
   * fork:mcp-undo —— 撤销一次删除：把 token 交回服务端，它把条目放回原来的位置。
   * 失败（过期 / 名字又被占用 / 目录不再受信任）时服务端会把条目退回，
   * 所以这条通知在剩下的时间里还能再试；410 表示确实没得撤销了。
   */
  // fork:mcp-undo —— 通知的寿命与服务端那份一致（60 秒），到期自动消失。
  useEffect(() => {
    if (!mcpUndo) return;
    const remaining = mcpUndo.expiresAt - Date.now();
    if (remaining <= 0) { setMcpUndo(null); return; }
    const timer = setTimeout(() => setMcpUndo(null), remaining);
    return () => clearTimeout(timer);
  }, [mcpUndo]);

  const undoMcpRemoval = useCallback(async () => {
    const pending = mcpUndo;
    if (!pending || pending.undoing) return;
    setMcpUndo({ ...pending, undoing: true });
    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "undo", token: pending.token }),
      });
      const next = (await response.json()) as McpResponse & { error?: string; detail?: string };
      if (!response.ok) {
        setMcpActionError(next.detail ?? next.error ?? t("mcp.undoFailed"));
        if (response.status === 410) setMcpUndo(null);
        else setMcpUndo({ ...pending, undoing: false });
        return;
      }
      setMcpData(next);
      setMcpUndo(null);
      setMcpAddMode(false);
      setMcpSelected(pending.name);
      setMcpActionMessage(t("mcp.undoRestored", { name: pending.name }));
    } catch (error) {
      setMcpUndo({ ...pending, undoing: false });
      setMcpActionError(error instanceof Error ? error.message : String(error));
    }
  }, [cwd, mcpUndo, t]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * fork:mcp-paste —— 「粘贴添加」的提交。浏览器发的是**粘贴原文**（外加用户改过的名字、
   * 作用域、逐字段取值），服务端用同一个解析器再解析一遍才写盘（`action:"paste"` →
   * `lib/mcp-add.ts` 的 `prepareMcpAdd`）：浏览器拼不出 def 绕过预检。
   */
  const pasteMcp = useCallback(
    async (draft: { text: string; name?: string; rawPi: boolean; server: number; values: Record<string, McpImportFieldValue>; secretReferences: Record<string, string> }) => {
      setBusyKey("mcp:paste");
      setMcpActionError(null);
      setMcpActionMessage(null);
      try {
        const res = await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd,
            action: "paste",
            scope: mcpScope,
            text: draft.text,
            name: draft.name,
            rawPi: draft.rawPi,
            server: draft.server,
            values: draft.values,
            secretReferences: draft.secretReferences,
            confirmHostEnv: [],
          }),
        });
        const next = (await res.json()) as McpResponse & { error?: string; reason?: string; added?: { name: string } };
        if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
        setMcpData(next);
        setMcpAddMode(false);
        setMcpEditTarget(null);
        setMcpSelected(next.added?.name ?? draft.name ?? "");
        setMcpActionMessage(t("mcp.msgAdded", { name: next.added?.name ?? draft.name ?? "" }));
      } catch (err) {
        setMcpActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyKey(null);
      }
    },
    [cwd, mcpScope, t], // eslint-disable-line react-hooks/exhaustive-deps
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
        const json = (await res.json()) as { ok?: boolean; message?: string; error?: string; live?: boolean };
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        // The route answers 200 with { ok: false } when the config fails pi's structural
        // validation. `ok` has to be honoured explicitly, otherwise an invalid config is
        // rendered as a success message. `ok: true` is structure only — the server message
        // says no connection was attempted, so it must not be read as "reachable".
        if (json.ok === false) {
          setMcpActionError(
            t("mcp.msgTestError", { name: server.name, error: json.message ?? "" }),
          );
        } else {
          // fork:mcp-live-test —— `live` 决定这句话怎么说：真连过时是「连上了 + 几个工具
          // + 花了多久」，没开真连的形态只有结构校验，不能读成「连得上」（路由的 detail
          // 里本来就写明 no connection was attempted）。
          setMcpActionMessage(json.live
            ? t("mcp.msgTestLive", { name: server.name, result: json.message ?? "" })
            : t("mcp.msgTestResult", { name: server.name, result: json.message ?? "" }));
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
        // fork:v5-d13-frame-c —— 弹层开着时卸载：详情跟着被移除的那一条走会直接
        // 跳到另一个包（`selected` 会被改成列表第一条），所以这里先关掉。
        if (detailOpen) setDetailOpen(false);
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
  }, [cwd, detailOpen]);

  /* fork:group-switch（G4）—— 一个作用域的分组开关：包里全部启用 / 全部停用。
     fork:bulk-routes（上游 `eceac13` #1020）—— 路由现在收
     `packages: [{ source, scope }]`，所以这里一次请求发完（改前是逐条串行：
     每个包一次 settings.json 的 flush，互相同一个文件连着写）。只把
     `packagesToSwitch` 算出的目标发出去，所以带 resource filter 的包
     （`keepOn`）根本不在请求里 —— 停用它会清空过滤条件且没人能存回去。
     路由逐包作答，被拒的包保持原状并逐条报在该组标题下。
     成功时响应仍是一份全量 `PluginsResponse`（外加 `results`），直接拿它当
     列表状态，不用再拉一次。 */
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
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          packages: targets.map((pkg) => ({ source: pkg.source, scope: pkg.scope })),
          cwd,
        }),
      });
      const next = (await res.json().catch(() => ({}))) as PluginsResponse & {
        results?: PluginToggleResult[];
        error?: string;
      };
      if (res.ok && !next.error && Array.isArray(next.results)) {
        setData(next as PluginsResponse);
        const message = enabled ? t("plugins.groupEnabled") : t("plugins.groupDisabled");
        setActionMessage(sessionId ? `${message} ${t("agents.reloadRequired")}` : message);
      }
      // 请求整体失败 → 所有目标都算失败，列表一行不动；逐包失败 → 只剩那几条不动。
      const results: PluginToggleResult[] = Array.isArray(next.results)
        ? next.results
        : targets.map((pkg) => ({
            source: pkg.source,
            scope: pkg.scope,
            error: next.error ?? `HTTP ${res.status}`,
          }));
      const failures = results.filter((result) => result.error);
      setGroupStatus({
        scope,
        note,
        lines: failures.length > 0
          ? [
              t("plugins.groupFailed", { count: failures.length, total: results.length }),
              ...failures.map((failure) => `${failure.source}: ${failure.error}`),
            ]
          : [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setGroupStatus({
        scope,
        note,
        lines: [
          t("plugins.groupFailed", { count: targets.length, total: targets.length }),
          ...targets.map((pkg) => `${pkg.source}: ${message}`),
        ],
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

  /* fork:v5-d13-frame-a —— 桌面档（画板 D-13 帧 A）：表格 + 行尾菜单 + 帧 C 弹层。
     手机档（M-05）与 MCP 分节继续走既有的两栏列表，不动。 */
  const desktopTable = !isMobile && !mcpOnly;
  const { openMenu } = useContextMenu();
  /** 行尾菜单的锚点：卸载确认浮窗在**同一个位置**接着开（板面两枚浮窗是叠着的）。 */
  const menuAnchor = useRef({ x: 0, y: 0 });

  const openDetail = useCallback((key: string) => {
    setView("plugins");
    setSelected(key);
    setAddMode(false);
    setActionError(null);
    setActionMessage(null);
    setDetailOpen(true);
  }, []);

  /** 帧 A 的卸载确认：逐条写后果 + 一条可逆的路（板面原话）。
   *  定义在行尾菜单**之前** —— 后者的依赖数组要读它（TDZ）。 */
  const openUninstallMenu = useCallback((x: number, y: number, pkg: PluginPackageInfo) => {
    openMenu(x, y, [
      {
        label: t("plugins.uninstallDir"),
        icon: <i data-ico="folder" data-size="14" aria-hidden="true" />,
        disabled: true,
        hint: <span className="d-mono d-t-xs d-t-faint">{pkg.installedPath ? shortenPath(pkg.installedPath) : t("i18n.notFound")}</span>,
      },
      {
        label: t("plugins.uninstallResources"),
        icon: <i data-ico="blocks" data-size="14" aria-hidden="true" />,
        disabled: true,
        hint: <span className="d-t-xs d-t-faint">{resourceSummary(pkg, t)}</span>,
      },
      {
        label: t("plugins.uninstallSessions"),
        icon: <i data-ico="history" data-size="14" aria-hidden="true" />,
        disabled: true,
        hint: <Badge tone="ok">{t("plugins.unaffected")}</Badge>,
      },
      { type: "separator" },
      {
        label: t("plugins.disableInstead"),
        icon: <i data-ico="power" data-size="14" aria-hidden="true" />,
        disabled: pkg.disabled,
        onSelect: () => void runAction("disable", pkg),
      },
      {
        label: t("plugins.confirmUninstall"),
        icon: <i data-ico="trash-2" data-size="14" aria-hidden="true" />,
        danger: true,
        disabled: busyKey !== null,
        onSelect: () => void runAction("remove", pkg),
      },
    ], {
      title: t("plugins.uninstallTitle", { name: pkg.packageName ?? pkg.source }),
      footer: t("plugins.uninstallFoot"),
    });
  }, [openMenu, t, runAction, busyKey]);

  /** 帧 A 行尾「更多」：插件详情 / 更新到 X / 启停 / ─ / 卸载…（板面同一顺序）。 */
  const openRowMenu = useCallback((event: ReactMouseEvent, pkg: PluginPackageInfo) => {
    menuAnchor.current = { x: event.clientX, y: event.clientY };
    const st = updateStatuses[packageKey(pkg)];
    const entries: ContextMenuEntry[] = [
      {
        label: t("plugins.detail"),
        icon: <i data-ico="square-pen" data-size="14" aria-hidden="true" />,
        onSelect: () => openDetail(packageKey(pkg)),
      },
    ];
    if (st?.state === "update-available" || !pkg.canCheckForUpdates) {
      entries.push({
        label: t("i18n.update"),
        icon: <i data-ico="download" data-size="14" aria-hidden="true" />,
        disabled: checkingUpdates.has(packageKey(pkg)) || busyKey !== null,
        onSelect: () => void runAction("update", pkg),
      });
    } else if (pkg.canCheckForUpdates) {
      entries.push({
        label: t("i18n.check"),
        icon: <i data-ico="refresh-cw" data-size="14" aria-hidden="true" />,
        disabled: checkingUpdates.has(packageKey(pkg)) || busyKey !== null,
        onSelect: () => void checkForUpdates(pkg),
      });
    }
    entries.push({
      label: pkg.disabled ? t("i18n.enablePackage") : t("i18n.disablePackage"),
      icon: <i data-ico="power" data-size="14" aria-hidden="true" />,
      disabled: busyKey !== null,
      onSelect: () => void runAction(pkg.disabled ? "enable" : "disable", pkg),
    });
    entries.push({ type: "separator" });
    entries.push({
      label: t("i18n.remove"),
      icon: <i data-ico="trash-2" data-size="14" aria-hidden="true" />,
      danger: true,
      disabled: busyKey !== null,
      onSelect: () => openUninstallMenu(menuAnchor.current.x, menuAnchor.current.y, pkg),
    });
    openMenu(menuAnchor.current.x, menuAnchor.current.y, entries, {
      title: `${pkg.packageName ?? pkg.source}${pkg.version ? ` · ${pkg.version}` : ""}`,
      ...(sessionId ? { footer: t("agents.reloadRequired") } : {}),
    });
  }, [openMenu, t, updateStatuses, checkingUpdates, busyKey, runAction, checkForUpdates, sessionId, openDetail, openUninstallMenu]);
  const mcpBusy = busyKey?.startsWith("mcp:") ?? false;

  /* fork:v5-d15-frame-a —— MCP 桌面列表（画板 D-15 帧 A）的两个浮窗入口。
     行尾浮窗的条目顺序照板面：测试连接 / 编辑配置 / 看 N 个工具与各自曝光 /
     移动到项目配置 / ─ / 删除；分节级那三件（刷新 / 导入 / 日志）是跨 server
     的，留在内容列第一行右端的 ⋮ 里。两者都用插件帧 A 同一套 `ContextMenu`
     浮窗（`d-pop-float` + `d-menu-row`），不另画一个下拉。 */
  const openMcpRowMenu = useCallback((x: number, y: number, server: McpServerInfo) => {
    const otherScope: McpScope = server.scope === "project" ? "global" : "project";
    openMenu(x, y, [
      {
        label: mcpTesting === server.name ? t("mcp.testing") : t("mcp.test"),
        icon: <i data-ico="plug" data-size="14" aria-hidden="true" />,
        disabled: mcpBusy,
        onSelect: () => void testMcp(server),
      },
      {
        label: t("mcp.edit"),
        icon: <i data-ico="pencil" data-size="14" aria-hidden="true" />,
        disabled: mcpBusy,
        onSelect: () => {
          setMcpEditTarget(server);
          // 作用域要跟着被编辑的 server 走（见桌面分支里的同一段注释）。
          setMcpScope(server.scope);
          setMcpAddMode(true);
          setMcpActionError(null);
          setMcpActionMessage(null);
        },
      },
      {
        label: t("mcp.rowDetails"),
        icon: <i data-ico="eye" data-size="14" aria-hidden="true" />,
        onSelect: () => setMcpSelected((current) => (current === server.name ? null : server.name)),
      },
      {
        label: otherScope === "project" ? t("mcp.moveToProject") : t("mcp.moveToGlobal"),
        icon: <i data-ico="move-diagonal" data-size="14" aria-hidden="true" />,
        disabled: mcpBusy,
        onSelect: () => void moveMcp(server),
      },
      { type: "separator" },
      {
        label: t("mcp.delete"),
        icon: <i data-ico="trash-2" data-size="14" aria-hidden="true" />,
        danger: true,
        disabled: mcpBusy,
        onSelect: () => void removeMcp(server),
      },
    ], {
      title: `${server.name} · ${MCP_TRANSPORT_LABEL[server.kind]}`,
      footer: shortenPath(server.source),
    });
  }, [openMenu, t, mcpBusy, mcpTesting, testMcp, moveMcp, removeMcp]);

  const openMcpPageMenu = useCallback((x: number, y: number, refreshDisabled: boolean) => {
    openMenu(x, y, [
      {
        label: t("i18n.refresh"),
        icon: <i data-ico="refresh-cw" data-size="14" aria-hidden="true" />,
        disabled: refreshDisabled,
        onSelect: () => void loadMcp(),
      },
      {
        label: t("mcp.importButton"),
        icon: <i data-ico="import" data-size="14" aria-hidden="true" />,
        onSelect: () => {
          setMcpImportOpen(true);
          setMcpActionError(null);
          void loadDiscovered();
        },
      },
      {
        label: t("mcp.logButton"),
        icon: <i data-ico="file-text" data-size="14" aria-hidden="true" />,
        onSelect: () => setMcpLogOpen(true),
      },
    ], { title: t("mcp.moreActions") });
  }, [openMenu, t, loadMcp, loadDiscovered]);
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
        actions={
          mcpOnly && !isMobile ? undefined : mcpOnly ? (
            <>
              {/* 画板 43:147 —— 计数徽章是 `.pw-shead-acts` 的第一枚，不是页头文案：
                  「这页是干嘛的」归 p.sub，数据归徽章（SettingsUi 的 actions 契约）。 */}
              <Badge tone="count">{t("mcp.count", { count: String(mcpData?.servers.length ?? 0) })}</Badge>
              {/* fork:proma-46-mcp-catalog —— 目录入口由 fork/McpConfig.tsx 提供；
                  配置完回调 reload()，列表与徽章立即跟着更新。 */}
              {renderMcpCatalogEntry?.({ reload: () => void loadMcp() })}
              {/* fork:mcp-native-exposure —— 看日志：server 连不上时，浏览器只有一句
                  「MCP failed to load」，真正的第一手材料（哪个 server、握手到哪一步）
                  在 agent 目录的 mcp.log 里，此前对用户完全不可见。 */}
              <Btn
                variant="secondary"
                size="small"
                onClick={() => setMcpLogOpen(true)}
                title={t("mcp.logTitle")}
              >
                <i data-ico="file-text" data-size="13" aria-hidden="true" />
                {t("mcp.logButton")}
              </Btn>
              {/* fix:mcp-refresh-target —— 位置从工具栏搬进页头动作，行为不变：
                  它原来调 loadPlugins()（只打 /api/plugins、写插件页状态，于是列表、
                  徽章、错误态都不动），MCP 模式调 loadMcp()，置灰跟 MCP 自己的状态
                  （加载中 / MCP 动作在飞），不被插件页的 loading 牵连。 */}
              <Btn
                variant="secondary"
                size="small"
                onClick={() => void loadMcp()}
                disabled={mcpLoading || mcpBusy}
              >
                <i data-ico="refresh-cw" data-size="13" aria-hidden="true" />
                {t("i18n.refresh")}
              </Btn>
              <Btn
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
                <i data-ico="import" data-size="13" aria-hidden="true" />
                {t("mcp.importButton")}
              </Btn>
              {/* fork:mcp-paste —— 粘贴添加（安装命令 / JSON / 安装链接），与下面的
                  手填表单并列；两者共用同一套解析与预检。 */}
              <Btn
                variant="secondary"
                size="small"
                onClick={() => {
                  setView("mcp");
                  setMcpPasteMode(true);
                  setMcpAddMode(false);
                  setMcpEditTarget(null);
                  setMcpActionError(null);
                  setMcpActionMessage(null);
                }}
              >
                <i data-ico="clipboard-list" data-size="13" aria-hidden="true" />
                {t("mcp.add.pasteButton")}
              </Btn>
              <Btn
                variant="primary"
                size="small"
                onClick={() => {
                  setView("mcp");
                  setMcpAddMode(true);
                  setMcpPasteMode(false);
                  setMcpEditTarget(null);
                  setMcpActionError(null);
                  setMcpActionMessage(null);
                }}
              >
                <i data-ico="plus" data-size="13" aria-hidden="true" />
                {t("mcp.addButton")}
              </Btn>
            </>
          ) : (
            <>
              {hasCheckablePackages && (
                <Btn
                  /* fork:settings-frame（画板 62 帧 D）—— 页级动作只有「1 主 + 1 次」：
                     添加插件是 primary，检查更新恒为 outline。有可用更新时也不抢主色
                     —— 数量进按钮文案，行内还有箭头徽标提醒。 */
                  variant="secondary"
                  size="small"
                  onClick={() => void (availableUpdateCount > 0 ? updateAllPluginsAction() : checkForUpdates())}
                  disabled={footerBusy}
                  title={availableUpdateCount > 0 ? t("i18n.updateAllPluginsHint") : undefined}
                >
                  <i data-ico="refresh-cw" data-size="13" aria-hidden="true" />
                  {updatingAll
                    ? t("i18n.updating")
                    : checkingAll
                      ? t("i18n.checking")
                      : availableUpdateCount > 0
                        ? `${t("i18n.updateAllPlugins")} (${availableUpdateCount})`
                        : t("i18n.checkUpdates")}
                </Btn>
              )}
              <Btn
                variant="primary"
                size="small"
                onClick={() => {
                  setView("plugins");
                  setAddMode(true);
                  setActionError(null);
                  setActionMessage(null);
                }}
              >
                <i data-ico="plus" data-size="13" aria-hidden="true" />
                {t("i18n.addPlugin")}
              </Btn>
            </>
          )
        }
        /* fork:mcp-head-actions —— MCP 分节没有工具栏（画板 43 的 MCP 帧在页头与
           内容区之间没有 `.pw-stools`），省略 prop 即不渲染那一行（SettingsUi:442）。
           fork:v5-d13-frame-a —— 桌面插件分节同样没有工具栏：画板帧 A 的计数与刷新
           在「已装」那一节的计数行里（`.d-row`），单独再撑一条工具栏行就是画板上
           不存在的一条横线。手机档保留工具栏（两栏列表需要那一行）。 */
        toolbar={mcpOnly || !isMobile ? undefined : (
          <>
            <span className="d-grow" aria-hidden="true" />
            {data?.diagnostics.length ? (
              <Badge
                tone={data.diagnostics.some((d) => d.type === "error") ? "bad" : "warn"}
                title={data.diagnostics.map((d) => `${d.type}: ${d.source ? `${d.source}: ` : ""}${d.message}`).join("\n")}
              >
                {t("plugins.diagnostics", { count: data.diagnostics.length })}
              </Badge>
            ) : null}
            <Badge tone="count">
              {data ? `${data.totals.extensions} ext · ${data.totals.skills} skills` : ""}
            </Badge>
            <Btn size="small" onClick={() => void loadPlugins()} disabled={footerBusy}>
              {t("i18n.refresh")}
            </Btn>
          </>
        )}
        fill
      >
        {/* 画板 D-13：信任提示是 `.d-banner warn` 一行。 */}
        {!projectResourcesLoaded && (
          <div role="status" className="d-banner warn">
            <i data-ico="info" data-size="14" aria-hidden="true"></i>
            <span className="d-grow">{t("trust.pluginsNotLoaded")}</span>
          </div>
        )}

        {/* fork:mcp-undo —— 删除后的撤销通知：服务端只给了 token，条目原文在它那边。
            60 秒后自动消失；410（过期/已撤销）就不给了，失败可再试。 */}
        {mcpOnly && mcpUndo && (
          <div role="status" className="d-banner info">
            <i data-ico="undo-2" data-size="14"></i>
            <span className="d-grow">{t("mcp.undoNotice", { name: mcpUndo.name })}</span>
            <button
              type="button"
              className="d-btn sm"
              onClick={() => void undoMcpRemoval()}
              disabled={mcpUndo.undoing}
            >
              {mcpUndo.undoing ? t("mcp.undoing") : t("mcp.undo")}
            </button>
          </div>
        )}

        {mcpOnly && !isMobile ? (
          /* fork:v5-d15-frame-a —— 桌面：内容列一块 `.d-set-inner`，页头只留标题
             （画板帧 A 的 `d-modal-head` 就是一行标题）。添加 / 粘贴两态沿用
             已落地的 D-15 帧 B 表单与粘贴面板；列表态是帧 A 的 `.d-slottable`，
             条目级动作在行尾浮窗里，「看配置与工具曝光」把读数展开在列表下面
             （画板没有这一层 —— 偏离登记在 DIVERGENCE.md）。 */
          <div className="d-set-inner">
            {mcpAddMode ? (
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
            ) : mcpPasteMode ? (
              <McpPastePanel
                cwd={cwd}
                scope={mcpScope}
                data={mcpData}
                busy={Boolean(busyKey)}
                actionError={mcpActionError}
                onScopeChange={setMcpScope}
                onSubmit={(draft) => void pasteMcp(draft)}
                onCancel={() => setMcpPasteMode(false)}
              />
            ) : (
              <>
                <McpCodemodeSettings cwd={cwd || null} />
                <McpServerList
                  data={mcpData}
                  loading={mcpLoading}
                  actionError={mcpActionError}
                  actionMessage={mcpActionMessage}
                  busy={mcpBusy}
                  selectedName={mcpSelected}
                  catalogEntry={renderMcpCatalogEntry?.({ reload: () => void loadMcp() }) ?? null}
                  onAdd={() => {
                    setMcpAddMode(true);
                    setMcpPasteMode(false);
                    setMcpEditTarget(null);
                    setMcpActionError(null);
                    setMcpActionMessage(null);
                  }}
                  onPaste={() => {
                    setMcpPasteMode(true);
                    setMcpAddMode(false);
                    setMcpEditTarget(null);
                    setMcpActionError(null);
                    setMcpActionMessage(null);
                  }}
                  onToggle={(server) => void toggleMcp(server)}
                  onRowMenu={openMcpRowMenu}
                  onPageMenu={openMcpPageMenu}
                />
                {selectedMcp && (
                  <McpServerDetail
                    key={selectedMcp.name}
                    server={selectedMcp}
                    cwd={cwd}
                    busy={mcpBusy || mcpTesting === selectedMcp.name}
                    actionError={null}
                    actionMessage={null}
                    onToggle={() => void toggleMcp(selectedMcp)}
                    onRemove={() => void removeMcp(selectedMcp)}
                    onMove={() => void moveMcp(selectedMcp)}
                    onTest={() => void testMcp(selectedMcp)}
                    onExposure={(exposure) => void setMcpExposure(selectedMcp, exposure)}
                    onEdit={() => {
                      setMcpEditTarget(selectedMcp);
                      setMcpScope(selectedMcp.scope);
                      setMcpAddMode(true);
                    }}
                    authActions={renderMcpAuthActions?.(selectedMcp)}
                    headActions={false}
                  />
                )}
              </>
            )}
          </div>
        ) : !mcpOnly && !isMobile ? (
          /* fork:v5-d13-frame-a —— 桌面 = 画板 D-13 帧 A：sec「已装」= 计数行
             （总/启用/禁用 + 诊断与资源徽章 + 刷新）+
             每个作用域一块 `.d-card > .d-table`（插件 / 来源 / 版本 / 状态 / 启用 /
             更多）+ 未信任横幅。行点击开帧 C 详情弹层，行尾「更多」与开关是条目动作
             （板面同一分工：禁用 / 卸载 / 更新 / 详情都不许共用一枚开关）。
             偏离（数据面，不是取舍，登记在 DIVERGENCE.md）：
             ① 帧 A 的「依赖被禁用」横幅与帧 B「待生效」表都要依赖图 / 变更队列，
                `/api/plugins` 都不返回，所以不画 —— 帧 B 的那半句真话落在详情弹层
                的 foot（`agents.reloadRequired`）；
             ② 板面一张表列全部包，产品按作用域分块（每块标题带 `n/m` + 整组开关，
                fork:group-switch 的能力不能因为换表格丢掉）；
             ③ 页级动作（检查更新 / 添加插件）仍在页头（SettingsPage 的 actions
                契约），不在计数行里重复一枚 —— 板面帧 A 把它们放在计数行是因为
                那一帧没有页头。 */
          addMode ? (
            /* 「添加插件」两态：表单占住内容列（与 D-15 帧 B 的 MCP 表单同一处），
               装完 `installPlugin` 自己把 addMode 落回false。 */
            <div className="d-set-inner">
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
            </div>
          ) : (
          <div className="d-set-inner">
            <div className="d-set-sec">
              <div className="d-set-sec-t">{t("plugins.installedSection")}</div>
              <div className="d-row">
                <span className="d-t-xs d-t-faint d-grow">
                  {t("plugins.countSummary", {
                    total: String(packages.length),
                    enabled: String(packages.filter((pkg) => !pkg.disabled).length),
                    disabled: String(packages.filter((pkg) => pkg.disabled).length),
                  })}
                </span>
                {data?.diagnostics.length ? (
                  <Badge
                    tone={data.diagnostics.some((item) => item.type === "error") ? "bad" : "warn"}
                    title={data.diagnostics.map((item) => `${item.type}: ${item.source ? `${item.source}: ` : ""}${item.message}`).join("\n")}
                  >
                    {t("plugins.diagnostics", { count: String(data.diagnostics.length) })}
                  </Badge>
                ) : null}
                {data && (
                  <Badge tone="count">
                    {`${data.totals.extensions} ${t("i18n.extensionShort")} · ${data.totals.skills} ${t("i18n.skillShort")}`}
                  </Badge>
                )}
                <Btn
                  variant="ghost"
                  size="small"
                  onClick={() => void loadPlugins()}
                  disabled={footerBusy}
                  title={t("i18n.refresh")}
                >
                  <i data-ico="refresh-cw" data-size="13" aria-hidden="true" />
                  {t("i18n.refresh")}
                </Btn>
              </div>

              {loading ? (
                <div className="d-banner info">
                  <span className="d-run"><i data-ico="loader-circle" data-size="14" aria-hidden="true"></i></span>
                  <span className="d-grow">{t("i18n.loading")}</span>
                </div>
              ) : error ? (
                <div className="d-banner err">
                  <i data-ico="triangle-alert" data-size="14"></i>
                  <span className="d-grow">{error}</span>
                </div>
              ) : packages.length === 0 && standaloneExtensions.length === 0 ? (
                /* fork:settings-frame（画板 62 帧 D）—— 列表空态：记号图标 + 一句。 */
                <EmptyState>
                  <span className="d-empty-ico"><i data-ico="blocks" data-size="16" aria-hidden="true" /></span>
                  <p className="d-empty-t">{t("i18n.noPlugins")}</p>
                </EmptyState>
              ) : (
                <>
                  {/* 独立扩展不在任何包里（不装也能放一个 .js 进 agent 目录），
                      所以是表格之前的一块，没有开关也没有行尾菜单。 */}
                  {standaloneExtensions.length > 0 && (
                    <>
                      <div className="d-group-title">{t("i18n.extensions")}</div>
                      <div className="d-card">
                        <table className="d-table">
                          <thead>
                            <tr>
                              <th style={{ width: "26%" }}>{t("i18n.extensions")}</th>
                              <th>{t("plugins.sourceLabel")}</th>
                              <th>{t("i18n.status")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {standaloneExtensions.map((extension) => {
                              const key = extensionKey(extension);
                              return (
                                <tr
                                  key={key}
                                  className={detailOpen && selected === key ? "is-on" : undefined}
                                  title={extension.path}
                                  onClick={() => openDetail(key)}
                                >
                                  <td>
                                    <div className="d-col">
                                      <span className="d-t-b">{extension.name}</span>
                                      <span className="d-t-xs d-t-faint">
                                        {t(`mcp.scope.${extension.scope}`)}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="d-mono">{shortenPath(extension.path)}</td>
                                  <td>
                                    <Badge tone={extension.enabled ? "ok" : "mute"}>
                                      {extension.enabled ? t("plugins.statusLoaded") : t("i18n.disabled")}
                                    </Badge>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  {groupedPackages.map((group) => {
                    /* fork:group-switch（G4）—— 块标题右侧是 `n/m` + 整组开关；
                       只有全开才算开（部分开的组读起来是「关」，点一下补齐）。 */
                    const enabledCount = group.packages.filter((pkg) => !pkg.disabled).length;
                    const allEnabled = enabledCount === group.packages.length;
                    return (
                      <Fragment key={group.scope}>
                        <div className="d-group-title">
                          {group.scope}
                          <GroupSwitch
                            enabled={enabledCount}
                            total={group.packages.length}
                            disabled={footerBusy}
                            loading={busyKey === `group:${group.scope}`}
                            label={t(allEnabled ? "plugins.groupSwitchDisable" : "plugins.groupSwitchEnable", { group: group.scope })}
                            onChange={(next) => void setGroupPackages(group.scope, group.packages, next)}
                          />
                        </div>
                        {groupStatus?.scope === group.scope && (
                          <GroupStatus note={groupStatus.note} errorLines={groupStatus.lines} />
                        )}
                        <div className="d-card">
                          <table className="d-table">
                            <thead>
                              <tr>
                                <th style={{ width: "26%" }}>{t("plugins.colPackage")}</th>
                                <th>{t("plugins.sourceLabel")}</th>
                                <th>{t("i18n.version")}</th>
                                <th>{t("i18n.status")}</th>
                                <th>{t("plugins.colEnable")}</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.packages.map((pkg) => {
                                const key = packageKey(pkg);
                                const name = pkg.packageName ?? pkg.source;
                                return (
                                  <tr
                                    key={key}
                                    className={detailOpen && selected === key ? "is-on" : undefined}
                                    title={name}
                                    onClick={() => openDetail(key)}
                                  >
                                    {/* 板面第一列是「名称 + 一句描述」两行（`d-col`）。 */}
                                    <td>
                                      <div className="d-col">
                                        <span className="d-t-b">{name}</span>
                                        {pkg.description && (
                                          <span className="d-t-xs d-t-faint">{pkg.description}</span>
                                        )}
                                      </div>
                                    </td>
                                    <td><SourceTag pkg={pkg} /></td>
                                    <td className="d-mono">{pkg.version ?? "—"}</td>
                                    <td>
                                      {packageStatusBadge(
                                        pkg,
                                        updateStatuses[key],
                                        checkingUpdates.has(key),
                                        t,
                                      )}
                                    </td>
                                    <td>
                                      <button
                                        type="button"
                                        role="switch"
                                        aria-checked={!pkg.disabled}
                                        aria-label={`${pkg.disabled ? t("i18n.enablePackage") : t("i18n.disablePackage")} · ${name}`}
                                        title={pkg.disabled ? t("i18n.enablePackage") : t("i18n.disablePackage")}
                                        disabled={busyKey !== null}
                                        className={`d-switch${pkg.disabled ? "" : " on"}`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void runAction(pkg.disabled ? "enable" : "disable", pkg);
                                        }}
                                      />
                                    </td>
                                    <td>
                                      <button
                                        type="button"
                                        className="d-iconbtn"
                                        title={`${t("plugins.more")} · ${name}`}
                                        aria-label={`${t("plugins.more")} · ${name}`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          openRowMenu(event, pkg);
                                        }}
                                      >
                                        <i data-ico="ellipsis" data-size="14" aria-hidden="true" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </Fragment>
                    );
                  })}
                </>
              )}
            </div>
          </div>
          )
        ) : (
        <ConfigSplitView>
          <ConfigSidebar>
            <ConfigSidebarList>
              {mcpOnly ? null : (<>
              {loading ? (
                <div className="d-banner info">
                  <span className="d-run"><i data-ico="loader-circle" data-size="14" aria-hidden="true"></i></span>
                  {/* 这里原来是硬编码的 "Loading..."；i18n.loading 三语值就是它。 */}
                  <span className="d-grow">{t("i18n.loading")}</span>
                </div>
              ) : error ? (
                <div className="d-banner err">
                  <i data-ico="triangle-alert" data-size="14"></i>
                  <span className="d-grow">{error}</span>
                </div>
              ) : packages.length === 0 && standaloneExtensions.length === 0 ? (
                /* fork:settings-frame（画板 62 帧 D）—— 列表空态落在列表列内：
                   记号图标 + 一句，不再是一行 pw-alert 飘字。 */
                <EmptyState>
                  <span className="d-empty-ico"><i data-ico="blocks" data-size="16" aria-hidden="true" /></span>
                  <p className="d-empty-t">No plugins configured</p>
                </EmptyState>
              ) : (
                <>
                  {standaloneExtensions.length > 0 && (
                    <>
                      <div className="d-group-title">{t("i18n.extensions")}</div>
                      {standaloneExtensions.map((extension) => {
                        const key = extensionKey(extension);
                        const isActive = !addMode && selected === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            aria-current={isActive ? "page" : undefined}
                            className={`d-sess${isActive ? " is-on" : ""}`}
                            title={extension.path}
                            onClick={() => {
                              setSelected(key);
                              setAddMode(false);
                              setActionError(null);
                              setActionMessage(null);
                            }}
                          >
                            <span className="d-row">
                              <StatusDot active={extension.enabled} />
                              <span className={`d-sess-t d-grow${extension.enabled ? "" : " d-t-faint"}`}>
                                {extension.name}
                              </span>
                            </span>
                          </button>
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
                        <div className="d-group-title">
                          {group.scope}
                          <GroupSwitch
                            enabled={enabledCount}
                            total={group.packages.length}
                            disabled={footerBusy}
                            loading={busyKey === `group:${group.scope}`}
                            label={t(allEnabled ? "plugins.groupSwitchDisable" : "plugins.groupSwitchEnable", { group: group.scope })}
                            onChange={(enabled) => void setGroupPackages(group.scope, group.packages, enabled)}
                          />
                        </div>
                        {groupStatus?.scope === group.scope && (
                          <GroupStatus note={groupStatus.note} errorLines={groupStatus.lines} />
                        )}
                        {group.packages.map((pkg) => {
                          const key = packageKey(pkg);
                          const isSelected = !addMode && selected === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              aria-current={isSelected ? "page" : undefined}
                              className={`d-sess${isSelected ? " is-on" : ""}`}
                              title={pkg.description ?? pkg.source}
                              onClick={() => {
                                setView("plugins");
                                setSelected(key);
                                setAddMode(false);
                                setActionError(null);
                                setActionMessage(null);
                              }}
                            >
                              <span className="d-row">
                                <StatusDot active={!pkg.disabled} color={statusColor(pkg.status)} />
                                <span className={`d-sess-t d-grow${pkg.disabled ? " d-t-faint" : ""}`}>
                                  {pkg.source}
                                </span>
                                {updateStatuses[packageKey(pkg)]?.state === "update-available" && (
                                  <i data-ico="arrow-up" data-size="12" title={t("i18n.updateAvailable")} aria-hidden="true" />
                                )}
                              </span>
                            </button>
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
                      <div className="d-banner info">
                        <span className="d-run"><i data-ico="loader-circle" data-size="14" aria-hidden="true"></i></span>
                        <span className="d-grow">{t("i18n.loading")}</span>
                      </div>
                    ) : !mcpData && mcpActionError ? (
                      <div className="d-banner err">
                        <i data-ico="triangle-alert" data-size="14"></i>
                        <span className="d-grow">{mcpActionError}</span>
                      </div>
                    ) : (mcpData?.servers.length ?? 0) === 0 ? (
                      /* fork:settings-frame（画板 62 帧 D）—— 列表空态落在列表列内。 */
                      <EmptyState>
                        <span className="d-empty-ico"><i data-ico="server" data-size="16" aria-hidden="true" /></span>
                        <p className="d-empty-t">{t("mcp.emptyList")}</p>
                      </EmptyState>
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
                                  <StatusDot
                                    active={!server.disabled}
                                    color={server.disabled ? undefined : "var(--accent)"}
                                  />
                                  <span className="grow">
                                    <ConfigSidebarText className={server.disabled ? "d-t-faint" : undefined}>
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

          <div className="d-set-inner">
            {/* fork:pwa-plugins-agents（手机档）—— `fork-pwa-detail` 是这台面板的
                作用域钩子：把产品侧接线里那条只在并排两列成立的 `height: 100%`
                在手机档还给内容，滚动仍然只有内容区一个（规则见
                app/pwa-plugins-agents.css 第 2 节）。桌面端该类不参与任何布局。 */}
            {/* fork:codemode-settings-ui —— 代码模式三项设置（自动/始终、mode、预算），
                写在详情区顶部、server 详情之上：它决定**所有** server 的 codemode 曝光
                工具怎么到达模型，与选不选某个 server 无关。 */}
            {mcpOnly && !mcpAddMode && (
              <div style={{ marginBottom: "var(--s3)" }}>
                <McpCodemodeSettings cwd={cwd || null} />
              </div>
            )}
            <Stack className="fork-pwa-detail">
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
                ) : mcpPasteMode ? (
                  <McpPastePanel
                    cwd={cwd}
                    scope={mcpScope}
                    data={mcpData}
                    busy={Boolean(busyKey)}
                    actionError={mcpActionError}
                    onScopeChange={setMcpScope}
                    onSubmit={(draft) => void pasteMcp(draft)}
                    onCancel={() => setMcpPasteMode(false)}
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
                    onExposure={(exposure) => void setMcpExposure(selectedMcp, exposure)}
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
                  <EmptyState>
                    <span className="d-empty-ico"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" /></span>
                    <p className="d-empty-t">{t("mcp.emptyDetail")}</p>
                  </EmptyState>
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
              /* fork:v5-d13 —— 独立扩展没有包可管，头（作用域 + 名称）在这里；
                  桌面档的同一副内容走 ExtensionDetailModal（弹层 head 摆头）。 */
              <Stack className="fork-pwa-detail">
                <Row className="fork-pwa-head">
                  <RowGrow>
                    <ScopeTag scope={selectedExtension.scope} />
                    <Title>{selectedExtension.name}</Title>
                  </RowGrow>
                </Row>
                <StandaloneExtensionDetail extension={selectedExtension} />
              </Stack>
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
                <EmptyState>
                  <span className="d-empty-ico"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" /></span>
                  <p className="d-empty-t">{t("i18n.selectPackage")}</p>
                </EmptyState>
              )}
            </Stack>
          </div>
        </ConfigSplitView>
        )}
      </SettingsPage>

      {/* fork:v5-d13-frame-c —— 桌面帧 A 的详情弹层，挂在 SettingsPage 的兄弟位
          （与下面的导入 / 日志弹层同一位）：设置壳已经在那里了，再套一层抽屉式
          主从就是画板上没有的第四种形态。只在桌面插件分节渲染 —— 手机档（M-05）
          的详情是列表内联的，`only="mcp"` 的详情在内容列里。 */}
      {desktopTable && detailOpen && selectedPackage && (
        <PluginDetailModal
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
          onUninstall={(event) => openUninstallMenu(event.clientX, event.clientY, selectedPackage)}
          onClose={() => setDetailOpen(false)}
        />
      )}
      {desktopTable && detailOpen && selectedExtension && (
        <ExtensionDetailModal
          key={extensionKey(selectedExtension)}
          extension={selectedExtension}
          onClose={() => setDetailOpen(false)}
        />
      )}

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

      {/* fork:mcp-native-exposure —— 日志弹层与导入弹层同一形态、同一挂点。 */}
      <McpLogModal open={mcpLogOpen} onDismiss={() => setMcpLogOpen(false)} />
    </ConfigPanelShell>
  );
}
