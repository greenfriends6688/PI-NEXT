import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:v5-landing D-07（2026-10-04）—— 设置左导航**以画板原文为准**的一条锁。
//
// 这条不是快照式的「把当前值抄一份」：它每次运行都**重新读画板 HTML**，从
// `design/v5/web/boards/D-07-settings-general.html` 的第一处 `<nav class="d-set-nav">`
// 里抠出四段 `.d-set-navsep` 与 11 枚 `.d-set-navitem`（文案 + `data-ico`），
// 再和产品侧的三张表逐项对：
//
//   1. `SETTINGS_SECTIONS`（`lib/settings-navigation.ts`）→ 分节顺序 + labelKey；
//   2. `SECTION_ICON_BY_ID`（`components/SettingsPanel.tsx`）→ 导航图标的 lucide 名；
//   3. `SETTINGS_HUB_GROUPS` + `settingsHubGroupLabel`（`components/pwa/settingsHub.ts`）
//      → 四段分组归属与段名。
//
// 锁的是**等价约束**而不是字面量：产品换个 id、改个键值顺序都不影响，只要
// 「画板上那一列」与「产品左导航那一列」仍然逐条相同。有人再加/改分节而忘了同步画板
// （或反过来），这条会立刻红 —— 而这正是 v5 三次翻车里「两个真相源悄悄分叉」的那一类。
//
// 画板导航在 **多张分节画板**（D-07 / D-07b / D-08…D-13 / D-15 / D-16 / D-17 / D-19 /
// D-20 / D-21 / D-25 / D-31）左侧逐字重复，所以这里只抠第一处，其余那些「只差哪一项 is-on」
// 的副本由 `其它画板导航与 D-07 同构` 那一条统一验。

const boardPath = new URL("../design/v5/web/boards/D-07-settings-general.html", import.meta.url);
const boardSource = await readFile(boardPath, "utf8");
const panelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");

/** 一枚 `.d-set-navsep`（分组标题）或一枚 `.d-set-navitem`（`<i data-ico> + 文案`）。 */
const pattern = /<div class="d-set-navsep">([^<]*)<\/div>|<button class="d-set-navitem([^"]*)"><i data-ico="([^"]+)" data-size="([^"]+)"><\/i>([^<]*)<\/button>/g;

// `fsCache: false` —— 这条锁的就是**当前源码**里的分节表与语言包。开着 jiti 的文件缓存
// 时，刚改完的 i18n / 分节表可能读到上一版缓存，于是「画板与产品一致」会假绿/假红一次。
const jiti = await import("jiti").then((m) => m.createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false }));
const { SETTINGS_SECTIONS } = await jiti.import("../lib/settings-navigation.ts");
const { SETTINGS_HUB_GROUPS, settingsHubGroupLabel } = await jiti.import("./pwa/settingsHub.ts");
const { zhCNLocale } = await jiti.import("../lib/i18n/messages/zh-CN.ts");
const messages = zhCNLocale.messages;

/** 画板左导航的全部帧（D-07 有四帧，每帧重复同一条导航，只有 is-on 不同）。 */
function readAllBoardNavs(html) {
  const navs = [...html.matchAll(/<nav class="d-set-nav">([\s\S]*?)<\/nav>/g)].map((nav) =>
    [...nav[1].matchAll(pattern)].map((match) =>
      match[1] !== undefined
        ? { kind: "sep", label: match[1] }
        : { kind: "item", ico: match[3], size: match[4], label: match[5], isOn: match[2].includes("is-on") },
    ),
  );
  assert.ok(navs.length > 0, "画板里没有 <nav class=\"d-set-nav\">");
  return navs;
}

/** 画板左导航的第一帧（D-07 的「通用」是当前项）。 */
function readBoardNav(html) {
  return readAllBoardNavs(html)[0];
}

const boardNav = readBoardNav(boardSource);
const boardItems = boardNav.filter((entry) => entry.kind === "item");
const boardSeps = boardNav.filter((entry) => entry.kind === "sep");

/** 产品侧把三张表摊平成与画板同形状的一列。 */
function readProductNav() {
  const byId = new Map(SETTINGS_SECTIONS.map((entry) => [entry.id, entry]));
  const icons = Object.fromEntries(
    [...panelSource.matchAll(/^\s{2}(\w+): "([a-z0-9-]+)",$/gm)]
      .filter((match) => byId.has(match[1]))
      .map((match) => [match[1], match[2]]),
  );
  const entries = [];
  for (const group of SETTINGS_HUB_GROUPS) {
    entries.push({ kind: "sep", label: settingsHubGroupLabel(group.id, "zh-CN") });
    for (const id of group.sections) {
      const section = byId.get(id);
      entries.push({
        kind: "item",
        label: messages[section.labelKey],
        ico: icons[id],
        size: "14",
      });
    }
  }
  return entries;
}

