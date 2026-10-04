import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  COMMAND_PALETTE_HISTORY_LIMIT,
  isMeaningfulPaletteQuery,
  pushCommandPaletteHistory,
  readCommandPaletteHistory,
  resolvePaletteScope,
  writeCommandPaletteHistory,
} = await jiti.import("./command-palette-history.ts");

const palette = await readFile(new URL("../components/fork/CommandPalette.tsx", import.meta.url), "utf8");
const nav = await readFile(new URL("./settings-navigation.ts", import.meta.url), "utf8");
const appShell = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
const shortcuts = await readFile(new URL("./shortcuts.ts", import.meta.url), "utf8");
const settingsPanel = await readFile(new URL("../components/SettingsPanel.tsx", import.meta.url), "utf8");
const shortcutsHook = await readFile(new URL("../hooks/useKeyboardShortcuts.ts", import.meta.url), "utf8");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    map,
  };
}

// fork:command-palette —— 域前缀：`>` 命令 / `#` 会话 / `@` 文件，无前缀全域。
test("scope prefixes resolve, and an explicit prefix wins over the manual scope", () => {
  assert.deepEqual(resolvePaletteScope("模型"), { scope: "all", explicit: false, query: "模型" });
  assert.deepEqual(resolvePaletteScope(">模型"), { scope: "commands", explicit: true, query: "模型" });
  assert.deepEqual(resolvePaletteScope("#deploy"), { scope: "sessions", explicit: true, query: "deploy" });
  assert.deepEqual(resolvePaletteScope("@BrowserP"), { scope: "files", explicit: true, query: "BrowserP" });
  // 前缀后的空格吃掉，别让 "  deploy" 这种前导空白进查询。
  assert.equal(resolvePaletteScope("# deploy").query, "deploy");
});

// 抄 ZCode 那一处真优点：MRU + 大小写去重 + 封顶（`commandCenterSearchHistory.ts`）。
test("history is MRU, case-insensitively deduped, and capped", () => {
  const entries = [
    { query: "旧", scope: "all", updatedAt: 1 },
    { query: "模型", scope: "commands", updatedAt: 2 },
  ];
  const pushed = pushCommandPaletteHistory(entries, { query: "模型", scope: "sessions", updatedAt: 9 });
  assert.equal(pushed.length, 2, "同一条（忽略大小写）不该变成两条");
  assert.equal(pushed[0].query, "模型");
  assert.equal(pushed[0].scope, "sessions", "重复搜索要更新 scope 与时间");
  assert.equal(pushed[0].updatedAt, 9);
  assert.equal(pushed[1].query, "旧", "其余保持原序");

  const many = Array.from({ length: COMMAND_PALETTE_HISTORY_LIMIT + 5 }, (_, i) => ({
    query: `q${i}`, scope: "all", updatedAt: i,
  }));
  const capped = pushCommandPaletteHistory(many, { query: "新", scope: "all", updatedAt: 99 });
  assert.equal(capped.length, COMMAND_PALETTE_HISTORY_LIMIT);
  assert.equal(capped[0].query, "新");
});

// 光前缀是「切域」不是「搜索」，不该进历史 —— 否则最近列表全是 `>` / `#`。
test("bare scope prefixes are not remembered as searches", () => {
  for (const q of ["", "  ", ">", "#", "@", "> ", "#@"]) {
    assert.equal(isMeaningfulPaletteQuery(q), false, `"${q}" 不该进历史`);
  }
  for (const q of [">a", "模型", "#deploy"]) {
    assert.equal(isMeaningfulPaletteQuery(q), true, `"${q}" 该进历史`);
  }
  const entries = [{ query: "x", scope: "all", updatedAt: 1 }];
  assert.equal(pushCommandPaletteHistory(entries, { query: ">", scope: "commands", updatedAt: 2 }).length, 1);
});

// 坏 localStorage（配额满 / 隐私模式 / 手改坏）不该让面板打不开。
test("unreadable history degrades to empty instead of throwing", () => {
  assert.deepEqual(readCommandPaletteHistory(fakeStorage({ "pi-web:command-palette-history:x": "{oops" }), "x"), []);
  assert.deepEqual(readCommandPaletteHistory(fakeStorage({ "pi-web:command-palette-history:x": '{"a":1}' }), "x"), []);
  assert.deepEqual(readCommandPaletteHistory(fakeStorage({ "pi-web:command-palette-history:x": "[null,1]" }), "x"), []);
  assert.deepEqual(readCommandPaletteHistory(fakeStorage(), "x"), []);
});

test("history round-trips through storage, per bucket", () => {
  const storage = fakeStorage();
  const a = [{ query: "one", scope: "all", updatedAt: 1 }];
  const b = [{ query: "two", scope: "files", updatedAt: 2 }];
  writeCommandPaletteHistory(storage, "proj-a", a);
  writeCommandPaletteHistory(storage, "proj-b", b);
  assert.deepEqual(readCommandPaletteHistory(storage, "proj-a"), a, "不同工作区互不串");
  assert.deepEqual(readCommandPaletteHistory(storage, "proj-b"), b);
});

// 面板必须复用既有 API，而不是自己再写一套搜索后端。
test("the palette reuses existing search APIs and adds no new backend", () => {
  const code = strip(palette);
  assert.match(code, /\/api\/sessions\/search\?q=/);
  assert.match(code, /\/api\/file-index\?cwd=/);
  // 请求带 abort：用户改字就得掐掉上一轮，否则慢的那次会盖掉新结果。
  assert.match(code, /AbortController/);
  assert.match(code, /return \(\) => controller\.abort\(\)/);
  // 关闭时清输入与结果，别给下次留上次的词。
  assert.match(code, /setRaw\(""\)/);
});

test("settings sections have one source of truth shared by the panel and the palette", () => {
  // 分节清单必须住在 lib，而不是复制一份到命令面板里（复制的那份会在加分节时过期）。
  assert.match(nav, /export const SETTINGS_SECTIONS: ReadonlyArray</);
  assert.match(strip(appShell), /SETTINGS_SECTIONS\.map\(/);
  // 设置侧栏自己也读同一份。
  assert.match(strip(settingsPanel), /SETTINGS_SECTIONS\.map\(/);
  assert.doesNotMatch(strip(settingsPanel), /\{ id: "general", label: t\(/, "旧的内联清单还在");
});

test("the hotkey is registered in the shortcut system, not hard-coded on window", () => {
  assert.match(shortcuts, /"commandPalette"/);
  // 两个别名，照 ZCode 的 shortcutCommands.ts:61-65。
  assert.match(shortcuts, /defaultBindings: \["CmdOrCtrl\+k", "CmdOrCtrl\+Shift\+p"\]/);
  assert.match(strip(shortcutsHook), /matchesAnyShortcutBinding\(event, effective\.commandPalette \?\? \[\]\)/);
  assert.match(strip(appShell), /onToggleCommandPalette: \(\) => setCommandPaletteOpen\(\(open\) => !open\)/);
});