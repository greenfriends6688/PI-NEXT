// SW-15 设置页新框架（画板 62）—— 用户裁定「按你的来」后落地的批次。
//
// 为什么补这一份：画板 62 定义了 12 个设置分节的统一骨架
// （页头 `.pw-shead` / 工具栏 `.pw-stools` / 唯一滚动的内容区 `.pw-scontent`
// / 两个宽度「列表 300 + 内容 760」），但**当时没有配 spec**，`verify:boards`
// 也没进 `check:design` —— 于是「画板画了、实现没跟上」只能靠人眼发现。
// 用户原话：「设计的好，但真正落地的时候就有差距了，就不按照规划的进行设计了」。
//
// 这一份把差距变成数字：同一个选择器在画板帧与产品页各取一次几何，逐项对数。
//
// 用法：node scripts/board-diff.mjs scripts/board-specs/62-settings-layout.mjs
export default {
  name: "设置新框架（画板 62 · 帧 B 列表页）",
  board: "62-settings-layout.html",
  // 帧 0 = 诊断，帧 1 = 新框架解剖（列表页形态），帧 2 = 两栏块流
  boardFrame: 1,
  app: { open: "settings:skills" },
  selectors: [
    ".pw-settings",
    ".pw-snav",
    ".pw-shead",
    ".pw-shead-copy > h2",
    ".pw-stools",
    ".pw-scontent",
    ".pw-cols",
    ".pw-list",
    ".pw-litem",
    ".pw-detail",
    ".pw-kv",
  ],
  tolerance: { box: 2, fontSize: 0 },
  knownDiffs: [
    {
      sel: ".pw-snav",
      reason: "画板帧只列了 12 个分节里的前 12 项（含「返回工作区」），产品导航同一份清单；"
        + "高度差来自滚动条与分组间距，属接线层",
    },
    {
      sel: ".pw-litem",
      reason: "列表行取的是第一行：画板第一行是项目作用域技能（带 SkillHub 徽章），"
        + "产品第一行是当前项目里的另一条，内容宽度不同",
    },
    {
      sel: ".pw-detail",
      reason: "详情卡高度按内容收口；画板画的是「SKILL.md 可编辑 + 磁盘冲突」那一态，"
        + "产品打开的是只读态，高度不同",
    },
  ],
};
