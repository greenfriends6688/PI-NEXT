import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./PiMemoryConfig.tsx", import.meta.url), "utf8");

/*
 * fork:design-system —— 画板 44 的记忆页：两块 `.pw-block`（开关与状态 / 记忆工具）
 * + 一组 `.pw-cols`（左：过滤框 + `.pw-list` 目录；右：`.pw-detail` 编辑器）。
 * 旧的 `settings-general*` / `settings-chat-*` / `settings-field-input` 自有类
 * 与内联盒子必须清零。
 */

test("the page is the board's blocks + two-column layout", () => {
  assert.match(source, /<SettingsPage[\s\S]*?sub=\{t\("memory\.subtitle"\)\}/);
  assert.match(source, /<PwBlock icon="brain" title=\{t\("memory\.switches"\)\}>/);
  assert.match(source, /<PwBlock icon="wrench" title=\{t\("memory\.tools"\)\}>/);
  // fork:settings-frame（画板 62）—— 两块收进 760 的内容宽度（原先 1160）。
  assert.match(source, /className="pw-narrow"/);
  assert.match(source, /<ConfigSplitView>/);
  assert.match(source, /<ConfigSidebar>/);
  assert.match(source, /<ConfigDetail[\s>]/);
  assert.doesNotMatch(source, /settings-general|settings-chat-|settings-field-input|settings-search-input/);
});

/**
 * fix:memory-scroll（2026-09-30 用户实测「记忆页面不能滑动」）——
 *
 * 记忆页**不能**用 `SettingsPage` 的 `fill`（`.pw-scontent.is-fixed`）。
 * 状态块 + 工具块 + 两栏加起来 1038px，而内容区只有 819px；`is-fixed` 是
 * `overflow: hidden`，多出来的 219px 被直接裁掉，**连滚动条都没有**
 * （实测：`contentOverflowY: hidden`，`scrollables: []`，`clippedPx: 219`）。
 * 这一页不是纯列表页，整页共用一个滚动容器。
 */
test("记忆页不用 fill：整页共用一个滚动容器（否则下半截被裁掉且无法滚动）", () => {
  const page = source.slice(source.indexOf("<SettingsPage"), source.indexOf("<PwBlock"));
  assert.doesNotMatch(page, /\bfill\b/);
  assert.match(source, /<ConfigSplitView>/);
});

test("the switch and package state are pw-field rows with a status badge", () => {
  // fix:memory-layout（画板 44 的状态块三行）—— 启用记忆（说明走 .pw-label small）/
  // pi-memory 状态（徽章 + 重新安装）/ 记忆文件目录（等宽路径 + 打开）。
  assert.match(source, /<ConfigField label=\{t\("memory\.enable"\)\} hint=\{t\("memory\.enableHint"\)\}>/);
  assert.match(source, /checked=\{enabled\}\n\s+loading=\{busy === "enable" \|\| busy === "disable"\}/);
  assert.match(source, /className=\{enabled \? "pw-badge ok" : "pw-badge"\} role="status">\{statusText\}/);
  assert.match(source, /<ConfigField label=\{t\("memory\.status"\)\}>/);
  assert.match(source, /<ConfigField label=\{t\("memory\.dirLabel"\)\}>/);
  assert.match(source, /t\("memory\.reinstall"\)/);
  assert.match(source, /t\("memory\.openDir"\)/);
  // 整段说明不再挤在块尾（那是「间距特别近」的来源）。
  assert.doesNotMatch(source, /<p className="pw-hint">\{t\("memory\.enableHint"\)\}<\/p>/);
  assert.doesNotMatch(source, /<p className="pw-hint">\{t\("memory\.toolsHint"\)\}<\/p>/);
});

