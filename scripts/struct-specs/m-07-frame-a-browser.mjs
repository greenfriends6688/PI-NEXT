/* M-07 帧 A · 浏览器常态 —— 地址栏 + 页面 + 设备视口五档 + 缩放条 + 底部动作行。 */
export default {
  name: "M-07 帧 A · 浏览器",
  board: "v5/pwa/boards/M-07-browser-cc.html",
  frame: 0,
  boardRoot: ".m-scene:nth-of-type(1) .m-phone-inner",
  viewport: { width: 390, height: 844 },
  app: {
    script: `
      // 先等 React 水合完成：太早抓到的节点会被换掉，点了也是死节点。
      await new Promise((r) => setTimeout(r, 3000));
      const wait = async (fn, ms = 10000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          const el = fn();
          if (el) return el;
          await new Promise((r) => setTimeout(r, 150));
        }
        return null;
      };
      const tap = (el) => el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      tap(await wait(() => document.querySelector(".m-drawer-foot .m-row")));
      await new Promise((r) => setTimeout(r, 600));
      tap(await wait(() => [...document.querySelectorAll("button")].find((b) => /browser|浏览/i.test(b.getAttribute("title") || b.textContent || ""))));
      await new Promise((r) => setTimeout(r, 1500));
    `,
  },
  appRoot: ".browser-panel, [data-browser-panel]",
  ignore: ["m-grow"],
  maxRows: 40,
};
