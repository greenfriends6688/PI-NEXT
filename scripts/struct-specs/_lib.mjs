// 右栏这几帧共用的驱动片段（struct-diff 自带等待只有 2.5s + 1.2s，dev server
// 首次命中某个路由时经常不够，所以这里自带一个「等它出现」的循环）。
export const OPEN_PANEL = `
  const waitFor = async (fn, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (fn()) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };
  const panel = document.querySelector(".right-panel-container");
  if (panel && !panel.className.includes("right-panel-open")) {
    document.querySelector(".desktop-secondary-workspace-toggle")?.click();
  }
  await waitFor(() => document.querySelector(".file-explorer-section"));
  await waitFor(() => document.querySelectorAll(".file-panel-main .d-trow").length > 0);
`;
export const OPEN_FILE = (name) => `
  const rows = [...document.querySelectorAll(".file-panel-main .d-trow")];
  const row = rows.find((r) => r.textContent.trim() === ${JSON.stringify(name)});
  if (!row) throw new Error("工作区里没有 " + ${JSON.stringify(name)} + "（有：" + rows.map((r) => r.textContent.trim()).join("/") + "）");
  row.click();
  await waitFor(() => document.querySelector(".file-panel-main .file-viewer-shell, .file-panel-main .d-viewer"), 15000);
  // 骨架屏退掉才算这一帧到了（.d-skel-list 是加载态，不是内容）。
  await waitFor(() => !document.querySelector(".file-panel-main .d-skel-list"), 15000);
  await new Promise((r) => setTimeout(r, 900));
`;
export const OPEN_TERMINAL = `
  ${OPEN_PANEL}
  const btn = [...document.querySelectorAll(".file-explorer-header .d-iconbtn")]
    .find((b) => b.querySelector('i[data-ico="square-terminal"]'));
  if (btn) btn.click();
  await waitFor(() => document.querySelector(".file-panel-main .terminal-panel"), 15000);
  await new Promise((r) => setTimeout(r, 600));
`;
