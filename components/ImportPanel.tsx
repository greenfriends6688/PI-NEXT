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
 *
 * fork:design-system —— 画板 46 帧「从其它 agent 导入」：页头行（h2 + 重新扫描）+
 * 四类资产 `.pw-radio`（带计数）+ `.pw-cols`（左列：搜索行 + 按来源分组列表，行内
 * `.pw-switch` 即选中态；右列 300px：「本次选择」与「上次导入结果」两张 `.pw-detail`）。
 * 结果三色：success / warning / error 各配一枚图标（画板注记）。
 */

import { useCallback, useState, type ReactNode } from "react";

import { useI18n } from "@/hooks/useI18n";
import {
  groupCandidates,
  groupsForKind,
  summarizeResults,
  toggleGroupSelection,
  type ImportGroupBy,
  type ImportResultSummary,
} from "@/lib/import/groups";
// The contract, not `./types`: that module owns the filesystem helpers and pulls in
// `node:fs/promises`, which a client component cannot bundle.
import { IMPORT_KINDS, type ImportCandidate, type ImportKind, type ImportSourceDiagnostic } from "@/lib/import/contract";
import { getRecentProjects } from "@/lib/project-groups";
import { useProjectFlags } from "@/lib/project-flags";
import type { SessionInfo } from "@/lib/types";
import { ConfigButton, ConfigSwitch, PwRadio, SettingsPage } from "./SettingsUi";
/* fork:disabled-reasons —— 「为什么不能点」的本地文案（语言包在 lib/i18n/messages/**，
 * 本轮不允许改 lib/，所以走与 AgentsConfig 同一套本地表，详见那里的注释）。 */
import { localCopy, type LocalCopy } from "./AgentsConfig";

interface KindState {
  /** null = 还没扫过。 */
  candidates: ImportCandidate[] | null;
  sources: ImportSourceDiagnostic[];
  scanning: boolean;
  applying: boolean;
  error: string | null;
  status: string | null;
  /** 上一次 apply 的三色统计（画板 46 右下角的「上次导入结果」）。 */
  lastSummary: ImportResultSummary | null;
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
  lastSummary: null,
  selected: new Set(),
  groupBy: "source",
};

const KIND_LABEL_KEY: Record<ImportKind, string> = {
  sessions: "import.kindSessions",
  models: "import.kindModels",
  skills: "import.kindSkills",
  mcp: "import.kindMcp",
};

