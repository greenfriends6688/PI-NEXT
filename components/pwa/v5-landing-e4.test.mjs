// fork:v5-landing E4 —— 这一批（PWA「剩余类」）的源码守卫。
//
// 与本仓其它波次同一口径：钉**结构**（类名 / 嵌套 / 状态类），不钉像素。
// 每条断言都能在画板上找到出处，注释里写清是哪一张、哪一帧：
//   · M-11 帧 A-1 `.m-pull`（下拉刷新指示器）、帧 A-2 `.m-swipe` / `.m-swipe-edge`
//     / `.m-swipe-hint`（左缘侧滑返回）、帧 C `.m-touch-56`（触控档）；
//   · M-10 帧 B-1 `.m-update`、帧 B-2 `.m-offline`、帧 C-1 `.m-trust`；
//   · M-02 帧 B `.m-attach-grid` / `.m-attach`、帧 C `.m-cites` / `.m-cite`；
//   · M-01 帧 C · M-05 帧 C · M-09 帧 A 的互斥单选行尾 `.m-radio`；
//   · M-01 / M-04 身份行的 `.m-brand`；M-06 帧 C / M-12 帧 B 的 `.m-term-mobile`。
//
// 另外守住那条最容易破的约束：**不许自造 `m-*` 类** —— 组件里出现的每一个 `m-*`
// 都必须在 `design/v5/pwa/system.css` 里真的定义过（缺件只能进汇报）。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), "utf8");

const systemCss = await read("design/v5/pwa/system.css");
const library = new Set([...systemCss.matchAll(/\.(m-[a-z0-9-]+)/g)].map((match) => match[1]));

const FILES = [
  "components/pwa/MobileGestures.tsx",
  "components/pwa/PwaTrustSheet.tsx",
  "components/pwa/PwaComposerSheet.tsx",
  "components/pwa/RightPanelsMobile.tsx",
  "components/fork/InstallPromptBanner.tsx",
  "components/AppShell.tsx",
  "components/ChatInput.tsx",
];
const sources = new Map(await Promise.all(FILES.map(async (file) => [file, await read(file)])));

