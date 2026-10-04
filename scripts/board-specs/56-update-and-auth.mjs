// 画板 56 更新与认证 —— 覆盖三帧里「当前环境能确定性打开」的原子。
//
// 和 31 同一套办法：不写 boardFrame，用 pairs 的双选择器精确指到某一个样张
// （`.pw-frame:nth-of-type(n) .pw-cell:nth-of-type(m) …`；n=1 插件更新五态、
// 2 列表项状态 / 技能更新指示 / 应用更新提示、3 agent 认证）。
//（下面的注释一律写「第一节 / 第二节 / 第三节」，对应 n=1/2/3。）
//
// 进目标状态：侧栏「设置」→ `button.pw-row[data-section="skills"]`。选技能页而不是
// 插件页，是因为**种子环境里装了技能但一个插件都没装**（`/api/plugins` 空）：
// 技能页的 `.pw-list / .pw-litem / .pw-litem.is-on / .pw-lname` 是有真数据的，
// 插件页只有一句 "No plugins configured" 的 `.pw-alert.info`。
//
// **不进 pairs 的原子（真漂移或结构缺口，不用 knownDiffs 掩盖；数字与证据见报告）**：
//   - `.pw-lsub`（第二节两个列表项的副标题行「全局 · 有新版本 / v1.4.0 · 6 个资源」）：
//     产品的技能行只有 `.pw-lname`，范围与版本被搬到了详情页的 `.pw-kv`。
//   - `.pw-litem > .pw-ico` 的 `box` 字形（第二节技能行首）：产品换成了 `ConfigStatusDot`
//     的状态点圆点（`.pw-dot`），不是图标。
//   - 第二节第三格「应用自身的更新提示」：产品有 `NewSessionUpdateLink`
//     （ChatWindow.tsx），但它只在 `/api/app-update` 返回 `updateAvailable: true` 时渲染；
//     实测线上 `{"currentVersion":"0.1.6","latestVersion":"0.1.6","updateAvailable":false}` ——
//     本机版本已经等于最新 release，只能放弃（要造出 true 只能改环境变量）。
//   - 第一节的 `.pw-inline`（更新行）/ `.pw-mono`（v0.9.2 → v0.9.3）：产品的更新信息不在
//     行内，而在详情页的 `.pw-kv` 版本行里；行内 `.pw-inline` 在产品里只有 12×29 的小图标用法。
//   - 第三节（agent 认证）：画板自己就写着「本段是设计提案」—— 产品没有 ACP agent 认证流程。
//     只有模型供应商登录（画板 41）。整帧放弃。

const F = (n) => `.pw-frame:nth-of-type(${n})`;
const CELL = (n, c) => `${F(n)} .pw-cell:nth-of-type(${c})`;

export default {
  name: "更新与认证（画板 56）",
  board: "56-update-and-auth.html",
  app: {
    settle: 1800,
    script: `
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const opener = document.querySelector("button.pw-side-foot");
    if (!opener) throw new Error("侧栏底部没有设置入口");
    opener.click();
    await sleep(1500);
    // 分节 id 与语言无关（fix:settings-section-target：按文案找会空转）。
    const row = document.querySelector('button.pw-row[data-section="skills"]');
    if (!row) throw new Error("设置面板里没有 skills 分节");
    row.click();
    await sleep(1800);`,
  },
  pairs: [
    // ---- 第一节：更新按钮的三枚变体原子（行内的版本号 / 徽章 / 文案见报告）----
    [CELL(1, 1) + " .pw-btn.outline.sm", ".pw-btn.outline.sm"],
    [CELL(1, 2) + " .pw-btn.primary.sm", ".pw-btn.primary.sm"],
    [CELL(1, 2) + " .pw-btn.sm", ".pw-btn.sm"],
    [CELL(1, 2) + " .pw-badge.accent", ".pw-badge.accent"],
    [CELL(1, 4) + " .pw-badge.bad", ".pw-badge.bad"],
    // ---- 第二节第二格：技能列表项（产品里唯一有真数据的列表）----
    // fork:v5-old-layer（2026-10-04）—— 技能列表已换画板 D-11 的 v5：SkillsConfig.tsx:66
    // 的 Stack 是 `.d-col`，列表项是 `.d-row`（:359），行内名字那格是 `.d-grow`。
    [CELL(2, 2) + " .pw-list", ".d-col"],
    [CELL(2, 2) + " .pw-litem", ".d-row"],
    [CELL(2, 2) + " .pw-litem.is-on", ".d-row.is-on"],
    [CELL(2, 2) + " .pw-litem.is-on .pw-lname", ".d-row.is-on .d-grow"],
    // 第二节第二格行尾那枚 ↑ 更新指示器：画板有，产品的渲染条件是「真的查到了新版本」。
    [CELL(2, 2) + " .pw-litem.is-on > .pw-ico:last-child", ".d-row.is-on > i[data-ico]:last-child"],
    // ---- 第二节第一格：插件列表项的四种标记 ----
    [CELL(2, 1) + " .pw-badge.ok", ".pw-badge.ok"],
    [CELL(2, 1) + " .pw-badge.warn", ".pw-badge.warn"],
  ],
  knownDiffs: [
    {
      sel: ".pw-badge.accent",
      reason: "**数据依赖**：「可更新」徽章要 `updateStatus.state === \"update-available\"`，"
        + "而当前一个插件都没装、`updateStatuses` 是空对象，徽章不渲染。装一个可更新的插件即出现。",
    },
    {
      sel: ".pw-badge.bad",
      reason: "**数据依赖**：同上，「检查失败」徽章要 `updateStatus.state === \"error\"`，"
        + "没有插件就没有检查，也就没有失败态。",
    },
    {
      sel: ".pw-badge.ok",
      reason: "**数据依赖**：第二节第一格是插件列表项的「已启用」徽章，插件页在种子环境里是空的"
        + "（`.pw-alert.info` = \"No plugins configured\"），列表与徽章都不存在。",
    },
    {
      sel: ".pw-badge.warn",
      reason: "**数据依赖**：同上，「可更新」列表项徽章需要真实插件 + 一次真实的更新检查。",
    },
    {
      sel: ".d-row.is-on > i[data-ico]:last-child",
      reason: "**数据依赖**：技能更新指示器（`.pw-ico` + `arrow-up`，title「有可用更新」）只在"
        + "`updateStatuses[key].state === \"update-available\"` 时渲染；种子技能没有 install "
        + "来源记录（`updateKey()` 返回 null），永远查不到更新。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};