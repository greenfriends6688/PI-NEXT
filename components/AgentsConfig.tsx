"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SubagentProfilesResponse, SubagentSettingsResponse } from "@/lib/api-types";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ModelsData } from "@/lib/models-cache";
import { isSubagentProfileOverridden } from "@/lib/subagent-profile-precedence";
import type { SubagentProfile, SubagentScope, SubagentWritableScope } from "@/lib/subagents";
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
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigEmptyState,
  ConfigField,
  ConfigPanelShell,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarSub,
  ConfigSidebarText,
  ConfigSplitView,
  ConfigSectionTitle,
  ConfigStatusDot,
  ConfigSwitch,
  ConfigDetailTitle,
  PwRadio,
  PwSearch,
  PwSelectBox,
  SettingsPage,
} from "./SettingsUi";
import { ModelSelector } from "./ModelSelector";
import { localCopy, NO_MODEL_PROVIDERS_HINT, READONLY_PROFILE_HINT } from "./settings-disabled-reasons";


const TOOL_OPTIONS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const THINKING_OPTIONS = ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type EditableProfile = Omit<SubagentProfile, "scope" | "filePath">;
type EditorMode = "view" | "edit" | "create";

const EMPTY_PROFILE: EditableProfile = {
  name: "custom-agent",
  displayName: "Custom agent",
  description: "",
  systemPrompt: "",
  tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
  loadSkills: false,
  loadExtensions: false,
  promptMode: "append",
  inheritContext: false,
  runInBackground: false,
  enabled: true,
};

/** pw-input 没有画板禁用态（画板没画 disabled 的输入框）：只读档
 *  （内置 / 工作区）的输入框要灰底示意「这里不可写」，所以保留这个
 *  运行时按 `disabled` 挂的条件 inline —— 全部走 token，没有字面值。 */
const disabledInputStyle: CSSProperties = {
  background: "var(--bg-panel)",
  color: "var(--text-dim)",
};

function editableProfile(profile: SubagentProfile): EditableProfile {
  return {
    name: profile.name,
    displayName: profile.displayName,
    description: profile.description,
    systemPrompt: profile.systemPrompt,
    tools: [...profile.tools],
    loadSkills: profile.loadSkills,
    loadExtensions: profile.loadExtensions,
    promptMode: profile.promptMode,
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.thinking ? { thinking: profile.thinking } : {}),
    ...(profile.maxTurns ? { maxTurns: profile.maxTurns } : {}),
    inheritContext: profile.inheritContext,
    runInBackground: profile.runInBackground,
    enabled: profile.enabled,
  };
}

function profileKey(profile: Pick<SubagentProfile, "scope" | "name">): string {
  return `${profile.scope}:${profile.name}`;
}

function duplicateProfileName(name: string, profiles: readonly SubagentProfile[]): string {
  const existing = new Set(profiles.map((profile) => profile.name.toLowerCase()));
  const base = `${name}-copy`;
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate.toLowerCase())) candidate = `${base}-${suffix++}`;
  return candidate;
}

function isWritableScope(scope: SubagentScope): scope is SubagentWritableScope {
  return scope === "global" || scope === "project";
}

/**
 * A built-in has no file to edit, so its fields stay read-only, but its switch is
 * live: the server records the name in `agents/settings.json` instead of writing a
 * copy of the profile to disk.
 */
// fork:builtin-subagent-disable
function isTogglableScope(scope: SubagentScope): boolean {
  return isWritableScope(scope) || scope === "builtin";
}

function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function displayProfilePath(profile: SubagentProfile, cwd: string): string | null {
  if (!profile.filePath) return null;
  if ((profile.scope === "project" || profile.scope === "workspace") && profile.filePath.startsWith(cwd)) {
    const relative = profile.filePath.slice(cwd.length).replace(/^[/\\]/, "");
    return `./${relative}`;
  }
  return shortenPath(profile.filePath);
}

/** fork:design-system —— 画板 42 的「工具与资源」芯片：已选项是 `.pw-chip accent`，
 *  未选项带 plus 图标。芯片是可点按钮（Tailwind preflight 归零 UA，board.css 出形）。 */
