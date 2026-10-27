// 20 顶栏右簇：板 web-running 帧 A 的 `.chrome__right` ↔ 产品同名块。
//
// 为什么不比整条 `.chrome`：产品第一颗是「收起侧栏」（画板第一颗是「新建会话」），
// 少一颗「权限」，于是从第 2 个节点起整段错位，比出来的 55 条里大半是位移噪音。
// 按 V5 的口径，spec 比的是**一个组件**：右簇是真正缺东西的地方
// （板是两组 `.ccap`，产品只有一组）。
export default {
  name: "20 顶栏右簇",
  board: "boards/web-running.html",
  boardRoot: '[data-v5="D-02-sidebar-topbar/A"] .chrome__right',
  appUrl: "http://127.0.0.1:30141/",
  appRoot: ".chrome__right",
  settleMs: 2500,
  viewport: { width: 1440, height: 900 },
  ignore: ["chev", "ic-sm"],
  // 实测结论（2026-10-25）：右簇的**壳**已经对了（`.ccap` + `.cbtn` + sprite 图标），
  // 剩下的偏差全是「按钮的语义不同」——产品这颗是完整历史 / 生成标题 / 子代理 / 分支 / 系统提示，
  // 画板帧 A 画的是 open-in / play / folder + 终端 / 变更。
  // 按主人的口径：不删产品更强的部分，也不给画板上的按钮硬塞假功能。
  // 所以这一组记为「内容差异」，结构差异为 0。
  knownDiffs: [
    { kind: "ICON", why: "按钮语义不同：产品是历史/命名/子代理/分支/系统提示，画板是 open-in/play/folder/终端/变更" },
    { kind: "EXTRA", why: "产品比画板多 3–4 颗钮（对应上面这些能力）" },
    { kind: "MISSING", why: "画板的 open-in / play / folder 三颗产品放在文件面板与工具栏里，不重复挂在顶栏" },
  ],
};
