/* M-05 帧 B · 通用 › 外观与输入 —— 板面「主题三档」那张卡对产品通用分节里的主题档位。
 * 只比这一张卡：通用分节在产品里还有皮肤 / 壁纸 / 侧栏 / 字体 / 聊天 / 通知 /
 * 推送等十几块，画板帧 B 只是「这一节长什么样」的样例，整页对数没有意义。 */
export default {
  name: "M-05 帧 B · 外观与输入 · 主题三档",
  board: "v5/pwa/boards/M-05-settings.html",
  frame: 1,
  boardRoot: ".m-scene:nth-of-type(2) .m-settings > div:nth-of-type(2) > .m-pickbar",
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
  appRoot: ".m-settings .m-pickbar",
  ignore: ["m-grow"],
  maxRows: 30,
};
