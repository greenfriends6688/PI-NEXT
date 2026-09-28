"use client";

/**
 * fork:import-ui — 设置 → 导入。
 *
 * 四类（会话 / 模型 / 技能 / MCP）各占一个分段 tab，**四个面板同时挂载、只切 `hidden`**：
 * 切 tab 不会丢掉已经扫出来的结果，也不会偷偷再扫一次。扫描永远是显式动作——
 * 参考实现的 ADR 0179 D007 明确禁止「启动时自动导入」，这里同样不自动扫。
 *
 * 两条纪律贯穿这个组件：
 *   1. 送给 `/api/import/apply` 的只有**候选 id**，从不送路径。服务端会重新扫一遍再反查，
 *      所以渲染端注入不了任何读/写路径。
 *   2. 结果按 `imported / skipped / failed` 三个数报，不假装「全部成功」。
 *
 * 这里也是 PD-14（导入后把新出现的项目从归档态恢复）的落点：导入会话前先记下项目 key 集合，
 * 导入后把**新增**的那些从归档里拿出来。只动新增的，不做全量刷新。
 */

import { useCallback, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import {
  groupCandidates,
  groupsForKind,
  groupSelectionState,
  summarizeResults,
  toggleAllSelection,
  toggleGroupSelection,
  type ImportGroupBy,
} from "@/lib/import/groups";
// The contract, not `./types`: that module owns the filesystem helpers and pulls in
// `node:fs/promises`, which a client component cannot bundle.
import { IMPORT_KINDS, type ImportCandidate, type ImportKind, type ImportSourceDiagnostic } from "@/lib/import/contract";
import { getRecentProjects } from "@/lib/project-groups";
import { useProjectFlags } from "@/lib/project-flags";
import type { SessionInfo } from "@/lib/types";
import { ConfigButton, ConfigFooter } from "./SettingsUi";

interface KindState {
  /** null = 还没扫过。 */
  candidates: ImportCandidate[] | null;
  sources: ImportSourceDiagnostic[];
  scanning: boolean;
  applying: boolean;
  error: string | null;
  status: string | null;
  selected: ReadonlySet<string>;
  groupBy: ImportGroupBy;
}

const EMPTY_KIND: KindState = {
  candidates: null,
  sources: [],
  scanning: false,
  applying: false,
  error: null,
  status: null,
  selected: new Set(),
  groupBy: "source",
};

const KIND_LABEL_KEY: Record<ImportKind, string> = {
  sessions: "import.kindSessions",
  models: "import.kindModels",
  skills: "import.kindSkills",
  mcp: "import.kindMcp",
};

const SOURCE_LABEL_KEY: Record<string, string> = {
  claude: "import.sourceClaude",
  "claude-desktop": "import.sourceClaudeDesktop",
  codex: "import.sourceCodex",
  opencode: "import.sourceOpencode",
  cursor: "import.sourceCursor",
  agents: "import.sourceAgents",
  pi: "import.sourcePi",
};

export function ImportPanel() {
  const { t } = useI18n();
  const { flags: projectFlags, restore: restoreProject } = useProjectFlags();
  const [active, setActive] = useState<ImportKind>("sessions");
  const [states, setStates] = useState<Record<ImportKind, KindState>>({
    sessions: { ...EMPTY_KIND },
    models: { ...EMPTY_KIND },
    skills: { ...EMPTY_KIND },
    mcp: { ...EMPTY_KIND },
  });

  const setKind = useCallback((kind: ImportKind, patch: Partial<KindState>) => {
    setStates((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
  }, []);

  const readProjectKeys = useCallback(async (): Promise<Set<string> | null> => {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) return null;
      const data = await res.json() as { sessions?: SessionInfo[] };
      return new Set(getRecentProjects(data.sessions ?? []).map((project) => project.key));
    } catch {
      return null;
    }
  }, []);

  const scan = useCallback(async (kind: ImportKind) => {
    setKind(kind, { scanning: true, error: null, status: null });
    try {
      const res = await fetch("/api/import/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const data = await res.json() as {
        candidates?: ImportCandidate[];
        sources?: ImportSourceDiagnostic[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      const candidates = data.candidates ?? [];
      setKind(kind, {
        candidates,
        sources: data.sources ?? [],
        scanning: false,
        // A fresh scan invalidates the previous selection: ids may no longer exist.
        selected: new Set(),
      });
    } catch (failure) {
      setKind(kind, {
        scanning: false,
        error: failure instanceof Error ? failure.message : String(failure),
      });
    }
  }, [setKind]);

  const apply = useCallback(async (kind: ImportKind) => {
    const state = states[kind];
    if (state.selected.size === 0) return;
    setKind(kind, { applying: true, error: null, status: null });
    // PD-14: remember the project keys before a session import so the restore only
    // touches projects this import actually introduced.
    const before = kind === "sessions" ? await readProjectKeys() : null;
    try {
      const res = await fetch("/api/import/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ids: [...state.selected] }),
      });
      const data = await res.json() as {
        items?: { status: "imported" | "skipped" | "failed" }[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      const summary = summarizeResults(data.items ?? []);
      // Refresh first: imported rows no longer resolve, so the stale list would offer
      // ids the server rejects. The summary is written *after* that refresh, because
      // `scan` clears `status` on its way in.
      await scan(kind);
      setKind(kind, { applying: false, status: t("import.result", { ...summary }) });

      if (kind === "sessions" && before) {
        const after = await readProjectKeys();
        if (after) {
          for (const key of after) {
            if (before.has(key)) continue;
            if (projectFlags.archived.includes(key)) restoreProject(key);
          }
        }
      }
    } catch (failure) {
      setKind(kind, {
        applying: false,
        error: failure instanceof Error ? failure.message : String(failure),
      });
    }
  }, [projectFlags.archived, readProjectKeys, restoreProject, scan, setKind, states, t]);

  // NOTE: this runs for all four kinds on every render, and it must read the state it
  // was handed rather than a captured copy — an earlier version built the group list from
  // a `useMemo` inside this loop (a conditional hook) and the grouping toggle silently
  // stopped re-rendering.
  const renderKind = (kind: ImportKind) => {
    const state = states[kind];
    const candidates = state.candidates;
    // Grouping is O(candidates) over a list the scanner already capped, and this runs
    // for four panels — a hook here would be a conditional hook (renderKind is called
    // from a map), so it stays a plain call.
    const groups = candidates ? groupCandidates(candidates, state.groupBy) : [];
    const overall = candidates ? groupSelectionState(candidates, state.selected) : "none";
    const groupBys = groupsForKind(kind);

    return (
      <div key={kind} hidden={kind !== active}>
        {/* 三组：动作（扫描）｜视图（按来源/按项目）｜结果（已选 + 导入）。
            原先五个控件平铺一行、样式权重相同，看不出哪几个是一组，右侧也没有落点。 */}
        <div className="import-toolbar">
          <div className="import-toolbar-group">
            <ConfigButton variant="secondary" size="small" disabled={state.scanning} onClick={() => void scan(kind)}>
              {state.scanning ? t("i18n.loading") : t("import.scan")}
            </ConfigButton>
          </div>
          {candidates !== null && groupBys.length > 1 && (
            <div className="import-toolbar-group" role="group" aria-label={t("import.groupBy")}>
              {groupBys.map((by) => (
                <ConfigButton
                  key={by}
                  variant={state.groupBy === by ? "primary" : "ghost"}
                  size="small"
                  aria-pressed={state.groupBy === by}
                  onClick={() => setKind(kind, { groupBy: by })}
                >
                  {by === "source" ? t("import.groupBySource") : t("import.groupByProject")}
                </ConfigButton>
              ))}
            </div>
          )}
          {candidates !== null && candidates.length > 0 && (
            <div className="import-toolbar-group import-toolbar-end">
              <label className="import-select-all">
                <input
                  type="checkbox"
                  checked={overall === "all"}
                  ref={(node) => { if (node) node.indeterminate = overall === "some"; }}
                  onChange={() => setKind(kind, { selected: toggleAllSelection(state.selected, candidates) })}
                />
                {t("import.selectedOf", { selected: state.selected.size, total: candidates.length })}
              </label>
              <ConfigButton
                variant="primary"
                size="small"
                disabled={state.selected.size === 0 || state.applying}
                onClick={() => void apply(kind)}
              >
                {state.applying ? t("i18n.loading") : t("import.applySelected")}
              </ConfigButton>
            </div>
          )}
        </div>

        {/* What was looked at, including the sources that were not there. A missing
            source is normal and has to be visible, or an empty list looks broken. */}
        {state.sources.length > 0 && (
          <p className="settings-pi-theme-note" style={{ marginBottom: 8 }}>
            {state.sources.map((source) => {
              const label = SOURCE_LABEL_KEY[source.source]
                ? t(SOURCE_LABEL_KEY[source.source])
                : source.source;
              if (!source.exists) return `${label}: ${t("import.sourceMissing")}`;
              // The destination tree is reported, not scanned: it is where imports land,
              // so nothing in it can be imported anywhere.
              if (source.error === "destination") return `${label}: ${t("import.sourceDestination")}`;
              const count = `${label}: ${source.count}${source.truncated ? "+" : ""}`;
              return source.error ? `${count} (${source.error})` : count;
            }).join("  ·  ")}
          </p>
        )}

        {state.error && <p className="settings-general-error" role="alert">{state.error}</p>}
        {candidates === null && !state.scanning && (
          <p className="settings-pi-theme-note">{t("import.idleHint")}</p>
        )}
        {candidates !== null && candidates.length === 0 && (
          <p className="settings-pi-theme-note">{t("import.empty")}</p>
        )}

        {groups.map((group) => {
          const groupState = groupSelectionState(group.items, state.selected);
          const label = group.key
            ? (SOURCE_LABEL_KEY[group.rawLabel] ? t(SOURCE_LABEL_KEY[group.rawLabel]) : group.rawLabel)
            : t("import.noProject");
          return (
            <div key={group.key || "__none"} className="settings-archived-group">
              <label className="settings-archived-group-label" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={groupState === "all"}
                  ref={(node) => { if (node) node.indeterminate = groupState === "some"; }}
                  onChange={() => setKind(kind, { selected: toggleGroupSelection(state.selected, group.items) })}
                />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                <span style={{ color: "var(--text-dim)" }}>{group.items.length}</span>
              </label>
              {group.items.slice(0, 60).map((item) => (
                <div key={item.id} className="settings-archived-row" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={state.selected.has(item.id)}
                    onChange={() => {
                      const next = new Set(state.selected);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      setKind(kind, { selected: next });
                    }}
                    aria-label={describeCandidate(item)}
                  />
                  {/* Titles and descriptions are both arbitrarily long, and the meta cell
                      ran straight into the title with no separator and no truncation, so a
                      row read as one run-on line. `flexBasis: 0` + `minWidth: 0` on both
                      makes them share the row and ellipsise independently. */}
                  <span
                    className="settings-archived-name"
                    style={{ flex: "1 1 0", minWidth: 0 }}
                    title={describeCandidate(item)}
                  >
                    {describeCandidate(item)}
                  </span>
                  <span
                    className="settings-archived-meta"
                    style={{ flex: "0 1 auto", minWidth: 0, maxWidth: "45%", borderLeft: "1px solid var(--border)", paddingLeft: 8 }}
                    title={itemModel(item, t)}
                  >
                    {itemModel(item, t)}
                  </span>
                </div>
              ))}
              {group.items.length > 60 && (
                <p className="settings-pi-theme-note">{t("import.moreInGroup", { count: group.items.length - 60 })}</p>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section className="fork-settings-block">
      <h3 className="fork-settings-block-label">{t("import.title")}</h3>
      <p className="settings-pi-theme-description">{t("import.description")}</p>

      <div role="tablist" aria-label={t("import.title")} style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
        {IMPORT_KINDS.map((kind) => (
          <ConfigButton
            key={kind}
            variant={kind === active ? "primary" : "ghost"}
            size="small"
            aria-pressed={kind === active}
            onClick={() => setActive(kind)}
          >
            {t(KIND_LABEL_KEY[kind])}
          </ConfigButton>
        ))}
      </div>

      {/* All four stay mounted: switching tabs must not throw away a scan result. */}
      {IMPORT_KINDS.map(renderKind)}

      <ConfigFooter status={states[active].status ?? undefined} />
    </section>
  );
}

/** One line that identifies a row well enough to decide whether to import it. */
function describeCandidate(candidate: ImportCandidate): string {
  if (candidate.kind === "sessions") {
    return candidate.title || candidate.externalId;
  }
  return candidate.name;
}

function itemModel(candidate: ImportCandidate, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (candidate.kind === "sessions") {
    const count = candidate.messageCount === null ? "—" : String(candidate.messageCount);
    return `${count} · ${candidate.projectPath ?? t("import.noProject")}`;
  }
  if (candidate.kind === "models") {
    return candidate.hasSecret ? t("import.hasCredential") : (candidate.baseUrl ?? "");
  }
  if (candidate.kind === "mcp") {
    return candidate.transport === "http" ? (candidate.url ?? "http") : (candidate.command ?? "stdio");
  }
  return candidate.description ?? "";
}
