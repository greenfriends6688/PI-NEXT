#!/usr/bin/env node
/**
 * fork:fastvibe-stack (H6) —— 旧画板命令的停用桩。
 *
 * ## 为什么有这个文件
 *
 * 用户 2026-10-13 裁定：「V5/V6 画板体系与门禁整套拆掉，验收完全换成 FastVibe 对照」，
 * 并在同一轮定了迁移节奏：**先共存、最后统一清**（L10 才删文件）。
 *
 * 于是从 H6 起：`design:v5*` / `design:v6*` / `verify:boards*` 这些命令**不能继续
 * 当验收用**（它们量的是旧真值），但文件还在、旧类名还在被产品引用，所以也不能
 * 直接删脚本 —— 指向这个桩，把「已停用」说清楚。
 *
 * ## 为什么退出码是 0
 *
 * 计划原文：「旧画板命令报『已停用』而不是报错」。如果一个流水线里还挂着
 * `npm run design:v5`，它会看到一行明确的说明而不是一个失败 —— 失败会让人以为
 * 是环境坏了，去查一圈才发现是命令本身退役了。
 *
 * ## L10 之后
 *
 * 全站迁完、旧 CSS 与 design/ 目录删除时，这些 script 条目与这个桩一起删。
 */

const PURPOSE = {
  "design:v5": "V5 画板静态门禁（未定义令牌 / 未定义类 / 前缀混用 / 图标名 / emoji）",
  "design:v5:land": "V5 落地清单（画板类名在产品里的覆盖率）",
  "design:v5:batch": "V5 落地清单（按批次）",
  "design:v5:shots": "V5 画板逐张出图 + 交互件点击",
  "design:v5:all": "V5 静态门禁 + 落地清单",
  "design:v6": "V6 毛玻璃画板静态门禁",
  "design:v6:land": "V6 落地清单",
  "design:v6:batch": "V6 落地清单（按批次）",
  "design:v6:shots": "V6 画板逐张出图",
  "design:v6:all": "V6 静态门禁 + 落地清单",
  "verify:boards": "产品与画板的几何对位",
  "verify:boards:seeded": "同上（用临时 agent 目录造出有消息的会话）",
};

const invoked = process.argv[2] ?? "design:v5";
const purpose = PURPOSE[invoked] ?? "画板相关验收";

console.log(`○ \`npm run ${invoked}\` 已停用 —— ${purpose}。`);
console.log("");
console.log("  原因：用户 2026-10-13 裁定视觉真值从「本仓 V5/V6 画板」换成");
console.log("        「FastVibe 原实现」，画板不再是验收依据（计划第三版 · 批次 H6）。");
console.log("");
console.log("  现在怎么验收：");
console.log("    · 规格     打开 fastvibe-main 对应源文件，DOM / 类名 / 间距照它写");
console.log("    · 截图     npm run fastvibe:shots（本仓各视图的标准视图截图）");
console.log("    · 结构守卫 npm test（仍钉产品 DOM 结构的那些 .test.mjs）");
console.log("    · 通用门禁 npm run check:design");
console.log("");
console.log("  文件仍在（design/v5、design/v6）—— 按「先共存、最后统一清」的裁定，");
console.log("  等 L 批次全部迁完后由 L10 删除，届时本命令一并移除。");
