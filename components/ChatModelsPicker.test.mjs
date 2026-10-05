// fork:models-picker —— 跨供应商「聊天里显示哪些模型」选择器的行为约定。
// 交互本身靠 source 钉（与本仓其它 settings 测试同一手法）：真正的不变量是
// 「已在聊天里的行锁住」与「replace 只在还没收窄时发生」。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const picker = await readFile(new URL("./ChatModelsPicker.tsx", import.meta.url), "utf8");
const modelsConfig = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
const controller = await readFile(new URL("./EnabledModelsSection.tsx", import.meta.url), "utf8");

test("the filter matches model ids and display names", () => {
  assert.match(picker, /model\.id\.toLocaleLowerCase\(\)\.includes\(needle\)/);
  assert.match(picker, /model\.name\.toLocaleLowerCase\(\)\.includes\(needle\)/);
});

test("models already in chat stay listed, checked and locked", () => {
  // 锁住而不是隐藏：供应商的完整模型集要看得见，少一个模型才不会被误读成故障。
  assert.match(picker, /const listed = listedRefs\.has\(model\.ref\)/);
  assert.match(picker, /checked=\{listed \|\| selected\.has\(model\.ref\)\}/);
  assert.match(picker, /disabled=\{listed\}/);
  assert.match(picker, /\{listed && <span className="d-t-xs d-t-faint">\{t\("models\.alreadyInChat"\)\}<\/span>\}/);
  // 全选只作用于还能加的那些。
  assert.match(picker, /const pickable = provider\.models\.filter\(\(model\) => !listedRefs\.has\(model\.ref\)\)/);
});

test("applying nothing is withheld, and the count follows the selection", () => {
  assert.match(picker, /disabled=\{selected\.size === 0 \|\| saving\}/);
  assert.match(picker, /t\("models\.pickSelected", \{ count: selected\.size \}\)/);
  assert.match(picker, /t\("models\.pickApply", \{ count: selected\.size \}\)/);
});

test("the dialog is a nested layer: Escape closes only itself", () => {
  assert.match(picker, /useDialogA11y\(\{ open: true, onClose, initialFocusRef: inputRef \}\)/);
  assert.match(picker, /if \(e\.key !== "Escape"\) return;[\s\S]{0,120}e\.stopPropagation\(\);/);
  // 窄屏 sheet 靠这两个类（app/pwa-models-skills.css 的选择器），不能改名。
  assert.match(picker, /className="fork-pwa-ms-sheet"/);
  assert.match(picker, /className="pw-modal"/);
});

test("the page opens it in replace mode only while nothing is narrowed yet", () => {
  // 全开时「追加」是空操作，那一次必须走 replace（写名单本身）。
  assert.match(modelsConfig, /mode=\{enabledModels\.view\.allEnabled \? "replace" : "add"\}/);
  assert.match(modelsConfig, /listedRefs=\{enabledModels\.view\.allEnabled\s*\?\s*new Set<string>\(\)/);
  assert.match(modelsConfig, /enabledModels\.view\?\.allEnabled\) enabledModels\.replaceModels\(refs\)/);
  assert.match(modelsConfig, /else enabledModels\.setModels\("chat-picker", refs, true\)/);
  // 入口在列表级工具栏，作用域不可写时不给开。
  assert.match(modelsConfig, /disabled=\{!enabledModels\.view\?\.editable\}/);
  assert.match(modelsConfig, /t\("models\.pickChatModels"\)/);
});

test("replace is one write, not a clear followed by an enable", () => {
  assert.match(controller, /mutate\("replace", \{ op: "replace", refs \}\)/);
  assert.match(controller, /replaceModels: \(refs: string\[\]\) => void;/);
});
