// 安装技能对话框（画板 42 · 帧 2）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*。
// **画板侧一行不动**，两边靠 pairs 显式配对。
//
// 这一枚弹层是**例外**：SkillsConfig.tsx:753-761 的 fork:v5-skin-pw-modal-keep
// 注释明说 —— 这里**有意保留** .pw-modal / -head / -body / -foot 四个 v1 类名
// （app/pwa-models-skills.css 的手机 sheet 以它们为选择器，删了会静默打断整片 sheet）。
// 所以弹层壳四个类在产品侧**照旧**，只把壳**里面**的 v1 件换成 v5 的。
const OPEN_SKILL_MARKET = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="skills"]');
  if (!row) throw new Error("settings section not found: skills");
  row.click();
  await new Promise((r) => setTimeout(r, 1800));
  const btn = [...document.querySelectorAll(".settings-section-host:not([hidden]) .d-set-sec .d-row button")]
    .find((b) => /添加技能|add skill/i.test(b.textContent ?? ""));
  if (!btn) throw new Error("页头动作区的「添加技能」按钮没找到");
  btn.click();
  await new Promise((r) => setTimeout(r, 1500));
  // fork:v5-settings-map —— 画板帧 2 量的是「搜索之后」的结果列表：v5 的结果网格是
  // .d-store-grid > .d-store-card（SkillsConfig.tsx:879）。不搜一次，弹层里只有
  // 市场芯片 / 安装到哪 / 一句提示，结果区一块都不在 DOM 里。
  const input = document.querySelector(".fork-pwa-ms-sheet .d-searchfield input");
  if (!input) throw new Error("弹层里的搜索框没找到");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "poster");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const search = [...document.querySelectorAll(".fork-pwa-ms-sheet .d-btn")]
    .find((b) => /搜索|search/i.test(b.textContent ?? ""));
  if (!search) throw new Error("弹层里的「搜索」按钮没找到");
  search.click();
  for (let i = 0; i < 40; i++) {
    if (document.querySelector(".fork-pwa-ms-sheet .d-store-card")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 800));`;

export default {
  "name": "安装技能对话框（画板 42 · 帧 2）",
  "board": "42-settings-agents-skills.html",
  "boardFrame": 2,
  "app": { "script": OPEN_SKILL_MARKET, "settle": 2000 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".fork-pwa-ms-sheet .pw-modal",
      "reason": "**取样差异（宿主选择器）**：画板侧写的是 `.pw-cols > .pw-modal`，而画板帧 2 是一张独立的演示帧（`max-width:848px`），**帧里没有 `.pw-cols`** —— 这一对在画板侧不存在（工具报「画板里没有这个选择器」并跳过），产品侧取的是真实弹层 `.fork-pwa-ms-sheet > .pw-modal`。"
    },
    {
      "sel": ".fork-pwa-ms-sheet .d-cats",
      "reason": "**取样差异（`.pw-radio` → 分类芯片）**：画板把「skills.sh ↔ SkillHub」画成 `.pw-radio` 一排小片；v5 走画板 D-11 帧 B 的 `.d-cats` + `button.d-cat`（`SkillsConfig.tsx:798`）。同一职责，选中态由 `.is-on` 表达。这一对量的是芯片行盒本体。"
    },
    {
      "sel": ".fork-pwa-ms-sheet .d-store-grid",
      "reason": "**取样差异（`.pw-pop` → 结果网格）**：画板把搜索结果画成一块 `.pw-pop` 里三行 `.pw-prow`；v5 按画板 D-11 帧 B 改用 `.d-store-grid` + `.d-store-card`（封面 + 名称 + 脚注）。这一对量的是**结果区宿主**；`.pw-prow` / `.pw-prow.is-on` 那一对同样落在它身上（取样差异：v5 没有浮层式的单行结果列表）。"
    },
    {
      "sel": ".fork-pwa-ms-sheet .d-searchfield",
      "reason": "**取样差异（内联搜索框 → `.d-searchfield`）**：画板那一行是内联样式拼出来的「描边 + 圆角 4 + 28 高」的输入条，里面还挂一枚 `.pw-kbd`；v5 用画板 D-11 的 `.d-searchfield`（`SkillsConfig.tsx:813`），`.pw-kbd`（Enter 提示）在 v5 这一处**没有单独发**。`.pw-kbd` 那一对登记为取样差异。"
    },
    {
      "sel": ".fork-pwa-ms-sheet .d-badge.count",
      "reason": "**取样差异（计数徽章的位置变了）**：画板把下载数 `.pw-badge.count` 挂在**每一行结果**的右端；v5 的 `.d-store-card` 脚注里没有这一枚计数徽章（`.d-store-foot` 只放名称与来源）。这一对量的是弹层里实际存在的那一枚 `.d-badge.count`。"
    },
    {
      "sel": ".fork-pwa-ms-sheet .d-banner.info",
      "reason": "**取样差异（`.pw-alert` → `.d-banner`）**：对照表里的 `.pw-alert` 在 v5 没有同名类，实际承载它的是 `.d-banner` + `.info` 档（`system.css:456/461`）。同一块提示条，字阶与内距按 v5 系统表取值。"
    },
    {
      "sel": ".fork-pwa-ms-sheet .d-select",
      "reason": "**取样差异（`.pw-selectbox` → `.d-select`）**：画板那个「安装到项目」是自绘下拉（`.pw-selectbox` + `.pw-ico chevron-down`）；v5 这一处是原生 `<select class=\"d-select\">`（SettingsUi.tsx 的 `PwSelect`）。触发钮的档位对得上，**内部结构不同**（原生 select 没有自绘的 chevron 图标壳）。"
    },
    {
      "sel": ".fork-pwa-ms-sheet .d-store-card",
      "reason": "**取样差异（`.pw-prow.is-on`）**：画板那一行是 `.pw-prow.is-on`（搜索结果里选中态那一行）；v5 的结果卡 `div.d-store-card` **没有选中态类**（安装是每张卡脚里的「安装」钮）。这一对与 `.pw-prow` 那一对量的是同一枚卡。"
    },
    {
      "sel": ".fork-pwa-ms-sheet .d-kbd",
      "reason": "**未落地**：画板那一行的搜索框右侧挂一枚 `.pw-kbd`（Enter 提示）；v5 的 `PwSearch`（`SettingsUi.tsx:635`）只发图标 + input + 「搜索」按钮，没有这枚键帽。Enter 键在 onKeyDown 里仍然可用，只是没有画板那一枚可见件。"
    },
    {
      "sel": ".fork-pwa-ms-sheet .d-badge.count",
      "reason": "**取样差异（计数徽章的形态变了）**：画板把下载数做成 `.pw-badge.count` 挂在每行结果右端；v5 的 `.d-store-foot` 里是一句纯文本「616.9K installs」，没有徽章。"
    },
    {
      "sel": ".fork-pwa-ms-sheet .d-btn.primary",
      "reason": "**未落地**：画板脚行右端是一枚 primary「安装到项目」；v5 的弹层脚行只有一枚「取消」（`SkillsConfig.tsx:944-948`）—— 安装动作下沉到每张结果卡的 `.d-store-foot` 里的「安装」钮。这一对量到的是弹层里实际存在的那一枚 `.d-btn.primary`（若没有则按取样差异记）。"
    }
  ],
  "pairs": [
    // 弹层壳：v5 有意保留 v1 类（见文件头注释）
    [".pw-modal", ".fork-pwa-ms-sheet > .pw-modal"],
    [".pw-modal-head", ".fork-pwa-ms-sheet .pw-modal-head"],
    [".pw-modal-body", ".fork-pwa-ms-sheet .pw-modal-body"],
    [".pw-modal-foot", ".fork-pwa-ms-sheet .pw-modal-foot"],
    // 壳内的 v1 件 → v5
    [".pw-inline", ".fork-pwa-ms-sheet .d-set-row"],
    [".pw-radio", ".fork-pwa-ms-sheet .d-cats"],
    [".pw-selectbox", ".fork-pwa-ms-sheet .d-select"],
    [".pw-input", ".fork-pwa-ms-sheet .d-searchfield > input"],
    [".pw-kbd", ".fork-pwa-ms-sheet .d-kbd"],
    [".pw-pop", ".fork-pwa-ms-sheet .d-store-grid"],
    [".pw-prow", ".fork-pwa-ms-sheet .d-store-card"],
    [".pw-prow.is-on", ".fork-pwa-ms-sheet .d-store-card"],
    [".pw-badge.count", ".fork-pwa-ms-sheet .d-badge.count"],
    [".pw-alert.info", ".fork-pwa-ms-sheet .d-banner.info"],
    [".pw-btn", ".fork-pwa-ms-sheet .d-btn"],
    [".pw-btn.primary", ".fork-pwa-ms-sheet .d-btn.primary"]
  ]
};