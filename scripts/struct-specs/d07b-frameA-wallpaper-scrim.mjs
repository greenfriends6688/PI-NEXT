// D-07b 帧 A · 壁纸块里的「scrim」一段（整块那份 spec 里它被「当前壁纸」那一行的取样
// 状态顶偏了，所以单独对一次）。
export default {
  name: "D-07b 帧 A · 壁纸块 · scrim",
  board: "v5/web/boards/D-07b-settings-general-detail.html",
  frame: 0,
  boardRoot: "section.d-scene:nth-of-type(1) .d-set-sec:nth-of-type(1) > div.d-set-row:has(input.d-slider)",
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
    `,
  },
  appRoot: '.settings-section-host[data-section="general"] .d-set-inner > div:first-child > .d-set-sec:nth-of-type(3) > div.d-set-row:has(#settings-wallpaper-scrim)',
  ignore: ["d-grow", "m-grow", "grow"],
  maxRows: 20,
};
