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
 * fork:settings-frame（画板 62，2026-10-01）—— 页面改**骨架 B（列表 300 + 详情 760）**，
 * 三件套各就各位：
 *   - 「扫描」是页级动作 → 页头右端（画板 46 页头同款 scan-search outline 按钮）；
 *   - 工具栏 = 四类资产 `PwRadio`（带计数）+ 搜索 + 按来源/按项目 + grow + **选择摘要**
 *     （`已选 n / m` 徽章 + 清空选择 + 导入所选）——「本次选择」摘要卡从右侧浮列收进
 *     工具栏右端（落位表：「浮卡与搜索框不对齐 → 选择摘要进工具栏右端」），清空/导入
 *     是列表级动作，按 62 的动作层级就位；
 *   - 列表列 = 扫描空态（62 帧 D：图标 + 一句 + 说明）/ 按来源分组的 `.d-set-sec-t` +
 *     `.d-sess` 行（行首 `.d-switch` 即选中态，画板 46 原样）；
 *   - 详情列 = 扫描来源说明 +「上次导入结果」卡（三色行，画板 46 注记）或「未选」空态。
 */

import { useCallback, useState } from "react";

import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { PwaBanner, PwaPage, PwaSetRow, PwaSwitchRow } from "@/components/pwa/PwaPage";
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
import {
  ConfigBadge,
  ConfigButton,
  ConfigDetail,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigSidebar,
  ConfigSidebarList,
  ConfigSplitView,
  ConfigSwitch,
  PwRadio,
  PwSearch,
  SettingsPage,
} from "./SettingsUi";
/* fork:disabled-reasons —— 「为什么不能点」的本地文案（语言包在 lib/i18n/messages/**，
 * 本轮不允许改 lib/，所以走与 AgentsConfig 同一套本地表，详见那里的注释）。 */
import { localCopy, type LocalCopy } from "./settings-disabled-reasons";

