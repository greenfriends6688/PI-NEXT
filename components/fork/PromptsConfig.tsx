"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigBadge, ConfigButton, ConfigEmptyState, ConfigSplitView, PwSearch, SettingsPage } from "../SettingsUi";
import type { PromptFile } from "@/lib/prompt-files";

/*
 * fork:zc-16 — management UI for `~/.pi/agent/prompts/*.md`.
 *
 * The slash palette already consumes the same directory, so there is no wiring
 * on the composer side: saving a prompt here makes `/name` available the next
 * time the palette is opened. The editor sends only `description` and `body`;
 * the route merges them surgically so hand-written frontmatter stays intact.
 *
 * fork:design-system —— 画板 46 帧「自定义命令」：左列搜索 + `.pw-list`
 * （行点击即选中编辑），右列 `.pw-detail` 三段式编辑（命令名带 `/` 前缀格、
 * 描述、正文长文本区），动作（在查看器打开 / 删除）收在详情头行。
 */

interface EditorState {
  /** null while creating a new prompt. */
  originalName: string | null;
  name: string;
  description: string;
  body: string;
}

const EMPTY_EDITOR: EditorState = { originalName: null, name: "", description: "", body: "" };

export function PromptsConfig({ onOpenFile }: { onOpenFile?: (path: string) => void }): ReactNode {
  const { t } = useI18n();
  const [prompts, setPrompts] = useState<PromptFile[]>([]);
  const [dir, setDir] = useState("");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/prompts", { cache: "no-store" });
      const data = await response.json() as { dir?: string; prompts?: PromptFile[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setPrompts(Array.isArray(data.prompts) ? data.prompts : []);
      setDir(data.dir ?? "");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return prompts;
    return prompts.filter((prompt) =>
      prompt.name.toLowerCase().includes(keyword)
      || prompt.description.toLowerCase().includes(keyword));
  }, [prompts, query]);

  const startCreate = () => {
    setMessage(null);
    setError(null);
    setEditor({ ...EMPTY_EDITOR });
  };

  const startEdit = (prompt: PromptFile) => {
    setMessage(null);
    setError(null);
    setEditor({
      originalName: prompt.name,
      name: prompt.name,
      description: prompt.description,
      body: prompt.body.replace(/^\n/, ""),
    });
  };

  const save = async () => {
    if (!editor) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const creating = editor.originalName === null;
      const response = await fetch("/api/prompts", {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editor.name,
          description: editor.description,
          body: editor.body,
        }),
      });
      const data = await response.json() as { prompt?: PromptFile; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setMessage(t(creating ? "prompts.created" : "prompts.saved"));
      if (data.prompt) {
        setEditor({
          originalName: data.prompt.name,
          name: data.prompt.name,
          description: data.prompt.description,
          body: data.prompt.body.replace(/^\n/, ""),
        });
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (name: string) => {
    if (typeof window !== "undefined" && !window.confirm(t("prompts.deleteConfirm", { name }))) return;
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/prompts?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (editor?.originalName === name) setEditor(null);
      setMessage(t("prompts.deleted"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <>
      {/* fork:settings-frame（画板 62）—— 自定义命令页的三件套（骨架 B）。
          h2 原来被包在 `.pw-inline` 里，够不到 board.css 的 `.pw-sbody > h2`
          （字号吃不到 15/500）；搜索框在左列里、计数在页头、目录在第二行 sub，
          三处各说各的。现在：页头 = 标题 + 一句说明 + 页级动作「新建命令」；
          工具栏 = 搜索 + 目录路径 + 计数等宽徽章。 */}
      <SettingsPage
        title={t("prompts.title")}
        sub={t("prompts.subtitle")}
        actions={
          <ConfigButton variant="primary" size="small" onClick={startCreate}>
            <span className="pw-ico"><i data-ico="plus" data-size="13" aria-hidden="true" /></span>
            {t("prompts.new")}
          </ConfigButton>
        }
        toolbar={
          <>
            <PwSearch
              value={query}
              placeholder={t("prompts.search")}
              ariaLabel={t("prompts.search")}
              onChange={setQuery}
            />
            <span className="pw-grow" aria-hidden="true" />
            {dir && <span className="pw-mono pw-dim">{dir}</span>}
            <ConfigBadge tone="count">{t("prompts.count", { count: String(filtered.length) })}</ConfigBadge>
          </>
        }
        fill
      >
      <ConfigSplitView>
        <div>
          <div className="pw-list">
            {filtered.map((prompt) => (
              <button
                key={prompt.name}
                type="button"
                className={`pw-litem${editor?.originalName === prompt.name ? " is-on" : ""}`}
                onClick={() => startEdit(prompt)}
              >
                <span className="pw-ico" style={editor?.originalName === prompt.name ? { color: "var(--accent-text)" } : undefined}>
                  <i data-ico="square-function" data-size="14" aria-hidden="true" />
                </span>
                <span className="grow">
                  <span className="pw-lname">/{prompt.name}</span>
                  <span className="pw-lsub">{prompt.description || t("prompts.noDescription")}</span>
                </span>
              </button>
            ))}
          </div>
          {loading && <p role="status" className="pw-hint">{t("i18n.loading")}</p>}
          {!loading && filtered.length === 0 && (
            <p role="status" className="pw-hint">{query.trim() ? t("prompts.noMatch") : t("prompts.empty")}</p>
          )}
        </div>

        {editor ? (
          <div className="pw-detail">
            <div className="pw-inline">
              <h3 className="pw-mono" style={{ margin: 0 }}>
                {editor.originalName === null ? t("prompts.newTitle") : `/${editor.originalName}`}
              </h3>
              <span className="pw-grow" aria-hidden="true" />
              {editor.originalName !== null && onOpenFile && (
                <ConfigButton variant="ghost" size="small" onClick={() => onOpenFile(`${dir}/${editor.originalName}.md`)}>
                  <span className="pw-ico"><i data-ico="external-link" data-size="13" aria-hidden="true" /></span>
                  {t("prompts.openInViewer")}
                </ConfigButton>
              )}
              {editor.originalName !== null && (
                <ConfigButton variant="danger" size="small" onClick={() => void remove(editor.originalName!)}>
                  <span className="pw-ico"><i data-ico="trash-2" data-size="13" aria-hidden="true" /></span>
                  {t("i18n.delete")}
                </ConfigButton>
              )}
            </div>

            {/* 编辑器的两个输入宽度照抄画板 46 帧「自定义命令」的 inline：
                命令名 180、描述 280（`--sidebar-width` 恰是 280px，走 token 不写字面量）；
                `min-width:0` 盖掉 board.css `.pw-input` 的 200px 下限，否则 180 出不来。 */}
            <div className="pw-field" style={{ marginTop: "var(--s3)" }}>
              <span className="pw-label">
                {t("prompts.name")}
                <small>{t("prompts.nameHint")}</small>
              </span>
              <span className="pw-ctl">
                <span className="pw-mono pw-dim">/</span>
                <input
                  className="pw-input"
                  style={{ minWidth: 0, width: 180 }}
                  value={editor.name}
                  disabled={editor.originalName !== null}
                  onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                  placeholder="review"
                  spellCheck={false}
                  aria-label={t("prompts.name")}
                />
              </span>
            </div>
            <div className="pw-field">
              <span className="pw-label">{t("prompts.description")}</span>
              <input
                className="pw-input"
                style={{ minWidth: 0, width: "var(--sidebar-width)" }}
                value={editor.description}
                onChange={(event) => setEditor({ ...editor, description: event.target.value })}
                placeholder={t("prompts.descriptionPlaceholder")}
                aria-label={t("prompts.description")}
              />
            </div>

            <div className="pw-sec-title" style={{ marginTop: "var(--s3)" }}>
              {t("prompts.body")}
              <span className="pw-grow" aria-hidden="true" />
            </div>
            {/* 正文是**整行宽**控件，放 `.pw-detail` 直下不塞字段行（画板 62 帧 B / 46 帧
                「自定义命令」同款）；`min-height: 200` 是画板 46 原件自带的 inline
                （board 46:94 `style="min-height:200px"`），门禁基线冻结的就是它。 */}
            <textarea
              className="pw-textarea"
              style={{ minHeight: "var(--edit-min)" }}
              value={editor.body}
              onChange={(event) => setEditor({ ...editor, body: event.target.value })}
              spellCheck={false}
              aria-label={t("prompts.body")}
            />

            <div className="pw-inline" style={{ marginTop: "var(--s2)" }}>
              <span className="pw-badge accent">
                <span className="pw-ico"><i data-ico="info" data-size="11" aria-hidden="true" /></span>
                {t("prompts.bodyHint")}
              </span>
              <span className="pw-grow" aria-hidden="true" />
              <ConfigButton variant="ghost" onClick={() => setEditor(null)}>
                {t("i18n.cancel")}
              </ConfigButton>
              <ConfigButton variant="primary" disabled={saving || editor.name.trim() === ""} onClick={() => void save()}>
                {saving ? t("prompts.saving") : t("i18n.save")}
              </ConfigButton>
            </div>
          </div>
        ) : (
          /* fork:settings-frame（画板 62 帧 D「详情未选」）—— 详情列恒有 `.pw-detail`
             卡，空态是卡内**居中**的 `.pw-empty`（board.css 的 `.pw-detail .pw-empty`
             高度规则就是为这个形态写的）：40px 方框图标（`.pw-empty-inner .mark`，
             DOM 抄帧 D）+ 一句引导。原来那句「保存后斜杠面板立即可用」飘在右列中段、
             脱离空态本体（62 禁止项），现在收进空态里。 */
          <div className="pw-detail">
            <ConfigEmptyState>
              <span className="mark" aria-hidden="true">
                <i data-ico="square-mouse-pointer" data-size="16" />
              </span>
              <p>{t("prompts.emptyDetail")}</p>
              <p className="pw-hint">{t("prompts.paletteHint")}</p>
            </ConfigEmptyState>
          </div>
        )}
      </ConfigSplitView>

      {message && (
        <div role="status" className="pw-alert info">
          <span className="pw-ico"><i data-ico="circle-check" data-size="14" aria-hidden="true" /></span>
          <span className="pw-grow">{message}</span>
        </div>
      )}
      {error && (
        <div className="pw-alert" role="alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
          <span className="pw-grow">{error}</span>
        </div>
      )}
      </SettingsPage>
    </>
  );
}
