import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./CronConfig.tsx", import.meta.url), "utf8");

/*
 * fork:fix-cron-model-list — `GET /api/models` returns `models` as a
 * `provider:id → display name` Record and the array a picker renders as
 * `modelList` (lib/models-cache.ts `ModelsData`). Reading the Record made
 * `.map` throw, the `.catch` swallowed the TypeError, and the picker silently
 * kept a single "default" option.
 */

test("the model picker lists the selectable models, not the lookup map", () => {
  assert.match(source, /setModels\(\(data\.modelList \?\? \[\]\)\.map\(/);
  assert.doesNotMatch(source, /data\?\.models/, "the Record has no .map()");
});

test("the default option names the model a run will actually use", () => {
  assert.match(source, /const defaultModelLabel = useMemo\(/);
  assert.match(source, /t\("cron\.modelDefault", \{ model: defaultModelLabel \}\)/);
});

test("a failed model list is reported instead of silently empty", () => {
  assert.match(source, /setModelsError\(data\.modelError \?\? null\)/);
  assert.match(source, /setModelsError\(cause instanceof Error \? cause\.message : String\(cause\)\)/);
  assert.match(source, /\{modelsError && \(/);
  assert.match(source, /t\("cron\.modelListError", \{ error: modelsError \}\)/);
});

/*
 * fork:zc-19 — the human-readable frequency editor must compile to the existing
 * 5-field cron (lib/cron-rule.ts); the raw expression remains an escape hatch.
 */
test("the frequency editor compiles readable rules to cron", () => {
  assert.match(source, /import \{ compileCronRule, parseClockTime, type CronRule \} from "@\/lib\/cron-rule"/);
  assert.match(source, /const scheduleForCreate = \(\): CronSchedule \| null => \{/);
  assert.match(source, /const result = compiledResult;/);
  assert.match(source, /kind: "cron",\s*\n\s*times: \[\],\s*\n\s*expression: result\.expression,/);
  assert.match(source, /t\("cron\.frequency"\)/);
  assert.match(source, /t\("cron\.freq\.monthly"\)/);
  assert.match(source, /t\("cron\.monthlyByWeekday"\)/);
  assert.match(source, /t\("cron\.endDate"\)/);
  assert.match(source, /t\("cron\.compiled"\)/);
});

/*
 * fork:zc-14 — the per-task history region: 8 rows per page, start/end, status,
 * output excerpt, open-session and delete-a-row.
 */
test("the run history region pages 8 rows and links to the run session", () => {
  assert.match(source, /const HISTORY_PAGE_SIZE = 8;/);
  assert.match(source, /function TaskHistory\(\{ task, onOpenSession, onDeleteRun \}/);
  assert.match(source, /runs\.slice\(\(currentPage - 1\) \* HISTORY_PAGE_SIZE, currentPage \* HISTORY_PAGE_SIZE\)/);
  assert.match(source, /t\("cron\.history\.pageOf", \{ current: currentPage, total: totalPages \}\)/);
  assert.match(source, /t\("cron\.openRun"\)/);
  assert.match(source, /t\("cron\.history\.deleteRun"\)/);
  assert.match(source, /run\.outputExcerpt \?\? ""/);
  assert.match(source, /run\.finishedAt \? new Date\(run\.finishedAt\) : null/);
  assert.match(source, /\/api\/cron\?id=\$\{encodeURIComponent\(taskId\)\}&runId=/);
});

/*
 * fork:design-system —— 画板 44 的两栏（`.pw-cols`）：左 = `.pw-list` / `.pw-litem`
 * 任务列表 + `.pw-detail` 运行历史，右 = `.pw-detail` 新建表单（`.pw-field` 行、
 * `.pw-selectbox` 下拉、`.pw-radio` 频率）。旧的 `settings-general*` /
 * `settings-chat-*` 自有类与内联盒子必须清零。
 */
test("the page is the board's two-column layout, not bespoke settings boxes", () => {
  assert.match(source, /<SettingsPage[\s\S]*?title=\{t\("cron\.title"\)\}[\s\S]*?sub=\{t\("cron\.pageSub"\)\}/);
  assert.match(source, /<ConfigSplitView>/);
  assert.match(source, /<ConfigSidebarList>/);
  assert.match(source, /<div className="pw-litem">/);
  assert.match(source, /<ConfigDetail>/);
  assert.doesNotMatch(source, /settings-general|settings-chat-|settings-field-input|settings-select/);
});

test("the run history is a pw-detail of pw-prow rows, not an inline <details>", () => {
  assert.match(source, /<div className="pw-prow" key=\{run\.id/);
  assert.match(source, /data-ico=\{RUN_STATUS_ICON\[run\.status\]/);
  assert.match(source, /`pw-badge \$\{tone\}` : "pw-badge"/);
  assert.match(source, /data-ico="chevron-left"/);
  assert.match(source, /data-ico="chevron-right"/);
  assert.doesNotMatch(source, /<details/);
  assert.doesNotMatch(source, /RUN_STATUS_COLOR/);
});

test("the page head carries the description sub and the count badge lives in the toolbar", () => {
  // fork:settings-frame（画板 62 落位表）—— sub 写「这页是干嘛的」，不写数据；
  // 任务计数进工具栏的等宽徽章。
  assert.match(source, /sub=\{t\("cron\.pageSub"\)\}/);
  assert.match(source, /toolbar=\{[\s\S]*?<ConfigBadge tone="count">\{t\("cron\.count"/);
});

test("「新建任务」is a page-level action in the page head that brings you to the form", () => {
  // 62 落位表：页级动作「新建任务」进页头右端。表单常驻右列，动作滚到并聚焦它。
  assert.match(source, /actions=\{\s*\n\s*<ConfigButton variant="primary" size="small" onClick=\{focusNewTaskForm\}>/);
  assert.match(source, /data-ico="plus"/);
  assert.match(source, /const focusNewTaskForm = \(\) => \{/);
  assert.match(source, /ref=\{newNameRef\}/);
});

test("the create form is a two-column grid of board cells without inline width literals", () => {
  // 62 落位表「16 行表单跨度 500 → 570 内两列」：短字段两两成格
  // （画板 42 编辑器网格 / 画板 44 频率三格的同一单元格），长控件通栏。
  assert.match(source, /const gridFieldStyle: CSSProperties = \{/);
  assert.match(source, /className="pw-grid2"/);
  assert.match(source, /className="pw-grid3"/);
  // 死宽度字面量清零：控件在格子里占满（宽度交给网格，不写数字）。
  assert.doesNotMatch(source, /width: (?:70|80|130|140|160)\b/);
  assert.match(source, /style=\{\{ width: "100%", minWidth: 0 \}\}/);
});

test("the create form rows are pw-field / pw-selectbox / pw-radio primitives", () => {
  assert.match(source, /<ConfigField label=\{t\("cron\.name"\)\} style=\{gridFieldStyle\}>/);
  assert.match(source, /className="pw-input pw-mono"/);
  assert.match(source, /className="pw-textarea"/);
  assert.match(source, /options=\{modelOptions\}/);
  assert.match(source, /<PwRadio\s*\n\s*value=\{mode\}/);
  assert.match(source, /aria-pressed=\{active\}/);
  assert.match(source, /<ConfigSwitch label=\{t\("cron\.enabled"\)\} checked=\{taskEnabled\}/);
});

test("empty, loading and error states use the board's empty / alert primitives", () => {
  // fork:settings-frame（画板 62 帧 D）—— 列表空态带 32px 记号图标，居中。
  assert.match(source, /<ConfigEmptyState>\s*\n\s*<span className="mark"><i data-ico="clock" data-size="16" aria-hidden="true" \/><\/span>\s*\n\s*<p>\{t\("cron\.empty"\)\}<\/p>/);
  assert.match(source, /<div className="pw-alert" role="alert">/);
  assert.match(source, /data-ico="triangle-alert"/);
});
