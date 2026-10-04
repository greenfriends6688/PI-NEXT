"use client";

/**
 * components/fork/CommandPalette.tsx — fork:command-palette
 *
 * `⌘K` / `⌘⇧P` 打开的统一入口：命令、会话、文件三样一处搜。
 *
 * 刻意**零新后端** —— 三个域全部复用既有 API：
 *   · 会话 → `GET /api/sessions/search`（`lib/session-search.ts` 流式扫正文）
 *   · 文件 → `GET /api/file-index?cwd=…&q=…`（`lib/file-fuzzy.ts` 的真评分）
 *   · 命令 → 内存里那份设置分节 / 面板动作清单
 *
 * 与 ZCode 的差异（都是有意为之，见 `lib/command-palette-history.ts` 头注）：
 * ZCode 把 cmdk 的排序关掉、自己写了一套布尔 AND-子串匹配，面板里的文件搜索
 * 比本仓文件树那条弱；这里文件域直接用既有的评分路，**不重写**。
 * 抄它的只有搜索历史（MRU + 域前缀）。
 *
 * 壳照 v5 画板 **D-22 帧 A** 的命令中心 DOM：`.d-cmd.is-open`（自带遮罩 + 居中）>
 * `.d-cmd-input`（input + `.d-cmd-tabs` > `.d-cat` + `.d-cmd-results` > `.d-cmd-group` /
 * `.d-cmd-row` > `.d-cmd-foot`）；命中加重照帧 B 的 `.d-cmd-hit`；空态与搜索中照帧 C 的
 * `.d-empty` + `.d-skel-list`。图标一律 `<i data-ico>`。
 *
 * fork:v5-boards D-22 补齐的三处（画板画了、产品原先没有，都不碰任何新后端）：
 *   ① **`.d-cmd-group` 分组标题**：三个域各自成组（命令 / 会话 / 文件），一条命中在哪一类
 *      一眼可见；文案直接用既有的 `palette.scope.*`，不新造 i18n key。
 *   ② **`.d-cmd-hit` 只加重命中片段**（帧 B 的硬要求）：整行打底色会把「哪几个字匹配了」
 *      藏起来，所以按 `splitPaletteHighlight` 切段逐个加重，一行里三处命中也分得清。
 *   ③ **搜索中给骨架**（帧 C）：`.d-skel-list` 三行 + 思考点行；原先只有一行纯文字状态。
 * 另外空查询时给「最近打开」一组（帧 A 的第一组）：走既有 `GET /api/sessions?summary=1`
 * （只读 header，与 SessionSidebar 同一份口径），仍然零新后端。
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useIsMobile } from "@/hooks/useIsMobile";
// fork:v5-wave-b —— 窄屏的命令中心 = M-08 的底部面板（`.m-sheet`），它**是弹层**、
// 不是新页面（底下那一屏会话原样留着）；用 portal 宿主，与输入卡那条线共用。
import { PwaComposerSheet } from "../pwa/PwaComposerSheet";
import {
  PALETTE_SCOPE_PREFIXES,
  pushCommandPaletteHistory,
  readCommandPaletteHistory,
  resolvePaletteScope,
  writeCommandPaletteHistory,
  type CommandPaletteHistoryEntry,
  type CommandPaletteScope,
} from "@/lib/command-palette-history";
import type { SettingsSection } from "@/lib/settings-navigation";

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  group: string;
  run: () => void;
}

interface SessionHit {
  sessionId: string;
  title: string;
  cwd: string;
  before: string;
  match: string;
  after: string;
}

interface FileHit {
  path: string;
  name: string;
}

const SESSION_LIMIT = 12;
const FILE_LIMIT = 12;
const COMMAND_LIMIT = 12;
/** 「最近打开」只摆最近这一小组（画板帧 A 的第一组就是两条，不是一份清单）。 */
const RECENT_SESSION_LIMIT = 5;

