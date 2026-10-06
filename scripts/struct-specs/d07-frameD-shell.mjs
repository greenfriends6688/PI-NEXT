// D-07 帧 D · 设置壳（弹窗宿主）↔ 产品设置弹窗。
//
// 帧 D 的内容是**故意裁短**的演示（板面自己写明「内容与帧 A / B 同一份」，
// 只画了「外观」「模态里能改什么」两块），所以 app.script 把通用分节里
// 第三块往后摘掉，让两侧的宿主层（d-modal › d-modal-box › head/body/foot
// › d-set › nav/main）与同一批内容逐节点对数。
//
// 取样时还摘掉三样**只在桌面下不存在 / 已登记为 EXTRA** 的东西（都不改产品，
// 只是让宿主骨架能对数；理由逐条写在下面）：
//   ① `.settings-mobile-section-picker` —— 宽屏 display:none 的窄屏分节下拉，
//      板面三帧都没有；2026-10-03 裁定「窄屏不再用它」，CSS 与 DOM 按纪律待收尾波清。
//   ② `.settings-dialog-close`（右上角浮着的 X）—— 板面的关闭口是脚的「完成」+ Esc；
//      产品按 2026-10-03 用户裁定保留了这枚 X（SettingsPanel.test.mjs 也钉着它），
//      2026-10-06 用户又把脚的「完成」撤了（「没啥卵用」，见 DIVERGENCE P）——脚上
//      现在只剩左槽那句说明，所以本 spec 与板面在 foot 上有一处有意的 MISSING。
//      这是本 spec 唯一的真·EXTRA。
//   ③ `.settings-dialog-close-mobile` —— 与 ② 同一位置、同一尺寸的第二枚 X（页头里那枚）。
//   ④ 「描边深度」行与「主题皮肤库」块 —— 产品独有的两块（画板只在皮肤工作室的
//      「几何与不透明度」里有「边框强度」；皮肤在 D-07 帧 A/D 里是一张 `.d-setcard`
//      入口 + `.d-pop`，产品是一排 `.pw-skin-strip` 卡带）。帧 D 的演示块里没有它们；
//      摘掉才能让帧 D 的第二块（模态里能改什么）与产品对上。两者都是**已登记的 EXTRA /
//      表达差异**，等拍板（见报告）。
export default {
  name: "D-07 帧 D · 设置弹窗宿主（d-modal › d-modal-box › d-set）",
  board: "v5/web/boards/D-07-settings-general.html",
  frame: 3,
  boardRoot: "section.d-scene:nth-of-type(4) .d-modal",
  app: {
    script: `
      const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('[data-ico="settings"]'));
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 900));
      const nav = document.querySelector('.d-set-navitem[data-section="general"]');
      if (nav) nav.click();
      await new Promise(r => setTimeout(r, 500));
      const secs = [...document.querySelectorAll('.settings-section-host[data-section="general"] .d-set-inner > div > .d-set-sec')];
      secs.slice(2).forEach(el => el.remove());
      document.querySelectorAll('.settings-mobile-section-picker, .settings-dialog-close, .settings-dialog-close-mobile')
        .forEach(el => el.remove());
      const depthRow = document.querySelector('#settings-border-depth')
        && document.querySelector('#settings-border-depth').closest('.d-set-row');
      if (depthRow) depthRow.remove();
      document.querySelectorAll('.pw-skin-strip, .d-set-inner > div > .d-set-sec')
        .forEach(el => { if (el.querySelector('.pw-skin-strip')) el.remove(); });
    `,
  },
  appRoot: ".d-modal",
  ignore: ["d-grow", "m-grow", "grow"],
  maxRows: 40,
};