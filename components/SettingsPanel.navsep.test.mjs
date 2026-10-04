import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:v5-landing Wave N1 · D-07 帧 A/B/C/D + M-05 帧 A/B —— 这一轮落地的两处接线：
//   ① 左导航的四段分组标题 `.d-set-navsep`（基础 / 能力 / 运行 / 数据与连接）；
//      分组表与手机 hub 的四张卡是**同一张**（`pwa/settingsHub.ts`），两端不各写一份。
//   ② 窄屏下拉的壳 `.m-pickselect`（M-05 帧 B：壳 + 裸原生 `<select>` + chevron），
//      而不是静态盒的 `.m-select` —— 手机上自绘下拉等于改行为。
// 两条都只改类名与嵌套，行为零变化；这里钉住的是「下一次换皮不会把它们退回旧形态」。

const panelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const hubSource = await readFile(new URL("./pwa/settingsHub.ts", import.meta.url), "utf8");
const uiSource = await readFile(new URL("./SettingsUi.tsx", import.meta.url), "utf8");

test("桌面左导航带四段分组标题，且段表就是手机 hub 的那张表", () => {
  // 段名是 `.d-set-navsep`（画板 D-07 左导航），不是自造的类。
  assert.match(panelSource, /<div className="d-set-navsep" key=\{entry\.key\}>\{entry\.label\}<\/div>/);
  // 分组来源只有一处：`SETTINGS_HUB_GROUPS`（= 手机 hub 的四张卡）。
  assert.match(panelSource, /const navEntries = SETTINGS_HUB_GROUPS\.flatMap\(/);
  assert.match(panelSource, /settingsHubGroupLabel\(group\.id, locale\)/);
  // 段表与分组表读同一个本地文案函数，不另抄一份三语表。
  assert.match(hubSource, /export function settingsHubGroupLabel\(groupId: string, locale: string\)/);
  assert.match(hubSource, /const GROUP_LABELS: Record<string, HubCopy>/);
});

test("四段分组名三语齐全（缺键回落 en，而不是留空）", async () => {
  const jiti = await import("jiti").then((m) => m.createJiti(import.meta.url, { tsconfigPaths: true }));
  const { settingsHubGroupLabel, SETTINGS_HUB_GROUPS } = await jiti.import("./pwa/settingsHub.ts");
  assert.deepEqual(
    SETTINGS_HUB_GROUPS.map((group) => group.id),
    ["base", "capability", "runtime", "data"],
    "画板 D-07 的四段顺序不能变",
  );
  for (const locale of ["zh-CN", "zh-TW", "en"]) {
    for (const group of SETTINGS_HUB_GROUPS) {
      const label = settingsHubGroupLabel(group.id, locale);
      assert.ok(label && label !== group.id, `${group.id} 在 ${locale} 缺文案`);
    }
  }
  assert.equal(settingsHubGroupLabel("base", "zh-CN"), "基础");
  assert.equal(settingsHubGroupLabel("data", "zh-CN"), "数据与连接");
  // 未知段回落成传入的 key（与本文件 hubCopy 的既有口径一致），不返回 undefined。
  assert.equal(settingsHubGroupLabel("nope", "zh-CN"), "nope");
});

test("不在四张卡里的分节接在末尾，不静默消失", () => {
  assert.match(panelSource, /const navOrphans = sections\.filter\(/);
  assert.match(panelSource, /\{navOrphans\.map\(renderNavItem\)\}/);
});

test("窄屏下拉走 .m-pickselect 壳（原生 select + chevron），桌面仍是 .d-select", () => {
  // M-05 帧 B 的原生下拉三件：壳 → 裸 <select> → 右侧 chevron。
  assert.match(uiSource, /<label className="m-pickselect m-grow">/);
  assert.match(uiSource, /<i data-ico="chevron-down" data-size="15" aria-hidden="true" \/>/);
  // 壳里那个必须是原生 select（不是自绘面板），行为因此零变化。
  const shell = uiSource.slice(
    uiSource.indexOf('<label className="m-pickselect m-grow">'),
    uiSource.indexOf("</label>", uiSource.indexOf('<label className="m-pickselect m-grow">')),
  );
  assert.match(shell, /<select\b/);
  assert.doesNotMatch(shell, /<option[^>]*>\s*<i /, "选项不能变成自绘结构");
  // 桌面那一支保持原样：同一个 `<select>` 挂 `.d-select`。
  assert.match(uiSource, /<select className="d-select" value=\{value\}/);
  // 窄屏不再发 `.m-select`（那是静态盒的类，画板把它留给自绘面板）。
  assert.doesNotMatch(uiSource, /isMobile \? "m-select"/);
});