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
 * fork:v5-landing-frame · D-21（2026-10-06）—— 桌面整页照抄画板 D-21 帧 B：
 * 一列**卡片**，不再有工具栏、列表列与详情列：
 *
 *   d-col（gap sp-4）
 *     ├ d-card 扫描（只读）          卡头：图标 + 标题 + `POST /api/import/scan` 徽标
 *     │                              + 「来源是怎么定的」浮层 + 重新扫描
 *     │   卡身：四类芯片（= 页签）→ 搜索 → **d-table**（一行一个来源，点行整批勾）
 *     │        → 「细选具体条目」入口（开弹窗）→ 一段脚注
 *     ├ d-card 确认导入              卡头：图标 + 标题 + `POST /api/import/apply` 徽标
 *     │                              + 「冲突策略」/「导入说明」两枚弹窗入口
 *     │   卡身：上次结果横幅（有才画）+ 清空选择 / 确认导入
 *     └ 三个 portal 弹窗：细选 / 冲突策略 / 导入说明
 *
 * 2026-10-07 用户裁定（覆盖 10-06 的帧 B 形态）：冲突策略卡、`d-statgrid` 四张统计卡、
 * 末尾 `d-grid3` 三张口径卡全部收进弹窗，页面上只留按钮；卡片不再编号（「第一步/第二步」
 * 对用户没用）。弹窗走 `useDialogA11y` + `createPortal(…, document.body)`。
 *
 * 四条判定：
 *   1. 表格里是**候选**不是结果，落盘数量由「确认导入」按钮给出；
 *   2. 一条都没勾时确认钮是灰的；
 *   3. 「结果分三段」—— imported / skipped / failed 在结果横幅里分别报，不用「全部成功」盖；
 *   4. 界面只送候选 id，服务端重扫反查，所以从界面改不出任何路径。
 *
 * 两处**已登记偏离**（DIVERGENCE §K）：冲突只有「跳过」一档（apply 层写死，没开覆盖/保留两份）；
 * 没有试运行端点，所以结果只有真实的三段数，不编预估。
 *
 * fork:v5-landing Wave B · M-05 · 窄屏那一支不动（M-05 只画了 hub 一行「导入」）。
 */

