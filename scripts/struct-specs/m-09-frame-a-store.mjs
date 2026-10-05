/* M-09 帧 A · 商店 —— 分类 chip 横滚（`.m-cats` / `.m-cat` 互斥）。产品对应的
 * 「连接目录」在 MCP 目录面板（McpCatalog）里，是这一段唯一的窄屏落点。 */
export default {
  name: "M-09 帧 A · 商店 · 分类条",
  board: "v5/pwa/boards/M-09-store-cron-usage.html",
  frame: 0,
  boardRoot: ".m-scene:nth-of-type(1) .m-cats",
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
      // 选会话会触发一次 router.replace（换 pathname）；把 history 写空掉，
      // 否则执行上下文被销毁，后半段脚本全丢。
      history.pushState = () => {};
      history.replaceState = () => {};
      // 商店（连接目录）要求有项目（目录入口 disabled={!cwd}），先把项目打开。
      tap(await wait(() => [...document.querySelectorAll(".m-drawer-body *")].find((e) => e.children.length === 0 && (e.textContent || "").trim() === "PI NEXT")));
      await new Promise((r) => setTimeout(r, 900));
      tap(await wait(() => document.querySelector(".m-drawer-body .fork-row-enter")));
      await new Promise((r) => setTimeout(r, 2500));
      tap(await wait(() => document.querySelector(".m-drawer-foot .m-row")));
      await new Promise((r) => setTimeout(r, 600));
      tap(await wait(() => document.querySelector('.m-setrow[data-section="mcp"]')));
      await new Promise((r) => setTimeout(r, 900));
      tap(await wait(() => [...document.querySelectorAll("button")].find((b) => /\u76ee\u5f55|\u8fde\u63a5\u76ee\u5f55|catalog/i.test(b.textContent || ""))));
      await new Promise((r) => setTimeout(r, 3500));
    `,
  },
  appRoot: ".m-cats",
  ignore: ["m-grow"],
  maxRows: 40,
};
