// D-07b 帧 B · 「聊天」块（11 行 + 界面密度的三段说明 + 发送键的两段说明）↔ 产品
// 通用分节里的同一块。
export default {
  name: "D-07b 帧 B · 聊天块",
  board: "v5/web/boards/D-07b-settings-general-detail.html",
  frame: 1,
  boardRoot: "section.d-scene:nth-of-type(2) .d-set-inner > .d-set-sec",
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
  appRoot: '.settings-section-host[data-section="general"] .d-set-inner > div:nth-child(2) > .d-set-sec:nth-of-type(1)',
  ignore: ["d-grow", "m-grow", "grow"],
  maxRows: 40,
};