// D-02c 帧 C · 标签页总览浮层
export default {
  name: "D-02c 帧C 标签总览",
  board: "v5/web/boards/D-02c-menus-atlas.html",
  frame: 2,
  boardRoot: "[data-demo-pop=\"tabs-c\"]",
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
    document.querySelector(".fork-tab-overview")?.click();
    await new Promise(r => setTimeout(r, 700));
    await wait(".d-pop-float, .d-rail, .d-searchfield", 8000);
  ` },
  appRoot: ".d-pop-float",
  maxRows: 60,
};
