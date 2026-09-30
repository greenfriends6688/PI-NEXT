"use client";

import { Fragment, useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import type {
  SkillInfo as Skill,
  SkillInstallScope,
  SkillSearchResult,
  SkillsResponse,
  SkillUpdateResult,
} from "@/lib/api-types";
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
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigField,
  ConfigFooter,
  ConfigListAction,
  ConfigPanelShell,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSplitView,
  ConfigSectionTitle,
  ConfigStatusDot,
  ConfigSwitch,
  PwRadio,
} from "./SettingsUi";
import { MarkdownBody } from "./MarkdownBody";

function shortenPath(p: string): string {
  // Match common home dir patterns: /Users/xxx, /home/xxx
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function sourceLabel(skill: Skill): string {
  const src = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (scope === "user" || src === "user") return "global";
  if (scope === "project" || src === "project") return "project";
  return "path";
}

export function orderSkillsByDormancy<
  T extends Pick<Skill, "disableModelInvocation">,
>(skills: T[]): T[] {
  return [
    ...skills.filter((skill) => !skill.disableModelInvocation),
    ...skills.filter((skill) => skill.disableModelInvocation),
  ];
}

function updateKey(skill: Skill): string | null {
  return skill.install
    ? `${skill.install.scope}\0${skill.install.package}`
    : null;
}

function shortVersion(version?: string): string {
  return version ? version.slice(0, 8) : "unknown";
}

function SkillDetail({
  skill,
  cwd,
  onToggle,
  toggling,
  saveError,
  updateStatus,
  checkingUpdate,
  updating,
  updateError,
  onCheckUpdate,
  onUpdate,
  onContentSaved,
}: {
  skill: Skill;
  cwd: string;
  onToggle: (skill: Skill) => void;
  toggling: boolean;
  saveError: string | null;
  updateStatus?: SkillUpdateResult;
  checkingUpdate: boolean;
  updating: boolean;
  updateError: string | null;
  onCheckUpdate: () => void;
  onUpdate: () => void;
  onContentSaved?: () => void;
}) {
  const { t } = useI18n();
  const label = sourceLabel(skill);
  const enabled = !skill.disableModelInvocation;

  // fork:skills-content — 正文读取 / 就地编辑。
  // 以前这里只有 name + description（frontmatter 的两个字段），正文得另外去文件浏览器
  // 找，而全局技能目录（~/.pi/agent/skills、~/.agents/skills）根本不在 /api/files 的
  // 允许根里。现在走 /api/skills/content：与 /api/skills PATCH 同一套根校验。
  const [content, setContent] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loadingContent, setLoadingContent] = useState(true);
  const [contentError, setContentError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingContent(true);
    setContentError(null);
    setEditing(false);
    setSavedAt(false);
    void fetch(`/api/skills/content?filePath=${encodeURIComponent(skill.filePath)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { content?: string; error?: string };
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        return data.content ?? "";
      })
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setDraft(text);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setContent(null);
        setContentError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingContent(false);
      });
    return () => { cancelled = true; };
  }, [skill.filePath]);

  const saveContent = async () => {
    setSaving(true);
    setContentError(null);
    try {
      const response = await fetch("/api/skills/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // baseContent = 打开时读到的原文，服务端据此做乐观并发检查（409）。
        body: JSON.stringify({ filePath: skill.filePath, content: draft, baseContent: content ?? "" }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; content?: string };
      if (response.status === 409) {
        // 文件被别的进程改过：把磁盘上的新内容换成当前草稿的基线，让用户先看再决定。
        setContent(data.content ?? null);
        setDraft(data.content ?? draft);
        throw new Error(t("skills.changedOnDisk"));
      }
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setContent(draft);
      setEditing(false);
      setSavedAt(true);
      // frontmatter 里就是 name / description，改完要让左侧列表跟着刷新。
      onContentSaved?.();
    } catch (error) {
      setContentError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  function displayPath(p: string): string {
    if (label === "project" && p.startsWith(cwd)) {
      const rel = p.slice(cwd.length).replace(/^[/\\]/, "");
      return `./${rel}`;
    }
    return shortenPath(p);
  }

  return (
    <ConfigDetailStack>
      {/* Path + tag + toggle, with a stable status row below. */}
      <ConfigDetailHeader>
        <ConfigDetailHeaderInfo>
          {/* fork:design-system SW-14 —— 作用域是状态徽章（画板 42 的 `.pw-badge accent`），
              路径是等宽元信息（画板 42 的 `.pw-mono` dd）。 */}
          <ConfigBadge tone={label === "project" ? "accent" : undefined}>
            {label}
          </ConfigBadge>
          <span className="pw-mono pw-dim pw-grow">
            {displayPath(skill.filePath)}
          </span>
        </ConfigDetailHeaderInfo>
        <ConfigDetailActions>
          <ConfigSwitch
            checked={enabled}
            loading={toggling}
            label={enabled ? t("i18n.visibleInPrompt") : t("i18n.hiddenFromPrompt")}
            onChange={() => onToggle(skill)}
          />
        </ConfigDetailActions>
      </ConfigDetailHeader>
      <div className="pw-inline">
        {!enabled && <span className="pw-dim">{t("i18n.hiddenButInvocable")}</span>}
        {saveError && <ConfigBadge tone="bad">{saveError}</ConfigBadge>}
      </div>

      {skill.install?.skillsShUrl && (
        <ConfigField label="Source">
          {/* 画板 42 的来源链接是等宽元信息（AddPluginPanel 的 `pw-mono pw-dim` 锚点同款）。 */}
          <a
            href={skill.install.skillsShUrl}
            target="_blank"
            rel="noreferrer"
            title={skill.install.skillsShUrl}
            className="pw-mono pw-dim"
          >
            {skill.install.skillsShUrl.replace(/^https?:\/\//, "")} ↗
          </a>
        </ConfigField>
      )}

      {skill.install && (
        <ConfigField label="Version">
          <ConfigControl>
            <span className="pw-mono">
              {shortVersion(updateStatus?.currentVersion ?? skill.install.versionHash)}
            </span>
            {skill.install.canCheckForUpdates && (
              <ConfigButton
                size="small"
                onClick={onCheckUpdate}
                disabled={checkingUpdate || updating}
              >
                 {t("i18n.check")}
              </ConfigButton>
            )}
            {updateStatus?.state === "update-available" && (
              <ConfigBadge tone="warn" title={t("i18n.updateAvailable")}>
                {shortVersion(updateStatus.latestVersion)}
              </ConfigBadge>
            )}
            {(checkingUpdate ||
              (updateStatus && updateStatus.state !== "update-available")) && (
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
            {updateStatus?.state === "update-available" && (
              <ConfigButton
                variant="primary"
                size="small"
                onClick={onUpdate}
                disabled={updating || checkingUpdate}
              >
                 {updating ? t("i18n.updating") : t("i18n.update")}
              </ConfigButton>
            )}
          </ConfigControl>
          {updateError && <ConfigBadge tone="bad">{updateError}</ConfigBadge>}
        </ConfigField>
      )}

      <ConfigField label="Name">
        <span className="pw-mono">
          {skill.name}
        </span>
      </ConfigField>

      <ConfigField label="Description">
        <span>
          {skill.description}
        </span>
      </ConfigField>

      <div>
        <ConfigSectionTitle>{t("skills.content")}</ConfigSectionTitle>
        {/* 画板 42 的编辑行动作：左状态徽章 + `.pw-grow` 撑开 + 右侧按钮组。 */}
        <div className="pw-inline">
          {savedAt && !editing && (
            <ConfigBadge tone="ok">{t("i18n.saved")}</ConfigBadge>
          )}
          <span className="pw-grow" aria-hidden="true" />
          {content !== null && !editing && (
            <ConfigButton size="small" onClick={() => { setDraft(content); setEditing(true); setSavedAt(false); }}>
              {t("skills.edit")}
            </ConfigButton>
          )}
          {editing && (
            <>
              <ConfigButton
                size="small"
                disabled={saving}
                onClick={() => { setDraft(content ?? ""); setEditing(false); setContentError(null); }}
              >
                {t("i18n.cancel")}
              </ConfigButton>
              <ConfigButton
                variant="primary"
                size="small"
                disabled={saving}
                onClick={() => { void saveContent(); }}
              >
                {saving ? t("i18n.saving") : t("i18n.save")}
              </ConfigButton>
            </>
          )}
        </div>

        {loadingContent ? (
          <div className="pw-alert info">
            <span className="pw-ico"><i data-ico="loader-circle" data-size="14" className="pw-anim-spin"></i></span>
            <span className="pw-grow">{t("i18n.loading")}</span>
          </div>
        ) : editing ? (
          <>
            {/* 画板 42 的 SKILL.md 编辑器就是 `.pw-textarea`；min/max 高度照它给
                textarea 写 inline 的写法，与只读视图（.skill-content-view）共用高度。 */}
            <textarea
              className="pw-textarea"
              value={draft}
              spellCheck={false}
              aria-label={`${t("skills.content")} · ${skill.name}`}
              onChange={(event) => setDraft(event.target.value)}
              style={{ minHeight: 200, maxHeight: 420 }}
            />
            {/* fork:design-system —— 编辑提示是画板 42 的 `.pw-alert info` 一行
                （「安装会走 npx skills add」同款），不再用自绘的 range-hint 类。 */}
            <div className="pw-alert info">
              <span className="pw-ico"><i data-ico="info" data-size="14"></i></span>
              <span className="pw-grow">{t("skills.contentHint")}</span>
            </div>
          </>
        ) : content !== null ? (
          <div className="skill-content-view">
            <MarkdownBody>{content}</MarkdownBody>
          </div>
        ) : (
          <div className="pw-alert">
            <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
            <span className="pw-grow">
              {contentError ? `${t("skills.contentLoadFailed")}: ${contentError}` : t("skills.contentLoadFailed")}
            </span>
          </div>
        )}
        {editing && contentError && (
          <div className="pw-alert">
            <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
            <span className="pw-grow">{t("skills.saveFailed")}: {contentError}</span>
          </div>
        )}
      </div>
    </ConfigDetailStack>
  );
}

/** fork:design-system —— 作用域切换 = 画板 42/43 的 `.pw-radio` 芯片组。
 *  不走 SettingsUi 的 PwRadio：它把 disabled 挂在整组上，而这里要按选项
 *  单独禁用「项目」（项目资源未加载时），所以像 PluginsConfig 的
 *  SegmentedScope 一样手写画板 DOM（产品侧接线由 fork-ui.css 的
 *  `.pw-radio > button` 承担）。 */
function ScopeRadio({
  value,
  projectResourcesLoaded,
  onChange,
}: {
  value: "global" | "project";
  projectResourcesLoaded: boolean;
  onChange: (scope: "global" | "project") => void;
}) {
  const { t } = useI18n();
  return (
    <span className="pw-radio" role="radiogroup" aria-label={t("i18n.scope")}>
      {(["global", "project"] as const).map((s) => {
        const active = value === s;
        const disabled = s === "project" && !projectResourcesLoaded;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={disabled ? t("trust.projectScopeUnavailable") : undefined}
            className={active ? "is-on" : undefined}
            onClick={() => {
              if (!disabled) onChange(s);
            }}
          >
            {s}
          </button>
        );
      })}
    </span>
  );
}

function AddSkillPanel({
  cwd,
  installedPackages,
  projectResourcesLoaded,
  onInstalled,
}: {
  cwd: string;
  installedPackages: Record<SkillInstallScope, ReadonlySet<string>>;
  projectResourcesLoaded: boolean;
  onInstalled: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [newlyInstalledPkgs, setNewlyInstalledPkgs] = useState<Set<string>>(
    new Set(),
  );
  const [scope, setScope] = useState<"global" | "project">("global");
  // fork:skillhub — 两个市场：skills.sh（原来的，npx 安装）与 SkillHub
  // （skillhub.cn，直接下 ZIP，不经 CLI）。切到 SkillHub 时会先按评分列一页，
  // 因为那边「按评分浏览」本身就是主要用法。
  const [source, setSource] = useState<"skills.sh" | "skillhub">("skills.sh");
  const [skillhubTotal, setSkillhubTotal] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (q: string, from: "skills.sh" | "skillhub" = source) => {
    // skills.sh 必须有关键词；SkillHub 留空 = 按评分浏览（它的默认视图）。
    if (!q.trim() && from !== "skillhub") return;
    setSearching(true);
    setSearchError(null);
    setResults([]);
    setSkillhubTotal(0);
    try {
      const res = from === "skillhub"
        ? await fetch("/api/skills/skillhub", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: q.trim(), pageSize: 30 }),
          })
        : await fetch("/api/skills/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: q.trim() }),
          });
      const d = (await res.json()) as {
        results?: SkillSearchResult[];
        total?: number;
        error?: string;
      };
      if (d.error) {
        setSearchError(d.error);
        return;
      }
      setResults(d.results ?? []);
      if (from === "skillhub" && typeof d.total === "number") setSkillhubTotal(d.total);
      if ((d.results ?? []).length === 0) setSearchError("No skills found");
    } catch (e) {
      setSearchError(String(e));
    } finally {
      setSearching(false);
    }
  }, [source]);

  // 切到 SkillHub 就先按评分列一屏，省得对着空列表不知道能搜什么。
  const switchSource = useCallback((next: "skills.sh" | "skillhub") => {
    setSource(next);
    setResults([]);
    setSearchError(null);
    setSkillhubTotal(0);
    if (next === "skillhub") void search(query, "skillhub");
  }, [query, search]);

  const install = useCallback(
    async (pkg: string, from: "skills.sh" | "skillhub" = "skills.sh") => {
      setInstalling(pkg);
      setInstallError(null);
      try {
        // SkillHub 走直接下载 ZIP 的那条；skills.sh 仍然交给 skills CLI。
        const res = from === "skillhub"
          ? await fetch("/api/skills/install-skillhub", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slug: pkg, scope, cwd }),
            })
          : await fetch("/api/skills/install", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ package: pkg, scope, cwd }),
            });
        const d = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok || d.error) {
          setInstallError(d.error ?? `HTTP ${res.status}`);
          return;
        }
        setNewlyInstalledPkgs((prev) =>
          new Set(prev).add(`${scope}:${pkg}`),
        );
        onInstalled();
      } catch (e) {
        setInstallError(String(e));
      } finally {
        setInstalling(null);
      }
    },
    [onInstalled, scope, cwd],
  );

  const installPath =
    scope === "global"
      ? "~/.pi/agent/skills/"
      : `${shortenPath(cwd)}/.pi/skills/`;

  return (
    <ConfigDetailStack>
      <ConfigDetailTitle>{t("i18n.addSkill")}</ConfigDetailTitle>

      {/* fork:skillhub —— 画板 42 安装对话框：市场切换是 `.pw-radio` 芯片组，
          右端是等宽元信息（总数 / 提示），与画板的 sec-title 尾注同款。 */}
      <div className="pw-inline">
        <PwRadio
          value={source}
          options={[
            { value: "skills.sh", label: "skills.sh" },
            { value: "skillhub", label: "SkillHub" },
          ]}
          ariaLabel={t("i18n.addSkill")}
          onChange={switchSource}
        />
        <span className="pw-grow" aria-hidden="true" />
        {source === "skillhub" && (
          <span className="pw-mono pw-dim">
            {skillhubTotal > 0 ? t("skills.skillhubTotal", { total: skillhubTotal }) : t("skills.skillhubHint")}
          </span>
        )}
      </div>

      {/* 搜索行：`.pw-input` 吃掉剩余宽度是画板 42 自带的 inline（搜索框 + 动作钮）。 */}
      <div className="pw-inline">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") search(query);
          }}
          placeholder={t("i18n.skillSearchPlaceholder")}
          className="pw-input"
          style={{ flex: 1, minWidth: 0 }}
        />
        <ConfigButton
          variant="primary"
          onClick={() => search(query)}
          disabled={searching || (!query.trim() && source !== "skillhub")}
        >
           {searching ? t("i18n.searching") : t("i18n.search")}
        </ConfigButton>
      </div>

      {/* Scope + install path row */}
      <div className="pw-inline">
        <ScopeRadio value={scope} projectResourcesLoaded={projectResourcesLoaded} onChange={setScope} />
        <span className="pw-grow" aria-hidden="true" />
        {/* 安装位置是等宽元信息（画板 43 AddPluginPanel 的同一款）。 */}
        <span className="pw-mono pw-dim">→ {installPath}</span>
      </div>

      {/* Errors */}
      {searchError && (
        <div className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
          <span className="pw-grow">{searchError}</span>
        </div>
      )}
      {installError && (
        <div className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
          <span className="pw-grow">{installError}</span>
        </div>
      )}

      {/* Results list —— 画板 42 安装对话框的 `.pw-prow` 行：
          图标 + 名字（b fw500）/ 描述（pw-desc block）/ 等宽 repo，
          右端安装量徽章（pw-badge count）+ 安装动作。 */}
      {results.length > 0 && (
        <div className="pw-list">
          {results.map((r) => {
            const isInstalled =
              installedPackages[scope].has(r.package) ||
              newlyInstalledPkgs.has(`${scope}:${r.package}`);
            const isInstalling = installing === r.package;
            const rowSource = r.source ?? "skills.sh";
            // split "owner/repo@skill" for cleaner display
            const atIdx = r.package.indexOf("@");
            const repopart = atIdx > -1 ? r.package.slice(0, atIdx) : r.package;
            const skillpart = atIdx > -1 ? r.package.slice(atIdx + 1) : null;
            return (
              <div key={r.package} className="pw-prow" title={r.package}>
                <span className="pw-ico"><i data-ico="box" data-size="14"></i></span>
                <span className="grow">
                  <b style={{ fontWeight: 500 }}>{skillpart ?? repopart}</b>
                  {/* fork:skillhub — SkillHub 的条目带摘要，装之前能看清是什么；
                      `display:block` 与 `font-weight:500` 都是画板 prow 的自带 inline。 */}
                  {r.description && (
                    <span className="pw-desc" style={{ display: "block" }}>
                      {r.description}
                    </span>
                  )}
                  <span className="pw-mono pw-dim" style={{ display: "block" }}>
                    {repopart}
                  </span>
                </span>
                <span className="pw-badge count">{r.installs}</span>
                {r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer" className="pw-mono pw-dim">
                    {rowSource === "skillhub" ? "skillhub.cn ↗" : "skills.sh ↗"}
                  </a>
                )}
                {isInstalled ? (
                  <ConfigBadge tone="ok">
                    <span className="pw-ico"><i data-ico="check" data-size="11"></i></span>
                    {t("i18n.installed")}
                  </ConfigBadge>
                ) : (
                  <ConfigButton
                    size="small"
                    onClick={() => !isInstalling && install(r.package, rowSource)}
                    disabled={isInstalling || installing !== null}
                  >
                    {isInstalling ? t("i18n.installing") : t("i18n.install")}
                  </ConfigButton>
                )}
              </div>
            );
          })}
        </div>
      )}
      {results.length === 0 && !searchError && !searching && (
        <div className="pw-alert info">
          <span className="pw-ico"><i data-ico="info" data-size="14"></i></span>
          <span className="pw-grow">
            Search{" "}
            <a href="https://skills.sh" target="_blank" rel="noreferrer" className="pw-mono">
              skills.sh
            </a>{" "}
            to discover and install skills for your agent.
          </span>
        </div>
      )}
    </ConfigDetailStack>
  );
}

export function SkillsConfig({
  cwd,
  onClose,
  embedded = false,
}: {
  cwd: string;
  onClose: () => void;
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => getLastSettingsSelection("skills", cwd));
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, SkillUpdateResult>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [updatingSkill, setUpdatingSkill] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [projectResourcesLoaded, setProjectResourcesLoaded] = useState(true);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`);
      const d = (await res.json()) as Partial<SkillsResponse> & { error?: string };
      if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
      const list = d.skills ?? [];
      setSkills(list);
      setProjectResourcesLoaded(d.projectResourcesLoaded ?? true);
      setSelected((current) => {
        if (current && list.some((skill) => skill.filePath === current)) return current;
        const initialSkill = list.find((skill) => !skill.disableModelInvocation) ?? list[0];
        return initialSkill?.filePath ?? null;
      });
      return list;
    } catch (e) {
      setError(String(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setUpdateStatuses({});
    setUpdateError(null);
    void loadSkills();
  }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selected) setLastSettingsSelection("skills", selected, cwd);
  }, [cwd, selected]);

  const checkForUpdates = useCallback(async (skill?: Skill) => {
    const targets = skill
      ? [skill]
      : skills.filter((item) => Boolean(item.install));
    const keys = targets
      .map(updateKey)
      .filter((key): key is string => Boolean(key));
    if (keys.length === 0) return;

    setUpdateError(null);
    setCheckingUpdates((current) => new Set([...current, ...keys]));
    if (!skill) setCheckingAll(true);
    try {
      const res = await fetch("/api/skills/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill?.install?.package,
          scope: skill?.install?.scope,
        }),
      });
      const data = (await res.json()) as {
        updates?: SkillUpdateResult[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUpdateStatuses((current) => {
        const next = { ...current };
        for (const update of data.updates ?? []) {
          next[`${update.scope}\0${update.package}`] = update;
        }
        return next;
      });
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingUpdates((current) => {
        const next = new Set(current);
        for (const key of keys) next.delete(key);
        return next;
      });
      if (!skill) setCheckingAll(false);
    }
  }, [cwd, skills]);

  const updateInstalledSkill = useCallback(async (skill: Skill) => {
    if (!skill.install) return;
    const key = updateKey(skill)!;
    setUpdatingSkill(key);
    setUpdateError(null);
    try {
      const res = await fetch("/api/skills/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill.install.package,
          scope: skill.install.scope,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        skill?: Skill;
        error?: string;
      };
      if (!res.ok || data.error || !data.success) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await loadSkills();
      const versionHash = data.skill?.install?.versionHash;
      setUpdateStatuses((current) => ({
        ...current,
        [key]: {
          package: skill.install!.package,
          scope: skill.install!.scope,
          state: "up-to-date",
          currentVersion: versionHash,
          latestVersion: versionHash,
        },
      }));
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdatingSkill(null);
    }
  }, [cwd, loadSkills]);

  const toggle = useCallback(async (skill: Skill) => {
    const next = !skill.disableModelInvocation;
    setToggling((s) => new Set(s).add(skill.filePath));
    setSaveError(null);
    try {
      const res = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: skill.filePath,
          disableModelInvocation: next,
        }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setSaveError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setSkills((prev) =>
        prev.map((s) =>
          s.filePath === skill.filePath
            ? { ...s, disableModelInvocation: next }
            : s,
        ),
      );
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setToggling((s) => {
        const n = new Set(s);
        n.delete(skill.filePath);
        return n;
      });
    }
  }, []);

  const selectedSkill = skills.find((s) => s.filePath === selected) ?? null;

  return (
    <ConfigPanelShell embedded={embedded} title={t("common.skills")} subtitle={shortenPath(cwd)} closeLabel={t("i18n.close")} onClose={onClose}>

        {/* fork:design-system SW-14 —— 画板 42 / 43 的信任提示是 `.pw-alert info` 一行。 */}
        {!projectResourcesLoaded && (
          <div role="status" className="pw-alert info">
            <span className="pw-ico"><i data-ico="info" data-size="14"></i></span>
            <span className="pw-grow">{t("trust.skillsNotLoaded")}</span>
          </div>
        )}

        {/* Body */}
        <ConfigSplitView>
          {/* Left: skill list */}
          <ConfigSidebar>
            <ConfigSidebarList>
              {loading ? (
                <div className="pw-alert info">
                  <span className="pw-ico"><i data-ico="loader-circle" data-size="14" className="pw-anim-spin"></i></span>
                  <span className="pw-grow">{t("i18n.loading")}</span>
                </div>
              ) : error ? (
                <div className="pw-alert">
                  <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
                  <span className="pw-grow">{error}</span>
                </div>
              ) : skills.length === 0 ? (
                <div className="pw-alert info">
                  <span className="pw-ico"><i data-ico="box" data-size="14"></i></span>
                  <span className="pw-grow">{t("i18n.noSkills")}</span>
                </div>
              ) : (
                (() => {
                  const groups: { label: string; skills: typeof skills }[] = [];
                  const scopeLabels = {
                    project: t("skills.scope.project"),
                    global: t("skills.scope.global"),
                    path: t("skills.scope.path"),
                  };
                  const groupDefinitions = [
                    {
                      label: `${scopeLabels.project} / skills.sh`,
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "project" &&
                        Boolean(skill.install?.skillsShUrl),
                    },
                    {
                      label: scopeLabels.project,
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "project" &&
                        !skill.install?.skillsShUrl,
                    },
                    {
                      label: `${scopeLabels.global} / skills.sh`,
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "global" &&
                        Boolean(skill.install?.skillsShUrl),
                    },
                    {
                      label: scopeLabels.global,
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "global" &&
                        !skill.install?.skillsShUrl,
                    },
                    {
                      label: scopeLabels.path,
                      matches: (skill: Skill) => sourceLabel(skill) === "path",
                    },
                  ];
                  for (const { label, matches } of groupDefinitions) {
                    const grpSkills = skills.filter(matches);
                    if (grpSkills.length > 0)
                      groups.push({ label, skills: grpSkills });
                  }
                  const renderSkillRow = (skill: Skill) => {
                    const isSelected =
                      !addMode && selected === skill.filePath;
                    const disabled = skill.disableModelInvocation;
                    return (
                      <ConfigSidebarItem
                        key={skill.filePath}
                        active={isSelected}
                        onClick={() => {
                          setSelected(skill.filePath);
                          setAddMode(false);
                        }}
                      >
                        <ConfigStatusDot active={!disabled} />
                        <ConfigSidebarText className={`is-grow${disabled ? " is-muted" : ""}`}>
                          {skill.name}
                        </ConfigSidebarText>
                        {(() => {
                          const key = updateKey(skill);
                          const status = key ? updateStatuses[key] : undefined;
                          if (status?.state !== "update-available") return null;
                          // 可更新标记 = 画板 43 列表行的 `.pw-ico` 箭头，不再手绘 SVG。
                          return (
                            <span title={t("i18n.updateAvailable")} className="pw-ico">
                              <i data-ico="arrow-up" data-size="12"></i>
                            </span>
                          );
                        })()}
                      </ConfigSidebarItem>
                    );
                  };
                  return groups.map(
                    ({ label: grpLabel, skills: grpSkills }) => {
                      // fork:design-system —— 画板 42 的分组标题就是 `.pw-list` 的直接
                      // 子元素（pw-group-title），不再包自绘的 config-sidebar-group 层。
                      return (
                        <Fragment key={grpLabel}>
                          <ConfigSidebarGroupLabel>
                            {grpLabel}
                          </ConfigSidebarGroupLabel>
                          {orderSkillsByDormancy(grpSkills).map(renderSkillRow)}
                        </Fragment>
                      );
                    },
                  );
                })()
              )}
            </ConfigSidebarList>
            {/* Add skill button */}
            <ConfigListAction
                onClick={() => setAddMode(true)}
                active={addMode}
              >
                 {t("i18n.addSkill")}
            </ConfigListAction>
          </ConfigSidebar>

          {/* Right: detail or add panel */}
          <ConfigDetail>
            <ConfigDetailStack>
              {addMode ? (
              <AddSkillPanel
                cwd={cwd}
                projectResourcesLoaded={projectResourcesLoaded}
                installedPackages={{
                  global: new Set(
                    skills
                      .filter((skill) => skill.install?.scope === "global")
                      .map((skill) => skill.install!.package),
                  ),
                  project: new Set(
                    skills
                      .filter((skill) => skill.install?.scope === "project")
                      .map((skill) => skill.install!.package),
                  ),
                }}
                onInstalled={() => {
                  void loadSkills();
                }}
              />
            ) : loading ? null : selectedSkill ? (
              <SkillDetail
                key={selectedSkill.filePath}
                skill={selectedSkill}
                cwd={cwd}
                onToggle={toggle}
                toggling={toggling.has(selectedSkill.filePath)}
                saveError={saveError}
                updateStatus={
                  updateKey(selectedSkill)
                    ? updateStatuses[updateKey(selectedSkill)!]
                    : undefined
                }
                checkingUpdate={
                  updateKey(selectedSkill)
                    ? checkingUpdates.has(updateKey(selectedSkill)!)
                    : false
                }
                updating={updatingSkill === updateKey(selectedSkill)}
                updateError={updateError}
                onCheckUpdate={() => void checkForUpdates(selectedSkill)}
                onUpdate={() => void updateInstalledSkill(selectedSkill)}
                onContentSaved={() => { void loadSkills(); }}
              />
              ) : (
                <ConfigEmptyState>{t("i18n.selectSkill")}</ConfigEmptyState>
              )}
            </ConfigDetailStack>
          </ConfigDetail>
        </ConfigSplitView>

        {/* Footer */}
        <ConfigFooter status={
            Object.values(updateStatuses).filter(
              (status) => status.state === "update-available",
            ).length > 0 && (
              /* 可更新计数是画板的 `.pw-badge warn`，不再手写 inline 颜色。 */
              <ConfigBadge tone="warn">
                {
                  Object.values(updateStatuses).filter(
                    (status) => status.state === "update-available",
                  ).length
                }{" "}
                {Object.values(updateStatuses).filter(
                  (status) => status.state === "update-available",
                ).length === 1
                   ? t("i18n.update")
                   : t("i18n.updates")}
              </ConfigBadge>
            )
        }>
          {!embedded && <ConfigButton onClick={onClose}>{t("i18n.close")}</ConfigButton>}
          {skills.some((skill) => Boolean(skill.install)) && (
            <ConfigButton variant="secondary" onClick={() => void checkForUpdates()} disabled={checkingAll || updatingSkill !== null}>
              {checkingAll ? t("i18n.checking") : t("i18n.checkUpdates")}
            </ConfigButton>
          )}
        </ConfigFooter>
    </ConfigPanelShell>
  );
}
