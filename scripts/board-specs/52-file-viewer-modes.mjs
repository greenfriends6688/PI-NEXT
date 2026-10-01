// 画板 52 文件查看器其余形态 —— 帧 A「可编辑源码」。
//
// 这一帧量的是查看器里**可编辑**那条路（板 52 帧 A），也就是产品上唯一挂着
// `.pw-viewer` 壳的那一支：头（文件名 + 格式徽章 + 撤销 + 保存）、正文（`.pw-code-body`）、
// 底栏（`.pw-card-foot`：Ln·Col / 语言·行尾·编码）。
//
// 选这一帧而不是帧 B（保存冲突）/ 帧 C（CSV·frontmatter）/ 帧 D（图片·滚动淡出）/
// 帧 E（HTML·全部分支），是因为**只有它能被当前种子数据稳定驱动到**：
//   · 帧 C 的三选一（用磁盘 / 覆盖磁盘 / 先看差异）要有 409 冲突才渲染；
//   · 帧 D 的 CSV/TSV 预览要工作区里有分隔符文本文件；
//   · 帧 E 的图片页脚（拖拽平移 / 适应窗口 / 1:1）那一整条工具条在产品上根本没挂 pw 类；
//   · 帧 F 的「与 HEAD 对比」覆盖层要工作区是个 git 仓库。
// 这些缺口与本 spec 无关，已在报告里逐条列了实测证据。
//
// 关键接线：产品上 `.pw-viewer-head` / `.pw-code-body` / `.pw-card-foot` 都挂在
// **CodeMirror 编辑器那一支**（CodeFileEditor.tsx 的根就是 `.pw-viewer`），
// 所以必须先点开一个**能进编辑器**的源码文件；只读那一支走的是
// `.file-source-view`（react-syntax-highlighter），**一个 pw-* 类都没有**。
const OPEN_PANEL = `
  const toggle = document.querySelector(".desktop-secondary-workspace-toggle");
  const panel = document.querySelector(".pw-panel");
  if (toggle && panel && !panel.className.includes("right-panel-open")) {
    toggle.click();
    await new Promise((r) => setTimeout(r, 1100));
  }
`;

const OPEN_AN_EDITABLE_FILE = `
  const rows = [...document.querySelectorAll(".file-explorer-section .pw-trow")];
  const isDir = (r) => !!r.querySelector('[data-ico="chevron-right"]');
  // 只认能进 CodeMirror 的后缀：html / csv / 图片走的是另外几条分支，
  // 挂不上 .pw-viewer 壳，量到的就不是这一帧的东西了。
  const EDITABLE = /\\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cc|cpp|h|sh|json|ya?ml|toml|css|scss|sql)$/i;
  const row = rows.find((r) => !isDir(r) && EDITABLE.test(r.textContent.trim()))
    ?? rows.find((r) => !isDir(r));
  if (!row) {
    const cwd = document.querySelector(".file-explorer-title-label.pw-mono");
    throw new Error("工作区 "
      + (cwd ? cwd.getAttribute("title") : "?")
      + " 里没有文件 —— 板 52 帧 A 量的是可编辑源码，得有一个能进编辑器的文件");
  }
  row.click();
  await new Promise((r) => setTimeout(r, 2000));
  if (!document.querySelector(".pw-viewer .cm-content")) {
    throw new Error("点开 " + row.textContent.trim()
      + " 之后没挂上编辑器（.pw-viewer .cm-content 缺失）——"
      + "这一帧要的是 CodeMirror 那一支，只读的 .file-source-view 不带 pw-* 类");
  }
`;

export default {
  name: "查看器可编辑源码（画板 52 · 帧 A）",
  board: "52-file-viewer-modes.html",
  boardFrame: 0,
  app: { script: `${OPEN_PANEL}${OPEN_AN_EDITABLE_FILE}`, settle: 2000 },
  pairs: [
    // 头：图标槽 / 等宽文件名 / 格式徽章 / 两个动作钮
    [".pw-viewer-head", ".pw-viewer .pw-viewer-head"],
    [".pw-viewer-head .pw-ico", ".pw-viewer .pw-viewer-head .pw-ico"],
    [".pw-viewer-head .pw-mono", ".pw-viewer .pw-viewer-head .pw-mono"],
    [".pw-viewer-head .pw-badge", ".pw-viewer .pw-viewer-head .pw-badge"],
    [".pw-viewer-head .pw-btn", ".pw-viewer .pw-viewer-head .pw-btn"],
    [".pw-viewer-head .pw-btn.primary", ".pw-viewer .pw-viewer-head .pw-btn.primary"],
    // 正文
    [".pw-code-body", ".pw-viewer .pw-code-body"],
    // 底栏：行·列 + 语言·行尾·编码
    [".pw-card-foot", ".pw-viewer .pw-card-foot"],
    [".pw-card-foot .pw-ico", ".pw-viewer .pw-card-foot .pw-ico"],
  ],
  tolerance: { box: 2, fontSize: 0 },
};
