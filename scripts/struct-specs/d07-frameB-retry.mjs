// D-07 帧 B · 「容错与重试」块 ↔ 产品通用分节里的同一块。
export default {
  name: "D-07 帧 B · 容错与重试块",
  board: "v5/web/boards/D-07-settings-general.html",
  frame: 1,
  boardRoot: "section.d-scene:nth-of-type(2) .d-set-inner > .d-set-sec:nth-of-type(2)",
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
  appRoot: '.settings-section-host[data-section="general"] .d-set-inner > div:nth-child(2) > .d-set-sec:nth-of-type(4)',
  ignore: ["d-grow", "m-grow", "grow"],
  maxRows: 40,
};