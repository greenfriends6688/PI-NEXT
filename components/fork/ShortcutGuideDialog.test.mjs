import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ShortcutGuideDialog } = await jiti.import("./ShortcutGuideDialog.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { buildShortcutGuide, parseShortcutOverrides } = await jiti.import("@/lib/shortcuts");

const source = await readFile(new URL("./ShortcutGuideDialog.tsx", import.meta.url), "utf8");
const entrySource = await readFile(new URL("./ShortcutGuideEntry.tsx", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../SettingsPanel.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../../app/fork-ui.css", import.meta.url), "utf8");
/** 注释里可以提 `defaultBindings`（解释为什么不用它），代码里不行。 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => {
    const at = line.indexOf("//");
    return at === -1 ? line : line.slice(0, at);
  })
  .join("\n");

const realNavigator = globalThis.navigator;

/** 地图的键帽走 `isApplePlatform`；SSR 那一刻组件没跑 effect，所以靠环境决定。 */
function withPlatform(platform, run) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: platform === "mac" ? { platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh)" } : { platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0)" },
  });
  try {
    return run();
  } finally {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: realNavigator });
  }
}

function render(platform = "win") {
  return withPlatform(platform, () =>
    renderToStaticMarkup(
      React.createElement(I18nProvider, null, React.createElement(ShortcutGuideDialog, { onClose: () => {} })),
    ),
  );
}

// ---------------------------------------------------------------------------
// 如实标注：managed:false 的行
// ---------------------------------------------------------------------------

