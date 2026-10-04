// fork:proma-33-shortcut-guide —— 快捷键地图的纯函数投影：平台键帽 + 生效值。
//
// 地图的唯一职责是「如实显示此刻生效的键」，所以这三件事必须被钉死：
//   ① 平台渲染（mac `⌘⇧L` 无分隔符 / 其它平台 `Ctrl+Shift+L` 用 `+`）；
//   ② 用户改过的绑定**盖过**默认值，且多个绑定全部列出；
//   ③ `managed: false` 的行如实带出 `managed:false`，让 UI 有依据标注状态。
import assert from "node:assert/strict";
import test from "node:test";

const {
  SHORTCUT_COMMANDS,
  buildShortcutGuide,
  formatShortcutBindingCapGroups,
  formatShortcutBindingsLabel,
  parseShortcutOverrides,
} = await import("./shortcuts.ts");

const MAC = { platform: "MacIntel" };
const WIN = { platform: "Win32" };

function rowFor(groups, id) {
  for (const group of groups) {
    const row = group.rows.find((entry) => entry.id === id);
    if (row) return row;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 平台键帽
// ---------------------------------------------------------------------------

test("CmdOrCtrl renders as ⌘ on Apple and Ctrl elsewhere", () => {
  assert.deepEqual(formatShortcutBindingCapGroups(["CmdOrCtrl+b"], MAC), [["⌘", "B"]]);
  assert.deepEqual(formatShortcutBindingCapGroups(["CmdOrCtrl+b"], WIN), [["Ctrl", "B"]]);
});

test("Shift and Alt pick their glyphs, in the platform's own order", () => {
  // Apple: ⌃⌥⇧⌘（修饰键在左，⌘ 收尾）
  assert.equal(formatShortcutBindingsLabel(["CmdOrCtrl+Shift+l"], MAC), "⇧⌘L");
  assert.equal(formatShortcutBindingsLabel(["CmdOrCtrl+Alt+n"], MAC), "⌥⌘N");
  assert.equal(formatShortcutBindingsLabel(["Ctrl+Alt+n"], MAC), "⌃⌥N");
  // 其它平台：Ctrl+Alt+Shift+键，修饰键之间用 `+`
  assert.equal(formatShortcutBindingsLabel(["CmdOrCtrl+Shift+l"], WIN), "Ctrl+Shift+L");
  assert.equal(formatShortcutBindingsLabel(["CmdOrCtrl+Alt+b"], WIN), "Ctrl+Alt+B");
  assert.equal(formatShortcutBindingsLabel(["Ctrl+Alt+n"], WIN), "Ctrl+Alt+N");
});

test("all four modifiers together still read correctly on both platforms", () => {
  assert.equal(formatShortcutBindingsLabel(["Ctrl+Alt+Shift+CmdOrCtrl+k"], MAC), "⌃⌥⇧⌘K");
  assert.equal(formatShortcutBindingsLabel(["Ctrl+Alt+Shift+CmdOrCtrl+k"], WIN), "Ctrl+Alt+Shift+K");
});

test("a bare named key is one cap, not a chord", () => {
  assert.deepEqual(formatShortcutBindingCapGroups(["Escape"], MAC), [["Esc"]]);
  assert.deepEqual(formatShortcutBindingCapGroups(["Escape"], WIN), [["Esc"]]);
  assert.equal(formatShortcutBindingsLabel(["ArrowUp"], WIN), "↑");
});

test("multiple bindings are all listed, in order, separated by /", () => {
  const bindings = ["CmdOrCtrl+b", "CmdOrCtrl+Shift+b", "Escape"];
  assert.deepEqual(formatShortcutBindingCapGroups(bindings, MAC), [
    ["⌘", "B"],
    ["⇧", "⌘", "B"],
    ["Esc"],
  ]);
  assert.equal(formatShortcutBindingsLabel(bindings, MAC), "⌘B / ⇧⌘B / Esc");
  assert.equal(formatShortcutBindingsLabel(bindings, WIN), "Ctrl+B / Ctrl+Shift+B / Esc");
  // 空绑定列表 = 空串（调用方自己决定「未设置」怎么写），不产生一条空的别名。
  assert.equal(formatShortcutBindingsLabel([], WIN), "");
});

// ---------------------------------------------------------------------------
// 生效值 vs 默认值
// ---------------------------------------------------------------------------

test("the guide shows the default chord when the user changed nothing", () => {
  const sidebar = rowFor(buildShortcutGuide(null, MAC), "toggleSidebar");
  assert.deepEqual(sidebar?.bindings, ["CmdOrCtrl+b"]);
  assert.equal(sidebar?.displayText, "⌘B");
  assert.equal(sidebar?.customized, false);
});

test("a user override replaces the default chord, and says it was customized", () => {
  const guide = buildShortcutGuide({ toggleSidebar: ["CmdOrCtrl+Shift+j"] }, MAC);
  const sidebar = rowFor(guide, "toggleSidebar");
  assert.deepEqual(sidebar?.bindings, ["CmdOrCtrl+Shift+j"]);
  assert.equal(sidebar?.displayText, "⇧⌘J");
  assert.equal(sidebar?.customized, true);
  // 默认值不再出现 —— 地图不同时列两个（那会让人以为两个都生效）。
  assert.equal(sidebar?.displayText.includes("⌘B"), false);
});

test("every binding of a customized command is listed, not just the first", () => {
  const sidebar = rowFor(
    buildShortcutGuide({ toggleSidebar: ["CmdOrCtrl+Shift+j", "F7"] }, MAC),
    "toggleSidebar",
  );
  assert.deepEqual(sidebar?.capGroups, [["⇧", "⌘", "J"], ["F7"]]);
  assert.equal(sidebar?.displayText, "⇧⌘J / F7");
});

test("an explicit empty override means unassigned and is not 'customized to the default'", () => {
  const theme = rowFor(buildShortcutGuide({ toggleTheme: [] }, WIN), "toggleTheme");
  assert.deepEqual(theme?.bindings, []);
  assert.equal(theme?.displayText, "");
  assert.equal(theme?.customized, true);
  // 未设置也要留在地图里（用户要看得见「它没有键」），不整行消失。
  assert.ok(rowFor(buildShortcutGuide({ toggleTheme: [] }, WIN), "toggleTheme"));
});

test("a garbage override falls back to the default and is not marked customized", () => {
  const theme = rowFor(buildShortcutGuide({ toggleTheme: ["not a binding"] }, WIN), "toggleTheme");
  assert.deepEqual(theme?.bindings, ["CmdOrCtrl+Shift+l"]);
  assert.equal(theme?.displayText, "Ctrl+Shift+L");
  assert.equal(theme?.customized, false);
});

test("'customized' means the effective list differs from the shipped default list", () => {
  // 逐项相等才算没改过：非规范序（`Shift+CmdOrCtrl+l`）在运行时匹配不上，
  // 如实标成「你改过」比骗人说它还是默认值强。
  const theme = rowFor(buildShortcutGuide({ toggleTheme: ["Shift+CmdOrCtrl+l"] }, MAC), "toggleTheme");
  assert.equal(theme?.customized, true);
  const sidebar = rowFor(buildShortcutGuide({ toggleSidebar: ["CmdOrCtrl+b"] }, MAC), "toggleSidebar");
  assert.equal(sidebar?.customized, false);
  // 多个默认值全被原样写回 override = 没改过。
  const multi = rowFor(
    buildShortcutGuide({ stopAgent: ["Escape"], newSession: ["Ctrl+Alt+n"] }, MAC),
    "stopAgent",
  );
  assert.equal(multi?.customized, false);
});

// ---------------------------------------------------------------------------
// 分组与状态
// ---------------------------------------------------------------------------

test("rows are grouped by the table's own group keys, in canonical order", () => {
  const guide = buildShortcutGuide(null, MAC);
  assert.deepEqual(guide.map((group) => group.group), ["essential", "layout", "appearance", "notMigrated"]);
  assert.deepEqual(guide.map((group) => group.labelKey), [
    "settings.shortcuts.groupEssential",
    "settings.shortcuts.groupLayout",
    "settings.shortcuts.groupAppearance",
    "settings.shortcuts.groupNotMigrated",
  ]);
  assert.deepEqual(guide.find((group) => group.group === "essential")?.rows.map((row) => row.id), [
    "stopAgent",
    "newSession",
    // fork:command-palette —— 命令面板也走内核分发（`effective.commandPalette`），
    // 所以它在 essential 组里，且下面那条「其余都是 managed:true」会把 `managed` 断言它。
    "commandPalette",
  ]);
  assert.equal(guide.find((group) => group.group === "appearance")?.rows[0]?.displayText, "⇧⌘L");
});

test("the read-only row is carried through with managed:false, not silently dropped", () => {
  // ⌘F 由会话内查找自己注册、不经内核分发。地图上它必须留着并标状态，
  // 否则用户按了没反应却以为地图骗了他。
  const find = rowFor(buildShortcutGuide(null, MAC), "findInConversation");
  assert.equal(find?.managed, false);
  assert.equal(find?.group, "notMigrated");
  assert.equal(find?.displayText, "⌘F");
  // 其余项都是内核自己在分发的（含 fork:command-palette 的 commandPalette）。
  for (const entry of SHORTCUT_COMMANDS) {
    if (entry.id === "findInConversation") continue;
    assert.equal(rowFor(buildShortcutGuide(null, MAC), entry.id)?.managed, true, entry.id);
  }
  // ⌘K 两个别名都在地图上写出来，用户才知道另一个也管用。
  assert.match(
    rowFor(buildShortcutGuide(null, MAC), "commandPalette")?.displayText ?? "",
    /K/,
  );
});

test("an override on a read-only row still shows, but stays flagged as not wired", () => {
  const find = rowFor(
    buildShortcutGuide({ findInConversation: ["CmdOrCtrl+Shift+f"] }, MAC),
    "findInConversation",
  );
  assert.equal(find?.managed, false);
  assert.equal(find?.displayText, "⇧⌘F");
});

test("the guide is data, not a component: storage junk resolves to the defaults", () => {
  // `buildShortcutGuide` takes the **validated** overrides shape (what
  // `hooks/useShortcutBindings` hands out). The storage-shaped value goes
  // through `parseShortcutOverrides` first, and that round trip must land on
  // the defaults rather than on a half-parsed table.
  for (const junk of [undefined, null, {}]) {
    const guide = buildShortcutGuide(junk, WIN);
    assert.equal(guide.length, 4);
    assert.equal(guide.reduce((sum, group) => sum + group.rows.length, 0), SHORTCUT_COMMANDS.length);
  }
  for (const junk of ["garbage", { toggleSidebar: "nope" }, { nope: ["CmdOrCtrl+x"] }, []]) {
    const guide = buildShortcutGuide(parseShortcutOverrides(junk), WIN);
    assert.equal(rowFor(guide, "toggleSidebar")?.displayText, "Ctrl+B");
    assert.equal(rowFor(guide, "toggleSidebar")?.customized, false);
  }
});
