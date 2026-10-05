// D-02c 帧 B · 菜单行原子（图标槽 + 文字 d-grow）
export default {
  name: "D-02c 帧B 菜单行",
  board: "v5/web/boards/D-02c-menus-atlas.html",
  frame: 1,
  boardRoot: "[data-demo-pop=\"menu-b1\"] > .d-menu-row:nth-of-type(1)",
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

    await wait(".d-topbar");
    const btns = await waitAll('.d-topbar button.d-iconbtn i[data-ico="ellipsis"]');
    btns[0]?.closest("button")?.click();
    await wait(".d-pop-float.context-menu");
  ` },
  appRoot: ".d-pop-float.context-menu .d-menu-row",
  maxRows: 20,
};
