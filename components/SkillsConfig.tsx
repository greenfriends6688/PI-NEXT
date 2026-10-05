"use client";

import { Fragment, useState, useEffect, useCallback, useRef, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useIsMobile } from "@/hooks/useIsMobile";
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
import { getSkillSlugFromEntryPath } from "@/lib/skill-usage";
import {
  ConfigPanelShell,
  ConfigSidebar,
  ConfigSplitView,
  PwRadio,
  PwSearch,
  SettingsPage,
  itemsToSwitch,
} from "./SettingsUi";
import { MarkdownBody } from "./MarkdownBody";
import { useContextMenu, type ContextMenuEntry } from "./ContextMenu";

/* ---------------------------------------------------------------------------
 * fork:v5-skin-d-only —— 本地内容基件只吐 d-*（画板 system.css）。
 *
 * SettingsUi 的 `Config*` 内容基件（Btn / Badge / ConfigSwitch /
 * ConfigEmptyState / Stack / ConfigField / …）目前仍渲染 v1 的 `pw-*`
 * 类，在 v5 引入顺序下会覆盖新视觉。换皮后组件 DOM 只许带 d-*，所以这几件先在本
 * 文件内用画板类落地。**页壳**（SettingsPage / ConfigPanelShell / ConfigSplitView /
 * ConfigSidebar / PwRadio / PwSearch）仍走 SettingsUi，归 F 统一收口。 */
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
function GroupStatus({ errorLines }: { errorLines?: readonly string[] }) {
  if (!errorLines?.length) return null;
  return (
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
  );
}

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

/**
 * fork:proma-32-skill-usage —— 按 slug 找技能。
 *
 * slug 是 `skills/` 下的目录名（`lib/skill-usage.ts` 的 `getSkillSlugFromEntryPath`），
 * 而列表这一侧给的是绝对路径，所以比对走**同一个正则**，而不是字符串拼接 ——
 * 同名 skill 可能同时存在于全局与项目两处，命中哪条就选哪条（先到先得）。
 */
export function findSkillBySlug(skills: Skill[], slug: string): Skill | undefined {
  return skills.find((skill) => getSkillSlugFromEntryPath(skill.filePath) === slug);
}

export function orderSkillsByDormancy<
  T extends Pick<Skill, "disableModelInvocation">,
>(skills: T[]): T[] {
  return [
    ...skills.filter((skill) => !skill.disableModelInvocation),
    ...skills.filter((skill) => skill.disableModelInvocation),
  ];
}

/** 一次分组开关里每一条的结果：`error` 为空即写成功。
 *  与 `app/api/skills/route.ts` 的 `SkillToggleResult` 同形（上游放在
 *  `lib/api-types.ts`，那个文件不在本次改动的边界内，两边各留一份）。 */
export interface SkillToggleResult {
  filePath: string;
  error?: string;
}

/** 一个分组开关会改动的技能：还没处在目标状态的那些。 */
export function skillsToSwitch<
  T extends Pick<Skill, "disableModelInvocation">,
>(skills: readonly T[], enabled: boolean): T[] {
  return itemsToSwitch(skills, enabled, (skill) => !skill.disableModelInvocation);
}

/** 套用一批开关的结果：写失败的那条保持原状，其余换成新状态。 */
export function applySkillToggleResults<
  T extends Pick<Skill, "filePath" | "disableModelInvocation">,
>(skills: T[], results: SkillToggleResult[], disableModelInvocation: boolean): T[] {
  const changed = new Set(
    results.filter((result) => !result.error).map((result) => result.filePath),
  );
  return skills.map((skill) =>
    changed.has(skill.filePath) ? { ...skill, disableModelInvocation } : skill,
  );
}

function updateKey(skill: Skill): string | null {
  return skill.install
    ? `${skill.install.scope}\0${skill.install.package}`
    : null;
}

function shortVersion(version?: string): string {
  return version ? version.slice(0, 8) : "unknown";
}

