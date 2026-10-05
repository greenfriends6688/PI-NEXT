// D-02 帧 B · 折叠导轨
export default {
  name: "D-02 帧B 折叠导轨",
  board: "v5/web/boards/D-02-sidebar-topbar.html",
  frame: 1,
  boardRoot: ".d-rail",
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
    document.querySelector('.d-side-head [aria-controls="session-sidebar"]')?.click();
    await new Promise(r => setTimeout(r, 900));
  ` },
  appRoot: ".d-rail",
  maxRows: 30,
};
