"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useI18n } from "@/hooks/useI18n";
import { MarkdownBody } from "../MarkdownBody";
import { localCopy, type LocalCopy } from "../settings-disabled-reasons";
import { SettingsPage } from "../SettingsUi";

/**
 * fork:memory —— 设置 → 记忆（画板 D-36）。
 *
 * 记忆能力整个来自第三方扩展 `pi-hermes-memory`（`pi install npm:pi-hermes-memory`）。
 * 这一页的开关是**本应用自己的**偏好（`~/.pi/agent/pi-web-preferences.json` 的
 * `memoryExtensionEnabled`）：关着时 PI NEXT 在会话创建时把这个扩展从加载结果里摘掉，
 * **不动 pi 的 `packages`** —— 终端与其它运行时照旧用它自己的那份记忆
 * （用户 2026-10-07 裁定：「只影响 PI NEXT」）。包里那条全局状态只读地摆在下面。
 *
 * **默认关着**：开之前它一个字节都不会写进 `~/.pi/agent/pi-hermes-memory/`。
 * 切换对**新会话**生效（扩展是会话启动时加载的），所以下面常驻「新会话生效」徽标。
 *
 * fork:memory-docs（2026-10-07 用户实拍）—— 这一页改成**能看、能改**：
 *   · 说明段、「记忆扩展」小标题、`pi-hermes-memory` 这一行文字都撤掉（用户裁定）；
 *   · 主开关挪到页头（与标题同一排）；
 *   · 「存在哪」那串拼成一行的文件名换成**文档列表**：全局 + 每个项目各一份
 *     `MEMORY.md`（项目那一列显示项目名），点开进弹窗读全文、改、保存。
 *   列表与读写走 `/api/memory`（`documents`）与 `/api/memory/document`；
 *   路径校验只在服务端 `lib/memory-docs.ts` 一处，面板不拼路径。
 *
 * DOM 照 `design/v5/web/boards/D-36-settings-memory.html` 抄：
 * `.d-set-sec` / `.d-set-row` / `.d-grow-last` / `.d-badge` / `.d-switch` / `.d-table` /
 * `.d-modal`，不新增任何 `d-*` 类，也不写内联几何。
 */

interface MemoryDocumentView {
  scope: "global" | "project";
  project: string | null;
  name: string;
  bytes: number;
  mtimeMs: number;
}

interface MemoryStateView {
  source: string;
  installed: boolean;
  /** 本应用的开关（默认关）。 */
  enabled: boolean;
  /** pi 的 packages 里那一条开着吗（终端 / 其它运行时）—— 只读。 */
  packageEnabled: boolean;
  version: string | null;
  memoryDir: string;
  memoryDirExists: boolean;
  files: { name: string; bytes: number }[];
  projectsDir: string;
  configPath: string;
  /** fork:memory-docs —— 可读可改的记忆文档（只含 `.md`）。 */
  documents: MemoryDocumentView[];
}

/** 弹窗里那份文档的全文。 */
interface MemoryDocView {
  scope: "global" | "project";
  project: string | null;
  name: string;
  path: string;
  content: string;
  bytes: number;
  mtimeMs: number;
}

/* 这一轮新加的文案走**组件内本地表**（`lib/i18n/messages/**` 正被另一路改动占着，
   与 `McpLogModal` / `settingsHub.ts` 同一处置：先在这里落字，键位表稳定后整体迁回 `t()`）。 */