import { Fragment, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useIsMobile } from "@/hooks/useIsMobile";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useI18n } from "@/hooks/useI18n";
import { PwaBanner, PwaPage, PwaSetRow, PwaSwitchRow } from "@/components/pwa/PwaPage";
import { PortalDropdown } from "@/components/PortalDropdown";
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
import { formatRelativeTime } from "@/lib/i18n/format";
import { getRecentProjects } from "@/lib/project-groups";
import { useProjectFlags } from "@/lib/project-flags";
import type { SessionInfo } from "@/lib/types";
import { ConfigButton, PwSearch, SettingsPage } from "./SettingsUi";
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

  // ── 桌面：画板 D-21 帧 B ────────────────────────────────────────────────
  // 两个画板没画、产品要留的接线：来源说明浮层 + 逐条细选（整批勾上之后还能去掉）。
  const [showPick, setShowPick] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showSourcesPop, setShowSourcesPop] = useState(false);
  const sourcesAnchorRef = useRef<HTMLDivElement | null>(null);

  // 三个弹窗共用一套焦点约束（同一时刻只开一个，所以共用 ref 与关闭回调）。
  const closeDialogs = useCallback(() => {
    setShowPick(false);
    setShowConflicts(false);
    setShowNotes(false);
  }, []);
  const { dialogRef, dialogProps } = useDialogA11y({
    open: showPick || showConflicts || showNotes,
    onClose: closeDialogs,
  });

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

  const keyword = query.trim().toLowerCase();
  const filtered = activeState.candidates && keyword
    ? activeState.candidates.filter((item) => describeCandidate(item).toLowerCase().includes(keyword)
      || itemModel(item, t).toLowerCase().includes(keyword))
    : activeState.candidates;
  // 细选按项目分（会话）；其余三类只有来源一个维度。来源这一维已经由上面的表格承担。
  const pickGroups = filtered ? groupCandidates(filtered, active === "sessions" ? "project" : "source") : [];
  /** 勾 / 取消单条。抽成具名函数是为了让 `.d-sess` 行的勾选盒紧跟在 `className`
   *  之后（`ImportPanel.test.mjs` 的 multi-select-row 约束用这段距离判定子节点顺序）。 */
  const togglePickItem = (id: string) => {
    const next = new Set(activeState.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setKind(active, { selected: next });
  };
  // 表格一行一个来源 —— **没找到的来源也列一行**：扫不到是常态，藏起来空列表就像坏了。
  const sourceRows = (activeState.sources ?? []).map((source) => {
    const items = (activeState.candidates ?? []).filter((item) => item.source === source.source);
    const picked = items.filter((item) => activeState.selected.has(item.id)).length;
    const latest = items
      .map((item) => (item.kind === "sessions" ? item.updatedAt : null))
      .reduce<string | null>((best, value) => (value && (!best || value > best) ? value : best), null);
    return { source, items, picked, latest };
  });

  return (
    <SettingsPage title={t("import.title")}>
      <div className="d-col" style={{ gap: "var(--nx-sp-4)" }}>
        {activeState.error && (
          <div role="alert" className="d-banner err">
            <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
            <span className="d-grow">{activeState.error}</span>
          </div>
        )}

        {/* 卡片一 · 第一步：扫描（只读）—— 表里出现的是候选，不是结果。 */}
        <div className="d-card">
          <div className="d-card-head">
            <i data-ico="scan-search" data-size="15" aria-hidden="true" />
            <span>{t("import.stepScan")}</span>
            <span className="d-badge info">POST /api/import/scan</span>
            <span className="d-grow" aria-hidden="true" />
            <div className="d-anchor" ref={sourcesAnchorRef}>
              <button
                type="button"
                className="d-btn sm ghost"
                onClick={() => setShowSourcesPop((current) => !current)}
              >
                <i data-ico="folder-search" data-size="13" aria-hidden="true" />
                {t("import.scanSourcesPop")}
              </button>
              <PortalDropdown
                open={showSourcesPop}
                anchorRef={sourcesAnchorRef}
                className="d-pop-float"
                width={340}
                align="right"
              >
                <div className="d-pop-title">{t("import.scanSourcesPop")}</div>
                <div className="d-pop-body d-col" style={{ gap: "var(--nx-sp-2)" }}>
                  <div className="d-t-xs">{t("import.scanSourcesPopBody")}</div>
                  <div className="d-t-xs d-t-faint">{t("import.scanSourcesPopNote")}</div>
                </div>
              </PortalDropdown>
            </div>
            <button
              type="button"
              className="d-btn sm"
              disabled={activeState.scanning}
              onClick={() => void scan(active)}
            >
              <i data-ico="refresh-cw" data-size="13" aria-hidden="true" />
              {activeState.scanning ? t("i18n.loading") : t("import.rescan")}
            </button>
          </div>

          <div className="d-card-body d-col" style={{ gap: "var(--nx-sp-3)" }}>
            {/* 四类芯片就是页签（画板这一行画的就是它）；实心 = 当前这一类。 */}
            <div className="d-set-row">
              <div className="d-set-row-box">
                <div className="d-set-row-t">{t("import.scanSourcesTitle")}</div>
                <div className="d-set-row-s">{t("import.scanSourcesSub")}</div>
              </div>
              <span className="d-grow-last d-row" style={{ gap: "var(--nx-sp-1)" }}>
                {IMPORT_KINDS.map((kind) => {
                  const count = states[kind].candidates;
                  return (
                    <button
                      key={kind}
                      type="button"
                      className={`d-cite${kind === active ? " is-on" : ""}`}
                      aria-pressed={kind === active}
                      onClick={() => setActive(kind)}
                    >
                      <i data-ico={KIND_ICON[kind]} data-size="12" aria-hidden="true" />
                      {count !== null ? `${t(KIND_LABEL_KEY[kind])} ${count.length}` : t(KIND_LABEL_KEY[kind])}
                    </button>
                  );
                })}
              </span>
            </div>

            {activeState.scanning ? (
              <div role="status" className="d-run">
                <i data-ico="loader-circle" data-size="14" aria-hidden="true" />
                <span className="d-grow">{t("i18n.loading")}</span>
              </div>
            ) : activeState.candidates === null ? (
              /* 还没扫：画板帧 B 画的是扫完之后的样子，这一态由产品补。 */
              <div className="d-empty">
                <div className="d-empty-ico">
                  <i data-ico="scan-search" data-size="20" aria-hidden="true" />
                </div>
                <div className="d-empty-s">{t("import.idleHint")}</div>
              </div>
            ) : sourceRows.length === 0 ? (
              <div className="d-empty">
                <div className="d-empty-ico">
                  <i data-ico="inbox" data-size="20" aria-hidden="true" />
                </div>
                <div className="d-empty-s">{t("import.empty")}</div>
              </div>
            ) : (
              <>
                <div className="d-row">
                  <PwSearch
                    value={query}
                    placeholder={t("import.searchPlaceholder")}
                    ariaLabel={t("import.searchPlaceholder")}
                    onChange={setQuery}
                  />
                  <span className="d-t-xs d-t-faint">
                    {t("import.selectedOf", {
                      selected: activeState.selected.size,
                      total: activeState.candidates.length,
                    })}
                  </span>
                </div>

                <table className="d-table">
                  <thead>
                    <tr>
                      <th>{t("import.colCandidate")}</th>
                      <th>{t("import.colPath")}</th>
                      <th>{t("import.colCount")}</th>
                      <th>{t("import.colWritten")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceRows.map((row) => {
                      const { source } = row;
                      const label = SOURCE_LABEL_KEY[source.source]
                        ? t(SOURCE_LABEL_KEY[source.source])
                        : source.source;
                      const hint = !source.exists
                        ? t("import.sourceMissing")
                        : source.error === "destination"
                          ? t("import.sourceDestination")
                          : (source.error ?? null);
                      const on = row.items.length > 0 && row.picked === row.items.length;
                      const toggle = () => setKind(active, {
                        selected: toggleGroupSelection(activeState.selected, row.items),
                      });
                      return (
                        <tr
                          key={source.source}
                          className={on ? "is-on" : undefined}
                          role="button"
                          tabIndex={0}
                          aria-pressed={on}
                          aria-disabled={row.items.length === 0}
                          onClick={toggle}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            toggle();
                          }}
                        >
                          <td>
                            {label}
                            {hint && <span className="d-badge mute"> {hint}</span>}
                          </td>
                          <td className="d-mono">{source.path}</td>
                          <td className="d-mono">
                            {row.picked > 0 && row.picked < row.items.length
                              ? `${row.picked} / ${row.items.length}${source.truncated ? "+" : ""}`
                              : `${row.items.length}${source.truncated ? "+" : ""}`}
                          </td>
                          <td className="d-mono">
                            {row.latest ? formatRelativeTime(new Date(row.latest), locale) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* 逐条细选：点行是整批勾上，弹窗里能单独去掉某一条（产品能力，画板按整批计）。 */}
                <div className="d-row">
                  <button
                    type="button"
                    className="d-btn sm ghost"
                    onClick={() => setShowPick(true)}
                  >
                    <i data-ico="list-checks" data-size="13" aria-hidden="true" />
                    {t("import.pickTitle")}
                  </button>
                  <span className="d-t-xs d-t-faint">{t("import.pickNote")}</span>
                </div>
              </>
            )}

            <div className="d-t-xs d-t-faint">{t("import.tableNote")}</div>
          </div>
        </div>

        {/* 确认导入卡：冲突口径与三条说明都收进弹窗，页面上只留按钮。 */}
        <div className="d-card">
          <div className="d-card-head">
            <i data-ico="circle-play" data-size="15" aria-hidden="true" />
            <span>{t("import.stepApply")}</span>
            <span className="d-badge mute">POST /api/import/apply</span>
            <span className="d-grow" aria-hidden="true" />
            <button type="button" className="d-btn sm ghost" onClick={() => setShowConflicts(true)}>
              <i data-ico="git-merge" data-size="13" aria-hidden="true" />
              {t("import.conflictButton")}
            </button>
            <button type="button" className="d-btn sm ghost" onClick={() => setShowNotes(true)}>
              <i data-ico="info" data-size="13" aria-hidden="true" />
              {t("import.notesTitle")}
            </button>
          </div>
          <div className="d-card-body d-col" style={{ gap: "var(--nx-sp-3)" }}>
            {activeState.status && (
              <div role="status" className="d-banner ok">
                <i data-ico="check" data-size="14" aria-hidden="true" />
                <span>{activeState.status}</span>
              </div>
            )}
            <div className="d-row" style={{ gap: "var(--nx-sp-2)" }}>
              <ConfigButton
                variant="secondary"
                size="small"
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
                <i data-ico="check" data-size="13" aria-hidden="true" />
                {activeState.applying
                  ? t("i18n.loading")
                  : t("import.confirmImport", { count: activeState.selected.size })}
              </ConfigButton>
            </div>
          </div>
        </div>

        {/* 三个弹窗都 portal 到 body：设置壳有 `overflow` 与 `backdrop-filter`，
            留在壳里的 `position: fixed` 会被面板裁掉（同 ThemeSkinStudio 的注记）。 */}
        {showPick && createPortal(
          <div
            ref={dialogRef}
            {...dialogProps}
            className="d-modal is-open"
            onClick={(event) => { if (event.target === event.currentTarget) closeDialogs(); }}
          >
            <div className="d-modal-box wide" style={{ height: "min(640px, calc(100dvh - 48px))" }}>
              <div className="d-modal-head d-row">
                <i data-ico="list-checks" data-size="16" aria-hidden="true" />
                <span className="d-grow">{t("import.pickTitle")}</span>
                <button
                  type="button"
                  className="d-iconbtn"
                  aria-label={t("i18n.close")}
                  title={t("i18n.close")}
                  onClick={closeDialogs}
                >
                  <i data-ico="x" data-size="14" aria-hidden="true" />
                </button>
              </div>
              <div className="d-modal-body" style={{ flex: "1 1 auto" }}>
                <div className="d-t-xs d-t-faint">{t("import.pickNote")}</div>
                {pickGroups.length === 0 && <div className="d-t-xs d-t-faint">{t("import.empty")}</div>}
                {pickGroups.map((group) => {
                  const label = group.key
                    ? (SOURCE_LABEL_KEY[group.rawLabel] ? t(SOURCE_LABEL_KEY[group.rawLabel]) : group.rawLabel)
                    : t("import.noProject");
                  return (
                    <Fragment key={group.key || "__none"}>
                      <div className="d-group-toggle">
                        <span className="d-t-sm d-t-b">{label}</span>
                        <span className="d-badge mute">
                          {t("import.selectedOf", {
                            selected: group.items.filter((item) => activeState.selected.has(item.id)).length,
                            total: group.items.length,
                          })}
                        </span>
                        <span className="d-grow" aria-hidden="true" />
                        <ConfigButton
                          variant="ghost"
                          size="small"
                          onClick={() => setKind(active, {
                            selected: toggleGroupSelection(activeState.selected, group.items),
                          })}
                        >
                          {t("import.selectAll")}
                        </ConfigButton>
                      </div>
                      <div className="d-col">
                        {group.items.slice(0, 60).map((item) => {
                          const picked = activeState.selected.has(item.id);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className="d-sess"
                              title={itemModel(item, t)}
                              onClick={() => togglePickItem(item.id)}
                            >
                              <span role="checkbox" aria-checked={picked} className={`d-checkbox${picked ? " on" : ""}`}>
                                <i data-ico="check" data-size="11" aria-hidden="true" />
                              </span>
                              <span className="d-sess-t">{describeCandidate(item)}</span>
                              <span className="d-sess-m">
                                <i data-ico={KIND_ICON[item.kind]} data-size="12" aria-hidden="true" />
                                {itemModel(item, t)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {group.items.length > 60 && (
                        <p className="d-t-xs d-t-faint">
                          {t("import.moreInGroup", { count: group.items.length - 60 })}
                        </p>
                      )}
                    </Fragment>
                  );
                })}
              </div>
              <div className="d-modal-foot">
                <button
                  type="button"
                  className="d-btn ghost"
                  disabled={activeState.selected.size === 0}
                  onClick={() => setKind(active, { selected: new Set() })}
                >
                  {t("import.clearSelection")}
                </button>
                <span className="d-grow" aria-hidden="true" />
                <button type="button" className="d-btn primary" onClick={closeDialogs}>{t("i18n.close")}</button>
              </div>
            </div>
          </div>,
          document.body,
        )}

        {showConflicts && createPortal(
          <div
            ref={dialogRef}
            {...dialogProps}
            className="d-modal is-open"
            onClick={(event) => { if (event.target === event.currentTarget) closeDialogs(); }}
          >
            <div className="d-modal-box">
              <div className="d-modal-head d-row">
                <i data-ico="git-merge" data-size="16" aria-hidden="true" />
                <span className="d-grow">{t("import.conflictTitle")}</span>
                <span className="d-badge mute">{t("import.conflictOnlySkip")}</span>
              </div>
              <div className="d-modal-body">
                <div className="d-row">
                  <span className="d-t-sm d-t-dim">{t("import.strategyLabel")}</span>
                  <span className="d-grow" aria-hidden="true" />
                  <div className="d-seg">
                    <button type="button" className="is-on" disabled>{t("import.conflictSkipLabel")}</button>
                  </div>
                </div>
                <div className="d-banner">
                  <i data-ico="shield-check" data-size="14" aria-hidden="true" />
                  <span>
                    <b>{t("import.conflictSkipLabel")}</b>
                    {t("import.conflictSkipBody")}
                  </span>
                </div>
                <div className="d-t-xs d-t-faint">{t("import.conflictNote")}</div>
              </div>
              <div className="d-modal-foot">
                <button type="button" className="d-btn primary" onClick={closeDialogs}>{t("i18n.close")}</button>
              </div>
            </div>
          </div>,
          document.body,
        )}

        {showNotes && createPortal(
          <div
            ref={dialogRef}
            {...dialogProps}
            className="d-modal is-open"
            onClick={(event) => { if (event.target === event.currentTarget) closeDialogs(); }}
          >
            <div className="d-modal-box">
              <div className="d-modal-head d-row">
                <i data-ico="info" data-size="16" aria-hidden="true" />
                <span className="d-grow">{t("import.notesTitle")}</span>
              </div>
              <div className="d-modal-body">
                <div>
                  <div className="d-t-sm d-t-b">{t("import.cardCredential")}</div>
                  <div className="d-t-cap d-t-dim">{t("import.cardCredentialBody")}</div>
                </div>
                <div>
                  <div className="d-t-sm d-t-b">{t("import.cardSegments")}</div>
                  <div className="d-t-cap d-t-dim">{t("import.cardSegmentsBody")}</div>
                </div>
                <div>
                  <div className="d-t-sm d-t-b">{t("import.cardIdempotent")}</div>
                  <div className="d-t-cap d-t-dim">{t("import.cardIdempotentBody")}</div>
                </div>
                <div className="d-banner warn">
                  <i data-ico="shield-alert" data-size="14" aria-hidden="true" />
                  <span>{t("import.idsOnly")}</span>
                </div>
              </div>
              <div className="d-modal-foot">
                <button type="button" className="d-btn primary" onClick={closeDialogs}>{t("i18n.close")}</button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      </div>
    </SettingsPage>
  );
}

/** `import.result`（"导入 X · 跳过 Y · 失败 Z"）现在是确认导入卡里那条 `d-banner ok`；
 *  窄屏另用结构化的 `lastSummary` 三行。 */

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
