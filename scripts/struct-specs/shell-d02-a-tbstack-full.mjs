// D-02 帧 A · 顶栏身份块「标题 + 运行中芯片 + 分支芯片 / 副行」那一档。
// **需要有运行中的会话 + 一个 worktree**，本地默认会话没有，所以这一格平时报
// MISSING（板上有、产品当前状态下没触发）而不是结构错。有种子数据时重跑。
export default {
  name: "D-02 帧A 顶栏身份块（含运行中/分支芯片）",
  board: "v5/web/boards/D-02-sidebar-topbar.html",
  frame: 0,
  boardRoot: "section:nth-of-type(1) .d-tb-stack",
  app: { script: `
    // dev 服务下首屏会自行跳一次 ?session=…（还会触发一次整页重载），
    // 所以先等地址稳定，再动手点。
    const settle = async (quiet = 2500, max = 40000) => {
      const t0 = Date.now();
      let last = location.href, since = Date.now();
      while (Date.now() - t0 < max) {
        await new Promise((r) => setTimeout(r, 400));
        if (location.href !== last) { last = location.href; since = Date.now(); }
        else if (document.readyState === "complete" && Date.now() - since > quiet) return;
      }
    };
    await settle();
    const wait = async (sel, ms = 25000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const el = document.querySelector(sel);
        if (el) return el;
        await new Promise((r) => setTimeout(r, 250));
      }
      return null;
    };
    await wait(".d-side");
  ` },
  appRoot: ".d-topbar > .d-tb-stack",
  maxRows: 30,
};