/**
 * 把一行文字按查询词切成「命中 / 未命中」若干段（纯函数，便于单测）。
 *
 * 画板 D-22 帧 B：只加重命中的那几个字，不给整行打底色。查询词按不区分大小写匹配，
 * 一行里多处命中会切成多段（板上的说明就是「一行里三处命中也要一眼分得清」）。
 * 空查询词 → 整行一段、不加重；查不到 → 同样整行返回（不做无意义的碎片化）。
 */
export function splitPaletteHighlight(
  text: string,
  query: string,
): Array<{ text: string; hit: boolean }> {
  const needle = query.trim();
  if (!needle || !text) return [{ text, hit: false }];
  const haystack = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  for (;;) {
    const at = haystack.indexOf(lowerNeedle, cursor);
    if (at === -1) break;
    if (at > cursor) parts.push({ text: text.slice(cursor, at), hit: false });
    parts.push({ text: text.slice(at, at + needle.length), hit: true });
    cursor = at + needle.length;
  }
  if (parts.length === 0) return [{ text, hit: false }];
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 工作目录：文件域必须限定在允许根之内，不能让面板变成任意路径浏览器。 */
  cwd: string;
  commands: PaletteCommand[];
  onOpenSession: (sessionId: string) => void;
  onOpenSettingsSection?: (section: SettingsSection) => void;
  onOpenFile?: (path: string) => void;
}