/** 列表行的快捷开关（画板 D-11 帧 A 的行尾 `.d-switch`）：行本体是 `<button>`
 *  （`.d-sess`），里面再嵌真开关按钮是非法嵌套，所以这里是 `aria-hidden` 的
 *  指针快捷开关（不进键盘焦点序）；键盘 / 读屏用户走详情里的「允许自动调用」
 *  真开关（下面 `<button role="switch">`）。 */
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
      className={`d-switch${enabled ? " on" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    />
  );
}

/** fork:skills-content —— 正文读取 / 就地编辑 / 在访达中定位，一条 hook。
 *
 *  以前这里只有 name + description（frontmatter 的两个字段），正文得另外去文件浏览器
 *  找，而全局技能目录（~/.pi/agent/skills、~/.agents/skills）根本不在 /api/files 的
 *  允许根里。现在走 /api/skills/content：与 /api/skills PATCH 同一套根校验。
 *
 *  两个宿主共用：移动端的内联详情（SkillDetail）与桌面端的内容弹层
 *  （SkillContentModal，画板 D-11 帧 C）。 */
function useSkillContent(skill: Skill, onContentSaved?: () => void) {
  const { t } = useI18n();
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
      // frontmatter 里就是 name / description，改完要让列表跟着刷新。
      onContentSaved?.();
    } catch (error) {
      setContentError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  /* fork:settings-frame（画板 62 帧 B）—— 「在文件管理器中打开」。
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

  return {
    content, draft, setDraft, loadingContent, contentError, setContentError, editing, setEditing,
    saving, savedAt, setSavedAt, revealError, saveContent, revealSkillFile,
  };
}

/** 项目技能的路径显示成 `./…`，其余缩掉家目录。 */
function displaySkillPath(p: string, cwd: string, label: string): string {
  if (label === "project" && p.startsWith(cwd)) {
    const rel = p.slice(cwd.length).replace(/^[/\\]/, "");
    return `./${rel}`;
  }
  return shortenPath(p);
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
  const c = useSkillContent(skill, onContentSaved);
  const { content, draft, setDraft, loadingContent, contentError, setContentError, editing, setEditing, saving, savedAt, setSavedAt } = c;

  const displayPath = (p: string) => displaySkillPath(p, cwd, label);

  return (
    <Stack>
      {/* 画板 D-11 帧 C —— 详情 = 头部 + 行式信息 + SKILL.md 卡片。
          头部：技能名 h3 + 作用域徽标 + grow + 条目级动作（在文件面板打开 / 检查更新 / 更新），
          「允许自动调用」开关走 `.d-set-row` 右侧的 `.d-switch`。 */}
      <div className="d-row">
        <Title>{skill.name}</Title>
        <Badge tone={label === "project" ? "accent" : undefined}>
          {scopeLabels[label] ?? label}
        </Badge>
        <span className="d-grow" aria-hidden="true" />
        <Btn variant="ghost" size="small" onClick={() => void c.revealSkillFile()}>
          <i data-ico="external-link" data-size="13" aria-hidden="true" />
          {t("sidebar.openInFileManager")}
        </Btn>
        {skill.install?.canCheckForUpdates && (
          <Btn
            variant="secondary"
            size="small"
            onClick={onCheckUpdate}
            disabled={checkingUpdate || updating}
          >
            <i data-ico="check" data-size="13" aria-hidden="true" />
            {checkingUpdate ? t("i18n.checking") : t("i18n.check")}
          </Btn>
        )}
        {updateStatus?.state === "update-available" && (
          <Btn
            variant="primary"
            size="small"
            onClick={onUpdate}
            disabled={updating || checkingUpdate}
          >
            {updating ? t("i18n.updating") : t("i18n.update")}
          </Btn>
        )}
      </div>
      {(!enabled || saveError || c.revealError) && (
        <div className="d-row">
          {!enabled && <span className="d-t-xs d-t-faint">{t("i18n.hiddenButInvocable")}</span>}
          {saveError && <Badge tone="bad">{saveError}</Badge>}
          {c.revealError && <Badge tone="bad">{c.revealError}</Badge>}
        </div>
      )}

      {/* 画板 D-11 帧 C：详情用行式 `.d-set-row`（左文案 / 右控件或徽章），
          不再用 v1 的 `<dl class="pw-kv">`。*/}
      <div className="d-set-sec">
        {skill.description && (
          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("i18n.description")}</div>
              <div className="d-set-row-s">{skill.description}</div>
            </div>
          </div>
        )}
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("skills.fieldSource")}</div>
            <div className="d-set-row-s">
              {skill.install ? (
                <>
                  {skill.install.skillsShUrl ? (
                    <a
                      href={skill.install.skillsShUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={skill.install.skillsShUrl}
                      className="d-mono"
                    >
                      {skill.install.skillsShUrl.replace(/^https?:\/\//, "")} ↗
                    </a>
                  ) : (
                    <span className="d-mono">{skill.install.source}</span>
                  )}
                  {" · "}{t("i18n.installed")} v{shortVersion(updateStatus?.currentVersion ?? skill.install.versionHash)}
                </>
              ) : (
                <span>{scopeLabels[label] ?? label}</span>
              )}
            </div>
          </div>
          <span className="d-grow-last">
            {skill.install && updateStatus?.state === "update-available" && (
              <Badge tone="warn" title={t("i18n.updateAvailable")}>
                {shortVersion(updateStatus.latestVersion)}
              </Badge>
            )}
            {skill.install && (checkingUpdate ||
              (updateStatus && updateStatus.state !== "update-available")) && (
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
          </span>
        </div>
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("skills.fieldPath")}</div>
            <div className="d-set-row-s d-mono">{displayPath(skill.filePath)}</div>
          </div>
        </div>
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("skills.allowAutoInvoke")}</div>
            <div className="d-set-row-s">{enabled ? t("i18n.visibleInPrompt") : t("i18n.hiddenFromPrompt")}</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-busy={toggling || undefined}
            aria-label={t("skills.allowAutoInvoke")}
            title={enabled ? t("i18n.visibleInPrompt") : t("i18n.hiddenFromPrompt")}
            disabled={toggling}
            className={`d-switch${enabled ? " on" : ""}`}
            onClick={() => onToggle(skill)}
          />
        </div>
      </div>
      {updateError && (
        <div className="d-row">
          <Badge tone="bad">{updateError}</Badge>
        </div>
      )}

      {/* 画板 D-11 帧 C：SKILL.md 是一张 `.d-card` —— `.d-card-head` 放文件图标 +
          标题 + grow + 编辑动作，`.d-card-body` 放渲染正文 / 编辑框。 */}
      <div className="d-set-sec">
        <div className="d-set-sec-t">SKILL.md</div>
        <div className="d-card">
          <div className="d-card-head">
            <i data-ico="file-text" data-size="15" aria-hidden="true" />
            <span>SKILL.md</span>
            <span className="d-grow" aria-hidden="true" />
            {savedAt && !editing && <Badge tone="ok">{t("i18n.saved")}</Badge>}
            {content !== null && !editing && (
              <Btn
                variant="ghost"
                size="small"
                onClick={() => { setDraft(content); setEditing(true); setSavedAt(false); }}
              >
                <i data-ico="square-pen" data-size="13" aria-hidden="true" />
                {t("skills.edit")}
              </Btn>
            )}
            {editing && (
              <>
                <Btn
                  variant="secondary"
                  size="small"
                  disabled={saving}
                  onClick={() => { setDraft(content ?? ""); setEditing(false); setContentError(null); }}
                >
                  {t("i18n.cancel")}
                </Btn>
                <Btn
                  variant="primary"
                  size="small"
                  disabled={saving}
                  onClick={() => { void c.saveContent(); }}
                >
                  {saving ? t("i18n.saving") : t("i18n.save")}
                </Btn>
              </>
            )}
          </div>
          <div className="d-card-body">
            {loadingContent ? (
              <div className="d-banner info">
                <span className="d-run"><i data-ico="loader-circle" data-size="14" aria-hidden="true" /></span>
                <span className="d-grow">{t("i18n.loading")}</span>
              </div>
            ) : editing ? (
              <>
                {/* 画板硬规则：详情内部不再套第二层滚动 —— textarea 不给 max-height，
                    用 rows 跟着草稿行数长高（min-height 由 `.d-textarea` 给）。 */}
                <textarea
                  className="d-textarea"
                  value={draft}
                  rows={Math.max(9, draft.split("\n").length + 1)}
                  spellCheck={false}
                  aria-label={`${t("skills.content")} · ${skill.name}`}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className="d-banner info">
                  <i data-ico="info" data-size="14" aria-hidden="true"></i>
                  <span className="d-grow">{t("skills.contentHint")}</span>
                </div>
              </>
            ) : content !== null ? (
              <div className="d-md">
                <MarkdownBody>{content}</MarkdownBody>
              </div>
            ) : (
              <div className="d-banner err">
                <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
                <span className="d-grow">
                  {contentError ? `${t("skills.contentLoadFailed")}: ${contentError}` : t("skills.contentLoadFailed")}
                </span>
              </div>
            )}
            {contentError && (
              <div className="d-row">
                <Badge tone="warn">
                  <i data-ico="triangle-alert" data-size="11" aria-hidden="true" />
                  {editing ? `${t("skills.saveFailed")}: ${contentError}` : contentError}
                </Badge>
              </div>
            )}
          </div>
        </div>
      </div>
    </Stack>
  );
}

/* fork:v5-d11-frame-c —— 内容查看弹层（画板 D-11 帧 C 的产品形）。
 *
 * 画板把「技能内容」从列表页拆成独立弹层：头部是技能名，正文一段
 * `.d-seg` 分段（渲染 / 原文）+ 右端路径，下挂两个 pane：
 *   · 渲染 = `.d-card`（`.d-card-head` 文件名 + 编辑动作，`.d-card-body` 渲染正文 / 编辑框）
 *   · 原文 = frontmatter 开关行 + `.d-code` 行号原文
 * 「总是优先使用」开关（画板能力面那一行）映射产品的「允许自动调用」。
 * 帧 C 的「文件」pane（技能目录文件清单）与「声明一致」徽章没有数据面
 * （/api/skills/content 只回单文件，产品不解析声明与正文的对应关系），
 * 不渲染；偏离已登记 DIVERGENCE.md。 */
function SkillContentModal({
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
  onClose,
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
  onClose: () => void;
}) {
  const { t } = useI18n();
  const label = sourceLabel(skill);
  const scopeLabels: Record<string, string> = {
    project: t("skills.scope.project"),
    global: t("skills.scope.global"),
    path: t("skills.scope.path"),
  };
  const enabled = !skill.disableModelInvocation;
  const c = useSkillContent(skill, onContentSaved);
  const [tab, setTab] = useState<"render" | "raw">("render");
  const [showFrontmatter, setShowFrontmatter] = useState(true);

  // fork:dsn-dialog-a11y —— 与安装弹层同一条口径：Esc 关闭、Tab 循环、背景 inert、
  // 关闭还焦点；点遮罩关闭在 onClick 里做（d-modal 是全屏遮罩本体）。
  const { dialogRef, dialogProps } = useDialogA11y({ open: true, onClose });

  const displayPath = (p: string) => displaySkillPath(p, cwd, label);

  /* 原文视图：内容是整份 SKILL.md（含 frontmatter）。frontmatter = 文件开头的
     `--- … ---` 块；开关只控制这一段显不显示，行号始终是真实文件行号。 */
  const lines = (c.content ?? "").split("\n");
  let frontmatterEnd = -1;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") { frontmatterEnd = i; break; }
    }
  }
  const rawStart = showFrontmatter || frontmatterEnd < 0 ? 0 : frontmatterEnd + 1;
  const rawLines = lines.slice(rawStart);

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={skill.name}
      className="d-modal is-open"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="d-modal-box wide">
        <div className="d-modal-head">
          <div className="d-row">
            <span>{skill.name}</span>
            <Badge>{scopeLabels[label] ?? label}</Badge>
            <span className="d-grow" aria-hidden="true" />
            {skill.install?.canCheckForUpdates && (
              <Btn
                variant="secondary"
                size="small"
                onClick={onCheckUpdate}
                disabled={checkingUpdate || updating}
              >
                <i data-ico="refresh-cw" data-size="13" aria-hidden="true" />
                {checkingUpdate ? t("i18n.checking") : t("i18n.check")}
              </Btn>
            )}
            {updateStatus?.state === "update-available" && (
              <Btn
                variant="primary"
                size="small"
                onClick={onUpdate}
                disabled={updating || checkingUpdate}
              >
                {updating ? t("i18n.updating") : t("i18n.update")}
              </Btn>
            )}
          </div>
        </div>
        <div className="d-modal-body">
          {saveError && (
            <div role="alert" className="d-banner err">
              <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
              <span className="d-grow">{saveError}</span>
            </div>
          )}
          {updateError && (
            <div role="alert" className="d-banner err">
              <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
              <span className="d-grow">{updateError}</span>
            </div>
          )}
          {c.revealError && (
            <div role="alert" className="d-banner err">
              <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
              <span className="d-grow">{c.revealError}</span>
            </div>
          )}

          <div className="d-set-sec">
            <div className="d-row">
              <div className="d-seg" role="tablist" aria-label={t("skills.content")}>
                <button
                  type="button"
                  aria-pressed={tab === "render"}
                  className={tab === "render" ? "is-on" : undefined}
                  onClick={() => setTab("render")}
                >
                  {t("skills.tabRender")}
                </button>
                <button
                  type="button"
                  aria-pressed={tab === "raw"}
                  className={tab === "raw" ? "is-on" : undefined}
                  onClick={() => setTab("raw")}
                >
                  {t("skills.tabRaw")}
                </button>
              </div>
              <span className="d-grow" aria-hidden="true" />
              <span className="d-t-xs d-t-faint d-mono">{displayPath(skill.filePath)}</span>
            </div>

            <section hidden={tab !== "render"}>
              <div className="d-card">
                <div className="d-card-head">
                  <i data-ico="file-text" data-size="15" aria-hidden="true" />
                  <span>SKILL.md</span>
                  <span className="d-grow" aria-hidden="true" />
                  {c.savedAt && !c.editing && <Badge tone="ok">{t("i18n.saved")}</Badge>}
                  {c.content !== null && !c.editing && (
                    <Btn
                      variant="ghost"
                      size="small"
                      onClick={() => { c.setDraft(c.content ?? ""); c.setEditing(true); c.setSavedAt(false); }}
                    >
                      <i data-ico="square-pen" data-size="13" aria-hidden="true" />
                      {t("skills.edit")}
                    </Btn>
                  )}
                  {c.editing && (
                    <>
                      <Btn
                        variant="secondary"
                        size="small"
                        disabled={c.saving}
                        onClick={() => { c.setDraft(c.content ?? ""); c.setEditing(false); c.setContentError(null); }}
                      >
                        {t("i18n.cancel")}
                      </Btn>
                      <Btn
                        variant="primary"
                        size="small"
                        disabled={c.saving}
                        onClick={() => { void c.saveContent(); }}
                      >
                        {c.saving ? t("i18n.saving") : t("i18n.save")}
                      </Btn>
                    </>
                  )}
                </div>
                <div className="d-card-body">
                  {c.loadingContent ? (
                    <div className="d-banner info">
                      <span className="d-run"><i data-ico="loader-circle" data-size="14" aria-hidden="true" /></span>
                      <span className="d-grow">{t("i18n.loading")}</span>
                    </div>
                  ) : c.editing ? (
                    <>
                      {/* 画板硬规则：弹层内部不再套第二层滚动 —— textarea 不给 max-height，
                          用 rows 跟着草稿行数长高（min-height 由 `.d-textarea` 给）。 */}
                      <textarea
                        className="d-textarea"
                        value={c.draft}
                        rows={Math.max(9, c.draft.split("\n").length + 1)}
                        spellCheck={false}
                        aria-label={`${t("skills.content")} · ${skill.name}`}
                        onChange={(event) => c.setDraft(event.target.value)}
                      />
                      <div className="d-banner info">
                        <i data-ico="info" data-size="14" aria-hidden="true"></i>
                        <span className="d-grow">{t("skills.contentHint")}</span>
                      </div>
                    </>
                  ) : c.content !== null ? (
                    <div className="d-md">
                      <MarkdownBody>{c.content}</MarkdownBody>
                    </div>
                  ) : (
                    <div className="d-banner err">
                      <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
                      <span className="d-grow">
                        {c.contentError ? `${t("skills.contentLoadFailed")}: ${c.contentError}` : t("skills.contentLoadFailed")}
                      </span>
                    </div>
                  )}
                  {c.contentError && c.editing && (
                    <div className="d-row">
                      <Badge tone="warn">
                        <i data-ico="triangle-alert" data-size="11" aria-hidden="true" />
                        {`${t("skills.saveFailed")}: ${c.contentError}`}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section hidden={tab !== "raw"}>
              <div className="d-set-row">
                <div className="d-set-row-box">
                  <div className="d-set-row-t">{t("skills.frontmatter")}</div>
                  <div className="d-set-row-s">{t("skills.frontmatterHint")}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showFrontmatter}
                  aria-label={t("skills.frontmatter")}
                  title={t("skills.frontmatter")}
                  className={`d-switch${showFrontmatter ? " on" : ""}`}
                  onClick={() => setShowFrontmatter((value) => !value)}
                />
              </div>
              {c.loadingContent ? (
                <div className="d-banner info">
                  <span className="d-run"><i data-ico="loader-circle" data-size="14" aria-hidden="true" /></span>
                  <span className="d-grow">{t("i18n.loading")}</span>
                </div>
              ) : c.content !== null ? (
                <div className="d-code">
                  <div className="d-code-head">
                    <i data-ico="braces" data-size="13" aria-hidden="true"></i>
                    <span>SKILL.md</span>
                    <span className="d-grow" aria-hidden="true" />
                    <span>{rawStart + 1}–{lines.length}</span>
                  </div>
                  <div className="d-code-body">
                    {rawLines.map((line, index) => (
                      <Fragment key={rawStart + index}>
                        <span className="d-ln">{rawStart + index + 1}</span>
                        {line}
                        {"\n"}
                      </Fragment>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="d-banner err">
                  <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
                  <span className="d-grow">
                    {c.contentError ? `${t("skills.contentLoadFailed")}: ${c.contentError}` : t("skills.contentLoadFailed")}
                  </span>
                </div>
              )}
            </section>
          </div>

          {/* 画板帧 C 的「能力面」在产品里只有一个真实字段：允许自动调用
              （disable-model-invocation 的反面）。 */}
          <div className="d-set-sec">
            <div className="d-set-row">
              <div className="d-set-row-box">
                <div className="d-set-row-t">{t("skills.allowAutoInvoke")}</div>
                <div className="d-set-row-s">{enabled ? t("i18n.visibleInPrompt") : t("i18n.hiddenFromPrompt")}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-busy={toggling || undefined}
                aria-label={t("skills.allowAutoInvoke")}
                title={enabled ? t("i18n.visibleInPrompt") : t("i18n.hiddenFromPrompt")}
                disabled={toggling}
                className={`d-switch${enabled ? " on" : ""}`}
                onClick={() => onToggle(skill)}
              />
            </div>
          </div>
        </div>
        <div className="d-modal-foot">
          <Btn variant="ghost" onClick={() => void c.revealSkillFile()}>
            <i data-ico="external-link" data-size="14" aria-hidden="true" />
            {t("sidebar.openInFileManager")}
          </Btn>
          <Btn variant="primary" onClick={onClose}>
            <i data-ico="check" data-size="14" aria-hidden="true" />
            {t("skills.done")}
          </Btn>
        </div>
      </div>
    </div>
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
      /* fork:pwa-models-skills —— 手机档钩子：≤640px 时安装弹层从 640px 居中框变成
         全屏 sheet（顶部圆角 + 底部安全区留白）。壳的宽高是内联几何（上面那段），
         覆盖写在 app/pwa-models-skills.css 的「sheet 一节」——该节用 `!important`
         压内联，因为「手机改成整片」这件事没法用另一段内联值表达而桌面端不变。 */
      className="fork-pwa-ms-sheet"
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
          ChatWindow.tsx:2570 / FileViewer.tsx:1212），上限跟应用自己量出的视口高走。

          fork:v5-skin-pw-modal-keep —— 这里**有意保留** `.pw-modal` /
          `.pw-modal-head` / `.pw-modal-body` / `.pw-modal-foot` 四个 v1 类名：
          `app/pwa-models-skills.css` 的手机 sheet 以 `.fork-pwa-ms-sheet > .pw-modal`
          / `> .pw-modal-body` / `> .pw-modal-foot` 为选择器，删了会静默打断手机端整片
          sheet（与 ModelsConfig 的同名注释同一理由）；收尾波与那段移动 CSS 一并换 `d-modal`。
          其余 v1 类（pw-ico / pw-grow / pw-mono / pw-hint / pw-sep / pw-alert / pw-iconbtn）
          已全部换成 d-*；结果行改用画板 D-11 帧 B 的 `.d-store-grid`，故移动 CSS 里
          `.fork-pwa-ms-sheet .pw-prow` 两条已成死规则（汇报里已登记）。 */}
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
          <i data-ico="box" data-size="16" aria-hidden="true" />
          {t("i18n.addSkill")}
          <span className="d-grow" aria-hidden="true" />
          <button
            type="button"
            className="d-iconbtn sm"
            onClick={onDismiss}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
          >
            <i data-ico="x" data-size="14" aria-hidden="true" />
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
          {/* 画板 D-11 帧 B：市场是 `.d-cats` 分类芯片，搜索是 `.d-searchfield`。 */}
          <div className="d-set-sec">
            <div className="d-cats">
              {(["skills.sh", "skillhub"] as const).map((market) => (
                <button
                  key={market}
                  type="button"
                  aria-pressed={source === market}
                  className={`d-cat${source === market ? " is-on" : ""}`}
                  onClick={() => switchSource(market)}
                >
                  {market === "skillhub" ? "SkillHub" : "skills.sh"}
                </button>
              ))}
            </div>
            <div className="d-searchfield">
              <i data-ico="search" data-size="14" aria-hidden="true"></i>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") search(query);
                }}
                placeholder={t("i18n.skillSearchPlaceholder")}
                aria-label={t("i18n.skillSearchPlaceholder")}
              />
              <Btn
                size="small"
                onClick={() => search(query)}
                disabled={searching || (!query.trim() && source !== "skillhub")}
              >
                {searching ? t("i18n.searching") : t("i18n.search")}
              </Btn>
            </div>
          </div>

          {/* 画板 D-11 帧 B 的「安装」节：左文案 + 右控件（安装位置）。 */}
          <div className="d-set-sec">
            <div className="d-set-row">
              <div className="d-set-row-box">
                <div className="d-set-row-t">{t("i18n.addSkill")}</div>
                <div className="d-set-row-s d-mono" style={{ overflowWrap: "anywhere" }}>→ {installPath}</div>
              </div>
              <span className="d-grow-last">
                <select
                  className="d-select"
                  value={scope}
                  aria-label={t("i18n.scope")}
                  onChange={(event) => setScope(event.target.value === "project" ? "project" : "global")}
                >
                  <option value="global">{t("skills.scope.global")}</option>
                  <option value="project">{t("skills.scope.project")}</option>
                </select>
              </span>
            </div>
            {/* 画板 D-11 帧 B 的底部信息条：安装走 npx、需要网络。 */}
            <div className="d-t-xs d-t-faint">
              {source === "skillhub"
                ? (skillhubTotal > 0 ? t("skills.skillhubTotal", { total: skillhubTotal }) : t("skills.skillhubHint"))
                : t("skills.installHint")}
            </div>
          </div>

          {/* Errors */}
          {searchError && (
            <div className="d-banner err">
              <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
              <span className="d-grow">{searchError}</span>
            </div>
          )}
          {installError && (
            <div className="d-banner err">
              <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
              <span className="d-grow">{installError}</span>
            </div>
          )}

          {/* 画板 D-11 帧 B：结果用 `.d-store-grid` 的 `.d-store-card`（封面 + 名称
              + 描述 + 底部状态/安装量）。 */}
          {results.length > 0 && (
            <div className="d-store-grid">
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
                  <div key={r.package} className="d-store-card" title={r.package}>
                    <div className="d-store-cover">
                      <i data-ico="box" data-size="22" aria-hidden="true"></i>
                    </div>
                    <div className="d-store-card-t">{skillpart ?? repopart}</div>
                    {/* fork:skillhub — SkillHub 的条目带摘要，装之前能看清是什么。 */}
                    {r.description && (
                      <div className="d-t-xs d-t-faint">{r.description}</div>
                    )}
                    <div className="d-mono d-t-xs d-t-faint" style={{ overflowWrap: "anywhere" }}>
                      {repopart}
                    </div>
                    <div className="d-store-foot">
                      {isInstalled ? (
                        <Badge tone="ok">
                          <i data-ico="check" data-size="11" aria-hidden="true"></i>
                          {t("i18n.installed")}
                        </Badge>
                      ) : (
                        <Btn
                          size="small"
                          onClick={() => !isInstalling && install(r.package, rowSource)}
                          disabled={isInstalling || installing !== null}
                        >
                          {isInstalling ? t("i18n.installing") : t("i18n.install")}
                        </Btn>
                      )}
                      <span className="d-grow" aria-hidden="true" />
                      <span>{r.installs}</span>
                      {r.url && (
                        <a href={r.url} target="_blank" rel="noreferrer" className="d-mono d-t-faint">
                          {rowSource === "skillhub" ? "skillhub.cn ↗" : "skills.sh ↗"}
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {results.length === 0 && !searchError && !searching && (
            <div className="d-banner info">
              <i data-ico="info" data-size="14"></i>
              <span className="d-grow">
                Search{" "}
                <a href="https://skills.sh" target="_blank" rel="noreferrer" className="d-mono">
                  skills.sh
                </a>{" "}
                to discover and install skills for your agent.
              </span>
            </div>
          )}
        </div>
        <div className="pw-modal-foot">
          <span className="d-grow" aria-hidden="true" />
          <Btn onClick={onDismiss}>{t("i18n.cancel")}</Btn>
        </div>
      </div>
    </div>
  );
}

export function SkillsConfig({
  cwd,
  onClose,
  embedded = false,
  focusSlug = null,
}: {
  cwd: string;
  onClose: () => void;
  embedded?: boolean;
  /** fork:proma-32-skill-usage —— 从本轮的 skill chip 点进来时，要选中的那一个。 */
  focusSlug?: string | null;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const { openMenu } = useContextMenu();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => getLastSettingsSelection("skills", cwd));
  /* fork:v5-d11-frame-a —— 桌面列表换成画板 D-11 帧A 的表格；行点击打开内容弹层
     （帧C）。移动端仍是 M-05 的列表 + 内联详情，不经过这个状态。 */
  const [contentOpen, setContentOpen] = useState(false);
  const focusConsumedRef = useRef(false);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  /* fork:group-switch（G4 · 上游 `eceac13` #1020 + `b9622a1` #1021）——
     正在跑的那一次分组开关（scope 键），与上一轮没做完的条目。
     结果报在**刚跑过的那一组标题下面**，不是页面顶上一块公共区域。 */
  const [bulkGroup, setBulkGroup] = useState<string | null>(null);
  const [groupStatus, setGroupStatus] = useState<{ group: string; lines: string[] } | null>(null);
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
        // fork:proma-32-skill-usage —— chip 带来的 slug 优先于「上次选的那一条」：
        // 用户点进来就是要看它，落在别的条目上等于没点。
        const focused = focusSlug ? findSkillBySlug(list, focusSlug) : undefined;
        if (focused) {
          // 桌面（D-11 帧A）没有常驻详情列，chip 进来直接开内容弹层（帧C）；
          // 只在首次命中时开 —— 之后的 reload（保存 / 更新）不再自动弹。
          if (!focusConsumedRef.current) {
            focusConsumedRef.current = true;
            setContentOpen(true);
          }
          return focused.filePath;
        }
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
  }, [cwd, focusSlug]);

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
    setGroupStatus(null);
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

  /* fork:group-switch（G4）—— 一个分组开关 = 一个作用域（项目 / 全局 / 路径）
     里的所有技能一起开或一起关。作用范围是**标题下当前列出来的那些行**
     （含搜索 / 作用域筛选），与旁边的 `n/m` 计数同口径。

     fork:bulk-routes（上游 `eceac13` #1020）—— 路由现在收 `filePaths`，所以这里
     一次请求发完（改前是逐条串行：每个 PATCH 一次独立文件写、一次独立报错，
     且第一条失败就把后面的全拖慢）。只把 `skillsToSwitch` 算出的目标发出去。
     路由逐条作答，某条被拒（路径不在允许根里 / 不是 .md / frontmatter 改不动）
     不打断其余，最后由 `applySkillToggleResults` 把被拒的那些留在原状态并报出
     是哪几条。 */
  const setGroupSkills = useCallback(async (
    group: string,
    groupSkills: Skill[],
    enabled: boolean,
  ) => {
    const targets = skillsToSwitch(groupSkills, enabled);
    setGroupStatus(null);
    if (targets.length === 0) return;
    const disableModelInvocation = !enabled;
    const filePaths = targets.map((skill) => skill.filePath);
    const names = new Map(targets.map((skill) => [skill.filePath, skill.name]));
    setBulkGroup(group);
    setSaveError(null);
    setToggling((current) => new Set([...current, ...filePaths]));
    try {
      const res = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePaths, disableModelInvocation }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        results?: SkillToggleResult[];
        error?: string;
      };
      // 请求本身失败（路由整体 400/500）时，全部目标都算失败，列表一行不动。
      const results: SkillToggleResult[] = Array.isArray(d.results)
        ? d.results
        : filePaths.map((filePath) => ({
            filePath,
            error: d.error ?? `HTTP ${res.status}`,
          }));
      setSkills((prev) => applySkillToggleResults(prev, results, disableModelInvocation));
      const failures = results.filter((result) => result.error);
      if (failures.length > 0) {
        setGroupStatus({
          group,
          lines: [
            t("skills.groupFailed", { count: failures.length, total: results.length }),
            ...failures.map(
              (failure) => `${names.get(failure.filePath) ?? failure.filePath}: ${failure.error}`,
            ),
          ],
        });
      }
    } catch (e) {
      // 网络层挂掉：一条都没写，列表保持原状。
      const message = e instanceof Error ? e.message : String(e);
      setSkills((prev) =>
        applySkillToggleResults(
          prev,
          filePaths.map((filePath) => ({ filePath, error: message })),
          disableModelInvocation,
        ),
      );
      setGroupStatus({
        group,
        lines: [
          t("skills.groupFailed", { count: filePaths.length, total: filePaths.length }),
          ...filePaths.map((filePath) => `${names.get(filePath) ?? filePath}: ${message}`),
        ],
      });
    } finally {
      setBulkGroup(null);
      setToggling((current) => {
        const next = new Set(current);
        for (const filePath of filePaths) next.delete(filePath);
        return next;
      });
    }
  }, [t]);

  const selectedSkill = skills.find((s) => s.filePath === selected) ?? null;
  const bulkBusy = loading || toggling.size > 0 || updatingSkill !== null || checkingAll;

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

  const contentSkill = contentOpen ? selectedSkill : null;

  /* fork:v5-d11-frame-a —— 帧A 表格的单元格：来源徽标（安装来源优先，其余按
     作用域三态：全局 mute / 项目 info / 路径 warn，对照画板 内置/商店/手动目录）、
     状态徽标（关掉 > 检查中 > 可更新 > 最新 > 出错 > 不检查 > 已启用）、
     行点击开内容弹层（帧C），行尾「更多」收条目级动作。 */
  const sourceBadgeCell = (skill: Skill) => {
    if (skill.install) {
      return (
        <Badge tone="info">
          <i data-ico="download" data-size="12" aria-hidden="true" />
          {skill.install.skillsShUrl ? "skills.sh" : skill.install.source}
        </Badge>
      );
    }
    const scope = sourceLabel(skill);
    if (scope === "global") {
      return <Badge tone="mute"><i data-ico="folder" data-size="12" aria-hidden="true" />{t("skills.scope.global")}</Badge>;
    }
    if (scope === "project") {
      return <Badge tone="info"><i data-ico="folder" data-size="12" aria-hidden="true" />{t("skills.scope.project")}</Badge>;
    }
    return <Badge tone="warn"><i data-ico="folder-open" data-size="12" aria-hidden="true" />{t("skills.scope.path")}</Badge>;
  };

  const statusBadgeCell = (skill: Skill) => {
    if (skill.disableModelInvocation) return <Badge tone="mute">{t("skills.statusDisabled")}</Badge>;
    const key = updateKey(skill);
    if (key && checkingUpdates.has(key)) return <Badge tone="mute">{t("i18n.checking")}</Badge>;
    const st = key ? updateStatuses[key] : undefined;
    if (st?.state === "update-available") {
      return (
        <Badge tone="warn" title={t("i18n.updateAvailable")}>
          <i data-ico="arrow-up" data-size="12" aria-hidden="true" />
          {t("skills.statusUpdatable", { version: shortVersion(st.latestVersion) })}
        </Badge>
      );
    }
    if (st?.state === "up-to-date") return <Badge tone="ok">{t("skills.statusLatest")}</Badge>;
    if (st?.state === "error") {
      return <Badge tone="bad" title={st.message}>{st.message || t("i18n.checkFailed")}</Badge>;
    }
    if (skill.install && !skill.install.canCheckForUpdates) {
      return <Badge tone="mute">{t("i18n.automaticChecksUnavailable")}</Badge>;
    }
    return <Badge tone="ok">{t("skills.statusEnabled")}</Badge>;
  };

  const openRow = (skill: Skill) => {
    setSelected(skill.filePath);
    setContentOpen(true);
  };

  const openRowMenu = (event: ReactMouseEvent, skill: Skill) => {
    const key = updateKey(skill);
    const st = key ? updateStatuses[key] : undefined;
    const entries: ContextMenuEntry[] = [
      {
        label: t("skills.viewContent"),
        icon: <i data-ico="eye" data-size="14" aria-hidden="true" />,
        onSelect: () => openRow(skill),
      },
    ];
    if (skill.install?.canCheckForUpdates && key !== null) {
      entries.push({
        label: t("i18n.check"),
        icon: <i data-ico="refresh-cw" data-size="14" aria-hidden="true" />,
        disabled: checkingUpdates.has(key) || updatingSkill === key,
        onSelect: () => void checkForUpdates(skill),
      });
    }
    if (st?.state === "update-available" && key !== null) {
      entries.push({
        label: t("i18n.update"),
        icon: <i data-ico="download" data-size="14" aria-hidden="true" />,
        disabled: updatingSkill === key,
        onSelect: () => void updateInstalledSkill(skill),
      });
    }
    openMenu(event.clientX, event.clientY, entries, { title: skill.name });
  };

  /* 画板帧A 的描述是一两行的手写短句；真实 SKILL.md 的 description 长得多，
     而库里没有给 `.d-table` 定义钳位类（判据⑦：类必须有画板在用）。
     数据侧截断 + 原文进 title，行高保持画板的节奏（60 字符 ≈ 中文两行）。 */
  const renderSkillTableRow = (skill: Skill) => {
    const disabled = skill.disableModelInvocation;
    const isOpen = contentOpen && selected === skill.filePath;
    const description = skill.description.length > 60
      ? `${skill.description.slice(0, 60)}…`
      : skill.description;
    return (
      <tr
        key={skill.filePath}
        className={isOpen ? "is-on" : undefined}
        title={skill.name}
        onClick={() => openRow(skill)}
      >
        <td>
          <div className="d-col">
            <span className="d-t-b">{skill.name}</span>
            {description && <span className="d-t-xs d-t-faint" title={skill.description}>{description}</span>}
          </div>
        </td>
        <td>{sourceBadgeCell(skill)}</td>
        <td className="d-mono">{skill.install ? shortVersion(skill.install.versionHash) : "—"}</td>
        <td>{statusBadgeCell(skill)}</td>
        <td>
          <button
            type="button"
            role="switch"
            aria-checked={!disabled}
            aria-label={`${t("skills.allowAutoInvoke")} · ${skill.name}`}
            title={t("skills.allowAutoInvoke")}
            disabled={toggling.has(skill.filePath)}
            className={`d-switch${disabled ? "" : " on"}`}
            onClick={(event) => {
              event.stopPropagation();
              void toggle(skill);
            }}
          />
        </td>
        <td>
          <button
            type="button"
            className="d-iconbtn"
            title={t("skills.more")}
            aria-label={`${t("skills.more")} · ${skill.name}`}
            onClick={(event) => {
              event.stopPropagation();
              openRowMenu(event, skill);
            }}
          >
            <i data-ico="ellipsis" data-size="14" aria-hidden="true" />
          </button>
        </td>
      </tr>
    );
  };

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
      <button
        key={skill.filePath}
        type="button"
        aria-current={isSelected ? "page" : undefined}
        className={`d-sess${isSelected ? " is-on" : ""}`}
        title={skill.name}
        onClick={() => setSelected(skill.filePath)}
      >
        <span className="d-row">
          <i data-ico={rowScope === "path" ? "folder-cog" : "box"} data-size="14" aria-hidden="true" className={rowScope === "path" ? "d-t-faint" : undefined} />
          <span className={`d-sess-t d-grow${disabled ? " d-t-faint" : ""}`}>{skill.name}</span>
          {hasUpdate ? (
            <Badge tone="warn" title={t("i18n.updateAvailable")}>
              {t("i18n.updateAvailable")}
            </Badge>
          ) : (
            <RowToggle
              enabled={!disabled}
              onToggle={() => void toggle(skill)}
            />
          )}
        </span>
      </button>
    );
  };

  return (
    <ConfigPanelShell embedded={embedded} title={t("common.skills")} subtitle={shortenPath(cwd)} closeLabel={t("i18n.close")} onClose={onClose}>
      {isMobile ? (
      <SettingsPage
        title={t("common.skills")}
        sub={t("skills.pageSub")}
        actions={
          <>
            {skills.some((skill) => Boolean(skill.install)) && (
              <Btn
                variant="secondary"
                size="small"
                onClick={() => void checkForUpdates()}
                disabled={checkingAll || updatingSkill !== null}
              >
                <i data-ico="refresh-cw" data-size="13" aria-hidden="true" />
                {checkingAll ? t("i18n.checking") : t("i18n.checkUpdates")}
              </Btn>
            )}
            <Btn
              variant="primary"
              size="small"
              /* fork:pwa-models-skills —— 作用域钩子，理由同 ModelsConfig 的同名注释：
                 app/pwa-models-skills.css 的窄屏规则只对本页（`.pw-shead:has(.fork-pwa-ms-page)`）
                 生效，插件 / 子代理分节零影响。`fork-pwa-ms-skills` 是技能页的细分钩子。 */
              className="fork-pwa-ms-page fork-pwa-ms-skills"
              onClick={() => setInstallOpen(true)}
            >
              <i data-ico="plus" data-size="13" aria-hidden="true" />
              {t("i18n.addSkill")}
            </Btn>
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
            <span className="d-sep-v" aria-hidden="true" />
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
            <span className="d-grow" aria-hidden="true" />
            {/* 画板 62 帧 B 的计数徽章：`17 个 · 4 个可更新` 合并成一枚。 */}
            <Badge tone="count">
              {t("skills.count", { count: String(visibleSkills.length) })}
              {updateCount > 0 ? ` · ${updateCount} ${t("i18n.updates")}` : ""}
            </Badge>
            <Btn
              size="small"
              onClick={() => void updateAllAvailable()}
              disabled={updateCount === 0 || checkingAll || updatingSkill !== null}
            >
              {checkingAll || updatingSkill !== null ? t("i18n.updating") : t("skills.updateAll")}
            </Btn>
          </>
        }
        fill
      >
        {/* 画板 D-11 帧 A：信任提示是 `.d-banner warn` 一行。 */}
        {!projectResourcesLoaded && (
          <div role="status" className="d-banner warn">
            <i data-ico="info" data-size="14" aria-hidden="true"></i>
            <span className="d-grow">{t("trust.skillsNotLoaded")}</span>
          </div>
        )}

        {/* fork:settings-frame（画板 62 帧 B）—— 列表 300 + 详情 760：`.pw-scontent.is-fixed`
            不滚，两列各自滚（board.css 的 `> .pw-cols > *`）。列表列 = 作用域分组
            （项目 · <cwd 名> / 全局 / 路径）+ pw-litem（图标 + 名称 + 描述副标题
            + 徽标或开关）；详情列 = 头部 + 行式信息 + SKILL.md 卡片。 */}
        <ConfigSplitView>
          <ConfigSidebar>
            {loading ? (
              <div className="d-banner info">
                <span className="d-run"><i data-ico="loader-circle" data-size="14" aria-hidden="true" /></span>
                <span className="d-grow">{t("i18n.loading")}</span>
              </div>
            ) : error ? (
              <div className="d-banner err">
                <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
                <span className="d-grow">{error}</span>
              </div>
            ) : visibleSkills.length === 0 ? (
              /* 画板 D-11 帧 A 列表空态（`.d-empty.compact`）。 */
              <div className="d-empty compact">
                <span className="d-empty-ico"><i data-ico="box" data-size="16" aria-hidden="true" /></span>
                <p className="d-empty-t">{listQueryTrimmed ? t("skills.noneFound") : t("i18n.noSkills")}</p>
                {!listQueryTrimmed && <p className="d-empty-s">{t("skills.emptyHint")}</p>}
              </div>
            ) : (
              /* fork:settings-frame（画板 62 帧 B）—— 作用域用分组标题表达，
                  不再按安装来源拆出第二层「/ skills.sh」组（来源进详情 kv）。 */
              (["project", "global", "path"] as const).map((scope) => {
                const grpSkills = visibleSkills.filter((skill) => sourceLabel(skill) === scope);
                if (grpSkills.length === 0) return null;
                const grpLabel = scope === "project"
                  ? `${t("skills.scope.project")} · ${projectName}`
                  : t(`skills.scope.${scope}`);
                /* fork:group-switch（G4）—— 标题右侧是 `n/m` + 整组开关；
                   只有全开才算开，部分开的组读起来是「关」，点一下补齐。 */
                const visibleCount = grpSkills.filter((skill) => !skill.disableModelInvocation).length;
                const allVisible = visibleCount === grpSkills.length;
                return (
                  <Fragment key={scope}>
                    <div className="d-group-title">
                      {grpLabel}
                      <GroupSwitch
                        enabled={visibleCount}
                        total={grpSkills.length}
                        disabled={bulkBusy}
                        loading={bulkGroup === scope}
                        label={t(allVisible ? "skills.groupSwitchHide" : "skills.groupSwitchShow", { group: grpLabel })}
                        onChange={(enabled) => void setGroupSkills(scope, grpSkills, enabled)}
                      />
                    </div>
                    {groupStatus?.group === scope && (
                      <GroupStatus errorLines={groupStatus.lines} />
                    )}
                    <div className="d-col">
                      {orderSkillsByDormancy(grpSkills).map(renderSkillRow)}
                    </div>
                  </Fragment>
                );
              })
            )}
          </ConfigSidebar>

          {/* Right: detail — 画板 D-11 的右列是 `.d-set-inner`（一列分节）。 */}
          <div className="d-set-inner">
            <Stack>
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
                <div className="d-empty compact">
                  <span className="d-empty-ico"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" /></span>
                  <p className="d-empty-t">{t("i18n.selectSkill")}</p>
                </div>
              )}
            </Stack>
          </div>
        </ConfigSplitView>
      </SettingsPage>
      ) : (
        /* fork:v5-d11-frame-a —— 桌面 = 画板 D-11 帧A：sec「已加载」= 计数行 +
            「搜索与安装」 + 筛选行 + `.d-card` 里的 `.d-table`
            （技能 30% / 来源 / 版本 / 状态 / 启用 / 更多）+ 两条横幅
            （关掉≠卸载 · 未信任目录）。行点击开帧C 内容弹层。
            与画板的偏离登记在 DIVERGENCE.md：
              ① 筛选行（搜索 + 作用域 + 组开关）是产品补的 —— 真机 87 个技能，
                 画板 5 行的表格没有检索需求；位置在计数行与表格之间；
              ② 帧 A 的「看卸载到底删什么」弹层没有做 —— 产品没有卸载能力，
                 横幅只保留「关掉 ≠ 卸载」这半段真话；
              ③ 计数行省掉「同名技能按目录优先级取一个」—— 产品的同名解析在
                 pi 侧，面板不做这个断言。 */
        <>
          <div className="d-set-inner">
            <div className="d-set-sec">
              <div className="d-set-sec-t">{t("skills.loaded")}</div>
              <div className="d-row">
                <span className="d-t-xs d-t-faint d-grow">
                  {t("skills.countSummary", {
                    total: String(skills.length),
                    enabled: String(skills.filter((skill) => !skill.disableModelInvocation).length),
                    disabled: String(skills.filter((skill) => skill.disableModelInvocation).length),
                  })}
                </span>
                {skills.some((skill) => Boolean(skill.install)) && (
                  <button
                    type="button"
                    className="d-btn sm"
                    onClick={() => void checkForUpdates()}
                    disabled={checkingAll || updatingSkill !== null}
                  >
                    <i data-ico="refresh-cw" data-size="13" aria-hidden="true" />
                    {checkingAll ? t("i18n.checking") : t("i18n.checkUpdates")}
                  </button>
                )}
                {updateCount > 0 && (
                  <button
                    type="button"
                    className="d-btn sm"
                    onClick={() => void updateAllAvailable()}
                    disabled={checkingAll || updatingSkill !== null}
                  >
                    {checkingAll || updatingSkill !== null ? t("i18n.updating") : t("skills.updateAll")}
                  </button>
                )}
                <button type="button" className="d-btn sm" onClick={() => setInstallOpen(true)}>
                  <i data-ico="search" data-size="13" aria-hidden="true" />
                  {t("skills.searchAndInstall")}
                </button>
              </div>
              <div className="d-row">
                <PwSearch
                  value={listQuery}
                  placeholder={t("skills.search")}
                  ariaLabel={t("skills.search")}
                  onChange={setListQuery}
                />
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
                <span className="d-grow" aria-hidden="true" />
                {scopeFilter !== "all" && visibleSkills.length > 0 && (
                  <GroupSwitch
                    enabled={visibleSkills.filter((skill) => !skill.disableModelInvocation).length}
                    total={visibleSkills.length}
                    disabled={bulkBusy}
                    loading={bulkGroup === scopeFilter}
                    label={t(
                      visibleSkills.every((skill) => !skill.disableModelInvocation)
                        ? "skills.groupSwitchHide"
                        : "skills.groupSwitchShow",
                      { group: t(`skills.scope.${scopeFilter}`) },
                    )}
                    onChange={(next) => void setGroupSkills(scopeFilter, visibleSkills, next)}
                  />
                )}
              </div>
              {scopeFilter !== "all" && groupStatus?.group === scopeFilter && (
                <GroupStatus errorLines={groupStatus.lines} />
              )}
              {loading ? (
                <div className="d-banner info">
                  <span className="d-run"><i data-ico="loader-circle" data-size="14" aria-hidden="true" /></span>
                  <span className="d-grow">{t("i18n.loading")}</span>
                </div>
              ) : error ? (
                <div className="d-banner err">
                  <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
                  <span className="d-grow">{error}</span>
                </div>
              ) : visibleSkills.length === 0 ? (
                <div className="d-empty compact">
                  <span className="d-empty-ico"><i data-ico="box" data-size="16" aria-hidden="true" /></span>
                  <p className="d-empty-t">{listQueryTrimmed ? t("skills.noneFound") : t("i18n.noSkills")}</p>
                  {!listQueryTrimmed && <p className="d-empty-s">{t("skills.emptyHint")}</p>}
                </div>
              ) : (
                <div className="d-card">
                  <table className="d-table">
                    <thead>
                      <tr>
                        <th style={{ width: "30%" }}>{t("skills.colSkill")}</th>
                        <th>{t("skills.colSource")}</th>
                        <th>{t("skills.colVersion")}</th>
                        <th>{t("skills.colStatus")}</th>
                        <th>{t("skills.colEnable")}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderSkillsByDormancy(visibleSkills).map(renderSkillTableRow)}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="d-banner warn">
                <i data-ico="circle-help" data-size="14" aria-hidden="true"></i>
                <span><b>{t("skills.offNotUninstallT")}</b>{t("skills.offNotUninstallB")}</span>
              </div>
              {!projectResourcesLoaded && (
                <div role="status" className="d-banner">
                  <i data-ico="shield-question" data-size="14" aria-hidden="true"></i>
                  <span className="d-grow">{t("trust.skillsNotLoaded")}</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

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

      {/* fork:v5-d11-frame-c —— 内容查看弹层（画板 D-11 帧 C）。桌面行点击打开；
          移动端不走（M-05 的内联详情照旧）。key 按文件路径换实例：
          换技能时 tab / 编辑态 / 滚动一起复位。 */}
      {!isMobile && contentSkill && (
        <SkillContentModal
          key={contentSkill.filePath}
          skill={contentSkill}
          cwd={cwd}
          onToggle={toggle}
          toggling={toggling.has(contentSkill.filePath)}
          saveError={saveError}
          updateStatus={
            updateKey(contentSkill)
              ? updateStatuses[updateKey(contentSkill)!]
              : undefined
          }
          checkingUpdate={
            updateKey(contentSkill)
              ? checkingUpdates.has(updateKey(contentSkill)!)
              : false
          }
          updating={updatingSkill === updateKey(contentSkill)}
          updateError={updateError}
          onCheckUpdate={() => void checkForUpdates(contentSkill)}
          onUpdate={() => void updateInstalledSkill(contentSkill)}
          onContentSaved={() => { void loadSkills(); }}
          onClose={() => setContentOpen(false)}
        />
      )}
    </ConfigPanelShell>
  );
}
