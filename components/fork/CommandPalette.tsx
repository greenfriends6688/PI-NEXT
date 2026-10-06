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
import type { ReactNode } from "react";
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

/** 目录名（板面 D-22 会话行的行尾格就是「PI NEXT」这种项目名，不是整条路径）。 */
function cwdBasename(cwd: string): string {
  const name = cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return name || cwd;
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
  /* fork:v5-frame-audit D-22 —— 页签行右侧那颗 `.d-iconbtn`（keyboard 图标）点开的是
     「前缀即语法」浮层（帧 A/C 板面上的 `.d-pop`）。它不是新后端：三条文案取既有的
     `palette.scope.*`，与输入框本身写的是同一张表。 */
  const [syntaxOpen, setSyntaxOpen] = useState(false);
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
    setSyntaxOpen(false);
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
    const out: Array<{ key: string; kind: string; label: string; hint?: ReactNode; icon: string; onPick: () => void }> = [];
    /* fork:v5-frame-audit D-22 帧 A —— 空查询那一屏的**组序**照板面 DOM 抄：
       「最近打开」在前、快捷入口在后（板面帧标里「快捷入口在前」那句与它自己的 DOM
       反着，DOM 是真值 —— 见汇报）。有查询词时仍是命令 → 会话 → 文件的命中清单，
       因为帧 B/C 那一屏按域分面板讲的是命中，不是组序。 */
    const pushCommands = () => {
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
    };
    /* 有查询词 = 命中清单；没有查询词 = 「最近打开」（帧 A 的第一组）。
       两个来源互斥，避免同一条会话在两处同时出现。 */
    const sessionHits = trimmed ? (sessions ?? []) : (recentSessions ?? []);
    const pushSessions = () => {
      for (const hit of sessionHits) {
        out.push({
          key: `ses:${hit.sessionId}`,
          kind: "sessions",
          label: hit.title,
          // fork:cmd-hint —— 服务端给的是命中**前后各 80 字**（lib/session-search.ts），
          // 整条塞进行尾会把标题挤没（用户 2026-10-05 截图：标题被压成逐字竖排的
          // “M- / 05 / _settings / frames”）。这里改成以命中处为中心的一小段，两头补省略号，
          // 命中那几个字上 `.d-cmd-hit` 色 —— 一眼能看出「在哪一句里命中」。
          // 没有正文命中（最近打开那一组）时给**目录名**而不是整条路径：D-22 帧 A/B/C 里
          // 会话行的行尾格就是「PI NEXT」这种项目名（板面自己从不写整条路径），而整条路径
          // 在单行省略里被截掉的是**尾巴**，留下的 “/Users/yingjing/Desktop/PI…” 恰好把
          // 有用的那截藏了。
          hint: hit.match ? (
            <>
              {hit.before.length > 24 ? "…" : ""}
              {hit.before.slice(-24)}
              <span className="d-cmd-hit">{hit.match}</span>
              {hit.after.slice(0, 24)}
              {hit.after.length > 24 ? "…" : ""}
            </>
          ) : cwdBasename(hit.cwd),
          icon: "message-square",
          onPick: () => onOpenSession(hit.sessionId),
        });
      }
    };
    if (trimmed) pushCommands();
    pushSessions();
    if (!trimmed) pushCommands();
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

  /* fork:v5-pwa-m0708 · M-08 帧 A-2（「最近搜索必须在第一屏」）——
     手机上**没有查询词**时，历史组与结果组画在同一张表里，上下连成一条可导航的
     列表，游标 `active` 走的是 `[历史 … 结果]` 这一个下标空间
     （`historyOffset` 是历史占掉的长度）。之前历史行只画在 `rows.length === 0`
     那一支里，而 `commands` 恒非空 ⇒ 那一支永远走不到，「最近搜索」在真机上从未
     出现过；而且历史行的 `setActive(index)` 写的是**结果列表**的下标，悬停第 2 条
     历史会点亮第 2 条结果、回车也打开它 —— 两个下标空间错位。
     `isMobile &&` 是有意的：桌面那一支的段序照 D-22 帧 A 的 `.d-cmd-group`，
     本轮不碰（帧 D-22 不在 M-07/M-08 范围内）。 */
  const historyVisible = isMobile && !trimmed && history.length > 0;
  const historyOffset = historyVisible ? history.length : 0;
  const navigableLength = historyOffset + rows.length;

  /** 把一条历史写回输入框（前缀按它当时的作用域补回去）—— 两处共用这一条。 */
  const restoreHistory = (entry: CommandPaletteHistoryEntry) => {
    setRaw(entry.scope === "all" ? entry.query : `${PALETTE_SCOPE_PREFIXES.find((p) => p.scope === entry.scope)?.prefix ?? ""}${entry.query}`);
    setManualScope(entry.scope);
  };

  const pickActive = () => {
    if (historyVisible && active < historyOffset) {
      restoreHistory(history[active]);
      return;
    }
    pick(active - historyOffset);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (navigableLength ? (i + 1) % navigableLength : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (navigableLength ? (i - 1 + navigableLength) % navigableLength : 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      pickActive();
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
          /* fork:v5-frame-audit —— M-08 帧 A-2 / B / C 的 `.m-pickbar`：键帽 + 一句
             人话（「移动 / 打开 / 收起」）。外接键盘时这行是真的，手机上它至少说明
             「这块可以被键盘驱动」（M-08 注）。 */
          <>
            <span className="m-kbd">↑</span>
            <span className="m-kbd">↓</span>
            <span className="m-t-xs m-t-faint">{t("palette.keyMove")}</span>
            <span className="m-kbd">↵</span>
            <span className="m-t-xs m-t-faint">{t("palette.keyOpen")}</span>
            <span className="m-grow" />
            <span className="m-kbd">esc</span>
            <span className="m-t-xs m-t-faint">{t("palette.keyClose")}</span>
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
          {/* fork:v5-frame-audit —— 画板 M-08 帧 A-2 的托盘右端那句「前缀即分类」：
             它是这条前缀 chip 行的**图注**，缺了 chip 就只剩三个无来由的符号。 */}
          <span className="m-grow" />
          <span className="m-t-xs m-t-faint">{t("palette.prefixIsCategory")}</span>
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

          {/* fork:v5-pwa-m0708 · M-08 帧 A-2 —— **最近搜索排在结果之前**。
             画板原话：「打开后第一屏先给最近搜索与快捷入口」「命令中心 90% 的使用
             是重复动作，靠打字找的成本远高于点两下」。这一组此前挂在
             `rows.length === 0` 那一支里，而命令表恒非空 ⇒ 真机上从未出现过。
             DOM 照帧 A-2：`.m-rowlabel`（标签 · 条数）+ 若干 `.m-sheet-row`
             （`clock` 图标 + 等宽标题带前缀 + `.m-sheet-row-desc` 写它当时的作用域）。
             画板紧接着的「快捷入口」`.m-grid2` 在本仓没有数据源：命令表就是
             `SETTINGS_SECTIONS` 全量（AppShell 构造），再造一份宫格等于把同一张
             清单摆两遍 —— 结果组承担这个位置，已登记在汇报里。 */}
          {historyVisible && (
            <>
              <div className="m-rowlabel">{`${t("palette.recent")} · ${history.length}`}</div>
              {history.map((entry, index) => (
                <button
                  key={`${entry.query}:${entry.updatedAt}`}
                  type="button"
                  className={`m-sheet-row${index === active ? " is-on" : ""}`}
                  data-active={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => restoreHistory(entry)}
                >
                  <i data-ico="clock" data-size="16" aria-hidden="true"></i>
                  <span className="m-setrow-body">
                    <span className="m-setrow-t m-mono">
                      {entry.scope === "all"
                        ? entry.query
                        : `${PALETTE_SCOPE_PREFIXES.find((p) => p.scope === entry.scope)?.prefix ?? ""} ${entry.query}`}
                    </span>
                    <span className="m-sheet-row-desc">{t(`palette.scope.${entry.scope}`)}</span>
                  </span>
                </button>
              ))}
            </>
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
                {/* fork:v5-frame-audit —— 画板 M-08 帧 C-1 的空态必须带**可点的去处**
                    （板上三条：清空 / 去掉前缀 / 去商店）。这里接上两条产品自己能兑现的：
                    清空 = 真的清输入框，去掉前缀 = 真的退到「全部」；第三条「去商店」
                    需要一个 `onOpenStore` 宿主（产品命令中心目前没有这个 prop），
                    不凭空造一个按不动的按钮 —— 已登记在汇报里。 */}
                <div className="m-pickbar" style={{ width: "100%" }}>
                  <button
                    type="button"
                    className="m-picktag"
                    onClick={() => { setRaw(""); setManualScope("all"); }}
                  >
                    {t("palette.emptyClear")}
                  </button>
                  <button
                    type="button"
                    className="m-picktag is-on"
                    onClick={() => { setRaw(raw.replace(/^[>#@]\s?/u, "")); setManualScope("all"); }}
                  >
                    {t("palette.emptyDropPrefix")}
                  </button>
                </div>
              </div>
            ) : null
          ) : rows.map((row, index) => (
            <Fragment key={row.key}>
              {/* 分组标题仍按**结果自己的下标**判：组序是 `rows` 的属性，与历史组无关。
                  这里曾经把判据写成 `historyOffset + index === 0` —— 历史组一出现，
                  第一行的 `index === 0` 短路就失效，`rows[-1].kind` 直接抛
                  TypeError，整棵根布局崩进 `error.tsx`（实测：任何非空历史 +
                  打开面板 = 必崩）。判据必须留在结果的下标空间里。 */}
              {(index === 0 || rows[index - 1].kind !== row.kind) && (
                <div className="m-rowlabel">{groupTitle(row.kind)}</div>
              )}
              <button
                type="button"
                className={`m-sheet-row${historyOffset + index === active ? " is-on" : ""}`}
                role="option"
                aria-selected={historyOffset + index === active}
                data-active={historyOffset + index === active}
                onMouseEnter={() => setActive(historyOffset + index)}
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
          {/* fork:v5-frame-audit D-22 帧 A —— 页签行右端这一段板面有、产品原先没有：
              一个撑开的 `d-grow` + 一颗「前缀语法」说明钮（`.d-iconbtn` + keyboard 图标）。
              浮层本体在 `.d-cmd` 里、`.d-cmd-input` 之后（抄板面位置：`.d-pop` 是
              `.d-cmd-input` 的兄弟，不是它的子节点）。 */}
          <span className="d-grow"></span>
          <button
            type="button"
            className="d-iconbtn"
            title={t("palette.title")}
            aria-expanded={syntaxOpen}
            aria-label={t("palette.title")}
            onClick={() => setSyntaxOpen((v) => !v)}
          >
            <i data-ico="keyboard" data-size="14" aria-hidden="true"></i>
          </button>
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
                {/* 帧 C 的 `.d-empty-s` 在板面是一整段话 + 三个行内 `.d-kbd`（不是三行列表）：
                    先照板面的形状抄，话用既有的 `palette.scope.*` 拼，不新造 i18n key。 */}
                <div className="d-empty-s">
                  {t("palette.scope.commands")} <span className="d-kbd">&gt;</span> ·{" "}
                  {t("palette.scope.sessions")} <span className="d-kbd">#</span> ·{" "}
                  {t("palette.scope.files")} <span className="d-kbd">@</span>
                </div>
                {/* 帧 C 空态底下那行按钮：第一颗就是页签行那颗语法钮的同一个浮层（真能点开）；
                    板面第二颗「看搜索中的样子」是演示重播件（骨架由真实 searching 态驱动），
                    不在产品里造假开关。 */}
                <div className="d-row" style={{ gap: "var(--nx-sp-2)" }}>
                  <button
                    type="button"
                    className="d-btn sm"
                    onClick={() => setSyntaxOpen(true)}
                  >
                    <i data-ico="keyboard" data-size="13" aria-hidden="true"></i>
                    {t("palette.title")}
                  </button>
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

      {/* fork:v5-frame-audit D-22 帧 A/B/C —— 「前缀即语法」浮层。板面三帧各有一份
          （A = 三行键位表 + 分隔线 + 一句脚注，B/C 各换一句解释文案）。
          产品这一份常驻 DOM、用 `hidden` 开关（浮层的唯一开关就是 hidden，见 system.css §6），
          不换数据源、不改任何既有行为。 */}
      <div
        className={`d-pop${syntaxOpen ? " is-open" : ""}`}
        hidden={!syntaxOpen}
        // 非主题值：min-width 280px 是画板 D-22 三帧浮层上的同一行内联值（不是令牌）。
        style={{ right: "var(--nx-sp-6)", top: "var(--nx-sp-6)", minWidth: 280 }}
      >
        <div className="d-pop-title">{t("palette.title")}</div>
        <div className="d-pop-body d-col" style={{ gap: "var(--nx-sp-2)" }}>
          {PALETTE_SCOPE_PREFIXES.filter((entry) => entry.scope !== "all").map((entry) => (
            <div key={entry.scope} className="d-row">
              <span className="d-kbd">{entry.prefix}</span>
              <span className="d-t-sm">{t(`palette.scope.${entry.scope}`)}</span>
            </div>
          ))}
        </div>
        <div className="d-sep"></div>
        <div className="d-pop-foot">{t("palette.placeholder")}</div>
      </div>
    </div>
  );
}
