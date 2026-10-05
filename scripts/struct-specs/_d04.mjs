// D-04 各帧 spec 共用的小工具：把一段「等到某件东西出现再动手」的脚本给 app.script 用。
//
// 冷启动那条首页有时先渲染「选一个工作目录」的引导页、有时直接进输入卡（取决于上一次
// 会话能不能自动恢复），所以每个 spec 的第一步都是轮询到目标元素再点，否则
// struct-diff 会报「产品里找不到 …」。`retries` / `gap` 都是毫秒。
export const waitFor = (selector, { retries = 40, gap = 500 } = {}) => `
  for (let i = 0; i < ${retries}; i++) {
    if (document.querySelector(${JSON.stringify(selector)})) break;
    await new Promise((r) => setTimeout(r, ${gap}));
  }
`;