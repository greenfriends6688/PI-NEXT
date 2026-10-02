import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const source = readFileSync(new URL("./PlanningTodoDetail.tsx", import.meta.url), "utf8");
const workspaceSource = readFileSync(new URL("./PlanningWorkspace.tsx", import.meta.url), "utf8");
const autosaveSource = readFileSync(new URL("../../lib/planning-draft-autosave.ts", import.meta.url), "utf8");
const { DRAFT_SAVE_DEBOUNCE_MS, DRAFT_SAVE_STATUS_MS } = await jiti.import("../../lib/planning-draft-save.ts");

/*
 * fork:proma-44-planning —— 详情面板的**接线**守卫。
 *
 * 状态机本身在 `lib/planning-draft-save.test.mjs`（纯函数，13 例）。这里钉的是
 * 「组件有没有按那个状态机的约定接线」—— 行为对但接线错（漏了 flush、两条字段
 * 共享一个 autosave、把保存回包 setState 回输入框）单测纯函数是看不见的，而这
 * 几处恰好是 Proma v0.16.8 修的那个坑的所在。
 */

test("标题与描述各用一个独立的 autosave 实例（共享会把彼此卡住）", () => {
  const instances = [...source.matchAll(/useDraftAutosave\(\{/g)];
  assert.equal(instances.length, 2, "两条字段必须是两个独立实例");
  assert.match(source, /const title = useDraftAutosave\(\{[\s\S]*?entityId: todo\.id,\s*persisted: todo\.title,[\s\S]*?save: saveTitle/);
  assert.match(source, /const notes = useDraftAutosave\(\{[\s\S]*?entityId: todo\.id,\s*persisted: todo\.notes \?\? "",[\s\S]*?save: saveNotes/);
});

test("自动保存的回包不被 setState 回输入框", () => {
  // 输入框的 value 只来自 draft autosave 的 draft。
  assert.match(source, /value=\{title\.draft\}/);
  assert.match(source, /value=\{notes\.draft\}/);
  // hook 里：保存成功后只 apply 状态机算出的下一个状态，不碰 draft。
  assert.match(autosaveSource, /apply\(draftSaveSettled\(stateRef\.current, \{ ok: true, persisted: stored, now: Date\.now\(\) \}\)\)/);
  // 组件里不得出现「拿保存结果去 setState」这一形态。
  assert.doesNotMatch(source, /setDraft|setTitle\(|setNotes\(/);
});

test("失焦立即保存；关闭面板的 flush 走 registerFlush", () => {
  assert.match(source, /onBlur=\{title\.flush\}/);
  assert.match(source, /onBlur=\{notes\.flush\}/);
  assert.match(source, /registerFlush\(flush\)/);
  // 组件卸载兜底
  assert.match(source, /useEffect\(\(\) => \(\) => \{ flushRef\.current\(\); \}, \[\]\)/);
  // 父组件必须真的把它接到「关面板」上
  assert.match(workspaceSource, /const closeDetail = useCallback\(\(\) => \{\s*flushRef\.current\(\);\s*setSelectedId\(null\);/);
  assert.match(workspaceSource, /onClose=\{closeDetail\}/, "× 走的是同一个 closeDetail");
});

test("× / Esc / 点空白三种手势只有一条关闭路径", () => {
  // 遮罩点击
  assert.match(workspaceSource, /onMouseDown=\{\(event\) => \{[\s\S]*?if \(event\.target !== event\.currentTarget\) return;\s*if \(selectedId\) closeDetail\(\);\s*else onClose\(\);/);
  // Esc
  assert.match(workspaceSource, /if \(event\.key !== "Escape"\) return;[\s\S]*?if \(selectedId\) closeDetail\(\);\s*else onClose\(\);/);
  // 别处不许直接 setSelectedId(null)（注释里提到的那一处不算）。
  const code = workspaceSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const nulls = [...code.matchAll(/setSelectedId\(null\)/g)];
  assert.equal(nulls.length, 1, "只允许 closeDetail 一处把详情关掉");
});

test("状态提示挂在描述那一行，且两个字段任一在途都显示", () => {
  assert.match(source, /draftStatusMessageKey\(notes\.status\) \?\? draftStatusMessageKey\(title\.status\)/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /planning\.saving/);
  assert.match(source, /planning\.saved/);
});

test("状态机用的是 Proma v0.16.8 的两个常量，不是拍脑袋的数", () => {
  assert.equal(DRAFT_SAVE_DEBOUNCE_MS, 800);
  assert.equal(DRAFT_SAVE_STATUS_MS, 2000);
  // 组件里不许再写一遍这两个数（改常量会漏改）；剥掉注释再看，
  // 否则「停手 800ms」这句话本身就会让断言变红。
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\b800\b|\b2000\b/);
});

test("两条字段的保存串行且不带版本号（否则会自冲突）", () => {
  assert.match(source, /const chainRef = useRef<Promise<unknown>>\(Promise\.resolve\(\)\)/);
  // 结构性 op 带 expectedUpdatedAt
  assert.match(source, /expectedUpdatedAt: todo\.updatedAt/);
  // 草稿保存不带
  const draftSave = source.slice(source.indexOf("const saveTitle"), source.indexOf("const title = useDraftAutosave"));
  assert.doesNotMatch(draftSave, /expectedUpdatedAt/);
});

test("工作区只有一个状态源：每个 op 之后吃服务端回的那份整快照", () => {
  assert.match(workspaceSource, /const result = await runPlanningOp\(op\);\s*setState\(result\.state\);/);
  // 不许有本地的乐观更新
  assert.doesNotMatch(workspaceSource, /setState\(\(current\) => \[\.\.\.current/);
});
