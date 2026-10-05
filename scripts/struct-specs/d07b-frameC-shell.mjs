// D-07b 帧 C · 「Shell 工具」块 ↔ 产品通用分节里的同一块。
//
// **这条只在 Windows 上成立**：板面帧 D 的依赖表写死了判据「非 Windows → 整块不渲染
// （不是灰掉的一行）」，产品也是照这一条实现的（`shellSettings.isWindows` 才挂这一块）。
// 本机是 macOS，所以取样时产品侧**必然找不到**这个块 —— 那正是板面要的行为，不是偏差。
// 要在 Windows 上复核这条，需要把 APP_URL 指到一台 Windows 机器。
export default {
  name: "D-07b 帧 C · Shell 工具块（平台条件：仅 Windows 渲染）",
  board: "v5/web/boards/D-07b-settings-general-detail.html",
  frame: 2,
  boardRoot: "section.d-scene:nth-of-type(3) .d-set-inner > .d-set-sec:nth-of-type(2)",
  app: {
    script: `
      const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('[data-ico="settings"]'));
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 900));
      const nav = document.querySelector('.d-set-navitem[data-section="general"]');
      if (nav) nav.click();
      await new Promise(r => setTimeout(r, 600));
    `,
  },
  appRoot: '.settings-section-host[data-section="general"] .d-set-inner > div:nth-child(2) > .d-set-sec:nth-of-type(3)',
  ignore: ["d-grow", "m-grow", "grow"],
  maxRows: 20,
};