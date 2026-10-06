import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

/**
 * fork:v5-m05-tier —— M-05「设置」PWA 画板逐帧落地的源码守卫。
 *
 * 每条断言后面写着它对应 M-05 帧的哪一行 / 哪句原话，以及为什么它是**等价约束**
 * 而不是「就长这样」（铁律：结构改了要断言新的等价约束，不许删测试）。
 *
 * 覆盖：
 *   · 帧 B 的主题档位条（`.m-pickbar` 三等分、满宽、标签在上）；
 *   · 帧 B / C / D 用到的六件家具（`.m-setrow` / `.m-badge` / `.m-fieldrow` +
 *     `.m-slider` / `.m-switch` / `.m-doc-label`）类名与嵌套；
 *   · 铁律二：一个类名只有一个来源 —— 产品侧不许新造 `m-*`，也不许另起同名。
 */

const uiSource = await readFile(new URL("./SettingsUi.tsx", import.meta.url), "utf8");
const panelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const pwaSystemSource = await readFile(new URL("../design/v5/pwa/system.css", import.meta.url), "utf8");
const m05Source = await readFile(
  new URL("../design/v5/pwa/boards/M-05-settings.html", import.meta.url),
  "utf8",
);


/** 取 `PwField` 里 `if (tier) { … }` 那一段（到窄屏非 tier 分支的 `return (` 为止）。 */
function tierSlice(pwField) {
  const start = pwField.indexOf("if (tier) {");
  assert.ok(start >= 0, "PwField 应当有 tier 分支");
  const rest = pwField.slice(start + 1);
  const end = rest.indexOf("\n    return (");
  return end > 0 ? rest.slice(0, end) : rest;
}

