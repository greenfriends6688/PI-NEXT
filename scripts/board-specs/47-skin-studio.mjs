// SW-13 皮肤工作室外壳（2026-09-30 接 pw-modal 后补规格）
export default {
  name: "皮肤工作室外壳（画板 47 · 帧按实现）",
  board: "47-skin-studio.html",
  boardFrame: 1,
  // fork:fix-fake-green（2026-10-01）—— 两个修正：
  // 1) 驱动从 `settings:general` 改成**真正打开工作室**。原驱动下 probe 量到的是设置壳
  //    自己的 `.pw-modal`（settings.css）与被 display:none 的 `.pw-modal-head`，
  //    于是「工作室已经不是 .pw-modal 结构」那条 knownDiff 是**基于错误对象的结论**。
  // 2) 选择器加宿主限定：工作室的浮层是 `.pw-modal.fork-skin-modal`，而**设置壳也**有一个
  //    `.pw-modal-head`（它在 `.settings-dialog-surface` 内，按画板 40 的裁定是
  //    `display:none` —— 那是设置壳自己的规则，工作室不受影响）。
  //    不限定就会量成设置壳那个，于是报「display 画板 flex ≠ 产品 none」——假红。
  app: {
    settle: 1800,
    script: `
      const opener = document.querySelector("button.pw-side-foot");
      if (opener) opener.click();
      await new Promise((r) => setTimeout(r, 1500));
      const row = document.querySelector('button.pw-row[data-section="general"]');
      if (!row) throw new Error("general 分节没找到");
      row.click();
      await new Promise((r) => setTimeout(r, 1800));
      const card = document.querySelector("button.pw-skin.is-new");
      if (!card) throw new Error("皮肤条上的「新建皮肤」卡没找到");
      card.click();
      await new Promise((r) => setTimeout(r, 1400));`,
  },
  selectors: [
    // 都限定在工作室自己的浮层 `.fork-skin-modal` 内 —— 选屏上还有一个同名的
    // `.pw-modal`（设置壳），不限定会量错对象（设置壳那个头按设计就是 display:none）。
    ".fork-skin-modal",
    ".fork-skin-modal .pw-modal-head",
    ".pw-tabs",
    ".pw-tab",
    ".fork-skin-modal .pw-modal-body",
    ".pw-field",
    ".pw-radio",
    ".pw-selectbox",
    ".fork-skin-modal .pw-modal-foot",
  ],
  // 画板的 shell 帧是 200px 演示列，产品内容行是 1fr + 340px（帧 1 的真实布局）。
  knownDiffs: [
    {
      sel: ".pw-field",
      reason:
        "fork:settings-field-density 接线（标签 132px 下限 + 控件放不下换行），settings.css 有注释登记；画板 40 的 spec 也登记过同一条",
    },
    {
      sel: ".pw-radio",
      reason:
        "画板帧的 `.pw-radio` 容器继承正文 13px；产品容器继承 12px，**芯片本身**（`.pw-radio > span`）两边都是 `--text-meta`(11px) 一致",
    },
    { sel: ".fork-skin-modal .pw-modal-body", reason: "演示帧 200px 预览列 vs 产品 340px（画板 47 帧 1 的真实值）" },
  ],
};