const DOC_COPY = {
  section: { en: "Memory documents", "zh-CN": "记忆文档", "zh-TW": "記憶文件" },
  empty: {
    en: "No memory documents yet. The extension writes them once it is on and a session runs.",
    "zh-CN": "还没有记忆文档。开着它并跑一轮会话之后，扩展才会写进来。",
    "zh-TW": "還沒有記憶文件。開著它並跑一輪工作階段之後，擴充功能才會寫進來。",
  },
  colName: { en: "Document", "zh-CN": "文档", "zh-TW": "文件" },
  colProject: { en: "Project", "zh-CN": "项目", "zh-TW": "專案" },
  colSize: { en: "Size", "zh-CN": "大小", "zh-TW": "大小" },
  colMtime: { en: "Updated", "zh-CN": "更新于", "zh-TW": "更新於" },
  global: { en: "Global", "zh-CN": "全局", "zh-TW": "全域" },
  loadFailed: { en: "Could not read this document", "zh-CN": "这份记忆读不出来", "zh-TW": "這份記憶讀不出來" },
  save: { en: "Save", "zh-CN": "保存", "zh-TW": "儲存" },
  saving: { en: "Saving…", "zh-CN": "保存中…", "zh-TW": "儲存中…" },
  saved: { en: "Saved", "zh-CN": "已保存", "zh-TW": "已儲存" },
  cancel: { en: "Cancel", "zh-CN": "取消", "zh-TW": "取消" },
  close: { en: "Close", "zh-CN": "关闭", "zh-TW": "關閉" },
  open: { en: "Open", "zh-CN": "打开", "zh-TW": "開啟" },
  edited: {
    en: "Saving rewrites the file the extension reads back next session.",
    "zh-CN": "保存会直接改写扩展下次会话读回的那份文件。",
    "zh-TW": "儲存會直接改寫擴充功能下次工作階段讀回的那份文件。",
  },
  tabRender: { en: "Rendered", "zh-CN": "渲染", "zh-TW": "渲染" },
  tabRaw: { en: "Source", "zh-CN": "原文", "zh-TW": "原文" },
  entryCount: { en: "entries", "zh-CN": "条", "zh-TW": "條" },
} satisfies Record<string, LocalCopy>;

/** 一条记忆（从存储格式里解出来的）。 */
interface MemoryEntry {
  text: string;
  /** `created=…` 里的日期；旧格式从行内 `<!-- 2026-09-20 … -->` 取。 */
  created: string | null;
  /** `last=…`：最近一次被引用。 */
  last: string | null;
}

/** 尾巴上那条 `<!-- created=…, last=…[, project64=…] -->`。
 *  （不用 `s` 标志：本仓的 tsconfig target 低于 es2018，`.` 不跨行。） */
const ENTRY_META = /^([\s\S]*?)\s*<!--\s*created=([^,]+),\s*last=([^,>]+)(?:,[^>]*)?\s*-->\s*$/;
/** 旧条目把日期写在**开头**（`<!-- 2026-09-20 17:40:50 [01a0bd3a] -->`）——
 *  那是条目的头，不是正文，所以连带那个注释一起切掉，只留日期。 */
const LEGACY_HEAD = /^\s*<!--\s*(\d{4}-\d\d-\d\d)[^>]*-->\s*/;

/**
 * fork:memory-docs —— **只给渲染那一栏用**：把扩展的存储格式翻成人读的条目列表。
 *
 * 文件本身的格式一个字都不能改：`pi-hermes-memory` 用 `\n§\n`（`ENTRY_DELIMITER`）
 * 切条目、每条尾巴上挂 `<!-- created=…, last=… -->`（`store/memory-store.ts`）。
 * 所以「排版」只能发生在**显示层** —— 切出来的条目一条一块，日期单独一行小字，
 * 正文交给 `MarkdownBody`；编辑与保存走的仍是原文。
 */
