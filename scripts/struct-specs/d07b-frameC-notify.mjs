// D-07b 帧 C · 「桌面通知」块（板面画的是总开关**开**的那一段：`nt-on` pane；`nt-off`
// 那段是同一批行的禁用态）↔ 产品通用分节里的同一块。
export default {
  name: "D-07b 帧 C · 桌面通知块（总开关开）",
  board: "v5/web/boards/D-07b-settings-general-detail.html",
  frame: 2,
  boardRoot: "section.d-scene:nth-of-type(3) .d-set-inner > .d-set-sec:nth-of-type(1)",
  app: {
    script: `
      const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('[data-ico="settings"]'));
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 900));
      const nav = document.querySelector('.d-set-navitem[data-section="general"]');
      if (nav) nav.click();
      await new Promise(r => setTimeout(r, 500));
      const sec = [...document.querySelectorAll('.d-set-inner > div > .d-set-sec')]
        .find(el => (el.textContent || '').includes('桌面通知'));
      if (!sec) throw new Error('notification block not found');
      window.__notifySec = sec;
      // 板面那一段是「总开关 开」：产品默认就是开，若不是就点开。
      const sw = [...sec.querySelectorAll('.d-switch')].find(s => (s.getAttribute('aria-label')||'').includes('桌面通知'));
      if (sw && sw.getAttribute('aria-checked') === 'false') sw.click();
      await new Promise(r => setTimeout(r, 400));
    `,
  },
  appRoot: '.settings-section-host[data-section="general"] .d-set-inner > div:nth-child(2) > .d-set-sec:nth-of-type(2)',
  ignore: ["d-grow", "m-grow", "grow"],
  maxRows: 40,
};