#!/usr/bin/env node
/* fork:v5-landing —— 板 ↔ 产品 PWA 同尺寸对照拍照（390×844）。
 * 用途：把「产品 PWA 到底和 M 板差在哪」变成可逐帧看的图，而不是靠类名数量自证。
 * 跑法：node scripts/pwa-compare.mjs [board 文件名片段]
 */
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome } from "./launch-chrome.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = process.env.APP_URL ?? "http://127.0.0.1:30141/";
const BOARDS = process.env.BOARD_BASE_URL ?? "http://127.0.0.1:39411/v5";
const OUT = "/tmp/pwa-compare";
mkdirSync(OUT, { recursive: true });

const only = process.argv[2] ?? "";
const dir = join(ROOT, "design/v5/pwa/boards");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".html"))
  .filter((f) => !only || f.includes(only));

const freeze = (page) =>
  page.addStyleTag({ content: "*,*::before,*::after{animation-play-state:paused !important}" });

const browser = await launchChrome();

for (const f of files) {
  const tag = f.replace(/\.html$/, "");

  const bp = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await bp.goto(`${BOARDS}/pwa/boards/${f}`, { waitUntil: "load" });
  await bp.waitForTimeout(700);
  await freeze(bp);
  await bp.screenshot({ path: join(OUT, `board-${tag}.png`) });
  await bp.close();

  const pp = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await pp.goto(APP, { waitUntil: "load" });
  await pp.waitForTimeout(2500);
  await freeze(pp);
  await pp.screenshot({ path: join(OUT, `app-${tag}-1-home.png`) });

  await pp.evaluate(async () => {
    const rows = [...document.querySelectorAll(".d-sess, .m-row")];
    const last = rows[rows.length - 1];
    if (last) { last.click(); await new Promise((r) => setTimeout(r, 3200)); }
  });
  await freeze(pp);
  await pp.screenshot({ path: join(OUT, `app-${tag}-2-session.png`) });
  await pp.close();

  process.stdout.write(`${tag} `);
}

await browser.close();
console.log(`\n图在 ${OUT}/`);
