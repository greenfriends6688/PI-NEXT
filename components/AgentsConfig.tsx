"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
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

/** 画板 42 编辑器网格（`.pw-grid2`）单元格的自带 inline：去掉 `.pw-field` 的
 *  行高与相邻发丝线，标签改到控件上方。逐字照抄画板，不是产品自创样式。 */
const gridFieldStyle: CSSProperties = {
  border: 0,
  minHeight: 0,
  display: "grid",
  gap: 4,
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
      className={selected ? "pw-chip accent" : "pw-chip"}
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
  const isMobile = useIsMobile();
  const { t } = useI18n();
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
          {/* fork:settings-frame（画板 62）—— 「内置子代理」两项从**顶部整宽**收进列表列。
              原来它们是两条 1160px 宽的设置行：标签在最左、开关/输入框在最右，
              两者相距 1000px；下面才切进两栏。现在放进 300px 的列表列顶部，
              标签与控件的距离回到一屏之内。 */}
          <div className="pw-block" style={{ marginTop: 0 }}>
            <ConfigField label={t("agents.builtInTitle")} hint={t("agents.builtInDescription")}>
              <ConfigControl>
                {reloadNeeded && sessionId && (
                  <ConfigButton size="small" onClick={() => void reloadSession()} disabled={reloading || settingsSaving}>
                    {reloading ? t("agents.reloading") : t("agents.reloadSession")}
                  </ConfigButton>
                )}
                <ConfigSwitch
                  checked={builtInEnabled}
                  disabled={settingsLoading || reloading}
                  loading={settingsSaving}
                  label={t("agents.builtInTitle")}
                  onChange={(enabled) => void toggleBuiltInSubagents(enabled)}
                />
              </ConfigControl>
            </ConfigField>
            <ConfigField label={t("agents.maxConcurrent")} hint={t("agents.maxConcurrentDescription")}>
              {/* 数字步进宽度是运行时布局值（pw-input 默认 min-width:200px 太宽）。 */}
              <input
                aria-label={t("agents.maxConcurrent")}
                type="number"
                min={1}
                max={32}
                value={maxConcurrent}
                disabled={settingsLoading || settingsSaving}
                onChange={(event) => setMaxConcurrent(Number(event.target.value))}
                onBlur={() => void updateMaxConcurrent(maxConcurrent)}
                className="pw-input"
                style={{ width: 64, textAlign: "center" }}
              />
            </ConfigField>
            {/* 画板 42 的第三行：空标签 + 右侧警示徽章（「改动需要重载会话才生效」）。 */}
            {reloadNeeded && (
              <ConfigField label="">
                <ConfigBadge tone="warn">
                  <span className="pw-ico"><i data-ico="triangle-alert" data-size="11"></i></span>
                  {t("agents.reloadRequired")}
                </ConfigBadge>
              </ConfigField>
            )}
          </div>
          <ConfigSidebarList>
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
              ) : (["project", "global", "workspace", "builtin"] as const).map((scope) => {
                const scopedProfiles = profiles.filter(
                  (profile) => profile.scope === scope && matchesAgentQuery(profile),
                );
                if (scopedProfiles.length === 0) return null;
                // fork:design-system —— 画板 42 的分组标题就是 `.pw-list` 的直接子元素
                // （pw-group-title），不再包自绘的 config-sidebar-group 层。
                return (
                  <Fragment key={scope}>
                    <ConfigSidebarGroupLabel>{t(`agents.scope.${scope}`)}</ConfigSidebarGroupLabel>
                    {scopedProfiles.map((profile) => {
                      const overridden = isSubagentProfileOverridden(profile, profiles);
                      return (
                        <ConfigSidebarItem
                          key={profileKey(profile)}
                          active={selectedKey === profileKey(profile) && !creating}
                          onClick={() => selectProfile(profile)}
                        >
                          {/* 画板 42：行首是**类型图标**（`.pw-ico` 的 bot），不再是自绘圆点；
                              启用时走 accent-text，停用/内置走弱化。 */}
                          <span className={`pw-ico${profile.enabled ? "" : " pw-dim"}`} style={profile.enabled ? { color: "var(--accent-text)" } : undefined}>
                            <i data-ico="bot" data-size="14" aria-hidden="true" />
                          </span>
                          {/* 名字 + 一句说明（`.pw-lname` / `.pw-lsub`）—— 一行两段，
                              原来是「圆点 + 光名字」，一列看下来太素也没有辨识度。 */}
                          <span className="grow">
                            <ConfigSidebarText className={profile.enabled ? "" : " is-muted"}>{profile.displayName}</ConfigSidebarText>
                            <ConfigSidebarSub>{profile.description || profile.name}</ConfigSidebarSub>
                          </span>
                          {/* 被覆盖项给一枚中性徽章（画板 42：不标红）。 */}
                          {overridden && <ConfigBadge>{t("agents.overridden")}</ConfigBadge>}
                          <ConfigStatusDot active={profile.enabled} />
                        </ConfigSidebarItem>
                      );
                    })}
                  </Fragment>
                );
              })}
          </ConfigSidebarList>
        </ConfigSidebar>

        {/* fork:settings-dialog-frame —— 画板 42 的右列只有一张 pw-detail 卡，
            按内容收口。原先这层是 is-fill（min-height:100%），把卡拉成整页高，
            底部留一大片空白、外圈看着像又套了一个弹窗。 */}
        <ConfigDetail>
          <ConfigDetailStack>
              {!selected && !creating ? (
                <ConfigEmptyState>{t("agents.empty")}</ConfigEmptyState>
              ) : (
                <ConfigDetailStack>
                  <ConfigDetailHeader>
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

                  {/* 画板 42 编辑器的两栏字段网格：ID / 显示名 / 模型覆盖。
                      窄屏收成一栏是运行时值（board.css 不含断点，没有 pw 基件）。 */}
                  <div className="pw-grid2" style={isMobile ? { gridTemplateColumns: "minmax(0, 1fr)" } : undefined}>
                    <ConfigField label={t("agents.name")} style={gridFieldStyle}>
                      {creating ? (
                        <input aria-label={t("agents.name")} value={draft.name} disabled={disabled} onChange={(event) => update("name", event.target.value)} className="pw-input pw-mono" style={{ width: "100%", minWidth: 0 }} />
                      ) : (
                        <code className="pw-mono">{draft.name}</code>
                      )}
                    </ConfigField>
                    <ConfigField label={t("agents.displayName")} style={gridFieldStyle}>
                      <input aria-label={t("agents.displayName")} value={draft.displayName} disabled={disabled} onChange={(event) => update("displayName", event.target.value)} className="pw-input" style={disabled ? disabledInputStyle : { width: "100%", minWidth: 0 }} />
                    </ConfigField>
                    <ConfigField label={t("agents.model")} style={gridFieldStyle}>
                      <div className="pw-rowgap">
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
                        {modelsError && <ConfigBadge tone="bad">{modelsError}</ConfigBadge>}
                      </div>
                    </ConfigField>
                  </div>

                  {/* 画板 42 的长文本段：`pw-sec-title` 小节标题 + 通栏控件。 */}
                  <ConfigSectionTitle>{t("agents.description")}</ConfigSectionTitle>
                  <input aria-label={t("agents.description")} value={draft.description} disabled={disabled} onChange={(event) => update("description", event.target.value)} className="pw-input" style={{ width: "100%", minWidth: 0 }} />

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

                  {/* 画板 42 的「工具与资源」：芯片表达，已选 accent、未选带 plus。
                      fix:agents-layout —— 芯片的两种状态原来没有任何文字说明，
                      用户实测「按钮啥的看不懂」；补一行 `.pw-hint` 讲清点法。 */}
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
                  </div>
                  <p className="pw-hint">{t("agents.toolsHint")}</p>

                  <ConfigSectionTitle>{t("agents.resources")}</ConfigSectionTitle>
                  <div className="pw-wrap">
                    <ToolChip selected={draft.loadSkills} disabled={disabled} onClick={() => update("loadSkills", !draft.loadSkills)}>{t("agents.loadSkills")}</ToolChip>
                    <ToolChip selected={draft.loadExtensions} disabled={disabled} onClick={() => update("loadExtensions", !draft.loadExtensions)}>{t("agents.loadExtensions")}</ToolChip>
                  </div>
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
                      style={{ width: 80, textAlign: "center" }}
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
                    <div className="pw-inline" style={{ marginTop: "var(--s3)" }}>
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
