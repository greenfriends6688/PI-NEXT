"use client";

import { useCallback, useEffect, useMemo, useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
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
  ConfigPanelShell,
  PwRadio,
  PwSearch,
  PwSelectBox,
  SettingsPage,
} from "./SettingsUi";
import { ModelSelector } from "./ModelSelector";
import { localCopy, NO_MODEL_PROVIDERS_HINT, READONLY_PROFILE_HINT } from "./settings-disabled-reasons";

/* fork:v5-landing · D-12 —— 本地内容基件只吐 d-*（同 SkillsConfig 的同名块）。
 * 页壳（SettingsPage / ConfigPanelShell / PwRadio / PwSearch / PwSelectBox）
 * 仍走 SettingsUi；本页**不再**有两栏（ConfigSplitView / ConfigSidebar）——
 * D-12 的内容列就是一串 `.d-set-inner > .d-set-sec`。 */
function Btn({
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

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="d-empty compact">{children}</div>;
}


const TOOL_OPTIONS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
/* fork:v5-landing · D-12 帧 C —— 白名单徽标那两个数**从勾选集真算**，不写死：
   写盘工具（能改文件 / 能跑命令）是这一节唯一要紧的口径。 */
const WRITE_TOOL_NAMES = new Set(["bash", "edit", "write"]);
/** 思考级别在高段时用 warn 徽标（画板 D-12 帧 B 的「高」），其余用 ok。 */
const HIGH_THINKING = new Set(["high", "xhigh", "max"]);
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

/** 画板 D-12 帧 C 的工具芯片：`.d-chips` 里的 `.d-chipbtn`，选中 `.is-on` + `check`，
 *  未选 `circle-slash`（画板把「能改东西」的工具放前面且默认不勾）。 */
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
      className={selected ? "d-chipbtn is-on fork-pwa-hit" : "d-chipbtn fork-pwa-hit"}
    >
      <i data-ico={selected ? "check" : "circle-slash"} data-size="12" aria-hidden="true"></i>
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
  /* fork:v5-landing · D-12 —— 工具栏的计数与搜索过滤（表格行与计数共用同一个判据）。 */
  const agentNeedle = agentQuery.trim().toLowerCase();
  const matchesAgentQuery = (profile: SubagentProfile) =>
    !agentNeedle ||
    profile.displayName.toLowerCase().includes(agentNeedle) ||
    profile.name.toLowerCase().includes(agentNeedle) ||
    (profile.description ?? "").toLowerCase().includes(agentNeedle);
  const visibleProfiles = profiles.filter(matchesAgentQuery);
  /* 画板 D-12 帧 C 的两枚计数徽标：从勾选集真算，白名单为空 / 全只读都是真的。 */
  const enabledToolCount = draft.tools.length;
  const writeToolCount = draft.tools.filter((tool) => WRITE_TOOL_NAMES.has(tool)).length;

  /* fork:v5-landing · D-12 帧 B —— profile 列表是 `.d-card > .d-table`：
     名称 / 描述 / 模型 / 思考 / max turns / 状态一行给全，派出去之前不用点开就知道
     「它会用什么模型、能不能写盘」。作用域从分组标题挪进「名称」那一格（分组没了，
     信息不能跟着没）。 */
  const renderAgentRow = (profile: SubagentProfile) => {
    const overridden = isSubagentProfileOverridden(profile, profiles);
    const isActive = selectedKey === profileKey(profile) && !creating;
    return (
      <tr
        key={profileKey(profile)}
        tabIndex={0}
        aria-current={isActive ? "true" : undefined}
        className={isActive ? "is-on" : undefined}
        style={{ cursor: "pointer" }}
        onClick={() => selectProfile(profile)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          selectProfile(profile);
        }}
      >
        <td className="d-mono d-t-b">{profile.name}</td>
        <td className="d-t-xs">{profile.description || profile.name}</td>
        <td className="d-mono d-t-xs">{profile.model ?? "—"}</td>
        <td>
          {profile.thinking
            ? <Badge tone={HIGH_THINKING.has(profile.thinking) ? "warn" : "ok"}>{profile.thinking}</Badge>
            : <span className="d-t-xs d-t-faint">—</span>}
        </td>
        <td className="d-mono">{profile.maxTurns ?? "—"}</td>
        <td>
          <div className="d-row">
            {/* 作用域从分组标题挪到这里（v1 的分组列没了，信息不能跟着没）。 */}
            <Badge>{t(`agents.scope.${profile.scope}`)}</Badge>
            <Badge tone={profile.enabled ? "ok" : "mute"}>
              {profile.enabled ? t("agents.statusReady") : t("agents.statusOff")}
            </Badge>
            {/* 被覆盖项给一枚中性徽章（画板：不标红）。 */}
            {overridden && <Badge>{t("agents.overridden")}</Badge>}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <ConfigPanelShell embedded={embedded} title={t("common.agents")} subtitle={shortenPath(cwd)} closeLabel={t("agents.close")} onClose={onClose}>
      {/* fork:v5-landing · D-12 —— 子代理分节不再是主从两栏。内容列是一串
          `.d-set-inner > .d-set-sec`：内置子代理（总开关 + 需重载会话）→ 共同上限 →
          profile 表 → 单个 profile 的细节 → 工具白名单。左导航仍是设置壳那一列
          （`.d-set-nav`），profile 的选择改由表格行承担 —— 画板 D-12 的十一张分节里
          没有一处 `.d-sess` 列表。 */}
      <SettingsPage
        title={t("common.agents")}
        toolbar={
          <>
            <PwSearch
              value={agentQuery}
              placeholder={t("agents.searchPlaceholder")}
              ariaLabel={t("agents.searchPlaceholder")}
              onChange={setAgentQuery}
            />
            <span className="d-grow" aria-hidden="true" />
            <Badge tone="count">{t("agents.count", { count: String(visibleProfiles.length) })}</Badge>
          </>
        }
      >
        <div className="d-set-inner">

          {/* 帧 A · 内置子代理：总开关 + 「需重载会话」徽标 + 重载入口。 */}
          <div className="d-set-sec">
            <div className="d-set-sec-t">{t("agents.builtinSection")}</div>
            <div className="d-set-row">
              <div className="d-set-row-box">
                <div className="d-set-row-t">{t("agents.builtInTitle")}</div>
              </div>
              {/* 「需重载会话」常驻在开关旁边（画板帧 A）：面板不假装它立刻生效。 */}
              <span className="d-grow-last">
                <span className="d-badge mute">
                  <i data-ico="lock" data-size="12" aria-hidden="true"></i>
                  {t("agents.reloadBadge")}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={builtInEnabled}
                aria-busy={settingsSaving || undefined}
                aria-label={t("agents.builtInTitle")}
                title={t("agents.builtInTitle")}
                disabled={settingsLoading || settingsSaving || reloading}
                className={`d-switch${builtInEnabled ? " on" : ""}`}
                onClick={() => void toggleBuiltInSubagents(!builtInEnabled)}
              />
            </div>
            {settingsError && (
              <div role="alert" className="d-banner err">
                <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
                <span className="d-grow">{settingsError}</span>
              </div>
            )}
            {/* 帧 A：切换后需重载会话 —— `.d-banner warn` + 重载入口。 */}
            {reloadNeeded && (
              <div className="d-banner warn">
                <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
                <span className="d-grow">{t("agents.reloadRequired")}</span>
                {sessionId && (
                  <button
                    type="button"
                    className="d-btn sm d-banner-btn"
                    onClick={() => void reloadSession()}
                    disabled={reloading || settingsSaving}
                  >
                    {reloading ? t("agents.reloading") : t("agents.reloadSession")}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 帧 A · 共同上限：产品这一档只有并发上限（`/api/subagents/settings`
              的第二个字段），所以只落这一行，不画板里没有数据的那两行。 */}
          <div className="d-set-sec">
            <div className="d-set-sec-t">{t("agents.limitsSection")}</div>
            <div className="d-set-row">
              <div className="d-set-row-box">
                <div className="d-set-row-t">{t("agents.maxConcurrent")}</div>
              </div>
              <span className="d-grow-last">
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
                  className="d-input d-mono"
                  style={{ width: 90, minWidth: 0, textAlign: "center" }}
                />
              </span>
            </div>
          </div>

          {/* 帧 B · profile 列表：`.d-set-row`（标签 + 新建）后接 `.d-card > .d-table`。 */}
          <div className="d-set-sec">
            <div className="d-set-row">
              <div className="d-set-row-box">
                <div className="d-set-row-t">{t("agents.profilesTitle")}</div>
              </div>
              <span className="d-grow-last">
                <Btn variant="primary" size="small" onClick={beginCreate}>
                  <i data-ico="plus" data-size="13" aria-hidden="true" />
                  {t("agents.newProfile")}
                </Btn>
              </span>
            </div>

            <div className="d-card">
              <table className="d-table">
                <thead>
                  <tr>
                    <th>{t("agents.colName")}</th>
                    <th>{t("agents.description")}</th>
                    <th>{t("agents.colModel")}</th>
                    <th>{t("agents.thinking")}</th>
                    <th>{t("agents.maxTurns")}</th>
                    <th>{t("agents.colStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6}><span className="d-t-xs d-t-faint">{t("agents.loading")}</span></td></tr>
                  ) : visibleProfiles.length === 0 ? (
                    /* 帧 D —— 过滤不到与一个都没有都落在表格里的一行，不另起空态卡。 */
                    <tr>
                      <td colSpan={6}>
                        <span className="d-t-xs d-t-faint">
                          {agentNeedle ? t("agents.noneFound") : t("agents.empty")}
                        </span>
                      </td>
                    </tr>
                  ) : visibleProfiles.map(renderAgentRow)}
                </tbody>
              </table>
            </div>
          </div>

          {/* 帧 B 下半 · 单个 profile 的细节。 */}
          {!selected && !creating ? (
            /* 帧 D —— 未选：`.d-empty` 记号 + 一句引导。 */
            <EmptyState>
              <span className="d-empty-ico"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" /></span>
              <p className="d-empty-t">{t("agents.empty")}</p>
            </EmptyState>
          ) : (
            <>
              <div className="d-set-sec">
                {/* 详情头 = 名称（h3）+ 作用域徽标 + 等宽路径 + 条目动作。
                    画板帧 B 的细节块没有这一行：产品的只读档需要「创建副本」这个唯一
                    出口，以及右侧的启用开关（只读说明文案指的就是它），所以保留，
                    形态仍照 `.d-set-sec-t` + `.d-badge` + `.d-mono` 那一族。 */}
                <div className="d-row fork-pwa-head">
                  <Title>{draft.displayName || draft.name || t("agents.new")}</Title>
                  {displayedScope && (
                    <Badge tone={displayedScope === "project" ? "accent" : undefined}>
                      {t(`agents.scope.${displayedScope}`)}
                    </Badge>
                  )}
                  <span title={fullPath} className="d-mono d-t-faint d-grow">
                    {displayedPath}
                  </span>
                  {selected && (mode === "view" || mode === "edit") && <Btn size="small" onClick={beginDuplicate} disabled={saving || toggling}>{t("agents.duplicate")}</Btn>}
                  {selected && isWritableScope(selected.scope) && mode === "edit" && <Btn variant="danger" size="small" onClick={() => void remove()} disabled={saving || toggling}>{t("agents.delete")}</Btn>}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.enabled}
                    aria-label={draft.enabled ? t("agents.disable") : t("agents.enable")}
                    title={draft.enabled ? t("agents.disable") : t("agents.enable")}
                    disabled={switchDisabled}
                    className={`d-switch${draft.enabled ? " on" : ""}`}
                    onClick={() => void toggleEnabled(!draft.enabled)}
                  />
                </div>

                {/* 只读态说明：`.d-banner info` 一行。 */}
                {readonlyProfile && selected && (
                  <div role="note" className="d-banner info">
                    <i data-ico="lock" data-size="14" aria-hidden="true"></i>
                    <span className="d-grow">
                      {localCopy(READONLY_PROFILE_HINT, locale, {
                        scope: t(`agents.scope.${selected.scope}`),
                      })}
                    </span>
                  </div>
                )}

                {creating && (
                  <div className="d-field">
                    <span className="d-field-t">{t("agents.saveScope")}</span>
                    {/* 画板 D-12：保存作用域是 `PwRadio` 芯片单选组。 */}
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
                  </div>
                )}

                {/* `.d-grid2` 两列放名称与模型，其余 `.d-field` 竖排。 */}
                <div className="d-grid2">
                  <div className="d-field">
                    <span className="d-field-t">{t("agents.name")}</span>
                    {creating ? (
                      <input aria-label={t("agents.name")} value={draft.name} disabled={disabled} onChange={(event) => update("name", event.target.value)} className="d-input d-mono" />
                    ) : (
                      // 只读 ID 是等宽文本（画板 D-12 的 ID 字段形态）。
                      <code className="d-mono">{draft.name}</code>
                    )}
                  </div>
                  <div className="d-field">
                    <span className="d-field-t">{t("agents.model")}</span>
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
                  </div>
                </div>
                {/* 「没有模型可选」是一句可见的说明，不只是控件上的 title。 */}
                {modelsError && <Badge tone="bad">{modelsError}</Badge>}
                {modelsUnavailable && <p className="d-t-xs d-t-faint">{noModelsHint}</p>}
                <div className="d-field">
                  <span className="d-field-t">{t("agents.displayName")}</span>
                  <input aria-label={t("agents.displayName")} value={draft.displayName} disabled={disabled} onChange={(event) => update("displayName", event.target.value)} className="d-input" />
                </div>
                <div className="d-field">
                  <span className="d-field-t">{t("agents.description")}</span>
                  <input aria-label={t("agents.description")} value={draft.description} disabled={disabled} onChange={(event) => update("description", event.target.value)} className="d-input" />
                </div>

                {/* 长文本段（系统指令）是一整行 `.d-field`。
                    `.agents-system-prompt` 保留：只承担「全局滚动条在场时仍可拖拽
                    右下角」的滚动条行为语义（settings.css，无画板对应物）。 */}
                <div className="d-field">
                  <span className="d-field-t">{t("agents.prompt")}</span>
                  <textarea
                    className="d-textarea agents-system-prompt"
                    aria-label={t("agents.prompt")}
                    value={draft.systemPrompt}
                    disabled={disabled}
                    onChange={(event) => update("systemPrompt", event.target.value)}
                    style={{ minHeight: 195, maxHeight: "60vh", resize: disabled ? "none" : "vertical" }}
                  />
                </div>

                <div className="d-grid2">
                  <div className="d-field">
                    <span className="d-field-t">{t("agents.thinking")}</span>
                    <PwSelectBox
                      value={draft.thinking ?? ""}
                      options={THINKING_OPTIONS.map((value) => ({ value, label: value || t("agents.inherit") }))}
                      ariaLabel={t("agents.thinking")}
                      disabled={disabled}
                      onChange={(value) => update("thinking", (value || undefined) as EditableProfile["thinking"])}
                    />
                  </div>
                  <div className="d-field">
                    <span className="d-field-t">{t("agents.maxTurns")}</span>
                    <input
                      aria-label={t("agents.maxTurns")}
                      type="number"
                      min={1}
                      value={draft.maxTurns ?? ""}
                      disabled={disabled}
                      onChange={(event) => update("maxTurns", event.target.value ? Number(event.target.value) : undefined)}
                      className="d-input d-mono"
                      style={{ width: 90, minWidth: 0, textAlign: "center" }}
                    />
                  </div>
                </div>

                <div className="d-set-row">
                  <div className="d-set-row-box">
                    <div className="d-set-row-t">{t("agents.inheritContext")}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.inheritContext}
                    aria-label={t("agents.inheritContext")}
                    title={t("agents.inheritContext")}
                    disabled={disabled}
                    className={`d-switch${draft.inheritContext ? " on" : ""}`}
                    onClick={() => update("inheritContext", !draft.inheritContext)}
                  />
                </div>
                <div className="d-set-row">
                  <div className="d-set-row-box">
                    <div className="d-set-row-t">{t("agents.background")}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.runInBackground}
                    aria-label={t("agents.background")}
                    title={t("agents.background")}
                    disabled={disabled}
                    className={`d-switch${draft.runInBackground ? " on" : ""}`}
                    onClick={() => update("runInBackground", !draft.runInBackground)}
                  />
                </div>

                {/* 表单级动作落在**表单块底部右对齐**（画板 62 的动作四级归位 ④）。 */}
                {editing && (
                  <div className="d-row fork-pwa-save">
                    <span className="d-grow" aria-hidden="true" />
                    <Btn
                      variant="primary"
                      onClick={() => void save()}
                      disabled={saving || savedOk || toggling || !draft.name.trim()}
                      className={savedOk ? "is-success" : undefined}
                    >
                      {savedOk && (
                        <i data-ico="check" data-size="13" aria-hidden="true"></i>
                      )}
                      <span>{savedOk ? t("i18n.saved") : saving ? t("agents.saving") : t("agents.save")}</span>
                    </Btn>
                  </div>
                )}
                {error && (
                  <div role="alert" className="d-banner err">
                    <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
                    <span className="d-grow">{error}</span>
                  </div>
                )}
              </div>

              {/* 帧 C · 工具白名单：内外置分两组芯片，计数徽标行，bash 单独一条警告。
                  画板帧 C 的「越权时怎么办」三行需要一套越权策略设置，产品没有这个
                  设置面（`lib/approval-policy.ts` 走的会话内批准，不是这里），所以
                  不画 —— 见 scripts/board-specs/d-12-settings-agents.mjs 的 knownDiffs。 */}
              <div className="d-set-sec">
                <div className="d-set-sec-t">{t("agents.tools")}</div>

                <div className="d-field">
                  <span className="d-field-t">{t("agents.toolsBuiltin")}</span>
                  <div className="d-chips">
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
                </div>

                <div className="d-field">
                  <span className="d-field-t">{t("agents.toolsExternal")}</span>
                  <div className="d-chips">
                    <ToolChip selected={draft.loadSkills} disabled={disabled} onClick={() => update("loadSkills", !draft.loadSkills)}>{t("agents.loadSkills")}</ToolChip>
                    <ToolChip selected={draft.loadExtensions} disabled={disabled} onClick={() => update("loadExtensions", !draft.loadExtensions)}>{t("agents.loadExtensions")}</ToolChip>
                  </div>
                </div>

                <div className="d-row">
                  <span className="d-badge ok">
                    <i data-ico="check" data-size="12" aria-hidden="true"></i>
                    {t("agents.toolsEnabled", { count: String(enabledToolCount) })}
                  </span>
                  <span className="d-badge mute">{t("agents.toolsWrite", { count: String(writeToolCount) })}</span>
                  <span className="d-grow" aria-hidden="true" />
                </div>

                <div className="d-banner warn">
                  <i data-ico="shield-alert" data-size="14" aria-hidden="true"></i>
                  <span className="d-grow">{t("agents.toolsShellWarn")}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </SettingsPage>
    </ConfigPanelShell>
  );
}
