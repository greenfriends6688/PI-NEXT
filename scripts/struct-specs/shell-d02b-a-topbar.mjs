// D-02b 帧 A · 「顶栏动作全景」—— 这是 D-01 / D-02 / D-02b / D-02c / D-02d 里
// 动作最全的一条桌面顶栏：身份块 · 垫片 · 历史/命名/子代理/分支/导出/⋯ · 竖分隔 · MCP · 插件。
// （D-01 帧 A 是「未选项目」那一档，动作更少；D-02b 帧 A 才是可比齐的那一条。）
export default {
  name: "D-02b 帧A 顶栏动作全景",
  board: "v5/web/boards/D-02b-topbar-popovers.html",
  frame: 0,
  boardRoot: "section:nth-of-type(1) .d-topbar",
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
  appRoot: ".d-topbar",
  maxRows: 60,
};
