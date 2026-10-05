// D-02b 帧 A · 系统提示词只读浮窗（⋯ → 系统提示词）
export default {
  name: "D-02b 帧A 系统提示词浮窗",
  board: "v5/web/boards/D-02b-topbar-popovers.html",
  frame: 0,
  boardRoot: "[data-demo-pop=\"sys-a\"]",
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
    const row = [...document.querySelectorAll(".d-pop-float.context-menu .d-menu-row")]
      .find((r) => /系统提示/.test(r.textContent || ""));
    row?.click();
    await new Promise(r => setTimeout(r, 1800));
  ` },
  appRoot: ".d-pop-float:not(.context-menu)",
  maxRows: 60,
};
