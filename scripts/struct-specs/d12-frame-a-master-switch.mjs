/* D-12 帧 A · 内置子代理总开关那一行（`.d-set-row` = 行盒 + 左标签/说明 + 右槽徽标 + 开关）。
   **只比这一行**：帧 A 的分节里还有「切换后需重载」的 warn banner、「允许的运行形态」
   的 `.d-seg` 三选一与三个 pane —— 产品没有那两个数据面（登记在
   design/v5/DIVERGENCE.md 的 D-12 条目），整节比会得到一堆假 MISSING。
   这一行是两侧逐节点同构的那一块：`.d-set-row-box` → `.d-set-row-t` + `.d-set-row-s`，
   `.d-grow-last` → `.d-badge.mute`（lock 图标），末尾 `button.d-switch[role=switch]`。
   跑法：`APP_URL=… node scripts/struct-diff.mjs scripts/struct-specs/d12-frame-a-master-switch.mjs` */
const OPEN_AGENTS = `
  const waitFor = async (fn, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (fn()) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };
  const opener = document.querySelector(".d-side-foot button");
  if (opener) opener.click();
  await waitFor(() => document.querySelector('button.d-set-navitem[data-section="agents"]'));
  const row = document.querySelector('button.d-set-navitem[data-section="agents"]');
  row.click();
  await waitFor(() => document.querySelector('div[data-section="agents"] .d-set-inner .d-set-row'));
  await new Promise((r) => setTimeout(r, 1200));
`;

export default {
  name: "D-12 帧A · 内置子代理总开关行",
  board: "v5/web/boards/D-12-settings-agents.html",
  frame: 0,
  boardRoot: ".d-modal .d-set-main .d-set-inner > .d-set-sec:nth-of-type(1) .d-set-row",
  app: { script: OPEN_AGENTS },
  appRoot: 'div[data-section="agents"] .d-set-inner > .d-set-sec:nth-of-type(1) .d-set-row',
  ignore: ["d-grow"],
  maxRows: 20,
};