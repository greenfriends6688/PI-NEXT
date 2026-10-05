/* struct-spec 共用的「怎么走到这个面」脚本（窄屏 390×844）。
 * 抽屉入口是 `.m-top` 里第一枚 `.m-top-btn`（画板 M-01 帧 A 的 panel-left）；
 * 抽屉里的项目行是 `.m-trow`，展开后才有 `.m-row` 会话行。展开态会跨用例记忆，
 * 所以每次都点两次到「确实有会话行为止」。 */
export const OPEN_DRAWER = `
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const open = [...document.querySelectorAll(".m-top .m-top-btn")][0];
  if (open && !document.querySelector(".sidebar-container.sidebar-open")) { open.click(); await sleep(1400); }
`;

export const EXPAND_PROJECT = `
  for (let i = 0; i < 30 && document.querySelectorAll(".sidebar-container .m-drawer-body .m-row").length === 0; i++) await sleep(400);
  for (let i = 0; i < 2 && document.querySelectorAll(".sidebar-container .m-drawer-body .m-row").length === 0; i++) {
    const proj = document.querySelector(".sidebar-container .m-trow");
    if (!proj) break;
    proj.click(); await sleep(1100);
  }
`;

export const OPEN_SESSION = `
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const open = [...document.querySelectorAll(".m-top .m-top-btn")][0];
  if (open && !document.querySelector(".sidebar-container.sidebar-open")) { open.click(); await sleep(1400); }
  for (let i = 0; i < 30 && document.querySelectorAll(".sidebar-container .m-drawer-body .m-row").length === 0; i++) await sleep(400);
  for (let i = 0; i < 2 && document.querySelectorAll(".sidebar-container .m-drawer-body .m-row").length === 0; i++) {
    const proj = document.querySelector(".sidebar-container .m-trow");
    if (!proj) break;
    proj.click(); await sleep(1100);
  }
  const rows = [...document.querySelectorAll(".sidebar-container .m-drawer-body .m-row")];
  const target = rows.find(r => r.textContent.includes("帧核对-PWA壳转录")) || rows[0];
  if (target) { target.click(); await sleep(4500); }
  for (let i = 0; i < 20 && !document.querySelector(".m-msg-ai"); i++) await sleep(300);
`;