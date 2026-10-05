// D-01 帧 A · 会话行（空闲态）：.d-sess > .d-sess-t + .d-sess-m
export default {
  name: "D-01 帧A 会话行",
  board: "v5/web/boards/D-01-workbench.html",
  boardRoot: ".d-sess",
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
    if (!document.querySelector(".d-side-scroll .d-sess")) {
      document.querySelector(".d-side-scroll .d-group-title")?.click();
    }
    await wait(".d-side-scroll .d-sess");
  ` },
  appRoot: ".d-side-scroll .d-sess",
  maxRows: 30,
};
