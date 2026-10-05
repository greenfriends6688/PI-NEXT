// D-07b 帧 C · 「后台推送（iOS 主屏应用）」块 ↔ 产品通用分节里的同一块。
export default {
  name: "D-07b 帧 C · 后台推送块",
  board: "v5/web/boards/D-07b-settings-general-detail.html",
  frame: 2,
  boardRoot: "section.d-scene:nth-of-type(3) .d-set-inner > .d-set-sec:nth-of-type(3)",
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
  // 注意：本工具的 `ignore` 只作用在**板侧**（app 侧那段 walk 没读 spec.ignore），
  // 所以只在一侧出现的类才放进来；`d-grow` 两边都有，忽略它反而会报「多 [d-grow]」。
  appRoot: '.settings-section-host[data-section="general"] .d-set-inner > div:nth-child(2) > .d-set-sec:nth-of-type(3)',
  maxRows: 30,
};