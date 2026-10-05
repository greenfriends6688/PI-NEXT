// D-01 帧 A · 侧栏底栏（设置行 + 手机钮 + 版本徽章）
export default {
  name: "D-01 帧A 侧栏底栏",
  board: "v5/web/boards/D-01-workbench.html",
  boardRoot: ".d-side-foot",
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
  appRoot: ".d-side-foot",
  maxRows: 20,
};
