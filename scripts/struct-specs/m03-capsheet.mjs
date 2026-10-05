// M-03 帧 A · 能力面板（`.m-sheet.is-open`：grab / title / body / 五行 / foot）
//
// ⚠ 这一帧的**行数是数据驱动的**（每行都有自己的数据源），所以它只在「模型已加载 +
// 会话统计已到位」时收敛：
//   模型行 ← modelOptions/model/modelError；思考 ← onThinkingLevelChange；
//   权限 ← onPermissionModeChange；工具 ← !isStreaming && onToolPresetChange；
//   上下文 ← contextUsage || sessionStats（板上那枚 `.m-ring` 在**行首**）。
// 没有会话的新会话首页上只有 3 行 —— 那是数据缺失，不是结构缺失。
// 板 35 / 产品 35 · 偏差 0 = 已收敛（knownDiff 那条是权限档图标随档位变）。
// 板侧原文要点：`.m-group-title` 一行 + 五个 `.m-sheet-row`（副行是 `.m-setrow-s`）
// + 末尾 `.m-sheet-foot`；上下文那一行的 `.m-ring` 在**行首**。
export default {
  name: "M-03 帧A · 能力面板",
  board: "v5/pwa/boards/M-03-composer-sheet.html",
  frame: 0,
  boardRoot: ".m-sheet.is-open",
  viewport: { width: 390, height: 844 },
  app: {
    script: `
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 40 && !document.querySelector(".m-composer-row .m-cap-btn"); i++) await sleep(250);
      // 页面上可能同时存在多枚 .m-cap-btn（跟随回合的第二个输入卡等），逐个试到面板开为止。
      await sleep(1500); // 元素出现 ≠ React 已挂上事件：等水合落定再点，否则点了没反应。
      // 每轮重新查一次：会话恢复期间 composer 会重渲染，缓存下来的旧节点点了是空的。
      for (let attempt = 0; attempt < 6; attempt++) {
        if (document.querySelector(".m-sheet.is-open")) break;
        const cap = document.querySelector(".m-composer-row .m-cap-btn");
        if (!cap) { await sleep(400); continue; }
        cap.click();
        for (let i = 0; i < 10 && !document.querySelector(".m-sheet.is-open"); i++) await sleep(250);
      }
      // 等「上下文占用」那一行（m-ring）真的到位，否则面板会随会话统计到达与否少一行。
      for (let i = 0; i < 40 && !document.querySelector(".m-sheet.is-open .m-ring"); i++) {
        await new Promise(r => setTimeout(r, 250));
      }
    `,
  },
  appRoot: ".m-sheet.is-open",
  // 模型行的图标：板上是 <i data-ico="cpu">，产品是供应商字形（ModelIcon，真数据）。
  // 图标名按板抄会丢掉真实供应商信息，故 boardSkip 掉这一枚，比结构。
  boardSkip: ['[data-ico="cpu"]'],
  // 权限行的图标跟着权限档走（bypass=shield / ask=shield-check / plan=book-marked）——
  // 板上那一帧是「需审批」档，产品当前会话是 bypass 档，属数据差异不是结构差异。
  knownDiffs: ["/2/3/0"],
  ignore: ["d-grow", "m-grow"],
  maxRows: 40,
};