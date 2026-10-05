// D-02 帧 A · 项目分组行（折叠箭头 + 名称 + 计数 + ⋯ + ⊕）
export default {
  name: "D-02 帧A 项目行",
  board: "v5/web/boards/D-02-sidebar-topbar.html",
  frame: 0,
  boardRoot: "section:nth-of-type(1) .d-side-scroll > div > .d-group-title:nth-of-type(2)",
  app: { script: `
    const wait = async (sel, ms = 25000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const el = document.querySelector(sel);
        if (el) return el;
        await new Promise((r) => setTimeout(r, 250));
      }
      return null;
    };
    const waitAll = async (sel, ms = 25000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const els = [...document.querySelectorAll(sel)];
        if (els.length) return els;
        await new Promise((r) => setTimeout(r, 250));
      }
      return [];
    };

    await wait(".d-side-scroll .d-group-title");
  ` },
  appRoot: ".d-side-scroll .d-group-title:has([data-project-actions])",
  maxRows: 30,
};
