// D-07b 帧 A · 壁纸块里的「areas」一段（整块那份 spec 里它被「当前壁纸」那一行的取样
// 状态顶偏了，所以单独对一次）。
export default {
  name: "D-07b 帧 A · 壁纸块 · areas",
  board: "v5/web/boards/D-07b-settings-general-detail.html",
  frame: 0,
  boardRoot: "section.d-scene:nth-of-type(1) .d-set-sec:nth-of-type(1) > div.d-field:has(> .d-grid3)",
  app: {
    script: `
      const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('[data-ico="settings"]'));
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 900));
      const nav = document.querySelector('.d-set-navitem[data-section="general"]');
      if (nav) nav.click();
      await new Promise(r => setTimeout(r, 500));
      const sw = [...document.querySelectorAll('.d-switch')].find(s => (s.getAttribute('aria-label')||'').includes('壁纸'));
      if (sw && sw.getAttribute('aria-checked') === 'false') sw.click();
      await new Promise(r => setTimeout(r, 400));
      // 把三个面的档位点成板面那一帧的样子（消息区=半透明 / 侧栏面板=不透明 / 输入框=毛玻璃）——
      // 芯片是真按钮，走产品自己的交互，不在页面里改类名。
      const cols = [...document.querySelectorAll('.d-set-inner > div:first-child > .d-set-sec:nth-of-type(3) .d-grid3 > .d-col')];
      [[1], [0], [2]].forEach((picks, i) => {
        const col = cols[i];
        if (!col) return;
        const cat = col.querySelectorAll('.d-cat')[picks[0]];
        if (cat && !cat.classList.contains('is-on')) cat.click();
      });
      await new Promise(r => setTimeout(r, 300));
    `,
  },
  appRoot: '.settings-section-host[data-section="general"] .d-set-inner > div:first-child > .d-set-sec:nth-of-type(3) > div.d-field:has(> .d-grid3)',
  ignore: ["d-grow", "m-grow", "grow"],
  maxRows: 20,
};
