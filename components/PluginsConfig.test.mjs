import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:v5-d13-frame-a/c（画板 D-13）—— 插件分节改版的**结构**断言。
// 桌面 = 帧 A 的「已装」表（计数行 + 每作用域一块 `.d-card > .d-table`）+ 帧 C 的
// 详情弹层；手机档（M-05）与 MCP 分节（D-15）走既有形态，不在断言范围里。
// 断言只锁「照抄画板的 DOM 形态」与三语键齐，不锁文案。

const source = await readFile(new URL("./PluginsConfig.tsx", import.meta.url), "utf8");
const locales = await Promise.all(["en", "zh-CN", "zh-TW"].map(async (name) => [
  name,
  await readFile(new URL(`../lib/i18n/messages/${name}.ts`, import.meta.url), "utf8"),
]));

const frameA = source.slice(
  source.indexOf("fork:v5-d13-frame-a —— 桌面 = 画板 D-13 帧 A"),
  source.indexOf("fork:design-system（画板 43 导入帧）"),
);

test("desktop plugins section is frame A: count row + d-table per scope", () => {
  // sec 标题「已装」+ 计数行（总数 / 启用 / 禁用 + **禁用 ≠ 卸载** + 刷新）
  assert.match(frameA, /className="d-set-sec-t"/);
  assert.match(frameA, /plugins\.installedSection/);
  assert.match(frameA, /plugins\.countSummary/);
  assert.match(frameA, /plugins\.offNotUninstallT/);
  assert.match(frameA, /plugins\.offNotUninstallB/);
  // 表格在 `.d-card` 里：列头 插件(26%) / 来源 / 版本 / 状态 / 启用 / （更多）
  assert.match(frameA, /className="d-card"/);
  assert.match(frameA, /className="d-table"/);
  assert.match(frameA, /style=\{\{ width: "26%" \}\}/);
  assert.match(frameA, /plugins\.colPackage/);
  assert.match(frameA, /plugins\.sourceLabel/);
  assert.match(frameA, /i18n\.version/);
  assert.match(frameA, /i18n\.status/);
  assert.match(frameA, /plugins\.colEnable/);
  // 行 = 名称+描述两行（d-col）+ 来源徽标 + 版本 + 状态徽章 + 真开关 + 更多
  assert.match(frameA, /className="d-col"/);
  assert.match(frameA, /<SourceTag pkg=\{pkg\} \/>/);
  assert.match(frameA, /className="d-mono"/);
  assert.match(frameA, /packageStatusBadge\(/);
  assert.match(frameA, /role="switch"/);
  assert.match(frameA, /event\.stopPropagation\(\)/);
  assert.match(frameA, /className="d-iconbtn"/);
  assert.match(frameA, /data-ico="ellipsis"/);
  // 桌面没有工具栏（计数与刷新宿在帧 A 的计数行里）
  assert.match(source, /toolbar=\{mcpOnly \|\| !isMobile \? undefined : \(/);
  // 组开关（fork:group-switch G4）不能因为换表格丢掉
  assert.match(frameA, /className="d-group-title"/);
  assert.match(frameA, /<GroupSwitch/);
  // 未信任目录的横幅仍在
  assert.match(source, /trust\.pluginsNotLoaded/);
});

test("row menu and uninstall confirmation both ride the shared popover menu", () => {
  const rowMenu = source.slice(
    source.indexOf("帧 A 的卸载确认：逐条写后果"),
    source.indexOf("const addBusy", source.indexOf("帧 A 的卸载确认：逐条写后果")),
  );
  // 板面顺序：插件详情 / 更新（无更新态时是检查）/ 启停 / ─ / 卸载…
  assert.match(rowMenu, /plugins\.detail/);
  assert.match(rowMenu, /\{ type: "separator" \}/);
  assert.match(rowMenu, /openUninstallMenu/);
  // 卸载确认逐条写后果 + 一条可逆的路；锚在行尾菜单同一个位置
  assert.match(rowMenu, /plugins\.uninstallDir/);
  assert.match(rowMenu, /plugins\.uninstallResources/);
  assert.match(rowMenu, /plugins\.uninstallSessions/);
  assert.match(rowMenu, /plugins\.unaffected/);
  assert.match(rowMenu, /plugins\.disableInstead/);
  assert.match(rowMenu, /plugins\.confirmUninstall/);
  assert.match(rowMenu, /plugins\.uninstallFoot/);
  assert.match(source, /menuAnchor\.current = \{ x: event\.clientX, y: event\.clientY \}/);
});

test("detail is frame C: a wide modal with head/body/foot, opened only on desktop", () => {
  const modal = source.slice(
    source.indexOf("function PluginDetailModal"),
    source.indexOf("/** fork:v5-d13-frame-c —— 独立扩展的详情"),
  );
  assert.match(modal, /className="d-modal is-open"/);
  assert.match(modal, /className="d-modal-box wide"/);
  assert.match(modal, /className="d-modal-head"/);
  assert.match(modal, /className="d-modal-body"/);
  assert.match(modal, /className="d-modal-foot"/);
  // foot：重载提示（帧 B 那半句真话）+ 卸载… + 完成
  assert.match(modal, /agents\.reloadRequired/);
  assert.match(modal, /data-ico="trash-2"/);
  assert.match(modal, /plugins\.done/);
  // 桌面才挂；选中与「弹层开着」是两个状态
  assert.match(source, /desktopTable && detailOpen && selectedPackage/);
  assert.match(source, /const \[detailOpen, setDetailOpen\] = useState\(false\)/);
  // 弹层与手机内联详情共用同一段正文
  assert.match(source, /<PackageDetailBody[\s\S]{0,200}?pkg=\{pkg\}/);
});

test("every new plugins.* key exists in all three locales", () => {
  const keys = [...source.matchAll(/t\("(plugins\.(?:installedSection|countSummary|offNotUninstall\w+|colPackage|colEnable|statusLoaded|statusNoResources|statusMissing|localSource|more|detail|uninstall\w+|unaffected|disableInstead|confirmUninstall|done))"/g)]
    .map((m) => m[1]);
  assert.ok(keys.length >= 16, `expected the D-13 key set, found ${keys.length}`);
  for (const [name, messages] of locales) {
    for (const key of new Set(keys)) {
      assert.ok(messages.includes(`"${key}":`), `${name} is missing ${key}`);
    }
  }
});