export function CommandPalette({
  open, onClose, cwd, commands, onOpenSession, onOpenFile,
}: Props) {
  const { t } = useI18n();
  // fork:v5-wave-b —— 窄屏（PWA 形态）走 M-08 的 `.m-sheet`；桌面仍是 D-22 的 `.d-cmd`。
  const isMobile = useIsMobile();
  const [raw, setRaw] = useState("");
  const [manualScope, setManualScope] = useState<CommandPaletteScope>("all");
  const [active, setActive] = useState(0);
  const [history, setHistory] = useState<CommandPaletteHistoryEntry[]>([]);
  const [sessions, setSessions] = useState<SessionHit[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [files, setFiles] = useState<FileHit[] | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  /* fork:v5-boards D-22 帧 A —— 「最近打开」：空查询时的第一组。走既有
     `GET /api/sessions?summary=1`（只要 header，与 SessionSidebar 同一份口径），
     best-effort：失败就是没有这一组，不影响命令与文件两域。 */
  const [recentSessions, setRecentSessions] = useState<SessionHit[] | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // fork:v5-wave-b —— 窄屏的面板是 `PwaComposerSheet`，它自己有一套焦点约束与 Esc；
  // 这里只让桌面那一块接管，免得同一层挂两个 Esc 监听（两个都会调 onClose，但多一个
  // 捕获阶段的 stopPropagation 就够写出一类难查的 bug）。
  const { dialogRef, dialogProps } = useDialogA11y({ open: open && !isMobile, onClose });

  const bucket = cwd || "global";
  const { scope: prefixScope, explicit, query } = resolvePaletteScope(raw);
  const scope = explicit ? prefixScope : manualScope;

  // 打开时读历史、关掉时清输入（ZCode `:544-554` 同款：否则下次打开还留着上次的词）。
  useEffect(() => {
    if (open) {
      setHistory(readCommandPaletteHistory(window.localStorage, bucket));
      return;
    }
    setRaw("");
    setManualScope("all");
    setSessions(null);
    setFiles(null);
    setRecentSessions(null);
    setActive(0);
  }, [open, bucket]);

  const wantSessions = scope === "sessions" || scope === "all";
  const wantFiles = scope === "files" || scope === "all";
  const trimmed = query.trim();

  // 会话域：复用既有正文搜索。请求带 AbortSignal，用户改字就掐掉上一轮。
  useEffect(() => {
    if (!open || !wantSessions || trimmed.length < 2) {
      setSessions(null);
      return;
    }
    const controller = new AbortController();
    setSessionsLoading(true);
    fetch(`/api/sessions/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
      .then(async (res) => (res.ok ? await res.json() as { results?: unknown[] } : { results: [] }))
      .then((data) => {
        const results = Array.isArray(data.results) ? data.results as Array<Record<string, unknown>> : [];
        setSessions(results.slice(0, SESSION_LIMIT).flatMap((row) => {
          const session = row.session as { id?: unknown; name?: unknown; title?: unknown; cwd?: unknown } | undefined;
          const id = typeof session?.id === "string" ? session.id : "";
          if (!id) return [];
          return [{
            sessionId: id,
            title: String(session?.title ?? session?.name ?? id),
            cwd: typeof session?.cwd === "string" ? session.cwd : "",
            before: typeof row.before === "string" ? row.before : "",
            match: typeof row.match === "string" ? row.match : "",
            after: typeof row.after === "string" ? row.after : "",
          }];
        }));
      })
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
    return () => controller.abort();
  }, [open, wantSessions, trimmed]);

  // 文件域：既有 /api/file-index（内部已跑 filterFileEntries 的真评分）。
  useEffect(() => {
    if (!open || !wantFiles || !cwd || trimmed.length < 1) {
      setFiles(null);
      return;
    }
    const controller = new AbortController();
    setFilesLoading(true);
    fetch(`/api/file-index?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
      .then(async (res) => (res.ok ? await res.json() as { matches?: unknown[] } : { matches: [] }))
      .then((data) => {
        const matches = Array.isArray(data.matches) ? data.matches : [];
        setFiles(matches.slice(0, FILE_LIMIT).flatMap((m) => {
          const entry = m as { path?: unknown; name?: unknown };
          if (typeof entry?.path !== "string") return [];
          return [{ path: entry.path, name: String(entry.name ?? entry.path.split("/").pop() ?? entry.path) }];
        }));
      })
      .catch(() => setFiles([]))
      .finally(() => setFilesLoading(false));
    return () => controller.abort();
  }, [open, wantFiles, trimmed, cwd]);

  // 「最近打开」：只在打开面板且**没有查询词**时请求一次（开了面板还没打字就发一次，
  // 打了字就不发 —— 那时用户要的是命中，不是清单）。
  useEffect(() => {
    if (!open || trimmed || !wantSessions) {
      if (!wantSessions) setRecentSessions(null);
      return;
    }
    const controller = new AbortController();
    fetch("/api/sessions?summary=1", { signal: controller.signal })
      .then(async (res) => (res.ok ? await res.json() as { sessions?: unknown[] } : { sessions: [] }))
      .then((data) => {
        const list = Array.isArray(data.sessions) ? data.sessions as Array<Record<string, unknown>> : [];
        const hits = list.flatMap((row) => {
          const id = typeof row.id === "string" ? row.id : "";
          if (!id) return [];
          const cwd = typeof row.cwd === "string" ? row.cwd : "";
          const name = typeof row.name === "string" ? row.name.trim() : "";
          const first = typeof row.firstMessage === "string" ? row.firstMessage.trim().replace(/\s+/g, " ") : "";
          return [{
            sessionId: id,
            title: name || first || id,
            cwd,
            before: "",
            match: "",
            after: "",
          }];
        });
        setRecentSessions(hits.slice(0, RECENT_SESSION_LIMIT));
      })
      .catch(() => setRecentSessions([]));
    return () => controller.abort();
  }, [open, trimmed, wantSessions]);

  const commandHits = useMemo(() => {
    if (scope !== "commands" && scope !== "all") return [];
    if (!trimmed) return commands.slice(0, COMMAND_LIMIT);
    const needle = trimmed.toLowerCase();
    // 布尔 AND-子串：命令量只有几十条，不需要评分。
    return commands
      .filter((command) => `${command.label} ${command.id} ${command.hint ?? ""}`.toLowerCase().includes(needle))
      .slice(0, COMMAND_LIMIT);
  }, [commands, scope, trimmed]);

  const rows = useMemo(() => {
    const out: Array<{ key: string; kind: string; label: string; hint?: string; icon: string; onPick: () => void }> = [];
    for (const command of commandHits) {
      out.push({
        key: `cmd:${command.id}`,
        kind: "commands",
        label: command.label,
        hint: command.hint,
        icon: command.icon,
        onPick: command.run,
      });
    }
    /* 有查询词 = 命中清单；没有查询词 = 「最近打开」（帧 A 的第一组）。
       两个来源互斥，避免同一条会话在两处同时出现。 */
    const sessionHits = trimmed ? (sessions ?? []) : (recentSessions ?? []);
    for (const hit of sessionHits) {
      out.push({
        key: `ses:${hit.sessionId}`,
        kind: "sessions",
        label: hit.title,
        hint: hit.match ? `…${hit.before}${hit.match}${hit.after}…` : hit.cwd,
        icon: "message-square",
        onPick: () => onOpenSession(hit.sessionId),
      });
    }
    for (const hit of files ?? []) {
      out.push({
        key: `file:${hit.path}`,
        kind: "files",
        label: hit.name,
        hint: hit.path,
        icon: "file",
        onPick: () => onOpenFile?.(hit.path),
      });
    }
    return out;
  }, [commandHits, sessions, files, recentSessions, trimmed, onOpenSession, onOpenFile]);

  /* fork:v5-boards D-22 帧 B —— 只加重命中片段（`.d-cmd-hit`），不给整行打底色。 */
  const highlight = (text: string) => splitPaletteHighlight(text, trimmed).map((part, index) => (
    part.hit
      ? <span key={index} className="d-cmd-hit">{part.text}</span>
      : <span key={index}>{part.text}</span>
  ));

  /* 分组标题（帧 A/B/C 的 `.d-cmd-group`）：三个域各自成组，标题后缀是命中数。
     文案取既有 `palette.scope.*` —— 不为「命令」这三个字另开一套 i18n key。 */
  const groupTitle = (kind: string) => {
    if (kind === "commands") return `${t("palette.scope.commands")} · ${commandHits.length}`;
    if (kind === "sessions") return `${t("palette.scope.sessions")} · ${trimmed ? (sessions ?? []).length : (recentSessions ?? []).length}`;
    return `${t("palette.scope.files")} · ${(files ?? []).length}`;
  };

  useEffect(() => {
    setActive(0);
  }, [scope, trimmed]);

  const searching = sessionsLoading || filesLoading;

  const remember = useCallback((usedScope: CommandPaletteScope) => {
    const next = pushCommandPaletteHistory(
      readCommandPaletteHistory(window.localStorage, bucket),
      { query: raw, scope: usedScope, updatedAt: Date.now() },
    );
    writeCommandPaletteHistory(window.localStorage, bucket, next);
    setHistory(next);
  }, [bucket, raw]);

  const pick = useCallback((index: number) => {
    const row = rows[index];
    if (!row) return;
    remember(scope);
    onClose();
    row.onPick();
  }, [rows, remember, scope, onClose]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      pick(active);
    }
  };

  useEffect(() => {
    const element = listRef.current?.querySelector('[data-active="true"]');
    element?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  /* fork:v5-wave-b —— 窄屏 = M-08 帧 A/B/C 的那块底部面板：
     `.m-sheet`（抓握 + 标题 + 滚动体）+ `.m-scrim`（点一下即收）；
     `.m-searchfield` 回显前缀与已输入的词、`.m-tray` 一排前缀 chip 做图示、
     `.m-seg` 分段固定为「全部 / 命令 / 会话 / 文件」、结果行统一 `.m-sheet-row`
     （`.is-on` 带对勾）、分组标题 `.m-rowlabel`、底部 `.m-pickbar` 写键位提示。
     行结构、排序、选中态与桌面那一块**完全一致** —— 三处入口指向同一块界面，
     不一致就变成三套要分别学的东西（M-08 注）。
     行为一个没改：同一个 `scope` 解析、同一个 `pick`、同一份历史与搜索请求。 */
  if (isMobile) {
    return (
      <PwaComposerSheet
        open={open}
        title={t("palette.title")}
        label={t("palette.title")}
        onClose={onClose}
        footer={(
          <>
            <span className="m-kbd">↑</span>
            <span className="m-kbd">↓</span>
            <span className="m-kbd">↵</span>
            <span className="m-grow" />
            <span className="m-kbd">esc</span>
          </>
        )}
      >
        <div className="m-searchfield" style={{ margin: "0 0 var(--nx-sp-2)" }}>
          <i data-ico="search" data-size="14" aria-hidden="true" />
          <input
            ref={inputRef}
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.title")}
            autoFocus
          />
        </div>

        {/* 前缀 chip（`.m-tray`）：点一下把前缀写回输入框 —— 与桌面的 `.d-cat` 同一条路。 */}
        <div className="m-tray" style={{ margin: "0 0 var(--nx-sp-2)" }}>
          {PALETTE_SCOPE_PREFIXES.filter((entry) => entry.scope !== "all").map((entry) => (
            <button
              key={entry.scope}
              type="button"
              className={`m-tray-chip${scope === entry.scope ? " is-on" : ""}`}
              onClick={() => {
                setManualScope(entry.scope);
                setRaw(`${entry.prefix}${raw.replace(/^[>#@]\s?/u, "")}`);
              }}
            >
              <i data-ico={entry.scope === "commands" ? "terminal" : entry.scope === "sessions" ? "hash" : "at-sign"} data-size="12" aria-hidden="true" />
              {t(`palette.scope.${entry.scope}`)}
            </button>
          ))}
        </div>

        {/* 分段固定为「全部 / 命令 / 会话 / 文件」，「全部」永远在最前（M-08 注）。
            按钮不另起类名：`.m-seg > button` 就是画板那一格（`.is-on` 是选中态）。 */}
        <div className="m-seg" style={{ margin: "0 0 var(--nx-sp-2)" }} role="tablist">
          {PALETTE_SCOPE_PREFIXES.map((entry) => (
            <button
              key={entry.scope}
              type="button"
              role="tab"
              aria-selected={scope === entry.scope}
              className={scope === entry.scope ? "is-on" : ""}
              onClick={() => {
                setManualScope(entry.scope);
                setRaw(entry.scope === "all" ? raw.replace(/^[>#@]\s?/u, "") : `${entry.prefix}${raw.replace(/^[>#@]\s?/u, "")}`);
              }}
            >
              {t(`palette.scope.${entry.scope}`)}
            </button>
          ))}
        </div>

        <div ref={listRef} role="listbox">
          {/* 搜索中给骨架（M-08 同款：骨架比一句「搜索中…」诚实）。 */}
          {searching && (
            <div className="m-skel-list" role="status">
              <div className="m-skel m-skel-50"></div>
              <div className="m-skel m-skel-50"></div>
              <div className="m-skel m-skel-50"></div>
              <div className="m-run"><i data-ico="loader-circle" data-size="14" aria-hidden="true" />{t("palette.searching")}</div>
            </div>
          )}
          {rows.length === 0 ? (
            trimmed ? (
              <div className="m-empty">
                <div className="m-empty-ico"><i data-ico="search" data-size="20" aria-hidden="true"></i></div>
                <div className="m-empty-t">{t("palette.noResults")}</div>
                <div className="m-empty-s">
                  {PALETTE_SCOPE_PREFIXES.filter((entry) => entry.scope !== "all").map((entry, index) => (
                    <span key={entry.scope}>
                      <span className="m-kbd">{entry.prefix}</span> {t(`palette.scope.${entry.scope}`)}
                      {index < PALETTE_SCOPE_PREFIXES.length - 2 ? " · " : ""}
                    </span>
                  ))}
                </div>
              </div>
            ) : history.length > 0 && (
              <>
                <div className="m-rowlabel">{t("palette.recent")}</div>
                {history.map((entry, index) => (
                  <button
                    key={`${entry.query}:${entry.updatedAt}`}
                    type="button"
                    className={`m-sheet-row${index === active ? " is-on" : ""}`}
                    data-active={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => {
                      setRaw(entry.scope === "all" ? entry.query : `${PALETTE_SCOPE_PREFIXES.find((p) => p.scope === entry.scope)?.prefix ?? ""}${entry.query}`);
                      setManualScope(entry.scope);
                    }}
                  >
                    <i data-ico="history" data-size="16" aria-hidden="true"></i>
                    <span className="m-setrow-body">
                      <span className="m-setrow-t">{entry.query}</span>
                      <span className="m-sheet-row-desc">{t(`palette.scope.${entry.scope}`)}</span>
                    </span>
                  </button>
                ))}
              </>
            )
          ) : rows.map((row, index) => (
            <Fragment key={row.key}>
              {(index === 0 || rows[index - 1].kind !== row.kind) && (
                <div className="m-rowlabel">{groupTitle(row.kind)}</div>
              )}
              <button
                type="button"
                className={`m-sheet-row${index === active ? " is-on" : ""}`}
                role="option"
                aria-selected={index === active}
                data-active={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(index)}
              >
                <i data-ico={row.icon} data-size="16" aria-hidden="true"></i>
                <span className="m-setrow-body">
                  <span className="m-setrow-t">{highlight(row.label)}</span>
                  {row.hint ? <span className="m-sheet-row-desc">{row.hint}</span> : null}
                </span>
              </button>
            </Fragment>
          ))}
        </div>
      </PwaComposerSheet>
    );
  }

  return (
    // fork:v5-landing —— 壳照 v5 画板 D-22 帧 A：`.d-cmd.is-open` 自己就是遮罩 + 居中，
    // 旧的 `.pw-scrim` / `.pw-modal` 一并退役。点遮罩关面板仍是产品行为（事件在 React）。
    <div
      {...dialogProps}
      ref={dialogRef}
      className="d-cmd is-open"
      aria-label={t("palette.title")}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="d-cmd-input">
        <input
          ref={inputRef}
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("palette.placeholder")}
          aria-label={t("palette.title")}
          autoFocus
        />

        {/* 域切换 = 画板 D-22 的 `.d-cmd-tabs` > `.d-cat.is-on`；点一下把前缀写回输入框
            （与 ZCode 的 `setScope`（`:637-644`）同一条路）。 */}
        <div className="d-cmd-tabs" role="tablist">
          {PALETTE_SCOPE_PREFIXES.map((entry) => (
            <button
              key={entry.scope}
              type="button"
              role="tab"
              aria-selected={scope === entry.scope}
              className={`d-cat${scope === entry.scope ? " is-on" : ""}`}
              onClick={() => {
                setManualScope(entry.scope);
                setRaw(entry.scope === "all" ? raw.replace(/^[>#@]\s?/u, "") : `${entry.prefix}${raw.replace(/^[>#@]\s?/u, "")}`);
              }}
            >
              {t(`palette.scope.${entry.scope}`)}
            </button>
          ))}
        </div>

        <div className="d-cmd-results" ref={listRef} role="listbox">
          {/* fork:v5-boards D-22 帧 C —— 搜索中给骨架（`.d-skel-list` 三行 + 思考点行），
              不再只给一行纯文字状态：三行骨架比一句「搜索中…」更诚实（用户看得见在扫）。 */}
          {searching && (
            <div className="d-skel-list" role="status" style={{ padding: "var(--nx-sp-2)" }}>
              <div className="d-skel d-skel-40"></div>
              <div className="d-skel d-skel-40"></div>
              <div className="d-skel d-skel-40"></div>
              <div className="d-row d-t-xs d-t-faint" style={{ gap: "var(--nx-sp-2)" }}>
                <span className="d-think-dots wave" aria-hidden="true">
                  <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
                </span>
                <span>{t("palette.searching")}</span>
              </div>
            </div>
          )}
          {rows.length === 0 ? (
            trimmed ? (
              /* 画板 D-22 帧 C 的空态：`.d-empty`（记号 + 一句 + 下一步）。
                 「没找到」永远带着下一步 —— 这里给的是前缀说明（> / # / @），
                 文案用既有的 `palette.scope.*`，不为这三行另开 i18n key。
                 板上的两枚演示钮（看前缀语法说明 / 看搜索中的样子）没有产品对应件，不画。
                 （骨架已经由上面的 `.d-skel-list` 承担。） */
              <div className="d-empty">
                <div className="d-empty-ico"><i data-ico="search" data-size="20" aria-hidden="true"></i></div>
                <div className="d-empty-t">{t("palette.noResults")}</div>
                <div className="d-empty-s d-col" style={{ gap: "var(--nx-sp-1)" }}>
                  {PALETTE_SCOPE_PREFIXES.filter((entry) => entry.scope !== "all").map((entry) => (
                    <span key={entry.scope} className="d-row" style={{ gap: "var(--nx-sp-1)" }}>
                      <span className="d-kbd">{entry.prefix}</span>
                      <span>{t(`palette.scope.${entry.scope}`)}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : history.length > 0 && (
              <>
                <div className="d-cmd-group">{t("palette.recent")}</div>
                {history.map((entry, index) => (
                  <button
                    key={`${entry.query}:${entry.updatedAt}`}
                    type="button"
                    className={`d-cmd-row${index === active ? " is-on" : ""}`}
                    data-active={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => {
                      setRaw(entry.scope === "all" ? entry.query : `${PALETTE_SCOPE_PREFIXES.find((p) => p.scope === entry.scope)?.prefix ?? ""}${entry.query}`);
                      setManualScope(entry.scope);
                    }}
                  >
                    <i data-ico="history" data-size="14" aria-hidden="true"></i>
                    <span className="d-grow">{entry.query}</span>
                    <span className="d-cmd-kind">{t(`palette.scope.${entry.scope}`)}</span>
                  </button>
                ))}
              </>
            )
          ) : rows.map((row, index) => (
            <Fragment key={row.key}>
              {/* fork:v5-boards D-22 帧 A —— 三个域各自成组；`rows` 按 命令 → 会话 → 文件
                  排好，所以只在「域变了」的那一行插标题。 */}
              {(index === 0 || rows[index - 1].kind !== row.kind) && (
                <div className="d-cmd-group">{groupTitle(row.kind)}</div>
              )}
              <button
                type="button"
                className={`d-cmd-row${index === active ? " is-on" : ""}`}
                role="option"
                aria-selected={index === active}
                data-active={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(index)}
              >
                <i data-ico={row.icon} data-size="14" aria-hidden="true"></i>
                <span className="d-grow">{highlight(row.label)}</span>
                {row.hint ? <span className="d-cmd-kind">{row.hint}</span> : null}
              </button>
            </Fragment>
          ))}
        </div>

        {/* 键位条 = 画板 D-22 帧 A 的 `.d-cmd-foot`。只放语言无关的键符：产品三语文案的
            键位说明没有现成 i18n key，不硬编码中文。 */}
        <div className="d-cmd-foot">
          <span className="d-row" style={{ gap: "var(--nx-sp-1)" }}><span className="d-kbd">↑</span><span className="d-kbd">↓</span></span>
          <span className="d-row" style={{ gap: "var(--nx-sp-1)" }}><span className="d-kbd">↵</span></span>
          <span className="d-row" style={{ gap: "var(--nx-sp-1)" }}><span className="d-kbd">esc</span></span>
          <span className="d-grow"></span>
          <span className="d-row" style={{ gap: "var(--nx-sp-1)" }}><span className="d-kbd">&gt;</span><span className="d-kbd">#</span><span className="d-kbd">@</span></span>
        </div>
      </div>
    </div>
  );
}
