/* M-05 帧 C · 通用 › 权限与信任 —— 板面 `.m-perm` 信任卡 + 三档 `.m-pickbar`。 */
export default {
  name: "M-05 帧 C · 权限与信任",
  board: "v5/pwa/boards/M-05-settings.html",
  frame: 2,
  boardRoot: ".m-scene:nth-of-type(3) .m-settings",
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
      tap(await wait(() => document.querySelector('.m-setrow[data-section="general"]')));
      await new Promise((r) => setTimeout(r, 900));
    `,
  },
  appRoot: ".m-settings",
  ignore: ["m-grow"],
  maxRows: 40,
};
