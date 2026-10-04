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
 * 壳照画板 50 的对话框（`.pw-scrim` › `.pw-modal` › `.pw-modal-head` …
 * `.pw-modal-body`）与画板 45 的 `.pw-pop-search` + `.pw-prow` 行，零新 `.pw-*` 类。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
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
  const [raw, setRaw] = useState("");
  const [manualScope, setManualScope] = useState<CommandPaletteScope>("all");
  const [active, setActive] = useState(0);
  const [history, setHistory] = useState<CommandPaletteHistoryEntry[]>([]);
  const [sessions, setSessions] = useState<SessionHit[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [files, setFiles] = useState<FileHit[] | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { dialogRef, dialogProps } = useDialogA11y({ open, onClose });

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
    const out: Array<{ key: string; kind: string; label: React.ReactNode; hint?: string; icon: string; onPick: () => void }> = [];
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
    for (const hit of sessions ?? []) {
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
  }, [commandHits, sessions, files, onOpenSession, onOpenFile]);

  useEffect(() => {
    setActive(0);
  }, [scope, trimmed]);

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

  return (
    <div
      className="pw-scrim fork-cmd-scrim"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div {...dialogProps} ref={dialogRef} className="pw-modal fork-cmd-palette" aria-label={t("palette.title")}>
        <div className="pw-modal-head" style={{ padding: 0 }}>
          <div className="pw-pop-search fork-cmd-palette-search" style={{ flex: 1, borderBottom: "none" }}>
            <span className="pw-ico"><i data-ico="search" data-size="14" aria-hidden="true"></i></span>
            <input
              ref={inputRef}
              className="pw-input"
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t("palette.placeholder")}
              aria-label={t("palette.title")}
              autoFocus
              style={{ border: "none", background: "transparent" }}
            />
            <button
              type="button"
              className="pw-iconbtn sm"
              onClick={onClose}
              title={t("i18n.close")}
              aria-label={t("i18n.close")}
            >
              <span className="pw-ico"><i data-ico="x" data-size="14"></i></span>
            </button>
          </div>
        </div>

        {/* 域切换：点一下就把前缀写回输入框，与 ZCode 的 `setScope`（`:637-644`）同一条路。 */}
        <div className="pw-inline fork-cmd-palette-scopes" role="tablist">
          {PALETTE_SCOPE_PREFIXES.map((entry) => (
            <button
              key={entry.scope}
              type="button"
              role="tab"
              aria-selected={scope === entry.scope}
              className={`pw-chipbtn sm${scope === entry.scope ? " is-on" : ""}`}
              onClick={() => {
                setManualScope(entry.scope);
                setRaw(entry.scope === "all" ? raw.replace(/^[>#@]\s?/u, "") : `${entry.prefix}${raw.replace(/^[>#@]\s?/u, "")}`);
              }}
            >
              {t(`palette.scope.${entry.scope}`)}
            </button>
          ))}
        </div>

        <div className="pw-modal-body fork-cmd-palette-list" ref={listRef} role="listbox">
          {rows.length === 0 ? (
            trimmed
              ? <p className="pw-hint">{t("palette.noResults")}</p>
              : history.length > 0 && (
                <>
                  <p className="pw-sec-title">{t("palette.recent")}</p>
                  {history.map((entry, index) => (
                    <button
                      key={`${entry.query}:${entry.updatedAt}`}
                      type="button"
                      className="pw-prow"
                      data-active={index === active}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => {
                        setRaw(entry.scope === "all" ? entry.query : `${PALETTE_SCOPE_PREFIXES.find((p) => p.scope === entry.scope)?.prefix ?? ""}${entry.query}`);
                        setManualScope(entry.scope);
                      }}
                    >
                      <span className="pw-ico"><i data-ico="clock" data-size="13"></i></span>
                      <span className="grow">{entry.query}</span>
                      <span className="pw-desc">{t(`palette.scope.${entry.scope}`)}</span>
                    </button>
                  ))}
                </>
              )
          ) : rows.map((row, index) => (
            <button
              key={row.key}
              type="button"
              className="pw-prow"
              role="option"
              aria-selected={index === active}
              data-active={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(index)}
            >
              <span className="pw-ico"><i data-ico={row.icon} data-size="14"></i></span>
              <span className="grow">{row.label}</span>
              {row.hint ? <span className="pw-desc">{row.hint}</span> : null}
            </button>
          ))}
          {(sessionsLoading || filesLoading) && (
            <p className="pw-hint" role="status">{t("palette.searching")}</p>
          )}
        </div>
      </div>
    </div>
  );
}