test("每个记忆工具是「名字 + 一句说明」的 pw-litem（画板 44 的 pw-lsub）", () => {
  assert.match(source, /import \{[^}]*PI_MEMORY_TOOL_HINT_KEYS[^}]*\} from "@\/lib\/pi-memory"/);
  assert.match(source, /<span className="pw-lsub">\{t\(PI_MEMORY_TOOL_HINT_KEYS\[tool\]\)\}<\/span>/);
});

test("新建入口在过滤行右侧（画板 44），不在每个缺失文件行尾", () => {
  assert.match(source, /const createMissing = async \(\) => \{/);
  assert.match(source, /className="pw-iconbtn sm"\n\s+title=\{t\("memory\.createMissing"\)\}/);
  // 缺失文件行不再各挂一枚按钮，只留「尚未创建」徽章。
  assert.doesNotMatch(source, /t\("memory\.createFile"\)/);
});

test("the file catalog is a pw-list of selectable rows, editing moves to the detail column", () => {
  assert.match(source, /<ConfigSidebarItem\n\s+key=\{file\.path\}\n\s+active=\{openFile\?\.path === file\.path\}\n\s+disabled=\{busy === file\.path\}\n\s+onClick=\{\(\) => void read\(file\.path\)\}/);
  assert.match(source, /data-ico="file-text"/);
  assert.match(source, /data-ico="file-plus"/);
  assert.match(source, /className="pw-lname pw-mono">\{file\.path\}/);
  assert.match(source, /className="pw-textarea"/);
  assert.match(source, /onClick=\{\(\) => onOpenFile\(`\$\{dir\}\/\$\{openFile\.path\}`\)\}/);
});

test("the conflict banner and errors use the board's pw-alert", () => {
  assert.match(source, /<div className="pw-alert" role="alert">/);
  assert.match(source, /data-ico="triangle-alert"/);
  assert.match(source, /\{conflict && \(/);
  assert.match(source, /onClick=\{\(\) => void read\(openFile\.path\)\}>\s*\n\s*\{t\("memory\.reload"\)\}/);
});

test("状态块/工具块留在两栏上方（DIVERGENCE 146 的裁定），弱化行用画板的 opacity", () => {
  // 〔与提案的差异〕画板 62 写的是「统一两栏」；裁定：把两块塞进详情列会让
  // 「未选中文件」的空态与状态块打架 —— 两块仍留在两栏上方，收进 .pw-narrow(760)。
  const narrowAt = source.indexOf('className="pw-narrow"');
  const colsAt = source.indexOf("<ConfigSplitView>");
  assert.ok(narrowAt > -1 && colsAt > narrowAt, "pw-narrow 状态块/工具块必须在两栏上方");
  // 画板 44 的弱化行：还没建出来的 pi-memory 文件用 opacity:.6。
  assert.match(source, /style=\{\{ opacity: 0\.6 \}\}/);
});

test("empty states use pw-empty + pw-empty-inner with the frame-D mark", () => {
  // fork:settings-frame（画板 62 帧 D）—— 列表空 / 详情未选都带记号图标：
  // 列表空 = 分节自己的图标；详情未选 = 40px 方框记号 + 一句引导，居中。
  assert.match(source, /<ConfigEmptyState>\s*\n\s*<span className="mark"><i data-ico="file-text" data-size="16" aria-hidden="true" \/><\/span>\s*\n\s*<p>\{fileQuery\.trim\(\) \? t\("memory\.fileNoMatch"\) : t\("memory\.filesEmpty"\)\}<\/p>/);
  assert.match(source, /<ConfigEmptyState>\s*\n\s*<span className="mark"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" \/><\/span>\s*\n\s*<p>\{t\("memory\.filesHint"\)\}<\/p>/);
  // fix:memory-layout（画板 62 帧 D「详情未选」）—— 空态的居中由 board.css 自己的
  // `.pw-detail .pw-empty { min-height:180px }` 兜底，组件不再写内联 minHeight
  //（那个 420 正是 62 诊断里「两栏仅 420 高」的来历）。
  assert.doesNotMatch(source, /minHeight: 420/);
});
