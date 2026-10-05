/* D-17 帧 A · 定时任务的任务行（`.d-cron-row` = 开关 + 名称/调度徽章/结局徽章 +
   副行「结果归谁」+ `.d-cron-when`「下一次什么时候」+ 行菜单）。
   **只比第一行**（两侧各取第一个 `.d-cron-row`）：structdiff 是**按位置**比节点序列的，
   任何一格多一个或少一个节点，后面整帧就全部错位、报出来的都是假偏差。帧 A 的
   筛选芯片选中态、间隔任务那行不写相对时间、已暂停那行多一句提示，都是**逐行取样
   文字**的差异（理由登记在 design/v5/DIVERGENCE.md），拿它们当门禁只会天天误报。
   帧级的三块（读数行 / `.d-cats` / 口径横幅）是三段固定 markup，改它们时用眼睛对
   板面 D-17 帧 A 即可（`node design/v5/scripts/shoot.mjs --only D-17` 出图）。

   **自带种子**：板面那一行的主体在空 store 里根本不存在，spec 造一条「每周一次 +
   上一轮成功」的任务（与板面第一行同一结局），比完由 `after` 立刻删掉。
   跑法：`APP_URL=… node scripts/struct-diff.mjs scripts/struct-specs/d17-frame-a-cron-row.mjs` */
const SEED = [{
  name: "依赖升级巡检",
  prompt: "读 lockfile、跑一次 dry-run、把 diff 写成一条结论。",
  active: true,
  scheduleType: "weekly",
  dayOfWeek: 1,
  timeOfDay: "09:00",
  intervalMinutes: 60,
  model: "anthropic/claude-sonnet-4-6",
  sessionMode: "daily",
  locale: "zh-CN",
  cwd: "/tmp/structdiff",
  createdAt: 1759000000000,
  updatedAt: 1759000000000,
  runHistory: [{ runAt: 1759500000000, sessionId: "s1", status: "success", durationMs: 41000 }],
}];

export default {
  name: "D-17 帧A · 任务行",
  board: "v5/web/boards/D-17-settings-automation.html",
  frame: 0,
  boardRoot: ".d-modal .d-set-main .d-set-inner .d-cron-row",
  app: {
    script: `
      const json = (body) => ({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      window.__seeded = [];
      for (const automation of ${JSON.stringify(SEED)}) {
        const res = await fetch("/api/automation", json({ action: "create", automation }));
        const data = await res.json().catch(() => ({}));
        if (data?.automation?.id) window.__seeded.push(data.automation.id);
      }
      // 设置弹窗 → 定时任务。
      await new Promise((r) => setTimeout(r, 3000));
      const open = [...document.querySelectorAll("button,span")].find((n) => n.textContent.trim() === "设置");
      open?.closest("button,[role=button],.d-row")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      await new Promise((r) => setTimeout(r, 1200));
      const nav = [...document.querySelectorAll(".d-set-navitem")].find((n) => n.textContent.includes("定时任务"));
      nav?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      await new Promise((r) => setTimeout(r, 1500));
    `,
  },
  appRoot: 'div[data-section="automation"] .d-cron-row',
  ignore: ["d-grow", "d-sep"],
  maxRows: 30,
  after: `
    for (const id of (window.__seeded ?? [])) {
      await fetch("/api/automation", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }) }).catch(() => {});
    }
  `,
};