/** 只保留「左导航那一列」的形状：段名 / 分节文案 / 图标名 / 图标尺寸。 */
function columnOf(nav) {
  return nav.map((entry) => (
    entry.kind === "sep"
      ? { kind: "sep", label: entry.label }
      : { kind: "item", label: entry.label, ico: entry.ico, size: entry.size }
  ));
}

test("产品左导航的分组 + 12 条文案与图标，逐条等于画板 D-07 的 .d-set-nav", () => {
  const productNav = readProductNav();
  assert.equal(boardItems.length, 12, "画板 D-07 的左导航应当是 12 条");
  assert.equal(boardSeps.length, 4, "画板 D-07 的左导航应当是四段分组");
  assert.deepEqual(
    // `is-on`（当前项）是另一条断言的事，这里比的是「那一列长什么样」。
    columnOf(productNav),
    columnOf(boardNav),
    "左导航（段名 / 文案 / 图标 / 顺序）与画板 D-07 不一致",
  );
});

test("画板上那一列的图标名与尺寸取自板面原文，且都在设计图标库里", () => {
  // 板面每枚图标都写 `data-size="14"`；产品侧走 `<SettingsSectionIcon size={14} />`。
  assert.ok(boardItems.every((item) => item.size === "14"));
  const productIcons = readProductNav().filter((entry) => entry.kind === "item").map((entry) => entry.ico);
  assert.deepEqual(productIcons, boardItems.map((item) => item.ico));
  assert.equal(new Set(productIcons).size, 12, "12 枚图标不能重名（重名即抄错行）");
});

test("画板左导航是一族分节画板的同一份：只差哪一项带 is-on", async () => {
  const boardDir = new URL("../design/v5/web/boards/", import.meta.url);
  const files = [
    "D-07-settings-general.html",
    "D-08-settings-models.html",
    "D-09-settings-model-advanced.html",
    "D-10-settings-enabled-models.html",
    "D-11-settings-skills.html",
    "D-12-settings-agents.html",
    "D-13-settings-plugins.html",
    "D-15-settings-mcp.html",
    "D-16-settings-mcp-exposure.html",
    "D-17-settings-automation.html",
    "D-19-settings-usage.html",
    "D-20-settings-phone-push.html",
    "D-21-settings-archive-import.html",
    "D-31-settings-imagegen.html",
  ];
  const shape = boardNav.map((entry) => entry.label);
  for (const file of files) {
    const navs = readAllBoardNavs(await readFile(new URL(file, boardDir), "utf8"));
    for (const nav of navs) {
      assert.deepEqual(nav.map((entry) => entry.label), shape, `${file} 的左导航与 D-07 不同构`);
      // 每张板恰好一枚 is-on，且产品也照它切 `is-on`（同一枚 = 同一分节）。
      assert.equal(nav.filter((entry) => entry.kind === "item" && entry.isOn).length, 1, `${file} 的 is-on 数量不对`);
    }
  }
});

test("分组归属：四段各段的分节集合与画板逐项相同（顺序也算）", () => {
  assert.deepEqual(
    SETTINGS_HUB_GROUPS.map((group) => group.id),
    ["base", "capability", "runtime", "data"],
  );
  // 「不在四张卡里的分节」必须为空 —— 有孤儿就说明分组表与分节清单分叉了。
  const grouped = new Set(SETTINGS_HUB_GROUPS.flatMap((group) => group.sections));
  assert.deepEqual(
    SETTINGS_SECTIONS.filter((entry) => !grouped.has(entry.id)).map((entry) => entry.id),
    [],
    "有分节没进任何分组（SettingsPanel 会把它接在末尾，那已是不一致）",
  );
  assert.deepEqual(
    SETTINGS_HUB_GROUPS.map((group) => settingsHubGroupLabel(group.id, "zh-CN")),
    boardSeps.map((sep) => sep.label),
  );
});

test("导航那一列的文案三语齐全，且 zh-CN 就是画板原文", () => {
  for (const entry of SETTINGS_SECTIONS) {
    assert.ok(messages[entry.labelKey], `${entry.id} 的 labelKey ${entry.labelKey} 在 zh-CN 缺文案`);
  }
  assert.deepEqual(
    SETTINGS_SECTIONS.map((entry) => messages[entry.labelKey]),
    boardItems.map((item) => item.label),
    "SETTINGS_SECTIONS 的顺序或 labelKey 与画板不一致",
  );
});