test("fork:proma-33-shortcut-guide —— 未接入的键位（⌘F）必须带状态标记，不能只列键帽", () => {
  const html = render("mac");
  // 键位本身在（地图是「现在有什么」，不是「我能改什么」）。
  assert.match(html, /<span class="d-kbd">⌘<\/span><span class="d-kbd">F<\/span>/);
  // 但它被标成「未接入」，且这条文案只出现在 ⌘F 那一行上。
  assert.match(html, /Not wired up — its own feature handles it/);
  assert.equal((html.match(/Not wired up/g) ?? []).length, 1, "只有 ⌘F 一行带这条标记");
  assert.equal(
    (html.match(/class="fork-shortcut-guide-flag/g) ?? []).length,
    1,
    "无 override 时只有一枚状态标记（「未接入」）；「已改」不该出现",
  );
  assert.equal(html.includes("fork-shortcut-guide-flag custom"), false);
});

test("未接入的那一行仍然留在 notMigrated 分组里，而不是被过滤掉", () => {
  const html = render("win");
  assert.match(html, /Registered elsewhere/);
  assert.match(html, /Find in conversation/);
  // 同一分组里没有「已改」以外的第二种状态标记混入。
  assert.match(html, /aria-labelledby="fork-shortcut-guide-group-notMigrated"/);
  assert.match(html, /id="fork-shortcut-guide-group-notMigrated"[^>]*>Registered elsewhere/);
});

// ---------------------------------------------------------------------------
// 生效值优先于默认值
// ---------------------------------------------------------------------------

test("fork:proma-33-shortcut-guide —— 生效值来自 overrides，不是表里的 defaultBindings", () => {
  // 组件是 `buildShortcutGuide(overrides, …)` 的薄壳，override 的优先级钉在
  // 这里：同一份 overrides，改过的行显示改过的键，没改的行照旧显示默认键。
  const overridden = parseShortcutOverrides({ toggleSidebar: ["CmdOrCtrl+Shift+j"] });
  const guide = buildShortcutGuide(overridden, { platform: "MacIntel" });
  const sidebar = guide.flatMap((group) => group.rows).find((row) => row.id === "toggleSidebar");
  assert.equal(sidebar.displayText, "⇧⌘J", "改过的行显示改过的键");
  assert.equal(sidebar.customized, true, "改过的行带「你改过」标记");

  const untouched = guide.flatMap((group) => group.rows).find((row) => row.id === "toggleRightPanel");
  assert.equal(untouched.displayText, "⌥⌘B", "没改的行显示默认键");
  assert.equal(untouched.customized, false);

  // 组件源码层面：唯一的数据源是 useShortcutBindings 的 overrides，组件自己
  // 不读 SHORTCUT_COMMANDS[].defaultBindings（否则改过的键永远不会显示）。
  assert.match(code, /const \{ overrides \} = useShortcutBindings\(\);/);
  assert.match(code, /buildShortcutGuide\(overrides, platformInfo\)/);
  assert.doesNotMatch(code, /defaultBindings/);
  assert.doesNotMatch(code, /SHORTCUT_COMMANDS/);
});

test("无 override 时地图显示的是本平台默认键帽", () => {
  const mac = render("mac");
  assert.match(mac, /<span class="d-kbd">⌘<\/span><span class="d-kbd">B<\/span>/, "mac 侧栏开关是 ⌘B");
  assert.match(mac, /<span class="d-kbd">⇧<\/span><span class="d-kbd">⌘<\/span><span class="d-kbd">L<\/span>/, "mac 主题切换是 ⇧⌘L");
  assert.match(mac, /The keys that work on this Mac right now/);

  const win = render("win");
  assert.match(win, /<span class="d-kbd">Ctrl<\/span><span class="d-kbd">B<\/span>/, "非 mac 侧栏开关是 Ctrl+B");
  assert.match(win, /<span class="d-kbd">Ctrl<\/span><span class="d-kbd">Shift<\/span><span class="d-kbd">L<\/span>/, "非 mac 主题切换是 Ctrl+Shift+L");
  assert.match(win, /The keys that work on this device right now/);
  assert.equal(win.includes("⌘"), false, "非 mac 不出现 ⌘");
});

// ---------------------------------------------------------------------------
// 结构与无障碍
// ---------------------------------------------------------------------------

test("弹层用画板 50 的壳 + 画板 45 的行，无障碍走 useDialogA11y", () => {
  assert.match(source, /useDialogA11y\(\{ open: true, onClose \}\)/, "不手搓焦点陷阱 / Esc");
  assert.match(source, /className="d-modal is-open fork-shortcut-guide-scrim"/);
  assert.match(source, /className="d-modal-box fork-shortcut-guide-modal"/);
  assert.match(source, /className="d-modal-head d-row"/);
  assert.match(source, /className="d-modal-body fork-shortcut-guide-body"/, "内容行可滚动");
  assert.match(source, /className="d-modal-foot"/);
  assert.match(source, /className="d-set-row"/);
  assert.match(source, /className="d-set-sec-t"/);
  assert.match(source, /<span className="d-kbd"/, "键帽是画板的 .d-kbd");
  // role/aria 由 hook 的 dialogProps 展开，组件不许自己再写一份。
  assert.match(source, /\{\.\.\.dialogProps\}/);
  assert.doesNotMatch(source, /role="dialog"/);
  // 图标一律 lucide 占位。
  assert.match(source, /<i data-ico="keyboard"/);
  assert.match(source, /<i data-ico="x"/);
  assert.doesNotMatch(source, /<svg/);
  // v5 迁移后 JSX 里零 `pw-*` 类：视觉全部走 `.d-*`（旧 CSS 文件保留不动）。
  for (const used of source.match(/className="([^"]*pw-[^"]*)"/g) ?? []) {
    assert.fail(`换皮后的 DOM 不许带旧类：${used}`);
  }
  // 分组标题的 id 与 aria-labelledby 配对（单实例，id 不会撞）。
  const rendered = render("mac");
  for (const group of buildShortcutGuide(null, { platform: "MacIntel" })) {
    assert.match(rendered, new RegExp(`aria-labelledby="fork-shortcut-guide-group-${group.group}"`));
    assert.match(rendered, new RegExp(`id="fork-shortcut-guide-group-${group.group}"`));
  }
});

test("对话框可滚动，且 notMigrated 组在滚动区内（85vh 上限写在 CSS，不内联几何）", () => {
  assert.match(source, /fork-shortcut-guide-body/, "内容行是滚动容器");
  assert.doesNotMatch(source, /style=\{\{/, "组件不写内联几何");
  assert.match(css, /\.fork-shortcut-guide-modal \{[^}]*max-height: 85vh;/, "弹层 85vh 上限");
  assert.match(css, /\.fork-shortcut-guide-scrim \{[^}]*position: fixed;/, "遮罩 fixed + 层级");
  assert.match(css, /\.fork-shortcut-guide-body \{\s*display: block;/, "内容行改块流，分组才能成段");
});

test("接线只有一处：常规设置页末尾的入口按钮，弹层开合状态在入口自己手里", () => {
  assert.match(panelSource, /import \{ ShortcutGuideEntry \} from "\.\/fork\/ShortcutGuideEntry";/);
  assert.equal((panelSource.match(/<ShortcutGuideEntry \/>/g) ?? []).length, 1);
  assert.match(entrySource, /const \[open, setOpen\] = useState\(false\);/);
  assert.match(entrySource, /\{open \? <ShortcutGuideDialog onClose=\{\(\) => setOpen\(false\)\} \/> : null\}/);
  // 入口是一行 `.pw-field` + 按钮，不是新设置分节。
  assert.match(entrySource, /<PwBlock icon="keyboard"/);
  assert.doesNotMatch(entrySource, /useShortcutBindings|defaultBindings/);
});

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

test("三语都补齐了地图文案", async () => {
  const keys = [
    "settings.shortcuts.guideBlockTitle",
    "settings.shortcuts.guideEntryLabel",
    "settings.shortcuts.guideEntryHint",
    "settings.shortcuts.guideOpen",
    "settings.shortcuts.guideTitle",
    "settings.shortcuts.guideSubApple",
    "settings.shortcuts.guideSubOther",
    "settings.shortcuts.guideNotWired",
    "settings.shortcuts.guideCustomized",
    "settings.shortcuts.guideFoot",
  ];
  const packages = {
    en: await jiti.import("@/lib/i18n/messages/en.ts"),
    "zh-CN": await jiti.import("@/lib/i18n/messages/zh-CN.ts"),
    "zh-TW": await jiti.import("@/lib/i18n/messages/zh-TW.ts"),
  };
  for (const [locale, messages] of Object.entries(packages)) {
    for (const key of keys) {
      const value = messages[`${locale.replace("-", "")}Locale`]?.messages?.[key];
      assert.equal(typeof value, "string", `${locale} 缺 ${key}`);
      assert.notEqual(value, "", `${locale}.${key} 是空串`);
      // 「已翻」：不允许把 key 原样留着。
      assert.notEqual(value, key, `${locale}.${key} 还没翻`);
    }
  }
});