interface KindState {
  /** null = 还没扫过。 */
  candidates: ImportCandidate[] | null;
  sources: ImportSourceDiagnostic[];
  scanning: boolean;
  applying: boolean;
  error: string | null;
  status: string | null;
  /** 上一次 apply 的三色统计（详情列的「上次导入结果」卡）。 */
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

/**
 * 一个扫描来源的**唯一**说法：桌面那一排 `.d-cite` 芯片与窄屏那一行
 * `PwaSetRow` 共用同一份拼装，所以两端不可能各说各话。
 * `scanned: false` 三种情形（不存在 / 是目标目录 / 读出错）都不是「扫到 0 条」——
 * 芯片用空心点，形状本身就在说「这一类没参与」。
 */
function describeSourceChip(
  source: ImportSourceDiagnostic,
  t: (key: string, params?: Record<string, string | number>) => string,
): { scanned: boolean; text: string } {
  const label = SOURCE_LABEL_KEY[source.source] ? t(SOURCE_LABEL_KEY[source.source]) : source.source;
  if (!source.exists) return { scanned: false, text: `${label}: ${t("import.sourceMissing")}` };
  // The destination tree is reported, not scanned: it is where imports land,
  // so nothing in it can be imported anywhere.
  if (source.error === "destination") return { scanned: false, text: `${label}: ${t("import.sourceDestination")}` };
  const count = `${label}: ${source.count}${source.truncated ? "+" : ""}`;
  if (source.error) return { scanned: false, text: `${count} (${source.error})` };
  return { scanned: true, text: count };
}

/** fork:disabled-reasons —— 「清空选择 / 导入所选」在一行都没勾时恒 disabled 的原因。 */
const NOTHING_SELECTED: LocalCopy = {
  en: "Nothing is selected yet — tick an entry in the list on the left first.",
  "zh-CN": "还没有勾选任何条目——先在左边的列表里勾上要导入的东西。",
  "zh-TW": "還沒有勾選任何項目——先在左邊的清單裡勾上要匯入的東西。",
};

export function ImportPanel() {
  const { locale, t } = useI18n();
  const mobile = useIsMobile();
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

  const activeState = states[active];
  const activeGroupBys = groupsForKind(active);

  // NOTE: the two renderers below run for all four kinds on every render, and they must
  // read the state they are handed rather than a captured copy — an earlier version built
  // the group list from a `useMemo` inside this loop (a conditional hook) and the grouping
  // toggle silently stopped re-rendering. They stay plain functions on purpose.
  const renderList = (kind: ImportKind) => {
    const state = states[kind];
    const candidates = state.candidates;
    const keyword = query.trim().toLowerCase();
    const filtered = candidates && keyword
      ? candidates.filter((item) => describeCandidate(item).toLowerCase().includes(keyword)
        || itemModel(item, t).toLowerCase().includes(keyword))
      : candidates;
    // Grouping is O(candidates) over a list the scanner already capped, and this runs
    // for four panels — a hook here would be a conditional hook (renderList is called
    // from a map), so it stays a plain call.
    const groups = filtered ? groupCandidates(filtered, state.groupBy) : [];

    if (state.scanning) {
      return <p role="status" className="d-t-xs d-t-faint">{t("i18n.loading")}</p>;
    }
    // 画板 62 帧 D 的列表空态：图标 + 一句 + 一句说明，落在列表列内。
    if (candidates === null) {
      return (
        <ConfigEmptyState>
          <span className="mark"><i data-ico="scan-search" data-size="16" aria-hidden="true" /></span>
          <p>{t("import.idleHint")}</p>
        </ConfigEmptyState>
      );
    }
    if (candidates.length === 0) {
      return (
        <ConfigEmptyState>
          <span className="mark"><i data-ico="inbox" data-size="16" aria-hidden="true" /></span>
          <p>{t("import.empty")}</p>
        </ConfigEmptyState>
      );
    }

    return (
      <>
        {groups.map((group) => {
          const label = group.key
            ? (SOURCE_LABEL_KEY[group.rawLabel] ? t(SOURCE_LABEL_KEY[group.rawLabel]) : group.rawLabel)
            : t("import.noProject");
          return (
            <div key={group.key || "__none"}>
              <div className="d-set-sec-t d-row">
                {label} · {group.items.length}
                <span className="d-grow" aria-hidden="true" />
                <ConfigButton
                  variant="ghost"
                  size="small"
                  onClick={() => setKind(kind, { selected: toggleGroupSelection(state.selected, group.items) })}
                >
                  {t("import.selectAll")}
                </ConfigButton>
              </div>
              <ConfigSidebarList>
                {group.items.slice(0, 60).map((item) => (
                  <div key={item.id} className="d-set-row">
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
                    <span className="d-grow" title={describeCandidate(item)}>
                      <span className="d-set-row-t">{describeCandidate(item)}</span>
                      <span className="d-set-row-s" title={itemModel(item, t)}>{itemModel(item, t)}</span>
                    </span>
                  </div>
                ))}
              </ConfigSidebarList>
              {group.items.length > 60 && (
                <p className="d-t-xs d-t-faint">{t("import.moreInGroup", { count: group.items.length - 60 })}</p>
              )}
            </div>
          );
        })}
        {/* 关键词把当前类过滤光时列表不能静默变白板，给一句落点。 */}
        {groups.length === 0 && candidates !== null && (
          <p role="status" className="d-t-xs d-t-faint">{t("import.empty")}</p>
        )}
      </>
    );
  };

  const renderDetail = (kind: ImportKind) => {
    const state = states[kind];
    return (
      <>
        {/* What was looked at, including the sources that were not there. A missing
            source is normal and has to be visible, or an empty list looks broken.

            fork:v5-landing · D-21 帧 B —— 画板把这一行写成 `.d-cites` 一排
            `.d-cite` 芯片（实心 `circle-dot` = 扫到了，空心 `circle` = 没扫到），
            而不是一串用 `·` 拼起来的灰字。文案与判据一字未改：仍然逐个来源
            报告，`sourceMissing` / `sourceDestination` / 截断的 `+` / 读错时的
            原文错误都照旧，只是从一段话变成了一排芯片。 */}
        {state.sources.length > 0 && (
          <div className="d-cites">
            {state.sources.map((source) => {
              const chip = describeSourceChip(source, t);
              return (
                <span className={`d-cite${chip.scanned ? " is-on" : ""}`} key={`${source.source}-${chip.text}`}>
                  <i data-ico={chip.scanned ? "circle-dot" : "circle"} data-size="12" aria-hidden="true" />
                  {chip.text}
                </span>
              );
            })}
          </div>
        )}

        {state.lastSummary ? (
          <ConfigDetail>
            <ConfigDetailStack>
              <ConfigDetailTitle>{t("import.lastResultTitle")}</ConfigDetailTitle>
              <ConfigSidebarList>
                <div className="d-set-row">
                  <i data-ico="circle-check" data-size="14" style={{ color: "var(--nx-success)" }} aria-hidden="true" />
                  <span className="d-grow">
                    <span className="d-set-row-t">{t("import.resultImported", { count: state.lastSummary.imported })}</span>
                  </span>
                </div>
                <div className="d-set-row">
                  <i data-ico="triangle-alert" data-size="14" style={{ color: "var(--nx-warning)" }} aria-hidden="true" />
                  <span className="d-grow">
                    <span className="d-set-row-t">{t("import.resultSkipped", { count: state.lastSummary.skipped })}</span>
                  </span>
                </div>
                <div className="d-set-row">
                  <i data-ico="circle-x" data-size="14" style={{ color: "var(--nx-danger)" }} aria-hidden="true" />
                  <span className="d-grow">
                    <span className="d-set-row-t">{t("import.resultFailed", { count: state.lastSummary.failed })}</span>
                  </span>
                </div>
              </ConfigSidebarList>
            </ConfigDetailStack>
          </ConfigDetail>
        ) : (
          <ConfigEmptyState>
            <span className="mark"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" /></span>
            <p>{t("import.idleHint")}</p>
          </ConfigEmptyState>
        )}
      </>
    );
  };

  // fork:v5-landing Wave B · M-05 · 窄屏：两段式不变成新页面 —— **扫描**仍是页头右端那枚
  // `scan-search`，第二段（挑 + 导入）直接跟在下面：四类页签 `.m-cats`、搜索 `.m-searchfield`、
  // 分组口径 `.m-pickbar`、选择摘要与两个动作 `.m-pickbar`、列表 `.m-cardgroup` + `.m-setrow`
  // （行首 `.m-switch` 即选中态）。
  // 「不点扫描不读文件、不点导入不写文件」与「四个面板同时挂载只切 hidden」两条纪律不动。
  if (mobile) {
    const keyword = query.trim().toLowerCase();
    const candidates = activeState.candidates;
    const filtered = candidates && keyword
      ? candidates.filter((item) => describeCandidate(item).toLowerCase().includes(keyword)
        || itemModel(item, t).toLowerCase().includes(keyword))
      : candidates;
    const mobileGroups = filtered ? groupCandidates(filtered, activeState.groupBy) : [];
    return (
      <PwaPage
        title={t("import.title")}
        actions={
          <button
            type="button"
            className="m-top-btn"
            title={activeState.scanning ? t("i18n.loading") : t("import.scan")}
            aria-label={activeState.scanning ? t("i18n.loading") : t("import.scan")}
            disabled={activeState.scanning}
            onClick={() => void scan(active)}
          >
            <i data-ico="scan-search" data-size="16" aria-hidden="true" />
          </button>
        }
      >
        <div className="m-cats">
          {IMPORT_KINDS.map((kind) => {
            const count = states[kind].candidates;
            return (
              <button
                key={kind}
                type="button"
                className={`m-cat${kind === active ? " is-on" : ""}`}
                aria-pressed={kind === active}
                onClick={() => setActive(kind)}
              >
                {count !== null ? `${t(KIND_LABEL_KEY[kind])} ${count.length}` : t(KIND_LABEL_KEY[kind])}
              </button>
            );
          })}
        </div>

        <div className="m-searchfield" style={{ margin: 0 }}>
          <i data-ico="search" data-size="14" aria-hidden="true" />
          <input
            value={query}
            placeholder={t("import.searchPlaceholder")}
            aria-label={t("import.searchPlaceholder")}
            maxLength={60}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {activeState.candidates !== null && activeGroupBys.length > 1 && (
          <div className="m-pickbar">
            {activeGroupBys.map((by) => (
              <button
                key={by}
                type="button"
                className={`m-picktag${by === activeState.groupBy ? " is-on" : ""}`}
                aria-pressed={by === activeState.groupBy}
                onClick={() => setKind(active, { groupBy: by })}
              >
                {by === "source" ? t("import.groupBySource") : t("import.groupByProject")}
              </button>
            ))}
          </div>
        )}

        <div className="m-pickbar">
          <span className="m-t-xs m-t-dim m-grow">
            {t("import.selectedOf", { selected: activeState.selected.size, total: activeState.candidates?.length ?? 0 })}
          </span>
          <button
            type="button"
            className="m-picktag"
            title={activeState.selected.size === 0 ? localCopy(NOTHING_SELECTED, locale) : undefined}
            disabled={activeState.selected.size === 0}
            onClick={() => setKind(active, { selected: new Set() })}
          >
            {t("import.clearSelection")}
          </button>
          <button
            type="button"
            className="m-picktag is-on"
            title={activeState.selected.size === 0 ? localCopy(NOTHING_SELECTED, locale) : undefined}
            disabled={activeState.selected.size === 0 || activeState.applying}
            onClick={() => void apply(active)}
          >
            {activeState.applying ? t("i18n.loading") : t("import.applySelected")}
          </button>
        </div>

        {activeState.error && (
          <PwaBanner icon="triangle-alert" tone="err" role="alert">{activeState.error}</PwaBanner>
        )}

        {activeState.sources.length > 0 && (
          <PwaSetRow
            label={t("import.title")}
            sub={activeState.sources.map((source) => describeSourceChip(source, t).text).join("  ·  ")}
          />
        )}

        {activeState.scanning ? (
          <p role="status" className="m-t-xs m-t-faint">{t("i18n.loading")}</p>
        ) : candidates === null ? (
          <div className="m-empty">
            <span className="m-empty-ico"><i data-ico="scan-search" data-size="20" aria-hidden="true" /></span>
            <span className="m-empty-s">{t("import.idleHint")}</span>
          </div>
        ) : candidates.length === 0 ? (
          <div className="m-empty">
            <span className="m-empty-ico"><i data-ico="inbox" data-size="20" aria-hidden="true" /></span>
            <span className="m-empty-s">{t("import.empty")}</span>
          </div>
        ) : (
          <>
            {mobileGroups.map((group) => {
              const label = group.key
                ? (SOURCE_LABEL_KEY[group.rawLabel] ? t(SOURCE_LABEL_KEY[group.rawLabel]) : group.rawLabel)
                : t("import.noProject");
              return (
                <div className="m-cardgroup" key={group.key || "__none"}>
                  <div className="m-group-title">
                    {label} · {group.items.length}
                  </div>
                  {group.items.slice(0, 60).map((item) => (
                    <PwaSwitchRow
                      key={item.id}
                      icon={KIND_ICON[item.kind]}
                      label={describeCandidate(item)}
                      sub={itemModel(item, t)}
                      checked={activeState.selected.has(item.id)}
                      switchLabel={describeCandidate(item)}
                      onChange={() => {
                        const next = new Set(activeState.selected);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        setKind(active, { selected: next });
                      }}
                    />
                  ))}
                  <div className="m-pickbar">
                    <button
                      type="button"
                      className="m-picktag"
                      onClick={() => setKind(active, { selected: toggleGroupSelection(activeState.selected, group.items) })}
                    >
                      {t("import.selectAll")}
                    </button>
                  </div>
                  {group.items.length > 60 && (
                    <PwaSetRow label={t("import.moreInGroup", { count: group.items.length - 60 })} />
                  )}
                </div>
              );
            })}
            {mobileGroups.length === 0 && (
              <p role="status" className="m-t-xs m-t-faint">{t("import.empty")}</p>
            )}
          </>
        )}

        {activeState.lastSummary && (
          <div className="m-cardgroup">
            <div className="m-group-title">{t("import.lastResultTitle")}</div>
            <PwaSetRow icon="circle-check" label={t("import.resultImported", { count: activeState.lastSummary.imported })} />
            <PwaSetRow icon="triangle-alert" label={t("import.resultSkipped", { count: activeState.lastSummary.skipped })} />
            <PwaSetRow icon="circle-x" label={t("import.resultFailed", { count: activeState.lastSummary.failed })} />
          </div>
        )}
      </PwaPage>
    );
  }

  return (
    <SettingsPage
      title={t("import.title")}
      sub={t("import.description")}
      actions={
        <ConfigButton
          variant="secondary"
          size="small"
          disabled={activeState.scanning}
          onClick={() => void scan(active)}
        >
          <i data-ico="scan-search" data-size="13" aria-hidden="true" />
          {activeState.scanning ? t("i18n.loading") : t("import.scan")}
        </ConfigButton>
      }
      toolbar={
        <>
          {/* 四类资产页签：`.d-seg` + 每类计数（扫过的才显示数字）。 */}
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
          {/* 画板 62 帧 B 的工具栏搜索（240px 定宽原语）。 */}
          <PwSearch
            value={query}
            placeholder={t("import.searchPlaceholder")}
            ariaLabel={t("import.searchPlaceholder")}
            onChange={setQuery}
          />
          {activeState.candidates !== null && activeGroupBys.length > 1 && (
            <PwRadio
              value={activeState.groupBy}
              ariaLabel={t("import.groupBy")}
              options={activeGroupBys.map((by) => ({
                value: by,
                label: by === "source" ? t("import.groupBySource") : t("import.groupByProject"),
              }))}
              onChange={(by) => setKind(active, { groupBy: by })}
            />
          )}
          <span className="d-grow" aria-hidden="true" />
          {/* 「本次选择」摘要收进工具栏右端（画板 62 落位表）。 */}
          <ConfigBadge tone="count">
            {t("import.selectedOf", { selected: activeState.selected.size, total: activeState.candidates?.length ?? 0 })}
          </ConfigBadge>
          <ConfigButton
            variant="secondary"
            size="small"
            /* fork:disabled-reasons —— 两枚按钮在没勾选时恒灰，原来没有任何
               title：用户只能推断「是不是坏了」。写禁用原因，不是功能名。 */
            title={activeState.selected.size === 0 ? localCopy(NOTHING_SELECTED, locale) : undefined}
            disabled={activeState.selected.size === 0}
            onClick={() => setKind(active, { selected: new Set() })}
          >
            {t("import.clearSelection")}
          </ConfigButton>
          <ConfigButton
            variant="primary"
            size="small"
            title={activeState.selected.size === 0 ? localCopy(NOTHING_SELECTED, locale) : undefined}
            disabled={activeState.selected.size === 0 || activeState.applying}
            onClick={() => void apply(active)}
          >
            {activeState.applying ? t("i18n.loading") : t("import.applySelected")}
          </ConfigButton>
        </>
      }
      fill
    >
      {activeState.error && (
        <div role="alert" className="d-banner err">
          <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
          <span className="d-grow">{activeState.error}</span>
        </div>
      )}

      {/* All four stay mounted: switching tabs must not throw away a scan result. */}
      <ConfigSplitView>
        <ConfigSidebar>
          {IMPORT_KINDS.map((kind) => (
            <div key={kind} hidden={kind !== active}>{renderList(kind)}</div>
          ))}
        </ConfigSidebar>
        {/* 画板 46 导入帧的右列：一列独立的详情卡（`ConfigDetailStack`）。 */}
        <ConfigDetailStack>
          {IMPORT_KINDS.map((kind) => (
            <div key={kind} hidden={kind !== active}>{renderDetail(kind)}</div>
          ))}
        </ConfigDetailStack>
      </ConfigSplitView>
    </SettingsPage>
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
