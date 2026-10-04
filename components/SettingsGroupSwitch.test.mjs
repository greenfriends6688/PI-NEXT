import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

// fork:group-switch（G4 · 上游 `eceac13` #1020 + `b9622a1` #1021）——
// 技能分节与插件分节的**整组开关**纯函数断言 + 接线形态断言。
// 边界重点：批量停用时带 resource filter 的包**不得**被停用（过滤器会被清空）。

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { skillsToSwitch, applySkillToggleResults } = await jiti.import("./SkillsConfig.tsx");
const { packagesToSwitch, filteredPackagesKeptOn } = await jiti.import("./PluginsConfig.tsx");

const skillsSource = await readFile(new URL("./SkillsConfig.tsx", import.meta.url), "utf8");
const pluginsSource = await readFile(new URL("./PluginsConfig.tsx", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

test("a skill group switch only writes the rows that would change", () => {
  const group = [
    { filePath: "/a/SKILL.md", disableModelInvocation: false },
    { filePath: "/b/SKILL.md", disableModelInvocation: true },
    { filePath: "/c/SKILL.md", disableModelInvocation: true },
  ];
  assert.deepEqual(skillsToSwitch(group, true).map((s) => s.filePath), ["/b/SKILL.md", "/c/SKILL.md"]);
  assert.deepEqual(skillsToSwitch(group, false).map((s) => s.filePath), ["/a/SKILL.md"]);
  // 已经是目标状态 → 一个都不发（开关点下去是空转）。
  const allOn = [{ filePath: "/a/SKILL.md", disableModelInvocation: false }];
  assert.deepEqual(skillsToSwitch(allOn, true), []);
});

test("a refused skill keeps its state while the rest of the group switches", () => {
  const before = [
    { filePath: "/a/SKILL.md", disableModelInvocation: false },
    { filePath: "/b/SKILL.md", disableModelInvocation: false },
  ];
  const after = applySkillToggleResults(
    before,
    [{ filePath: "/a/SKILL.md" }, { filePath: "/b/SKILL.md", error: "Access denied" }],
    true,
  );
  assert.deepEqual(after.map((s) => s.disableModelInvocation), [true, false]);
});

test("a package group switch disables every plain package in the scope", () => {
  const group = [
    { source: "npm:a", disabled: false, filtered: false },
    { source: "npm:b", disabled: true, filtered: false },
  ];
  assert.deepEqual(packagesToSwitch(group, false).map((p) => p.source), ["npm:a"]);
  assert.deepEqual(packagesToSwitch(group, true).map((p) => p.source), ["npm:b"]);
});

test("a filtered package is never disabled in bulk: disabling it drops its resource filters", () => {
  const group = [
    { source: "npm:plain", disabled: false, filtered: false },
    { source: "npm:filtered", disabled: false, filtered: true },
  ];
  assert.deepEqual(packagesToSwitch(group, false).map((p) => p.source), ["npm:plain"]);
  assert.deepEqual(filteredPackagesKeptOn(group).map((p) => p.source), ["npm:filtered"]);
  // 已经停用的带过滤包不在「保持启用」名单里（它没有过滤器可丢）。
  const off = [{ source: "npm:filtered", disabled: true, filtered: true }];
  assert.deepEqual(packagesToSwitch(off, false), []);
  assert.deepEqual(filteredPackagesKeptOn(off), []);
  // 重新启用时 keepOn 不适用：一个都不落下。
  assert.deepEqual(packagesToSwitch(group, true).map((p) => p.source), []);
});

test("both sections wire the switch into the group heading and report under it", () => {
  for (const source of [skillsSource, pluginsSource]) {
    // fork:v5-landing —— 技能页已按画板 D-11 改成本地 `GroupSwitch` / `GroupStatus`（直接发 `.d-switch`），
    // 插件页仍走共享基件；两者都算「分组标题里有整组开关 + 状态行」。
    assert.match(source, /<ConfigSidebarGroupSwitch|function GroupSwitch\(/);
    assert.match(source, /<ConfigSidebarGroupStatus|function GroupStatus\(/);
  }
  // 计数与「全开才算开」都交给共享基件，分节只传数。
  assert.match(skillsSource, /enabled=\{visibleCount\}/);
  assert.match(skillsSource, /total=\{grpSkills\.length\}/);
  assert.match(pluginsSource, /enabled=\{enabledCount\}/);
  // fork:bulk-routes（上游 `eceac13` #1020）—— 路由现在收批量，分组开关的串行循环
  // 换成**一次**请求：一次 PATCH 带全部 filePaths / 一次 POST 带全部 packages。
  // 只看两个分组开关函数体，别处的循环（「全部更新」等）不算。
  const skillGroup = skillsSource.slice(
    skillsSource.indexOf("const setGroupSkills"),
    skillsSource.indexOf("const selectedSkill"),
  );
  const pluginGroup = pluginsSource.slice(
    pluginsSource.indexOf("const setGroupPackages"),
    pluginsSource.indexOf("const installPlugin"),
  );
  assert.match(skillGroup, /JSON\.stringify\(\{ filePaths, disableModelInvocation \}\)/);
  assert.doesNotMatch(skillGroup, /for \(const skill of targets\)/);
  // 路由逐条作答：没拿到 results 时整组都算失败（列表一行不动），不是静默当成成功。
  assert.match(skillGroup, /Array\.isArray\(d\.results\)/);
  // 单条开关仍走单条形态（`filePath`），不能被批量改坏。
  assert.match(skillsSource, /filePath: skill\.filePath,\s*\n\s*disableModelInvocation: next,/);

  // 插件侧：批量路由接上了，同一次请求带全部 packages；逐包 results 兜底。
  assert.match(pluginGroup, /packages: targets\.map\(\(pkg\) => \(\{ source: pkg\.source, scope: pkg\.scope \}\)\)/);
  assert.doesNotMatch(pluginGroup, /for \(const pkg of targets\)/);
  assert.match(pluginGroup, /Array\.isArray\(next\.results\)/);
  // 单条开关仍走单条形态（`source` / `scope`），不能被批量守卫吃掉。
  assert.match(pluginsSource, /JSON\.stringify\(\{ action, source: pkg\.source, scope: pkg\.scope, cwd \}\)/);
});

test("group switch copy exists in all three locales", () => {
  for (const key of [
    "skills.groupSwitchShow",
    "skills.groupSwitchHide",
    "skills.groupFailed",
    "plugins.groupSwitchEnable",
    "plugins.groupSwitchDisable",
    "plugins.groupKeptFiltered",
    "plugins.groupFailed",
  ]) {
    assert.match(enSource, new RegExp(`"${key}":`), `${key} in en`);
    assert.match(zhSource, new RegExp(`"${key}":`), `${key} in zh-CN`);
    assert.match(skillsSource.includes(key.split(".")[0]) ? skillsSource : pluginsSource, new RegExp(key));
  }
});