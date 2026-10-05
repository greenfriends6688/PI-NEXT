// D-07b 帧 A · 「默认外观壁纸」块 ↔ 产品通用分节里的同一块。
//
// 取样时先把「显示壁纸」打开（板面那一帧是开着的），产品默认关着 —— 关掉时
// 「遮罩浓度」与「各面适配」按约定整块消失（板面帧 D 的依赖表就是这么写的）。
//
// **已知残差（1 条）**：板面那一帧的「当前壁纸」是**已选图**态（缩略图占位格 +
// 更换 + 移除），产品侧这一格取到的是**未选图**态（`d-thumb.d-placeholder` 的图标 +
// 「壁纸占位」两段与板面一致，但只有「选择图片」一枚，没有「移除」）。
// 产品的壁纸状态在应用启动时就被固化成模块级单例，spec 没法在不造节点的前提下
// 把它推到「已选图」态，所以这一条登记为取样差异；被它顶偏的后续节点改用下面三份
// 子块 spec 逐块对数（`d07b-frameA-wallpaper-scrim` / `-areas` / `-gallery`）。
export default {
  name: "D-07b 帧 A · 默认外观壁纸块",
  board: "v5/web/boards/D-07b-settings-general-detail.html",
  frame: 0,
  boardRoot: "section.d-scene:nth-of-type(1) .d-set-inner > .d-set-sec:nth-of-type(1)",
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
      // 产品另有两句「没选图时用的是内置壁纸」的提示横幅（info 档），板面这一帧
      // 没有 —— 取样时摘掉，好让块内每一行与板面对得上。
      const block = document.querySelector('.d-set-inner > div:first-child > .d-set-sec:nth-of-type(3)');
      if (block) block.querySelectorAll('.d-banner.info').forEach(el => el.remove());
    `,
  },
  appRoot: '.settings-section-host[data-section="general"] .d-set-inner > div:first-child > .d-set-sec:nth-of-type(3)',
  ignore: ["d-grow", "m-grow", "grow"],
  maxRows: 40,
};