// ── 帧 B · 板面前提（守卫测试自己也得钉住板面没被顺手改掉）─────────────────
test("M-05 帧 B: `.m-pickbar` 三等分、满宽，且从不与标签并排", async () => {
  // 板面帧 B 主题那一格：`.m-hero`（主题 + 一句说明）在上，`.m-cardgroup` ›
  // `.m-pickbar` › 三枚 `button.m-picktag`（跟随系统 / 浅色 / 深色）在下。
  const themeBlock = m05Source.match(
    /<div class="m-hero">\s*<span class="m-t-lg m-t-b">主题<\/span>[\s\S]*?<\/div>\s*<div class="m-cardgroup">([\s\S]*?)<\/div>\s*<div class="m-cardgroup">/,
  );
  assert.ok(themeBlock, "M-05 帧 B 的主题块应当是 `.m-hero` + `.m-cardgroup`");
  assert.match(themeBlock[1], /class="m-pickbar"/);
  assert.equal((themeBlock[1].match(/class="m-picktag/g) ?? []).length, 3, "主题是三档");

  // **前提守卫**：12 张 PWA 画板里 `.m-pickbar` 一次也没有出现在 `.m-setrow` 内部。
  // 产品据此把「档位条」判成「标签在上、控件在下」；板面若哪天改了，这里先红。
  const boardDir = new URL("../design/v5/pwa/boards/", import.meta.url);
  const boards = (await readdir(boardDir)).filter((name) => name.endsWith(".html"));
  assert.ok(boards.length >= 12, "PWA 画板应至少有 12 张");
  for (const name of boards) {
    const source = await readFile(new URL(name, boardDir), "utf8");
    for (const match of source.matchAll(
      /<(\w+)[^>]*class="[^"]*m-setrow[^"]*"[^>]*>([\s\S]*?)<\/\1>/g,
    )) {
      assert.doesNotMatch(
        match[2],
        /class="m-pickbar"/,
        `${name}: .m-pickbar 不该出现在 .m-setrow 内部`,
      );
    }
  }
});

// ── 帧 B · 产品侧：PwField 的满宽档位条分支 ─────────────────────────────────
test("PwField: `tier` 在窄屏把标签行与档位条拆成两段（板面 `.m-hero` + 满宽 `.m-pickbar`）", () => {
  const pwField = uiSource.slice(
    uiSource.indexOf("export function PwField("),
    uiSource.indexOf("export function PwCtl("),
  );

  // ① 档位分支存在，且是**片段**（两段兄弟），不是一张 `.m-setrow`。
  assert.match(pwField, /if \(tier\) \{/, "PwField 应当有 tier 分支");
  const tierBranch = tierSlice(pwField);
  assert.match(tierBranch, /<>[\s\S]*?className="m-setrow"[\s\S]*?\{control\}[\s\S]*?<\/>/,
    "tier 分支应是 Fragment：标签行 + 控件行两段兄弟");
  assert.doesNotMatch(
    tierBranch,
    /className="m-setrow"[\s\S]*className="m-setrow"[\s\S]*\{control\}/,
    "档位条绝不能仍待在 `.m-setrow` 的 flex 行里（那就是 146px 的根因）",
  );

  // ② 标签行仍是板面那三件套：`.m-setrow` › `.m-setrow-body` › `.m-setrow-t` +
  //    `.m-setrow-s`（与 `PwRadioRow` 的窄屏标签行同款）。
  for (const cls of ["m-setrow", "m-setrow-body", "m-setrow-t", "m-setrow-s"]) {
    assert.match(tierBranch, new RegExp(`className="${cls}"`), `tier 标签行应含 .${cls}`);
  }

  // ③ 桌���那一支一个字不动：D-07 帧 D 的 `.d-set-row` + `.d-grow-last` / `.d-slider`。
  const desktop = pwField.slice(pwField.indexOf("return (\n    <div className=\"d-set-row\">"));
  assert.match(desktop, /className="d-set-row"/);
  assert.match(desktop, /className="d-set-row-box"/);
  assert.match(desktop, /className="d-grow-last"/);
  assert.doesNotMatch(pwField, /className="d-set-row"[\s\S]*tier/, "tier 不得影响桌面分支");
});

// ── 帧 B / C · 四个档位字段必须声明 tier ────────────────────────────────────
test("SettingsPanel: 四个 `.m-pickbar` 字段（主题 / 语言 / 密度 / 通知总开关）都标 tier", () => {
  // 按 `<PwField` 切块：每块到下一个 `<PwField` / `</PwBlock>` 为止。
  const chunks = panelSource.split(/<PwField\b/).slice(1);
  const pickbarFields = chunks.filter((chunk) => /<PwRadio\b/.test(chunk));
  assert.equal(pickbarFields.length, 4, "常规页应有四个档位字段（与产品现状一一对应）");
  for (const chunk of pickbarFields) {
    const beforeControl = chunk.slice(0, chunk.indexOf("<PwRadio"));
    assert.match(
      beforeControl,
      /\btier\b/,
      "每个档位字段都要在 control 之前标 tier（否则档位条会被压成行右槽）",
    );
  }
  // 主题那一处必须标 tier（用户报的那一格）。
  const themeChunk = pickbarFields.find((chunk) => chunk.includes('t("settings.theme")'));
  assert.ok(themeChunk, "主题那一格应当在这四个档位字段里");
  assert.match(themeChunk, /tier/);
});

// ── 帧 B / C / D · 六件家具：类名与嵌套 ──────────────────────────────────────
test("M-05 家具：`.m-setrow` / `.m-badge` / `.m-fieldrow` / `.m-slider` / `.m-switch` / `.m-doc-label` 字面一致", () => {
  for (const cls of [
    "m-setrow",
    "m-setrow-body",
    "m-setrow-t",
    "m-setrow-s",
    "m-cardgroup",
    "m-group-title",
    "m-badge",
    "m-fieldrow",
    "m-fieldrow-s",
    "m-slider",
    "m-switch",
    "m-doc-label",
    "m-radio",
    "m-pickbar",
    "m-picktag",
  ]) {
    assert.match(pwaSystemSource, new RegExp(`\\.${cls}[\\s.: >{,\\[]`), `pwa/system.css 应定义 .${cls}`);
  }

  // `.m-switch` 必须是「按钮 + 状态类 `on`」，铁律一允许 div→button（保留原类名）。
  const pwSwitch = uiSource.slice(uiSource.indexOf("export function PwSwitch("), uiSource.indexOf("export interface PwRadioOption"));
  assert.match(pwSwitch, /className=\{`\$\{isMobile \? "m-switch" : "d-switch"\}\$\{checked \? " on" : ""\}`\}/);
  assert.match(pwSwitch, /role="switch"/);

  // `.m-picktag` 的选中态类是 `is-on`（板面原文），不是 `on`。
  const pwRadio = uiSource.slice(uiSource.indexOf("export function PwRadio<"), uiSource.indexOf("export interface PwRadioRowOption"));
  assert.match(pwRadio, /`m-picktag\$\{on \? " is-on" : ""\}`/);

  // `.m-radio` 的选中态类是 `on`（板面原文）。
  assert.match(uiSource, /`m-radio\$\{on \? " on" : ""\}`/);

  // `.m-badge` 的档位类：ok / warn / bad / mute（板面帧 A / B / C 都用到）。
  for (const tone of ["ok", "warn", "bad", "mute"]) {
    assert.match(pwaSystemSource, new RegExp(`\\.m-badge\\.${tone}`));
  }
});

// ── 铁律二：本轮不许在产品 CSS 里新造 / 另起 `m-*` ─────────────────────────
test("产品样式表没有新造 `m-*` 类（类只出自 design/v5/pwa/system.css）", async () => {
  const appDir = new URL("../app/", import.meta.url);
  const cssFiles = (await readdir(appDir)).filter((name) => name.endsWith(".css"));
  const declared = new Set(
    [...pwaSystemSource.matchAll(/\.(m-[a-z0-9-]+)/g)].map((m) => m[1]),
  );
  assert.ok(declared.size > 50, "库里应有足量的 m-* 类");
  for (const name of cssFiles) {
    const source = await readFile(new URL(name, appDir), "utf8");
    for (const match of source.matchAll(/\.(m-[a-z0-9-]+)/g)) {
      const cls = match[1];
      if (cls.startsWith("m-") && !declared.has(cls)) {
        // 只放行「不是类」的写法：`@media (…max-width: 640px)` 之类不会出现，
        // 这里命中即视为另起同名 —— 直接红。
        assert.fail(`app/${name} 出现了库里没有的 .${cls}（铁律二：一个类名只有一个来源）`);
      }
    }
  }
});

// ── 铁律五：tier 只动窄屏，桌面几何不许变 ────────────────────────────────────
test("tier 分支不带任何桌面类（`.d-*`）与内联几何", () => {
  const pwField = uiSource.slice(
    uiSource.indexOf("export function PwField("),
    uiSource.indexOf("export function PwCtl("),
  );
  const tierBranch = tierSlice(pwField);
  assert.doesNotMatch(tierBranch, /className="d-/, "tier 分支是窄屏形态，不许发桌面类");
  assert.doesNotMatch(tierBranch, /style=\{\{/, "tier 分支不许内联几何");
});
// ── tier 与 slider 互斥（上面 `tier` 的契约）────────────────────────────────
test("没有调用点同时给 `tier` 与 `slider`（档位条不是滑杆）", () => {
  const chunks = panelSource.split(/<PwField\b/).slice(1);
  for (const chunk of chunks) {
    if (!/\btier\b/.test(chunk.slice(0, chunk.search(/control=|slider=\{|\/>/)))) continue;
    assert.doesNotMatch(
      chunk,
      /slider=\{/,
      "tier 那一支只出 control；给了 slider 会静默丢掉（守卫钉住这个契约）",
    );
  }
});
