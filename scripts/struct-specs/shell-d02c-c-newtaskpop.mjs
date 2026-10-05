// D-02c 帧 C · 新建任务选择器（输入框上方工作区芯片点开的那一份浮窗）
export default {
  name: "D-02c 帧C 新建任务选择器",
  board: "v5/web/boards/D-02c-menus-atlas.html",
  frame: 2,
  boardRoot: "[data-demo-pop=\"newtask-c\"]",
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

    (await wait(".d-side-nav .d-row"))?.click();
    await wait(".d-ctxbar .d-chipbtn");
    await new Promise(r => setTimeout(r, 600));
    document.querySelector(".d-ctxbar .d-chipbtn")?.click();
    await wait(".d-pop-float.context-menu");
  ` },
  appRoot: ".d-pop-float.context-menu",
  maxRows: 40,
};
