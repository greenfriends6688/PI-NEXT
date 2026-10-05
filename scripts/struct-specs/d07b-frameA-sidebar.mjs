// D-07b 帧 A · 「侧边栏」块 ↔ 产品通用分节里的同一块（两行 + 块尾一条横幅）。
export default {
  name: "D-07b 帧 A · 侧边栏块",
  board: "v5/web/boards/D-07b-settings-general-detail.html",
  frame: 0,
  boardRoot: "section.d-scene:nth-of-type(1) .d-set-inner > .d-set-sec:nth-of-type(2)",
  app: {
    script: `
      const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('[data-ico="settings"]'));
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 900));
      const nav = document.querySelector('.d-set-navitem[data-section="general"]');
      if (nav) nav.click();
      await new Promise(r => setTimeout(r, 500));
    `,
  },
  appRoot: '.settings-section-host[data-section="general"] .d-set-inner > div:first-child > .d-set-sec:nth-of-type(4)',
  ignore: ["d-grow", "m-grow", "grow"],
  maxRows: 30,
};