const KIND_ICON: Record<ImportKind, string> = {
  sessions: "message-square",
  models: "cpu",
  skills: "box",
  mcp: "server",
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

/** fork:disabled-reasons —— 「清空选择 / 导入所选」在一行都没勾时恒 disabled 的原因。 */
const NOTHING_SELECTED: LocalCopy = {
  en: "Nothing is selected yet — tick an entry in the list on the left first.",
  "zh-CN": "还没有勾选任何条目——先在左边的列表里勾上要导入的东西。",
  "zh-TW": "還沒有勾選任何項目——先在左邊的清單裡勾上要匯入的東西。",
};

export function ImportPanel() {
  const { locale, t } = useI18n();
  const { flags: projectFlags, restore: restoreProject } = useProjectFlags();
  const [active, setActive] = useState<ImportKind>("sessions");
  const [query, setQuery] = useState("");
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
      setKind(kind, {
        applying: false,
        status: t("import.result", { ...summary }),
        lastSummary: summary,
      });

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
    const keyword = query.trim().toLowerCase();
    const filtered = candidates && keyword
      ? candidates.filter((item) => describeCandidate(item).toLowerCase().includes(keyword)
        || itemModel(item, t).toLowerCase().includes(keyword))
      : candidates;
    // Grouping is O(candidates) over a list the scanner already capped, and this runs
    // for four panels — a hook here would be a conditional hook (renderKind is called
    // from a map), so it stays a plain call.
    const groups = filtered ? groupCandidates(filtered, state.groupBy) : [];
    const groupBys = groupsForKind(kind);
    const lastSummary = state.lastSummary;

    return (
      <div key={kind} hidden={kind !== active}>
        {/* What was looked at, including the sources that were not there. A missing
            source is normal and has to be visible, or an empty list looks broken. */}
        {state.sources.length > 0 && (
          <p className="sub">
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

        {state.error && (
          <div role="alert" className="pw-alert">
            <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
            <span className="grow">{state.error}</span>
          </div>
        )}
        {candidates === null && !state.scanning && <p className="sub">{t("import.idleHint")}</p>}
        {candidates !== null && candidates.length === 0 && <p className="sub">{t("import.empty")}</p>}

        <div className="pw-cols" style={{ gridTemplateColumns: "minmax(0,1fr) 300px" }}>
          <div>
            {/* 画板 46 的搜索行：search 图标 + 输入格 + 按来源/按项目 radio。 */}
            <div className="pw-inline" style={{ marginBottom: "var(--s2)" }}>
              <span className="pw-ico pw-dim"><i data-ico="search" data-size="14" aria-hidden="true" /></span>
              <input
                type="search"
                className="pw-input"
                style={{ flex: 1, minWidth: 0, height: "var(--control-sm)" }}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("import.searchPlaceholder")}
                aria-label={t("import.searchPlaceholder")}
              />
              {candidates !== null && groupBys.length > 1 && (
                <PwRadio
                  value={state.groupBy}
                  ariaLabel={t("import.groupBy")}
                  options={groupBys.map((by) => ({
                    value: by,
                    label: by === "source" ? t("import.groupBySource") : t("import.groupByProject"),
                  }))}
                  onChange={(by) => setKind(kind, { groupBy: by })}
                />
              )}
            </div>

            {state.scanning && <p role="status" className="sub">{t("i18n.loading")}</p>}

            {groups.map((group) => {
              const label = group.key
                ? (SOURCE_LABEL_KEY[group.rawLabel] ? t(SOURCE_LABEL_KEY[group.rawLabel]) : group.rawLabel)
                : t("import.noProject");
              return (
                <div key={group.key || "__none"}>
                  <div className="pw-sec-title">
                    {label} · {group.items.length}
                    <span className="pw-grow" aria-hidden="true" />
                    <ConfigButton
                      variant="ghost"
                      size="small"
                      onClick={() => setKind(kind, { selected: toggleGroupSelection(state.selected, group.items) })}
                    >
                      {t("import.selectAll")}
                    </ConfigButton>
                  </div>
                  <div className="pw-list">
                    {group.items.slice(0, 60).map((item) => (
                      <div key={item.id} className="pw-litem">
                        <ConfigSwitch
                          checked={state.selected.has(item.id)}
                          label={describeCandidate(item)}
                          onChange={() => {
                            const next = new Set(state.selected);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            setKind(kind, { selected: next });
                          }}
                        />
                        <span className="grow" title={describeCandidate(item)}>
                          <span className="pw-lname" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {describeCandidate(item)}
                          </span>
                          <span className="pw-lsub" title={itemModel(item, t)}>{itemModel(item, t)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  {group.items.length > 60 && (
                    <p className="sub">{t("import.moreInGroup", { count: group.items.length - 60 })}</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* 画板 46 右列：本次选择 + 上次导入结果（300px 定宽列）。 */}
          <div style={{ display: "grid", gap: "var(--s3)", alignContent: "start" }}>
            <div className="pw-detail">
              <h3 style={{ margin: 0, fontSize: "var(--text-body)" }}>{t("import.selectionTitle")}</h3>
              <dl className="pw-kv" style={{ marginTop: "var(--s2)" }}>
                <dt>{t("import.selectedOf", { selected: state.selected.size, total: candidates?.length ?? 0 })}</dt>
                <dd className="pw-mono">{state.selected.size}</dd>
              </dl>
              <div className="pw-inline" style={{ marginTop: "var(--s3)" }}>
                <ConfigButton
                  variant="secondary"
                  size="small"
                  /* fork:disabled-reasons —— 两枚按钮在没勾选时恒灰，原来没有任何
                     title：用户只能推断「是不是坏了」。写禁用原因，不是功能名。 */
                  title={state.selected.size === 0 ? localCopy(NOTHING_SELECTED, locale) : undefined}
                  disabled={state.selected.size === 0}
                  onClick={() => setKind(kind, { selected: new Set() })}
                >
                  {t("import.clearSelection")}
                </ConfigButton>
                <span className="pw-grow" aria-hidden="true" />
                <ConfigButton
                  variant="primary"
                  size="small"
                  title={state.selected.size === 0 ? localCopy(NOTHING_SELECTED, locale) : undefined}
                  disabled={state.selected.size === 0 || state.applying}
                  onClick={() => void apply(kind)}
                >
                  {state.applying ? t("i18n.loading") : t("import.applySelected")}
                </ConfigButton>
              </div>
            </div>

            {lastSummary && (
              <div className="pw-detail">
                <h3 style={{ margin: 0, fontSize: "var(--text-body)" }}>{t("import.lastResultTitle")}</h3>
                <div className="pw-list" style={{ marginTop: "var(--s2)" }}>
                  <div className="pw-litem">
                    <span className="pw-ico" style={{ color: "var(--success)" }}>
                      <i data-ico="circle-check" data-size="14" aria-hidden="true" />
                    </span>
                    <span className="grow">
                      <span className="pw-lname">{t("import.resultImported", { count: lastSummary.imported })}</span>
                    </span>
                  </div>
                  <div className="pw-litem">
                    <span className="pw-ico" style={{ color: "var(--warning)" }}>
                      <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
                    </span>
                    <span className="grow">
                      <span className="pw-lname">{t("import.resultSkipped", { count: lastSummary.skipped })}</span>
                    </span>
                  </div>
                  <div className="pw-litem">
                    <span className="pw-ico" style={{ color: "var(--error)" }}>
                      <i data-ico="circle-x" data-size="14" aria-hidden="true" />
                    </span>
                    <span className="grow">
                      <span className="pw-lname">{t("import.resultFailed", { count: lastSummary.failed })}</span>
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* fork:settings-frame（画板 62）—— 导入页的三件套。
          h2 原来被包在 `.pw-inline` 里（够不到 board.css 的 `.pw-sbody > h2`），
          四类资产页签与说明挤在内容区第一行；「扫描」是页级动作、页签是列表级
          筛选，现在分列页头与工具栏。 */}
      <SettingsPage
        title={t("import.title")}
        sub={t("import.description")}
        actions={
          <ConfigButton
            variant="secondary"
            size="small"
            disabled={states[active].scanning}
            onClick={() => void scan(active)}
          >
            <span className="pw-ico"><i data-ico="scan-search" data-size="13" aria-hidden="true" /></span>
            {states[active].scanning ? t("i18n.loading") : t("import.scan")}
          </ConfigButton>
        }
        toolbar={
          <>
            {/* 四类资产页签：`.pw-radio` + 每类计数（扫过的才显示数字）。 */}
            <PwRadio
              value={active}
              ariaLabel={t("import.title")}
              options={IMPORT_KINDS.map((kind) => {
                const count = states[kind].candidates;
                return {
                  value: kind,
                  icon: KIND_ICON[kind],
                  label: count !== null ? `${t(KIND_LABEL_KEY[kind])} ${count.length}` : t(KIND_LABEL_KEY[kind]),
                };
              })}
              onChange={setActive}
            />
            <span className="pw-grow" aria-hidden="true" />
          </>
        }
      >
      {/* All four stay mounted: switching tabs must not throw away a scan result. */}
      {IMPORT_KINDS.map(renderKind)}
      </SettingsPage>
    </>
  );
}

/** `import.result` 的状态文案仍保留（无障碍读出用），三色统计走结构化的 `lastSummary`。 */

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
