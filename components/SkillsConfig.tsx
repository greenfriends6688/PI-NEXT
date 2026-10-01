"use client";

import { Fragment, useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
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
  ConfigDetail,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigKv,
  ConfigPanelShell,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSplitView,
  ConfigSwitch,
  PwRadio,
  PwSearch,
  PwSelectBox,
  SettingsPage,
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

/** 列表行的快捷开关：画板 62 帧 B 的 `.pw-litem` 行尾是静态 `pw-switch` span，
 *  产品沿用这个形态做**指针快捷开关**（aria-hidden，不进键盘焦点序）——
 *  因为行本体是 `ConfigSidebarItem`（button），button 里再嵌真开关按钮是
 *  非法嵌套；键盘 / 读屏用户走详情 kv 里的「允许自动调用」真开关。
 *  不带 `is-loading`：那个类全仓没有对应规则（ConfigSwitch 挂的同样是死类）。 */
function RowToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <span
      aria-hidden="true"
      className={`pw-switch${enabled ? " on" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <i />
    </span>
  );
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
  const scopeLabels: Record<string, string> = {
    project: t("skills.scope.project"),
    global: t("skills.scope.global"),
    path: t("skills.scope.path"),
  };
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
  const [revealError, setRevealError] = useState<string | null>(null);

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

  /* fork:settings-frame（画板 62 帧 B）—— 详情头的「在文件面板打开」。
     应用内的文件面板 tab 由 AppShell 私有状态管理，分节侧没有打开入口；
     现有可用的最近动作是 /api/files/reveal（OS 文件管理器里定位 SKILL.md），
     允许根之外（全局技能目录）会被 403，错误就地显示。真正接进应用内面板
     需要壳（AppShell）暴露打开事件，见改版报告。 */
  const revealSkillFile = async () => {
    setRevealError(null);
    try {
      const res = await fetch("/api/files/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: skill.filePath, action: "reveal" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
    } catch (error) {
      setRevealError(error instanceof Error ? error.message : String(error));
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
      {/* fork:settings-frame（画板 62 帧 B）—— 详情从裸字段罗列改成
          「pw-inline 头 + pw-kv + SKILL.md 正文」。头部：技能名 h3 + 作用域徽标
          + grow + 条目级动作（在文件面板打开 / 检查更新 / 更新），
          「允许自动调用」开关按画板归进 kv 表。 */}
      <div className="pw-inline">
        <ConfigDetailTitle>{skill.name}</ConfigDetailTitle>
        <ConfigBadge tone={label === "project" ? "accent" : undefined}>
          {scopeLabels[label] ?? label}
        </ConfigBadge>
        <span className="pw-grow" aria-hidden="true" />
        <ConfigButton variant="ghost" size="small" onClick={() => void revealSkillFile()}>
          <span className="pw-ico"><i data-ico="external-link" data-size="13" aria-hidden="true" /></span>
          {t("sidebar.openInFileManager")}
        </ConfigButton>
        {skill.install?.canCheckForUpdates && (
          <ConfigButton
            variant="secondary"
            size="small"
            onClick={onCheckUpdate}
            disabled={checkingUpdate || updating}
          >
            <span className="pw-ico"><i data-ico="check" data-size="13" aria-hidden="true" /></span>
            {checkingUpdate ? t("i18n.checking") : t("i18n.check")}
          </ConfigButton>
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
      </div>
      {(!enabled || saveError || revealError) && (
        <div className="pw-inline">
          {!enabled && <span className="pw-dim">{t("i18n.hiddenButInvocable")}</span>}
          {saveError && <ConfigBadge tone="bad">{saveError}</ConfigBadge>}
          {revealError && <ConfigBadge tone="bad">{revealError}</ConfigBadge>}
        </div>
      )}

      {/* fork:settings-frame（画板 62 帧 B）—— kv 属性表：来源 / 路径 / 允许自动调用。
          版本折进「来源」一行（画板：`SkillHub · 已安装 v1.2.0`），更新状态徽章跟在后面。
          fork:skills-row-name-only（2026-10-02）—— 首行补「描述」：列表行撤掉副标题
          之后，这是描述唯一的出口（SKILL.md 预览把 frontmatter 当 yaml 节点吃掉 ——
          lib/markdown.ts 的 remark-frontmatter），落在详情头正下方 = 画板 kv 的
          「头 → 字段表」次序。形态照 PluginsConfig.tsx:425：插件详情的 kv 首行就是
          i18n.description，空则不出这一行。文案复用既有键，不新增 i18n。 */}
      <ConfigKv>
        {skill.description && (
          <>
            <dt>{t("i18n.description")}</dt>
            <dd>{skill.description}</dd>
          </>
        )}
        <dt>{t("skills.fieldSource")}</dt>
        <dd>
          {skill.install ? (
            <>
              {skill.install.skillsShUrl ? (
                <a
                  href={skill.install.skillsShUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={skill.install.skillsShUrl}
                  className="pw-mono"
                >
                  {skill.install.skillsShUrl.replace(/^https?:\/\//, "")} ↗
                </a>
              ) : (
                <span className="pw-mono">{skill.install.source}</span>
              )}
              <span className="pw-dim">
                {" · "}{t("i18n.installed")} v{shortVersion(updateStatus?.currentVersion ?? skill.install.versionHash)}
              </span>
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
            </>
          ) : (
            <span>{scopeLabels[label] ?? label}</span>
          )}
        </dd>
        <dt>{t("skills.fieldPath")}</dt>
        <dd className="pw-mono">{displayPath(skill.filePath)}</dd>
        <dt>{t("skills.allowAutoInvoke")}</dt>
        <dd>
          <ConfigSwitch
            checked={enabled}
            loading={toggling}
            label={enabled ? t("i18n.visibleInPrompt") : t("i18n.hiddenFromPrompt")}
            onChange={() => onToggle(skill)}
          />
        </dd>
      </ConfigKv>
      {updateError && (
        <div className="pw-inline">
          <ConfigBadge tone="bad">{updateError}</ConfigBadge>
        </div>
      )}

      {/* fork:settings-frame（画板 62 帧 B）—— SKILL.md：sec-title 行 = 标题 + grow
          + 编辑钮（画板 square-pen），编辑态换成 取消 / 保存，已保存徽章同行显示。 */}
      <div className="pw-sec-title">
        SKILL.md
        <span className="pw-grow" aria-hidden="true" />
        {savedAt && !editing && <ConfigBadge tone="ok">{t("i18n.saved")}</ConfigBadge>}
        {content !== null && !editing && (
          <ConfigButton
            variant="ghost"
            size="small"
            onClick={() => { setDraft(content); setEditing(true); setSavedAt(false); }}
          >
            <span className="pw-ico"><i data-ico="square-pen" data-size="13" aria-hidden="true" /></span>
            {t("skills.edit")}
          </ConfigButton>
        )}
        {editing && (
          <>
            <ConfigButton
              variant="secondary"
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
          {/* 画板 62 硬规则：详情内部不再套第二层滚动。textarea 不给 max-height，
              用 rows 跟着草稿行数长高（min-height:190px 在画板约等于 9 行），
              滚动交给详情列自己。 */}
          <textarea
            className="pw-textarea"
            value={draft}
            rows={Math.max(9, draft.split("\n").length + 1)}
            spellCheck={false}
            aria-label={`${t("skills.content")} · ${skill.name}`}
            onChange={(event) => setDraft(event.target.value)}
          />
          {/* fork:design-system —— 编辑提示是画板 42 的 `.pw-alert info` 一行。 */}
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
      {contentError && (
        /* fork:settings-frame（画板 62 帧 B）—— 磁盘冲突行：`pw-badge warn`
            + triangle-alert（画板「磁盘上的文件在你编辑期间被改过」同款）。
            冲突时当前逻辑已把磁盘内容换进草稿，这里只做提示，不动作。 */
        <div className="pw-inline">
          <ConfigBadge tone="warn">
            <span className="pw-ico"><i data-ico="triangle-alert" data-size="11" aria-hidden="true" /></span>
            {editing ? `${t("skills.saveFailed")}: ${contentError}` : contentError}
          </ConfigBadge>
        </div>
      )}
    </ConfigDetailStack>
  );
}

/** fork:skillhub / 画板 42 帧 3 —— 安装技能改成 **pw-modal 弹层**（上轮裁定项：
 *  内联视图退役）。结构照画板 42 的安装技能对话框：
 *  pw-modal-head（box 图标 + 标题 + grow + pw-iconbtn 关闭）› pw-modal-body
 *  （市场 radio + grow + 安装位置 selectbox ／ 搜索行 ／ 结果 pw-list 的 pw-prow 行
 *  ／ 提示 alert）› pw-modal-foot（取消）。数据与安装逻辑（/api/skills/install、
 *  /api/skills/install-skillhub、/api/skills/search、/api/skills/skillhub）不变。 */
function InstallSkillsModal({
  cwd,
  installedPackages,
  onInstalled,
  onDismiss,
}: {
  cwd: string;
  installedPackages: Record<SkillInstallScope, ReadonlySet<string>>;
  onInstalled: () => void;
  onDismiss: () => void;
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

  // fork:dsn-dialog-a11y — 与 ModelsConfig 的供应商选择弹层同一条口径：
  // 打开移焦（搜索框）、Tab 循环、Esc 关闭、背景 inert、关闭还焦点。
  const { dialogRef, dialogProps } = useDialogA11y({ open: true, onClose: onDismiss, initialFocusRef: inputRef });

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
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={t("i18n.addSkill")}
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "var(--scrim)", display: "grid", placeItems: "center" }}
      onClick={(event) => { if (event.target === event.currentTarget) onDismiss(); }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }}
    >
      {/* 画板 42 的弹层宽 640；board.css 的 `.pw-modal` 默认 560，这里用 min()
          压过它（门禁放行 calc/min，不写裸像素）。
          fork:skills-modal-scroll（2026-10-02，用户实测「添加技能弹窗滑不动」）——
          壳改成 **视口上限 + flex 列**，内容行拿 flex + min-height:0 才能收缩，
          board.css:643 的 `overflow-y:auto` 才真正生效。
          CDP 逐层量出来的原因（1440×900，50 条搜索结果，从弹层本体往上每一级）：
            · 弹层 `.pw-modal` 本体：display:block / overflow-y:hidden（board.css:632）
              / height:2678px / max-height:none —— 内容定高，顶端被顶出视口（top=-889）；
            · board.css:643 的 `.pw-modal-body{min-height:0;overflow-y:auto}` 形同虚设：
              scrollHeight 2576 === clientHeight 2576（父级没有上限，body 永远等于内容高）；
            · 祖先链 config-panel-surface / settings-section-host / settings-dialog-main /
              settings-dialog-surface / body / html **全是 overflow:hidden**，中间那层
              fixed 遮罩是 overflow:visible 且 scrollHeight 1789 > clientHeight 900 ——
              滚轮事件一路冒到 html 也没有可滚容器，所以滚轮 / 拖动 / 键盘三条路全断；
            · transform / filter 全是 none（逐级量过），`position:fixed` 没有失效，
              所以不是「弹层挂在 transform 祖先下」那一类。
          横向额外一处：内容行是 `display:grid`，列宽 auto 取 min-content，
          行内一个不断词的长名就能把轨道顶宽 → 给它 `gridTemplateColumns: minmax(0,1fr)`。
          修法照本仓既有的同一家族（不是自创）：ChatWindow.tsx:3028 的扩展对话框、
          ImagePreview.tsx:97、DirectoryPicker.tsx:228，以及并行修的 PluginsConfig.tsx:932
          （MCP 导入弹层 · fork:settings-modal-scroll，同一根因）——解法完全一致，
          这里跟同一口径。`- 32px` 用 `var(--app-viewport-height, 100dvh)`（同
          ChatWindow.tsx:2570 / FileViewer.tsx:1212），上限跟应用自己量出的视口高走。 */}
      <div
        className="pw-modal"
        style={{
          width: "min(640px, calc(100vw - 32px))",
          display: "flex",
          flexDirection: "column",
          maxHeight: "calc(var(--app-viewport-height, 100dvh) - 32px)",
        }}
      >
        <div className="pw-modal-head">
          <span className="pw-ico"><i data-ico="box" data-size="16" aria-hidden="true" /></span>
          {t("i18n.addSkill")}
          <span className="pw-grow" aria-hidden="true" />
          <button
            type="button"
            className="pw-iconbtn sm"
            onClick={onDismiss}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
          >
            <span className="pw-ico"><i data-ico="x" data-size="14" aria-hidden="true" /></span>
          </button>
        </div>
        {/* 内容行 = 唯一滚动容器（头尾固定）：flex + min-height:0 让它在壳的
            max-height 里收缩，overflow-y 与 board.css:643 同值（显式写出来是为了让
            「这个 bug 的正主就是这行」在源码里自证）；
            gridTemplateColumns 把 grid 列从 min-content 收成壳宽，防横向滚动条。 */}
        <div
          className="pw-modal-body"
          style={{
            flex: "1 1 0%",
            minHeight: 0,
            overflowY: "auto",
            gridTemplateColumns: "minmax(0, 1fr)",
          }}
        >
          {/* 画板 42 帧 3 第一行：市场切换 radio 在左，安装位置 selectbox 在右。 */}
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
            <PwSelectBox
              value={scope}
              options={[
                { value: "global", label: t("skills.scope.global") },
                { value: "project", label: t("skills.scope.project") },
              ]}
              ariaLabel={t("i18n.addSkill")}
              onChange={(next) => setScope(next === "project" ? "project" : "global")}
            />
          </div>

          {/* 搜索行：pw-input 吃掉剩余宽度 + 画板的 Enter 键帽 + 搜索动作。
              （画板的行级边框盒在 board.css 只给 .pw-stools 的 pw-search 供了样式，
              弹层里用 pw-input 原语承担。） */}
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
            <span className="pw-kbd" aria-hidden="true">Enter</span>
            <ConfigButton
              variant="primary"
              onClick={() => search(query)}
              disabled={searching || (!query.trim() && source !== "skillhub")}
            >
              {searching ? t("i18n.searching") : t("i18n.search")}
            </ConfigButton>
          </div>
          {/* fork:skills-modal-scroll —— 路径是不断词的长 token，`.pw-mono` 没有折行规则；
              内容行一旦有了 overflow-y:auto，横向溢出就会变成一条横滚动条（overflow-x
              由 visible 计算成 auto），所以这里让它自己折行而不是把壳撑宽。 */}
          <span className="pw-mono pw-dim" style={{ overflowWrap: "anywhere" }}>→ {installPath}</span>
          {/* 画板 42 安装弹层的底部信息条：安装走 npx、需要网络。 */}
          <span className="pw-hint">{t("skills.installHint")}</span>
          {source === "skillhub" && (
            <span className="pw-hint">
              {skillhubTotal > 0 ? t("skills.skillhubTotal", { total: skillhubTotal }) : t("skills.skillhubHint")}
            </span>
          )}

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
                    {/* fork:skills-modal-scroll —— board.css:625 的 `.pw-prow .grow` 只给了
                        `flex:1`，没有 `.pw-litem .grow`（board.css:858）那行 `min-width:0`。
                        技能名 / repo 是不断词 token：flex 项的自动最小宽度等于
                        min-content，撞不下的名字会把整行顶宽 → 内容行出横向滚动条。
                        补回同款 min-width:0，并让长 token 就地折行。 */}
                    <span className="grow" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
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
        </div>
        <div className="pw-modal-foot">
          <span className="pw-grow" aria-hidden="true" />
          <ConfigButton onClick={onDismiss}>{t("i18n.cancel")}</ConfigButton>
        </div>
      </div>
    </div>
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
  /* fork:settings-frame（画板 42 帧 3）—— 安装技能从详情列的内联视图改成
     pw-modal 弹层（上轮裁定项），这里只剩开关状态。 */
  const [installOpen, setInstallOpen] = useState(false);
  /* fork:settings-frame（画板 62）—— 工具栏里的搜索与作用域筛选。
     列表原来没有搜索框，17 个技能只能靠滚。按名字 + 描述 + 路径过滤。 */
  const [listQuery, setListQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "project" | "global" | "path">("all");
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

  /* fork:settings-frame（画板 62）—— 工具栏的计数与搜索过滤。
     计数从页脚搬到工具栏（页脚不再放动作，也不再重复列表的信息）。 */
  const updateCount = Object.values(updateStatuses).filter(
    (status) => status.state === "update-available",
  ).length;
  const listQueryTrimmed = listQuery.trim().toLowerCase();
  const visibleSkills = skills
    .filter((skill) => scopeFilter === "all" || sourceLabel(skill) === scopeFilter)
    .filter((skill) =>
      listQueryTrimmed
        ? skill.name.toLowerCase().includes(listQueryTrimmed) ||
          skill.description.toLowerCase().includes(listQueryTrimmed) ||
          skill.filePath.toLowerCase().includes(listQueryTrimmed)
        : true,
    );

  /* fork:settings-frame（画板 62 帧 B）—— 「全部更新」= 列表级动作，只更新
     检查出 update-available 的那些包（更新单个的 /api/skills/update 不变）。 */
  const updateAllAvailable = useCallback(async () => {
    const targets = skills.filter((skill) => {
      const key = updateKey(skill);
      return key !== null && updateStatuses[key]?.state === "update-available";
    });
    for (const skill of targets) {
      await updateInstalledSkill(skill);
    }
  }, [skills, updateStatuses, updateInstalledSkill]);

  const projectName = cwd.split(/[\\/]+/).filter(Boolean).pop() ?? cwd;

  /* fork:skills-row-name-only（2026-10-02，替代上条 fork:settings-frame 的「名称 +
      描述副标题」）—— 列表行 = pw-litem：图标（path 组用 folder-cog 弱化）+
      **只留 pw-lname**，行尾「可更新」warn 徽标或快捷开关（画板行尾的 pw-switch；
      键盘 / 读屏走详情 kv 的真开关）。
      为什么撤掉 pw-lsub（用户截图 · image-gen 铺 6 行、impeccable 铺 19 行）：
      画板 42 的副标题全是**一两行的手写短句**（「招标结构化抽取」/「PDF 读写」），
      而 board.css:860 的 `.pw-litem .pw-lsub` 只有 `color` + `font-size` ——
      **没有 overflow/white-space 钳位**，实测产品里 `white-space: normal`、
      行高 117~381px、副标题 5~19 行。副标题槽位本身不保证一行，真实描述一进来
      就把行高撑爆、把行尾开关推到几百像素之外。
      「截断成一行放副标题」需要补一条钳位 CSS，而 board.css 不归本文件管；
      名称一侧的钳位 board.css:859 已经给了（`.pw-lname` min-width:0 +
      overflow:hidden + text-overflow:ellipsis + white-space:nowrap），所以
      **行内只保留名称**：超长名走类自带的单行省略，不写内联高度。
      描述没有丢 —— 它挪到详情列的 kv 首行（见 SkillDetail 的 fork 注释）：
      SKILL.md 正文那一侧因为 lib/markdown.ts 的 remark-frontmatter 把 yaml 节点
      吃掉了，frontmatter 的 description 在页面上根本没有第二处出口。
      SkillHub / skills.sh 来源画板是徽标，但产品的 SkillHub 安装不写
      skills-lock（无法从数据区分），来源信息只在详情 kv 显示。 */
  const renderSkillRow = (skill: Skill) => {
    const isSelected = !installOpen && selected === skill.filePath;
    const disabled = skill.disableModelInvocation;
    const rowScope = sourceLabel(skill);
    const key = updateKey(skill);
    const hasUpdate =
      key !== null && updateStatuses[key]?.state === "update-available";
    return (
      <ConfigSidebarItem
        key={skill.filePath}
        active={isSelected}
        onClick={() => setSelected(skill.filePath)}
      >
        <span className={`pw-ico${rowScope === "path" ? " pw-dim" : ""}`}>
          <i data-ico={rowScope === "path" ? "folder-cog" : "box"} data-size="14" aria-hidden="true" />
        </span>
        <span className="grow">
          <span className={`pw-lname${disabled ? " pw-dim" : ""}`}>{skill.name}</span>
        </span>
        {hasUpdate ? (
          <ConfigBadge tone="warn" title={t("i18n.updateAvailable")}>
            {t("i18n.updateAvailable")}
          </ConfigBadge>
        ) : (
          <RowToggle
            enabled={!disabled}
            onToggle={() => void toggle(skill)}
          />
        )}
      </ConfigSidebarItem>
    );
  };

  return (
    <ConfigPanelShell embedded={embedded} title={t("common.skills")} subtitle={shortenPath(cwd)} closeLabel={t("i18n.close")} onClose={onClose}>
      <SettingsPage
        title={t("common.skills")}
        sub={t("skills.pageSub")}
        actions={
          <>
            {skills.some((skill) => Boolean(skill.install)) && (
              <ConfigButton
                variant="secondary"
                size="small"
                onClick={() => void checkForUpdates()}
                disabled={checkingAll || updatingSkill !== null}
              >
                <span className="pw-ico"><i data-ico="refresh-cw" data-size="13" aria-hidden="true" /></span>
                {checkingAll ? t("i18n.checking") : t("i18n.checkUpdates")}
              </ConfigButton>
            )}
            <ConfigButton variant="primary" size="small" onClick={() => setInstallOpen(true)}>
              <span className="pw-ico"><i data-ico="plus" data-size="13" aria-hidden="true" /></span>
              {t("i18n.addSkill")}
            </ConfigButton>
          </>
        }
        toolbar={
          <>
            <PwSearch
              value={listQuery}
              placeholder={t("skills.search")}
              ariaLabel={t("skills.search")}
              onChange={setListQuery}
            />
            <span className="pw-sep" aria-hidden="true" />
            <PwRadio
              value={scopeFilter}
              options={[
                { value: "all", label: t("skills.scope.all") },
                { value: "project", label: t("skills.scope.project") },
                { value: "global", label: t("skills.scope.global") },
                { value: "path", label: t("skills.scope.path") },
              ]}
              ariaLabel={t("i18n.scope")}
              onChange={setScopeFilter}
            />
            <span className="pw-grow" aria-hidden="true" />
            {/* 画板 62 帧 B 的计数徽章：`17 个 · 4 个可更新` 合并成一枚。 */}
            <ConfigBadge tone="count">
              {t("skills.count", { count: String(visibleSkills.length) })}
              {updateCount > 0 ? ` · ${updateCount} ${t("i18n.updates")}` : ""}
            </ConfigBadge>
            <ConfigButton
              size="small"
              onClick={() => void updateAllAvailable()}
              disabled={updateCount === 0 || checkingAll || updatingSkill !== null}
            >
              {checkingAll || updatingSkill !== null ? t("i18n.updating") : t("skills.updateAll")}
            </ConfigButton>
          </>
        }
        fill
      >
        {/* fork:design-system SW-14 —— 画板 42 / 43 的信任提示是 `.pw-alert info` 一行。 */}
        {!projectResourcesLoaded && (
          <div role="status" className="pw-alert info">
            <span className="pw-ico"><i data-ico="info" data-size="14"></i></span>
            <span className="pw-grow">{t("trust.skillsNotLoaded")}</span>
          </div>
        )}

        {/* fork:settings-frame（画板 62 帧 B）—— 列表 300 + 详情 760：`.pw-scontent.is-fixed`
            不滚，两列各自滚（board.css 的 `> .pw-cols > *`）。列表列 = 作用域分组
            （项目 · <cwd 名> / 全局 / 路径）+ pw-litem（图标 + 名称 + 描述副标题
            + 徽标或开关）；详情列 = pw-inline 头 + pw-kv + SKILL.md 正文。 */}
        <ConfigSplitView>
          <ConfigSidebar>
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
            ) : visibleSkills.length === 0 ? (
              /* fork:settings-frame（画板 62 帧 D）—— 列表空态落在列表列内。 */
              <ConfigEmptyState>
                <span className="mark"><i data-ico="box" data-size="16" aria-hidden="true" /></span>
                <p>{listQueryTrimmed ? t("skills.noneFound") : t("i18n.noSkills")}</p>
                {!listQueryTrimmed && <p className="pw-hint">{t("skills.emptyHint")}</p>}
              </ConfigEmptyState>
            ) : (
              /* fork:settings-frame（画板 62 帧 B）—— 作用域用分组标题表达，
                  不再按安装来源拆出第二层「/ skills.sh」组（来源进详情 kv）。 */
              (["project", "global", "path"] as const).map((scope) => {
                const grpSkills = visibleSkills.filter((skill) => sourceLabel(skill) === scope);
                if (grpSkills.length === 0) return null;
                const grpLabel = scope === "project"
                  ? `${t("skills.scope.project")} · ${projectName}`
                  : t(`skills.scope.${scope}`);
                return (
                  <Fragment key={scope}>
                    <ConfigSidebarGroupLabel>{grpLabel}</ConfigSidebarGroupLabel>
                    <div className="pw-list">
                      {orderSkillsByDormancy(grpSkills).map(renderSkillRow)}
                    </div>
                  </Fragment>
                );
              })
            )}
          </ConfigSidebar>

          {/* Right: detail — 画板 62 帧 D 的详情未选空态落在详情列居中。 */}
          <ConfigDetail>
            <ConfigDetailStack>
              {loading ? null : selectedSkill ? (
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
                <ConfigEmptyState>
                  <span className="mark"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" /></span>
                  <p>{t("i18n.selectSkill")}</p>
                </ConfigEmptyState>
              )}
            </ConfigDetailStack>
          </ConfigDetail>
        </ConfigSplitView>
      </SettingsPage>

      {installOpen && (
        <InstallSkillsModal
          cwd={cwd}
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
          onDismiss={() => setInstallOpen(false)}
        />
      )}
    </ConfigPanelShell>
  );
}