function ToolChip({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={selected ? "pw-chip accent fork-pwa-hit" : "pw-chip fork-pwa-hit"}
    >
      {!selected && <span className="pw-ico"><i data-ico="plus" data-size="12"></i></span>}
      {children}
    </button>
  );
}

export function AgentsConfig({
  cwd,
  sessionId = null,
  onClose,
  onReloaded,
  embedded = false,
}: {
  cwd: string;
  sessionId?: string | null;
  onClose: () => void;
  onReloaded?: () => void;
  embedded?: boolean;
}) {
  const { t, locale } = useI18n();
  const [profiles, setProfiles] = useState<SubagentProfile[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelsData["modelList"]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => getLastSettingsSelection("agents", cwd));
  const [draft, setDraft] = useState<EditableProfile>(EMPTY_PROFILE);
  const [mode, setMode] = useState<EditorMode>("view");
  const [targetScope, setTargetScope] = useState<SubagentWritableScope>("global");
  const [loading, setLoading] = useState(true);
  // fix:agents-layout（画板 42）—— 左列头是「搜索子代理 + 新建图标钮」，过滤走这里。
  const [agentQuery, setAgentQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [builtInEnabled, setBuiltInEnabled] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(10);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [reloadNeeded, setReloadNeeded] = useState(false);
  const [reloading, setReloading] = useState(false);

  const selected = useMemo(
    () => profiles.find((profile) => profileKey(profile) === selectedKey) ?? null,
    [profiles, selectedKey],
  );
  const modelSelectorOptions = useMemo(() => modelOptions.map((model) => ({
    provider: model.provider,
    modelId: model.id,
    name: model.name,
  })), [modelOptions]);

  const loadProfiles = useCallback(async (preferredKey?: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/subagents/profiles?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const data = await response.json() as Partial<SubagentProfilesResponse> & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      const next = data.profiles ?? [];
      setProfiles(next);
      const rememberedKey = preferredKey ?? getLastSettingsSelection("agents", cwd);
      const chosen = next.find((profile) => profileKey(profile) === rememberedKey)
        ?? next.find((profile) => profile.scope === "project")
        ?? next.find((profile) => profile.scope === "global")
        ?? next[0]
        ?? null;
      setSelectedKey(chosen ? profileKey(chosen) : null);
      if (chosen) {
        setDraft(editableProfile(chosen));
        setMode(isWritableScope(chosen.scope) ? "edit" : "view");
        if (isWritableScope(chosen.scope)) setTargetScope(chosen.scope);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    const controller = new AbortController();
    setSettingsLoading(true);
    setSettingsError(null);
    void (async () => {
      try {
        const response = await fetch("/api/subagents/settings", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json() as Partial<SubagentSettingsResponse> & { error?: string };
        if (!response.ok || data.error || typeof data.enabled !== "boolean") {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }
        setBuiltInEnabled(data.enabled);
        if (typeof data.maxConcurrent === "number") setMaxConcurrent(data.maxConcurrent);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setSettingsError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!controller.signal.aborted) setSettingsLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (selectedKey) setLastSettingsSelection("agents", selectedKey, cwd);
  }, [cwd, selectedKey]);

  useEffect(() => {
    const controller = new AbortController();
    setModelsLoading(true);
    setModelsError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/models?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal });
        const data = await response.json() as Partial<ModelsData> & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setModelOptions(data.modelList ?? []);
        setModelsError(data.modelError ?? null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setModelsError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!controller.signal.aborted) setModelsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [cwd]);

  const selectProfile = (profile: SubagentProfile) => {
    setSelectedKey(profileKey(profile));
    setDraft(editableProfile(profile));
    setMode(isWritableScope(profile.scope) ? "edit" : "view");
    if (isWritableScope(profile.scope)) setTargetScope(profile.scope);
    setError(null);
  };

  const beginCreate = () => {
    let name = "custom-agent";
    let suffix = 2;
    while (profiles.some((profile) => profile.name === name)) name = `custom-agent-${suffix++}`;
    setSelectedKey(null);
    setDraft({ ...EMPTY_PROFILE, name, displayName: name });
    setMode("create");
    setTargetScope("global");
    setError(null);
  };

  const beginDuplicate = () => {
    if (!selected) return;
    const name = duplicateProfileName(selected.name, profiles);
    setSelectedKey(null);
    setDraft({
      ...editableProfile(selected),
      name,
      displayName: t("agents.copyName", { name: selected.displayName }),
    });
    setMode("create");
    setTargetScope(isWritableScope(selected.scope) ? selected.scope : "global");
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: targetScope, profile: draft }),
      });
      const data = await response.json() as { profile?: SubagentProfile; error?: string };
      if (!response.ok || data.error || !data.profile) throw new Error(data.error ?? `HTTP ${response.status}`);
      await loadProfiles(profileKey(data.profile));
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected || !isWritableScope(selected.scope)) return;
    if (!window.confirm(t("agents.deleteConfirm", { name: selected.displayName }))) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: selected.scope, name: selected.name }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      await loadProfiles();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const editing = mode !== "view";
  const creating = mode === "create";
  const disabled = !editing || saving || toggling;
  const displayedScope = creating ? targetScope : selected?.scope;
  const displayedPath = creating
    ? targetScope === "global"
      ? `~/.pi/agent/agents/${draft.name || "..."}.md`
      : `./.pi/agents/${draft.name || "..."}.md`
    : selected
      ? displayProfilePath(selected, cwd) ?? t("agents.builtinPath")
      : "";
  const fullPath = creating ? displayedPath : selected?.filePath ?? displayedPath;
  const selectedModelAvailable = !draft.model || modelOptions.some((model) => `${model.provider}/${model.id}` === draft.model);
  // fork:disabled-reasons —— 一台没配供应商的机器上 `/api/models` 回 200 + 空列表：
  // `modelsError` 只在 HTTP 非 2xx 时有值，于是「指定模型」恒 disabled 却零提示。
  const modelsUnavailable = !modelsLoading && modelOptions.length === 0 && !modelsError;
  const noModelsHint = localCopy(NO_MODEL_PROVIDERS_HINT, locale);
  // 只读档 = 非 global / project 的来源（内置 / 工作区）：字段全灰且页面上原本
  // 一句解释都没有，唯一出口「创建副本」也没有任何文案指向它。
  const readonlyProfile = mode === "view" && selected !== null;
  const selectedModel = (() => {
    if (!draft.model) return null;
    const separator = draft.model.indexOf("/");
    return separator < 0
      ? { provider: "", modelId: draft.model }
      : { provider: draft.model.slice(0, separator), modelId: draft.model.slice(separator + 1) };
  })();
  const switchDisabled = creating
    ? disabled
    : !selected || !isTogglableScope(selected.scope) || saving || toggling;
  const update = <K extends keyof EditableProfile>(key: K, value: EditableProfile[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleEnabled = async (enabled: boolean) => {
    if (creating) {
      update("enabled", enabled);
      return;
    }
    if (!selected || !isTogglableScope(selected.scope)) return;
    setToggling(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: selected.scope, name: selected.name, enabled }),
      });
      const data = await response.json() as { profile?: SubagentProfile; error?: string };
      if (!response.ok || data.error || !data.profile) throw new Error(data.error ?? `HTTP ${response.status}`);
      const saved = data.profile;
      setProfiles((current) => current.map((profile) => profileKey(profile) === profileKey(saved) ? saved : profile));
      setDraft((current) => ({ ...current, enabled: saved.enabled }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setToggling(false);
    }
  };

  const toggleBuiltInSubagents = async (enabled: boolean) => {
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const response = await fetch("/api/subagents/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as Partial<SubagentSettingsResponse> & { error?: string };
      if (!response.ok || data.error || typeof data.enabled !== "boolean") {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setBuiltInEnabled(data.enabled);
      setReloadNeeded(Boolean(sessionId));
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSettingsSaving(false);
    }
  };

  const updateMaxConcurrent = async (value: number) => {
    setMaxConcurrent(value);
    setSettingsError(null);
    try {
      const response = await fetch("/api/subagents/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxConcurrent: value }),
      });
      const data = await response.json() as Partial<SubagentSettingsResponse> & { error?: string };
      if (!response.ok || data.error || typeof data.maxConcurrent !== "number") throw new Error(data.error ?? `HTTP ${response.status}`);
      setMaxConcurrent(data.maxConcurrent);
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const reloadSession = async () => {
    if (!sessionId) return;
    setReloading(true);
    setSettingsError(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      setReloadNeeded(false);
      onReloaded?.();
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReloading(false);
    }
  };

  /* fork:settings-frame（画板 62）—— 工具栏的计数与搜索过滤（列表与工具栏共用同一个判据）。 */
  const agentNeedle = agentQuery.trim().toLowerCase();
  const matchesAgentQuery = (profile: SubagentProfile) =>
    !agentNeedle ||
    profile.displayName.toLowerCase().includes(agentNeedle) ||
    profile.name.toLowerCase().includes(agentNeedle) ||
    (profile.description ?? "").toLowerCase().includes(agentNeedle);
  const visibleProfileCount = profiles.filter(matchesAgentQuery).length;
  // fork:settings-frame（画板 62 落位表）—— 列表行 = pw-litem（图标 + 名称 +
  // 描述副标题 + 被覆盖徽标 / 状态点），列表与「内置」组的行共用同一渲染。
  const renderAgentRow = (profile: SubagentProfile) => {
    const overridden = isSubagentProfileOverridden(profile, profiles);
    return (
      <ConfigSidebarItem
        key={profileKey(profile)}
        active={selectedKey === profileKey(profile) && !creating}
        onClick={() => selectProfile(profile)}
      >
        {/* 画板 42：行首是**类型图标**（`.pw-ico` 的 bot），启用走 accent-text
            （画板 42 行内 `style="color:var(--accent-text)"` 原样），停用/被覆盖走 pw-dim。 */}
        <span className={`pw-ico${profile.enabled ? "" : " pw-dim"}`} style={profile.enabled ? { color: "var(--accent-text)" } : undefined}>
          <i data-ico="bot" data-size="14" aria-hidden="true" />
        </span>
        {/* 名字 + 一句说明（`.pw-lname` / `.pw-lsub`）。停用态不再给名字挂旧的
            弱化类（settings.css 的 config-sidebar-text 族已退役）：画板 42 的
            停用行只弱化图标与状态点，名字保持正文色。 */}
        <span className="grow">
          <ConfigSidebarText>{profile.displayName}</ConfigSidebarText>
          <ConfigSidebarSub>{profile.description || profile.name}</ConfigSidebarSub>
        </span>
        {/* 被覆盖项给一枚中性徽章（画板 42：不标红）。 */}
        {overridden && <ConfigBadge>{t("agents.overridden")}</ConfigBadge>}
        <ConfigStatusDot active={profile.enabled} />
      </ConfigSidebarItem>
    );
  };

  return (
    <ConfigPanelShell embedded={embedded} title={t("common.agents")} subtitle={shortenPath(cwd)} closeLabel={t("agents.close")} onClose={onClose}>
      <SettingsPage
        title={t("common.agents")}
        sub={t("agents.pageSub")}
        actions={
          <ConfigButton variant="primary" size="small" onClick={beginCreate}>
            <span className="pw-ico"><i data-ico="plus" data-size="13" aria-hidden="true" /></span>
            {t("agents.new")}
          </ConfigButton>
        }
        toolbar={
          <>
            <PwSearch
              value={agentQuery}
              placeholder={t("agents.searchPlaceholder")}
              ariaLabel={t("agents.searchPlaceholder")}
              onChange={setAgentQuery}
            />
            <span className="pw-grow" aria-hidden="true" />
            <ConfigBadge tone="count">{t("agents.count", { count: String(visibleProfileCount) })}</ConfigBadge>
          </>
        }
        fill
      >
      <ConfigSplitView>
        <ConfigSidebar>
          <ConfigSidebarList>
            {/* fork:settings-frame（画板 62 落位表）—— 「启用内置子代理」开关 +
                「并发上限」从**顶部整宽的独立卡片**收成「内置」组顶部的一条紧凑
                设置行（行 anatomy 照画板 42 的 pw-field：标签 + small 说明在左，
                控件在右；两条整宽行 → 一行）。设置行不依赖列表加载结果，
                任何时候都可操作，所以挂在 loading / 空态分支之外。 */}
            <ConfigSidebarGroupLabel>{t("agents.scope.builtin")}</ConfigSidebarGroupLabel>
            <ConfigField label={t("agents.builtInTitle")} hint={t("agents.builtInDescription")}>
              <ConfigControl>
                <ConfigSwitch
                  checked={builtInEnabled}
                  disabled={settingsLoading || reloading}
                  loading={settingsSaving}
                  label={t("agents.builtInTitle")}
                  onChange={(enabled) => void toggleBuiltInSubagents(enabled)}
                />
                {/* fix:agents-row-collapse —— 这条行在**列表列**（295px）里，不是整宽设置页。
                    `.pw-input` 的 `min-width: 200px` 压过了内联的 `width: 64`（实测输入框
                    200px、控件列 238px），把标签列挤到 53px —— 标题折三行、说明折成一根
                    186px 高的条，整行 194px 高。`min-width` 归零后控件列 ≈100px，
                    标签拿回 ~190px。 */}
                <input
                  aria-label={t("agents.maxConcurrent")}
                  title={t("agents.maxConcurrentDescription")}
                  type="number"
                  min={1}
                  max={32}
                  value={maxConcurrent}
                  disabled={settingsLoading || settingsSaving}
                  onChange={(event) => setMaxConcurrent(Number(event.target.value))}
                  onBlur={() => void updateMaxConcurrent(maxConcurrent)}
                  className="pw-input"
                  style={{ width: 64, minWidth: 0, textAlign: "center" }}
                />
              </ConfigControl>
            </ConfigField>
            {/* 画板 42 的第三行：空标签 + 右侧警示徽章（「改动需要重载会话才生效」）
                与重载入口（会话在场时）。 */}
            {reloadNeeded && (
              <ConfigField label="">
                <ConfigControl>
                  {reloadNeeded && sessionId && (
                    <ConfigButton size="small" onClick={() => void reloadSession()} disabled={reloading || settingsSaving}>
                      {reloading ? t("agents.reloading") : t("agents.reloadSession")}
                    </ConfigButton>
                  )}
                  <ConfigBadge tone="warn">
                    <span className="pw-ico"><i data-ico="triangle-alert" data-size="11"></i></span>
                    {t("agents.reloadRequired")}
                  </ConfigBadge>
                </ConfigControl>
              </ConfigField>
            )}
            {loading ? (
              <div className="pw-alert info">
                <span className="pw-ico"><i data-ico="loader-circle" data-size="14" className="pw-anim-spin"></i></span>
                <span className="pw-grow">{t("agents.loading")}</span>
              </div>
            ) : visibleProfileCount === 0 ? (
              /* fork:settings-frame（画板 62）—— 列表空态落在列表列内（32px 图标 + 一句），
                 不再让「搜不到」静默留白。 */
              <ConfigEmptyState>
                <span className="mark"><i data-ico="bot" data-size="16" aria-hidden="true" /></span>
                <p>{agentNeedle ? t("agents.noneFound") : t("agents.empty")}</p>
              </ConfigEmptyState>
            ) : (
              <>
                {/* fork:settings-frame（画板 62 落位表）—— 「内置」组紧随组顶部的
                    设置行：先内置子代理行，再自定义组（项目 / 全局 / 工作区）。 */}
                {profiles
                  .filter((profile) => profile.scope === "builtin" && matchesAgentQuery(profile))
                  .map(renderAgentRow)}
                {(["project", "global", "workspace"] as const).map((scope) => {
                  const scopedProfiles = profiles.filter(
                    (profile) => profile.scope === scope && matchesAgentQuery(profile),
                  );
                  if (scopedProfiles.length === 0) return null;
                  // fork:design-system —— 画板 42 的分组标题就是 `.pw-list` 的直接子元素
                  // （pw-group-title），不再包自绘的 config-sidebar-group 层。
                  return (
                    <Fragment key={scope}>
                      <ConfigSidebarGroupLabel>{t(`agents.scope.${scope}`)}</ConfigSidebarGroupLabel>
                      {scopedProfiles.map(renderAgentRow)}
                    </Fragment>
                  );
                })}
              </>
            )}
          </ConfigSidebarList>
        </ConfigSidebar>

        {/* fork:settings-dialog-frame —— 画板 42 的右列只有一张 pw-detail 卡，
            按内容收口。原先这层是 is-fill（min-height:100%），把卡拉成整页高，
            底部留一大片空白、外圈看着像又套了一个弹窗。 */}
        <ConfigDetail>
          {/* fork:pwa-plugins-agents（手机档）—— `fork-pwa-detail` 是这台面板的作用域钩子：
              把产品侧接线里那条只在并排两列成立的 `height: 100%` 在手机档还给内容，
              滚动仍然只有内容区一个（规则见 app/pwa-plugins-agents.css 第 2 节）。
              桌面端该类不参与任何布局。 */}
          <ConfigDetailStack className="fork-pwa-detail">
              {!selected && !creating ? (
                /* fork:settings-frame（画板 62 帧 D）—— 详情未选：40px 方框图标
                   （`.mark`）+ 一句引导，居中。 */
                <ConfigEmptyState>
                  <span className="mark"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" /></span>
                  <p>{t("agents.empty")}</p>
                </ConfigEmptyState>
              ) : (
                <ConfigDetailStack>
                  <ConfigDetailHeader className="fork-pwa-head">
                    <ConfigDetailHeaderInfo>
                      {/* fix:agents-layout（画板 42）—— 详情头第一项是**名字**（h3），
                          后面才是作用域徽章与等宽路径。原来这一行没有名字，只有
                          「徽章 + 路径」，卡片没有标题。 */}
                      <ConfigDetailTitle>{draft.displayName || draft.name || t("agents.new")}</ConfigDetailTitle>
                      {/* fork:design-system SW-14 —— 画板 42 的详情头：作用域徽章 + 等宽路径。 */}
                      {displayedScope && (
                        <ConfigBadge tone={displayedScope === "project" ? "accent" : undefined}>
                          {t(`agents.scope.${displayedScope}`)}
                        </ConfigBadge>
                      )}
                      <span title={fullPath} className="pw-mono pw-dim pw-grow">
                        {displayedPath}
                      </span>
                    </ConfigDetailHeaderInfo>
                    <ConfigDetailActions>
                      {selected && (mode === "view" || mode === "edit") && <ConfigButton size="small" onClick={beginDuplicate} disabled={saving || toggling}>{t("agents.duplicate")}</ConfigButton>}
                      {selected && isWritableScope(selected.scope) && mode === "edit" && <ConfigButton variant="danger" size="small" onClick={() => void remove()} disabled={saving || toggling}>{t("agents.delete")}</ConfigButton>}
                      <ConfigSwitch checked={draft.enabled} disabled={switchDisabled} label={draft.enabled ? t("agents.disable") : t("agents.enable")} onChange={(checked) => void toggleEnabled(checked)} />
                    </ConfigDetailActions>
                  </ConfigDetailHeader>

                  {/* fork:disabled-reasons —— 只读态原来只有一枚灰色的路径文字
                      「内置配置」，17 个控件全灰却没有半句解释。说明 + 出口
                      （右上角「创建副本」）走画板 42 已有的 `.pw-alert info` 一行，
                      位置紧贴详情头，也就是那排全灰控件的正上方。 */}
                  {readonlyProfile && selected && (
                    <div role="note" className="pw-alert info">
                      <span className="pw-ico"><i data-ico="lock" data-size="14" aria-hidden="true" /></span>
                      <span className="pw-grow">
                        {localCopy(READONLY_PROFILE_HINT, locale, {
                          scope: t(`agents.scope.${selected.scope}`),
                        })}
                      </span>
                    </div>
                  )}

                  {creating && (
                    <ConfigField label={t("agents.saveScope")}>
                      {/* 画板 42 编辑器的「保存作用域」是芯片单选组（PwRadio）。 */}
                      <PwRadio
                        value={targetScope}
                        options={[
                          { value: "global", label: t("agents.scope.global") },
                          { value: "project", label: t("agents.scope.project") },
                        ]}
                        ariaLabel={t("agents.saveScope")}
                        disabled={saving}
                        onChange={setTargetScope}
                      />
                    </ConfigField>
                  )}

                  {/* fork:settings-frame（画板 62 落位表）—— 详情字段一律 `.pw-field`
                      行（标签左 / 控件右）：子代理 ID、显示名称、指定模型、描述。
                      原来的两栏网格（标签在控件上方）退役；画板的 `.pw-field` 就是
                      为这种「标签左、定宽控件右」的行设计的，字段跨度与左列协调。 */}
                  <ConfigField label={t("agents.name")}>
                    {creating ? (
                      <input aria-label={t("agents.name")} value={draft.name} disabled={disabled} onChange={(event) => update("name", event.target.value)} className="pw-input pw-mono" style={disabled ? disabledInputStyle : undefined} />
                    ) : (
                      // 只读 ID 是等宽文本（画板 42 的 ID 字段形态）。
                      <ConfigControl>
                        <code className="pw-mono">{draft.name}</code>
                      </ConfigControl>
                    )}
                  </ConfigField>
                  <ConfigField label={t("agents.displayName")}>
                    <input aria-label={t("agents.displayName")} value={draft.displayName} disabled={disabled} onChange={(event) => update("displayName", event.target.value)} className="pw-input" style={disabled ? disabledInputStyle : undefined} />
                  </ConfigField>
                  <ConfigField label={t("agents.model")}>
                    <ModelSelector
                      options={modelSelectorOptions}
                      value={selectedModel}
                      onChange={(provider, modelId) => update("model", `${provider}/${modelId}`)}
                      onClear={() => update("model", undefined)}
                      emptyLabel={modelsLoading ? t("agents.modelsLoading") : t("agents.inherit")}
                      selectedLabel={draft.model && !selectedModelAvailable ? t("agents.modelUnavailable", { model: draft.model }) : undefined}
                      disabled={disabled || modelsLoading || (modelOptions.length === 0 && !draft.model)}
                      ariaLabel={t("agents.model")}
                      variant="field"
                      placement="auto"
                    />
                  </ConfigField>
                  {/* 「没有模型可选」是一句可见的说明，不只是控件上的 title：
                      整页就这一处能解释下拉为什么只剩「跟随父会话」。 */}
                  {modelsError && <ConfigBadge tone="bad">{modelsError}</ConfigBadge>}
                  {modelsUnavailable && <p className="pw-hint">{noModelsHint}</p>}
                  <ConfigField label={t("agents.description")}>
                    <input aria-label={t("agents.description")} value={draft.description} disabled={disabled} onChange={(event) => update("description", event.target.value)} className="pw-input" style={disabled ? disabledInputStyle : undefined} />
                  </ConfigField>

                  {/* 画板 42 的长文本段：`pw-sec-title` 小节标题 + 通栏控件。
                      系统指令是整行宽控件，放 `.pw-detail` 直下、不塞进字段行 ——
                      board.css 的 `.pw-field` 只为定宽小控件设计。 */}
                  <ConfigSectionTitle>{t("agents.prompt")}</ConfigSectionTitle>
                  {/* `.agents-system-prompt` 保留：只承担「全局滚动条在场时仍可拖拽
                      右下角」的滚动条行为语义（settings.css，无画板对应物）。 */}
                  <textarea
                    className="pw-textarea agents-system-prompt"
                    aria-label={t("agents.prompt")}
                    value={draft.systemPrompt}
                    disabled={disabled}
                    onChange={(event) => update("systemPrompt", event.target.value)}
                    style={{ minHeight: 195, maxHeight: "60vh", resize: disabled ? "none" : "vertical" }}
                  />

                  {/* fork:settings-frame —— 画板 42 的「工具与资源」是一个芯片区：
                      已选工具 accent 芯片 + 「+ 加载技能 / + 加载扩展」入口芯片。
                      原来「工具 / 资源」分两个小节，现照画板合并。芯片的两种状态
                      原来没有任何文字说明，用户实测「按钮啥的看不懂」；两行
                      `.pw-hint` 讲清点法与作用。 */}
                  <ConfigSectionTitle>{t("agents.tools")}</ConfigSectionTitle>
                  <div className="pw-wrap">
                    {TOOL_OPTIONS.map((tool) => (
                      <ToolChip
                        key={tool}
                        selected={draft.tools.includes(tool)}
                        disabled={disabled}
                        onClick={() => update("tools", draft.tools.includes(tool) ? draft.tools.filter((item) => item !== tool) : [...draft.tools, tool])}
                      >
                        {tool}
                      </ToolChip>
                    ))}
                    <ToolChip selected={draft.loadSkills} disabled={disabled} onClick={() => update("loadSkills", !draft.loadSkills)}>{t("agents.loadSkills")}</ToolChip>
                    <ToolChip selected={draft.loadExtensions} disabled={disabled} onClick={() => update("loadExtensions", !draft.loadExtensions)}>{t("agents.loadExtensions")}</ToolChip>
                  </div>
                  <p className="pw-hint">{t("agents.toolsHint")}</p>
                  <p className="pw-hint">{t("agents.resourcesHint")}</p>

                  {/* 画板 42 详情底部的一组 `pw-field` 行（标签左、控件右）。 */}
                  <ConfigField label={t("agents.thinking")}>
                    <PwSelectBox
                      value={draft.thinking ?? ""}
                      options={THINKING_OPTIONS.map((value) => ({ value, label: value || t("agents.inherit") }))}
                      ariaLabel={t("agents.thinking")}
                      disabled={disabled}
                      onChange={(value) => update("thinking", (value || undefined) as EditableProfile["thinking"])}
                    />
                  </ConfigField>
                  <ConfigField label={t("agents.maxTurns")}>
                    <input
                      aria-label={t("agents.maxTurns")}
                      type="number"
                      min={1}
                      value={draft.maxTurns ?? ""}
                      disabled={disabled}
                      onChange={(event) => update("maxTurns", event.target.value ? Number(event.target.value) : undefined)}
                      className="pw-input"
                      style={{ width: 80, minWidth: 0, textAlign: "center" }}
                    />
                  </ConfigField>
                  <ConfigField label={t("agents.inheritContext")}>
                    <ConfigSwitch checked={draft.inheritContext} disabled={disabled} label={t("agents.inheritContext")} onChange={(checked) => update("inheritContext", checked)} />
                  </ConfigField>
                  <ConfigField label={t("agents.background")}>
                    <ConfigSwitch checked={draft.runInBackground} disabled={disabled} label={t("agents.background")} onChange={(checked) => update("runInBackground", checked)} />
                  </ConfigField>

                  {/* fork:settings-frame（画板 62）—— 表单级动作落在**表单块底部右对齐**，
                      不再放页面页脚：页脚是视口级的，滚动时它会脱离它保存的那张卡。 */}
                  {editing && (
                    <div className="pw-inline fork-pwa-save">
                      <span className="pw-grow" aria-hidden="true" />
                      <ConfigButton
                        variant="primary"
                        onClick={() => void save()}
                        disabled={saving || savedOk || toggling || !draft.name.trim()}
                        className={savedOk ? "is-success" : undefined}
                      >
                        {savedOk && (
                          <span className="pw-ico"><i data-ico="check" data-size="13"></i></span>
                        )}
                        <span>{savedOk ? t("i18n.saved") : saving ? t("agents.saving") : t("agents.save")}</span>
                      </ConfigButton>
                    </div>
                  )}
                  {(settingsError || error) && (
                    <div role="alert" className="pw-alert">
                      <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
                      <span className="pw-grow">{settingsError || error}</span>
                    </div>
                  )}
                </ConfigDetailStack>
              )}
          </ConfigDetailStack>
        </ConfigDetail>
      </ConfigSplitView>
      </SettingsPage>
    </ConfigPanelShell>
  );
}
