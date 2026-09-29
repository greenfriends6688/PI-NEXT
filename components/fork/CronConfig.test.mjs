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
  assert.match(source, /<PwPageHead title=\{t\("cron\.title"\)\} \/>/);
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

test("the create form rows are pw-field / pw-selectbox / pw-radio primitives", () => {
  assert.match(source, /<ConfigField label=\{t\("cron\.name"\)\}>/);
  assert.match(source, /className="pw-input pw-mono"/);
  assert.match(source, /className="pw-textarea"/);
  assert.match(source, /options=\{modelOptions\}/);
  assert.match(source, /<PwRadio\s*\n\s*value=\{mode\}/);
  assert.match(source, /aria-pressed=\{active\}/);
  assert.match(source, /<ConfigSwitch label=\{t\("cron\.enabled"\)\} checked=\{taskEnabled\}/);
});

test("empty, loading and error states use the board's empty / alert primitives", () => {
  assert.match(source, /<ConfigEmptyState>\s*\n\s*<p>\{t\("cron\.empty"\)\}<\/p>/);
  assert.match(source, /<div className="pw-alert" role="alert">/);
  assert.match(source, /data-ico="triangle-alert"/);
});
