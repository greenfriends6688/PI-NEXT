/* M-05 帧 B · 滑杆 —— `input.m-slider`（拇指 26）+ 它所在的卡内表单行。 */
export default {
  name: "M-05 帧 B · 外观与输入 · 滑杆行",
  board: "v5/pwa/boards/M-05-settings.html",
  frame: 1,
  boardRoot: ".m-scene:nth-of-type(2) .m-settings input.m-slider",
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
  appRoot: ".m-settings input.m-slider",
  ignore: ["m-grow"],
  maxRows: 30,
};
