// D-02d 帧 D · 会话动作菜单（⋯ 唯一入口，12 行 / 3 段分隔 / 标题 / 脚注）
export default {
  name: "D-02d 帧D 会话动作菜单",
  board: "v5/web/boards/D-02d-sidebar-detail.html",
  frame: 3,
  boardRoot: "[data-demo-pop=\"sess-d\"]",
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
  appRoot: ".d-pop-float.context-menu",
  maxRows: 80,
};
