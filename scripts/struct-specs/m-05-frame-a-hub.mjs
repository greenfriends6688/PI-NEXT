/* M-05 帧 A · 设置 hub —— 板面 `.m-settings` 对产品窄屏 hub。
 * 不选会话（cwd 为空），与画板帧 A 同一状态：技能/子代理/插件三行带「需项目」徽章。 */
export default {
  name: "M-05 帧 A · 设置 hub",
  board: "v5/pwa/boards/M-05-settings.html",
  frame: 0,
  boardRoot: ".m-settings",
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
    `,
  },
  appRoot: ".m-settings",
  ignore: ["m-grow"],
  maxRows: 60,
};