/** 只看真正落在 `className` 里的类名 —— 注释里提到类名不算。 */
function classLiterals(source) {
  return [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function tokensOf(value) {
  return value.split(/[\s'"`$?{}[\]():]+/).filter((token) => /^[dm]-[a-z0-9-]+$/.test(token));
}

test("这一批用到的每个 m-* 类都真的定义在 design/v5/pwa/system.css 里", () => {
  const missing = new Set();
  for (const [file, source] of sources) {
    for (const literal of classLiterals(source)) {
      for (const token of tokensOf(literal)) {
        if (token.startsWith("m-") && !library.has(token)) missing.add(`${file}: ${token}`);
      }
    }
  }
  assert.deepEqual([...missing], [], "新造 m-* 类是越权（缺件写汇报，不写产品）");
});

test("M-11 帧 A：下拉指示器与侧滑返回都按画板原文发类", () => {
  const gestures = sources.get("components/pwa/MobileGestures.tsx");
  // `.m-pull` › `.m-badge.mute` › `<i data-ico>`（帧 A-1 原文）。
  assert.match(gestures, /className="m-pull"/);
  assert.match(gestures, /className="m-badge mute"/);
  // 三档由**位置**表达（帧 A-1 的三句话）：提示 / 到位 / 执行各换一次图标。
  for (const icon of ["arrow-down", "refresh-cw", "loader-circle"]) {
    assert.match(gestures, new RegExp(`"${icon}"`), `下拉指示器少了 ${icon} 这一档`);
  }
  // `.m-swipe` › `.m-swipe-edge`（帧 A-2），提示胶囊 `.m-swipe-hint` 靠 `.is-open` 显形。
  assert.match(gestures, /className="m-swipe"/);
  assert.match(gestures, /className="m-swipe-edge"/);
  assert.match(gestures, /className=\{`m-swipe-hint\$\{hintOpen \? " is-open" : ""\}`\}/);
  // 画板两条纪律：只有左缘 28px（类给），已经在顶才拉（scrollTop 判据在组件里）。
  assert.match(gestures, /scroller\.scrollTop <= 0/);
  assert.match(gestures, /PULL_TRIGGER_PX/);
  // M-12 帧 B 那一层用同一件侧滑返回：松手 = 关掉这一层（与右上角 × 同一个动作）。
  assert.match(sources.get("components/pwa/RightPanelsMobile.tsx"), /<PwaEdgeSwipeBack onBack=\{closeAll\}/);
});

test("M-11 帧 C：56 档挂在真实的附件格上（附件钮 / 图标网格单元）", () => {
  const chatInput = sources.get("components/ChatInput.tsx");
  assert.match(chatInput, /className="m-attach add m-touch-56"/);
  assert.match(systemCss, /\.m-touch-56 \{/);
});

test("M-10 帧 B / C：更新浮条、断网条、目录信任条都按画板原文发类", () => {
  const lifecycle = sources.get("components/fork/InstallPromptBanner.tsx");
  // `.m-offline` 两行：状态 + 代价（帧 B-2 原文就是两个裸 div）。
  assert.match(lifecycle, /className="m-offline"/);
  // `.m-update` › `<i data-ico="download">` + `.m-setrow-body` + 「稍后」那枚 `.m-branch`。
  assert.match(lifecycle, /className="m-update"/);
  assert.match(lifecycle, /className="m-setrow-body"/);
  assert.match(lifecycle, /className="m-branch"/);
  // 两条横幅的数据源都必须是真的：onLine 事件 & Service Worker 换岗。
  assert.match(lifecycle, /window\.addEventListener\("offline", sync\)/);
  assert.match(lifecycle, /container\.addEventListener\("controllerchange", onControllerChange\)/);
  // `.m-trust`（帧 C-1）在 PWA 组件里；宿主递数据，组件发类。
  assert.match(sources.get("components/pwa/PwaTrustSheet.tsx"), /className="m-trust"/);
  assert.match(sources.get("components/AppShell.tsx"), /<PwaTrustBanner[\s\S]{0,200}?onTrust=/);
});

test("M-01 / M-04 身份行的 .m-brand 挂在手机抽屉的品牌位上", () => {
  const shell = sources.get("components/AppShell.tsx");
  assert.match(shell, /<img className="m-brand" src="\/pi-next-logo\.png" alt="PI NEXT"/);
  assert.match(shell, /className="nx-row m-t-sm"/);
  // fork:pwa-drawer-brand（2026-10-06 用户裁定）—— 尾件从「项目名徽章」换成字标图：
  // 原来图标后面同时写着 `.m-t-b` 文本与项目名徽章，同一个名字在这一行出现三次。
  assert.match(shell, /<img className="m-wordmark" src="\/pi-next-wordmark\.png"/);
  assert.doesNotMatch(shell, /<span className="m-t-b">PI NEXT<\/span>/);
});

test("M-02 帧 B / 帧 C：附件网格与引用芯片接的是真实附件集合", () => {
  const chatInput = sources.get("components/ChatInput.tsx");
  assert.match(chatInput, /<div className="m-attach-grid">/);
  assert.match(chatInput, /className="m-attach"/);
  assert.match(chatInput, /<div className="m-cites">/);
  assert.match(chatInput, /className=\{`m-cite\$\{cited \? " is-on" : ""\}`\}/);
  // `is-on` 的判据是「这个名字还写在输入框里」，不是写死的 true。
  assert.match(chatInput, /const cited = value\.includes\(chip\.name\)/);
  // 两个块都由 `referenceAttachments.length > 0` 驱动 —— 空集合不渲染空壳。
  assert.equal((chatInput.match(/referenceAttachments\.map\(\(chip\) => \{/g) ?? []).length >= 1, true);
});

test("互斥单选行尾是 .m-radio，且不再叠 .is-on 的 ✓（同一件事只由一个来源说）", () => {
  const sheet = sources.get("components/pwa/PwaComposerSheet.tsx");
  assert.match(sheet, /<span className=\{`m-radio\$\{on \? " on" : ""\}`\} aria-hidden="true" \/>/);
  assert.match(sheet, /on && !marked \? " is-on" : ""/);
  const chatInput = sources.get("components/ChatInput.tsx");
  // 三张板的互斥清单都挂 radio：思考强度 / 权限档位 / 工具预设。
  assert.equal((chatInput.match(/^\s+radio$/gm) ?? []).length, 3);
});

test("M-06 帧 C / M-12 帧 B：终端那一块是 .m-term-mobile（与 .m-panel-scroll 同时挂）", () => {
  const panels = sources.get("components/pwa/RightPanelsMobile.tsx");
  assert.match(panels, /"m-panel-scroll m-term-mobile"/);
  // 判据是**图标名**（板面同一批：terminal / square-terminal），不是写死的 key。
  assert.match(panels, /item\.icon === "terminal" \|\| item\.icon === "square-terminal"/);
  // 调用方仍可覆盖（避免把「哪一块是终端」这个事实固定在组件里）。
  assert.match(panels, /item\.containerClassName/);
});