function parseMemoryDoc(content: string): { lead: string; entries: MemoryEntry[] } {
  const chunks = content.split("\n§\n").map((chunk) => chunk.trim()).filter(Boolean);
  let lead = "";
  let body = chunks;
  // 文件头（`# Memory` + 一句说明）与第一条记忆**同属第一个 chunk**（它们之间只有空行）。
  // 头后面一定跟着空行 + 条目，所以用「连着两个空行」或第一条注释当分界。
  if (chunks[0]?.startsWith("#")) {
    const cut = chunks[0].search(/\n\n\n|<!--/);
    if (cut > 0) {
      lead = chunks[0].slice(0, cut).trim();
      const rest = chunks[0].slice(cut).trim();
      body = rest ? [rest, ...chunks.slice(1)] : chunks.slice(1);
    }
  }
  return {
    lead,
    entries: body.map((raw) => {
      const meta = raw.match(ENTRY_META);
      if (meta) return { text: meta[1].trim(), created: meta[2].trim(), last: meta[3].trim() };
      const legacy = raw.match(LEGACY_HEAD);
      if (legacy) return { text: raw.slice(legacy[0].length).trim(), created: legacy[1], last: null };
      return { text: raw, created: null, last: null };
    }),
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function MemorySettingsPanel() {
  const { t, locale } = useI18n();
  const [state, setState] = useState<MemoryStateView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // 弹窗：哪一份、全文、草稿、保存状态。
  const [openDoc, setOpenDoc] = useState<MemoryDocumentView | null>(null);
  const [doc, setDoc] = useState<MemoryDocView | null>(null);
  const [draft, setDraft] = useState("");
  const [docError, setDocError] = useState<string | null>(null);
  const [docBusy, setDocBusy] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  /** 渲染（读） / 原文（改）—— 与技能内容弹窗同一套分段。 */
  const [tab, setTab] = useState<"render" | "raw">("render");
  /* 渲染那一栏的条目表：只随草稿变（编辑时也要跟着变，所以不能只算一次）。 */
  const parsed = useMemo(() => parseMemoryDoc(draft), [draft]);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/memory");
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${response.status}`);
      }
      setState(await response.json() as MemoryStateView);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const closeDoc = useCallback(() => {
    setOpenDoc(null);
    setDoc(null);
    setDraft("");
    setDocError(null);
    setSaveState("idle");
  }, []);

  const { dialogRef, dialogProps } = useDialogA11y({
    open: openDoc !== null,
    onClose: closeDoc,
    initialFocusRef: closeRef,
  });
  const openDocument = useCallback(async (target: MemoryDocumentView) => {
    setOpenDoc(target);
    setDoc(null);
    setDraft("");
    setDocError(null);
    setSaveState("idle");
    setTab("render");
    const params = new URLSearchParams({ scope: target.scope, name: target.name });
    if (target.project) params.set("project", target.project);
    try {
      const response = await fetch(`/api/memory/document?${params.toString()}`);
      const data = await response.json() as MemoryDocView & { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setDoc(data);
      setDraft(data.content);
    } catch (error) {
      setDocError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const saveDocument = useCallback(async () => {
    if (!openDoc) return;
    setDocBusy(true);
    setDocError(null);
    try {
      const response = await fetch("/api/memory/document", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: openDoc.scope,
          ...(openDoc.project ? { project: openDoc.project } : {}),
          name: openDoc.name,
          content: draft,
        }),
      });
      const data = await response.json() as { ok?: boolean; bytes?: number; mtimeMs?: number; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setDoc((current) => (current
        ? { ...current, content: draft, bytes: data.bytes ?? current.bytes, mtimeMs: data.mtimeMs ?? current.mtimeMs }
        : current));
      setSaveState("saved");
      await load();
    } catch (error) {
      setDocError(error instanceof Error ? error.message : String(error));
    } finally {
      setDocBusy(false);
    }
  }, [draft, load, openDoc]);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setToggleError(null);
    try {
      const response = await fetch("/api/memory", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as MemoryStateView & { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setState(data);
    } catch (error) {
      setToggleError(error instanceof Error ? error.message : String(error));
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <SettingsPage title={t("settings.memory")}>
        <div className="d-set-inner">
          <div className="d-set-sec">
            <div className="d-banner err">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{t("settings.memoryLoadFailed")}: {loadError}</span>
            </div>
          </div>
        </div>
      </SettingsPage>
    );
  }
  if (!state) return null;

  const documents = state.documents ?? [];
  const dirty = doc !== null && draft !== doc.content;

  return (
    <SettingsPage
      title={t("settings.memory")}
      actions={
        <>
          {state.installed
            ? <span className="d-badge mute">{t("settings.memoryVersion", { version: state.version ?? "" })}</span>
            : <span className="d-badge bad">{t("settings.memoryNotInstalled")}</span>}
          <button
            type="button"
            role="switch"
            aria-checked={state.enabled}
            aria-busy={busy || undefined}
            aria-label={t("settings.memoryToggle")}
            title={t("settings.memoryToggle")}
            disabled={busy || !state.installed}
            className={`d-switch${state.enabled ? " on" : ""}`}
            onClick={() => void toggle(!state.enabled)}
          />
        </>
      }
    >
      <div className="d-set-inner">
        <div className="d-set-sec">
          {toggleError ? (
            <div className="d-banner err">
              <i data-ico="circle-alert" data-size="14"></i>
              <span>{toggleError}</span>
            </div>
          ) : null}

          {!state.installed ? (
            <div className="d-banner warn">
              <i data-ico="triangle-alert" data-size="14"></i>
              <span>{t("settings.memoryInstallHint")}</span>
            </div>
          ) : null}

          {/* 这个开关只影响 PI NEXT —— 包里那条全局状态只读地摆出来（终端 / 其它运行时）。 */}
          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.memoryScopeTitle")}</div>
            </div>
            <span className="d-grow-last">
              {state.packageEnabled
                ? <span className="d-badge ok">{t("settings.memoryScopeOn")}</span>
                : <span className="d-badge mute">{t("settings.memoryScopeOff")}</span>}
            </span>
          </div>
          {!state.packageEnabled ? (
            <div className="d-banner warn">
              <i data-ico="triangle-alert" data-size="14"></i>
              <span>{t("settings.memoryPackageDisabledHint")}</span>
            </div>
          ) : null}

          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.memoryReloadTitle")}</div>
            </div>
            <span className="d-grow-last"><span className="d-badge mute">{t("settings.memoryReloadBadge")}</span></span>
          </div>
        </div>

        {/* fork:memory-docs —— 文档列表：全局 + 每个项目（项目名单独一列）。 */}
        <div className="d-set-sec">
          <div className="d-set-sec-t">{localCopy(DOC_COPY.section, locale)}</div>
          {documents.length === 0 ? (
            <div className="d-set-row">
              <div className="d-set-row-box">
                <div className="d-set-row-s">{localCopy(DOC_COPY.empty, locale)}</div>
              </div>
            </div>
          ) : (
            <div className="d-card">
              <table className="d-table">
                <thead>
                  <tr>
                    <th>{localCopy(DOC_COPY.colName, locale)}</th>
                    <th>{localCopy(DOC_COPY.colProject, locale)}</th>
                    <th>{localCopy(DOC_COPY.colSize, locale)}</th>
                    <th>{localCopy(DOC_COPY.colMtime, locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((entry) => (
                    <tr
                      key={`${entry.scope}:${entry.project ?? ""}:${entry.name}`}
                      tabIndex={0}
                      role="button"
                      title={localCopy(DOC_COPY.open, locale)}
                      onClick={() => void openDocument(entry)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        void openDocument(entry);
                      }}
                    >
                      <td><span className="d-mono">{entry.name}</span></td>
                      <td>
                        {entry.project
                          ? <span className="d-badge mute">{entry.project}</span>
                          : <span className="d-t-xs d-t-faint">{localCopy(DOC_COPY.global, locale)}</span>}
                      </td>
                      <td><span className="d-t-xs d-t-faint">{formatBytes(entry.bytes)}</span></td>
                      <td>
                        <span className="d-t-xs d-t-faint">
                          {new Date(entry.mtimeMs).toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="d-set-sec">
          <div className="d-set-sec-t">{t("settings.memoryStorageSection")}</div>
          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.memoryDirTitle")}</div>
              <div className="d-set-row-s d-mono">{state.memoryDir}</div>
            </div>
          </div>

          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.memoryProjectsTitle")}</div>
              <div className="d-set-row-s d-mono">{state.projectsDir}</div>
            </div>
          </div>

          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("settings.memoryConfigTitle")}</div>
              <div className="d-set-row-s d-mono">{state.configPath}</div>
            </div>
          </div>
        </div>
      </div>

      {openDoc ? (
        <div
          ref={dialogRef}
          {...dialogProps}
          className="d-modal is-open"
          onClick={(event) => { if (event.target === event.currentTarget) closeDoc(); }}
          aria-label={openDoc.name}
        >
          <div className="d-modal-box wide" style={{ width: "min(880px, calc(100vw - 32px))" }}>
            <div className="d-modal-head d-row">
              <i data-ico="brain" data-size="16" aria-hidden="true" />
              <span className="d-grow d-mono">{openDoc.name}</span>
              {openDoc.project ? <span className="d-badge mute">{openDoc.project}</span> : null}
              <button
                ref={closeRef}
                type="button"
                className="d-iconbtn"
                onClick={closeDoc}
                title={localCopy(DOC_COPY.close, locale)}
                aria-label={localCopy(DOC_COPY.close, locale)}
              >
                <i data-ico="x" data-size="14" aria-hidden="true" />
              </button>
            </div>

            <div className="d-modal-body">
              {/* 渲染 / 原文：记忆是「一行一条」的纯文本，直接看原文就是一面墙。
                  分段与技能内容弹窗同构（`.d-seg` + 两个 pane），**默认渲染**。 */}
              <div className="d-row">
                <div className="d-seg" role="tablist" aria-label={openDoc.name}>
                  <button
                    type="button"
                    aria-pressed={tab === "render"}
                    className={tab === "render" ? "is-on" : undefined}
                    onClick={() => setTab("render")}
                  >
                    {localCopy(DOC_COPY.tabRender, locale)}
                  </button>
                  <button
                    type="button"
                    aria-pressed={tab === "raw"}
                    className={tab === "raw" ? "is-on" : undefined}
                    onClick={() => setTab("raw")}
                  >
                    {localCopy(DOC_COPY.tabRaw, locale)}
                  </button>
                </div>
                <span className="d-grow" aria-hidden="true" />
                {doc !== null ? (
                  <span className="d-t-xs d-t-faint">
                    {parsed.entries.length} {localCopy(DOC_COPY.entryCount, locale)}
                  </span>
                ) : null}
              </div>
              {docError ? (
                <div className="d-banner err">
                  <i data-ico="circle-alert" data-size="14"></i>
                  <span>{docError}</span>
                </div>
              ) : null}
              {doc === null && !docError ? (
                <div className="d-t-xs d-t-faint">{t("i18n.loading")}</div>
              ) : tab === "render" ? (
                /* fork:memory-docs —— 条目化：一条一块（分隔线 + 日期小字 + 正文）。
                   日期是扩展自己记的（`created=` / `last=`），正是判断「这条还新鲜吗」的依据；
                   文件头（`# Memory` + 一句说明）单独当引言，不跟第一条记忆搵在一起。 */
                <div className="d-md">
                  {parsed.lead ? <MarkdownBody>{parsed.lead}</MarkdownBody> : null}
                  {parsed.entries.map((entry, index) => (
                    <Fragment key={index}>
                      <div className="d-sep" aria-hidden="true" />
                      <span className="d-t-xs d-t-faint d-mono">
                        {entry.created ?? `#${index + 1}`}
                        {entry.last && entry.last !== entry.created ? ` · ${entry.last}` : ""}
                      </span>
                      <MarkdownBody>{entry.text}</MarkdownBody>
                    </Fragment>
                  ))}
                </div>
              ) : (
                /* 画板硬规则（同技能弹窗）：弹层内部不再套第二层滚动 —— textarea
                   不给 max-height，用 rows 跟着草稿行数长高。 */
                <textarea
                  className="d-textarea d-mono"
                  rows={Math.max(9, draft.split("\n").length + 1)}
                  spellCheck={false}
                  aria-label={openDoc.name}
                  value={draft}
                  disabled={docBusy}
                  onChange={(event) => { setDraft(event.target.value); setSaveState("idle"); }}
                />
              )}
            </div>

            <div className="d-modal-foot d-row">
              <span className="d-t-xs d-t-faint d-grow">
                {saveState === "saved" ? localCopy(DOC_COPY.saved, locale) : localCopy(DOC_COPY.edited, locale)}
              </span>
              <button type="button" className="d-btn ghost" onClick={closeDoc}>
                {localCopy(DOC_COPY.cancel, locale)}
              </button>
              <button
                type="button"
                className="d-btn primary"
                disabled={docBusy || doc === null || !dirty}
                onClick={() => void saveDocument()}
              >
                <i data-ico="check" data-size="13" aria-hidden="true" />
                {docBusy ? localCopy(DOC_COPY.saving, locale) : localCopy(DOC_COPY.save, locale)}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </SettingsPage>
  );
}
