/**
 * File viewer mode-switch gate (fork:perf-viewer-keepalive).
 *
 * Measures what the source-contract tests cannot: the real cost of toggling
 * Source / Preview / Diff, and whether the stages stay mounted across the toggle.
 *
 * Connect it to a server that is already running (prod is the interesting mode —
 * dev recompiles per route and the numbers are meaningless):
 *
 *   npm run prod
 *   node e2e/file-viewer-modes.mjs
 *
 * Env overrides:
 *   PI_E2E_URL        default http://127.0.0.1:30141
 *   PI_E2E_PROJECT    sidebar project to open (default: the repo this script lives in)
 *   PI_E2E_PATH       file to open, relative to the project (default: AGENTS.md)
 *   PI_E2E_BUDGET_MS  per-switch budget for the warm toggles (default 300)
 *
 * The default target is a markdown file that has a working-tree change: that is the
 * only combination where all three modes (Source / Preview / Diff) exist. A clean
 * `.tsx` file has no preview and no diff, so its mode switch is not rendered at all.
 *
 * Budgets are regression guards, not targets. A measured warm toggle is
 * dispatch + two rAFs (~35ms of settle) + one FileViewer/AppShell re-render; on the
 * machine this was written on it lands at 180-260ms, and the `switchTo` timing also
 * pays for the click round-trip. The cold budget is the one that catches a real
 * regression, because that is where a stage is created: before the keep-alive fix a
 * preview visit cost ~1700ms (rebuilding the ProseMirror document every time).
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.PI_E2E_URL ?? "http://127.0.0.1:30141";
const project = process.env.PI_E2E_PROJECT ?? root;
const fileName = process.env.PI_E2E_PATH ?? "AGENTS.md";
const budgetMs = Number(process.env.PI_E2E_BUDGET_MS ?? 300);

const browser = await chromium.launch({ channel: process.env.PI_E2E_CHANNEL ?? "chrome" });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });

const diffRequests = [];
page.on("request", (request) => {
  if (request.url().includes("/api/git/diff")) diffRequests.push(request.url());
});
page.on("console", (message) => {
  if (message.type() === "error") console.error("[browser]", message.text().slice(0, 160));
});

const treeRow = (name) => page.locator(".file-panel-body [role='treeitem']").filter({ hasText: name }).first();

async function settle() {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/** Open the secondary workspace panel and wait for it to actually take up width. */
async function openFilePanel() {
  await page.getByTitle("显示右侧工作区").first().click();
  await page.waitForFunction(() => {
    const body = document.querySelector(".file-panel-body");
    return body !== null && body.getBoundingClientRect().width > 100;
  }, { timeout: 10_000 });
}

/** Click a mode button and return the time until the next two frames have run. */
async function switchTo(label) {
  const button = page.locator(`.file-viewer-mode-switch .file-viewer-mode-button:has-text("${label}")`).first();
  const started = Date.now();
  await button.click();
  await settle();
  return Date.now() - started;
}

/** The HEAD comparison is an overlay with its own toggle (fork:perf-viewer-two-modes). */
async function toggleDiff() {
  const button = page.locator(".file-viewer-diff-toggle").first();
  const started = Date.now();
  await button.click();
  await settle();
  return Date.now() - started;
}

const domCounts = () =>
  page.evaluate(() => {
    const stages = [...document.querySelectorAll("[data-file-stage]")];
    const sourceStage = document.querySelector('[data-file-stage="source"]');
    return {
      // fork:perf-viewer-two-modes — the Source stage is a live CodeMirror editor for
      // every editable text file now (markdown included), so the old per-line spans are
      // only one of the two possible source surfaces.
      sourceLines: document.querySelectorAll(".file-source-line").length,
      sourceEditors: document.querySelectorAll('[data-file-stage="source"] .cm-content[contenteditable="true"]').length,
      sourceSurface: document.querySelectorAll('[data-file-stage="source"] .cm-content, [data-file-stage="source"] .file-source-line').length,
      sourceHidden: sourceStage?.hasAttribute("hidden") ?? null,
      stages: stages.length,
      hiddenStages: stages.filter((stage) => stage.hasAttribute("hidden")).length,
      visibleStages: stages.filter((stage) => !stage.hasAttribute("hidden")).length,
      comparisonOpen: document.querySelectorAll(".file-viewer-diff-overlay").length,
      // A read-only Preview must not contain an editor.
      previewEditors: document.querySelectorAll('[data-file-stage="preview"] .cm-content, [data-file-stage="preview"] .ProseMirror').length,
    };
  });

try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(2500);

  // Switch the project first: selecting a project deliberately closes the secondary
  // workspace (AppShell `setRightPanelOpen(false)`), so opening the panel before the
  // switch would be undone by it.
  await page.locator(`button[title="${project}"]`).first().click({ timeout: 15_000 });
  await page.waitForTimeout(3000);

  // The file explorer lives in the right panel.
  await openFilePanel();
  // Expand every directory on the way down, then open the file.
  const segments = fileName.split("/");
  for (const segment of segments) {
    await treeRow(segment).click({ timeout: 15_000 });
    await page.waitForTimeout(segment === segments[segments.length - 1] ? 0 : 2000);
  }
  await page.waitForTimeout(5000);

  const modes = await page.evaluate(() =>
    [...document.querySelectorAll(".file-viewer-mode-switch .file-viewer-mode-button")].map((button) => button.textContent.trim()));
  assert.deepEqual(modes, ["Source", "Preview"], `the switch must offer exactly two modes, saw: ${modes.join(", ") || "none"}`);
  const meta = await page.locator(".file-viewer-meta").first().textContent();
  console.log(`opened ${fileName} — ${meta}`);

  // The first visit to a stage pays for the parse; later visits must not.
  const visitBudget = Math.max(budgetMs * 3, 900);
  const results = [];
  for (const label of modes) {
    results.push([`cold ${label}`, await switchTo(label), visitBudget]);
  }
  for (const label of [...modes].reverse().concat(modes)) {
    results.push([`warm ${label}`, await switchTo(label), budgetMs]);
  }

  const after = await domCounts();
  console.log("stages:", JSON.stringify(after));

  // The comparison is an overlay: it hides the stages instead of unmounting them,
  // and it is dismissed from its own banner.
  const overlayBudget = Math.max(budgetMs, 400);
  const hasOverlayToggle = await page.locator(".file-viewer-diff-toggle").count();
  if (hasOverlayToggle > 0) {
    results.push(["open compare", await toggleDiff(), overlayBudget]);
    assert.ok(await page.locator(".file-viewer-diff-banner").count() > 0, "the comparison banner is missing");
    const covered = await domCounts();
    assert.equal(covered.comparisonOpen, 1, "the comparison overlay is missing");
    assert.equal(covered.visibleStages, 0, `the stages must be hidden while the comparison is open, saw ${covered.visibleStages}`);
    assert.equal(covered.sourceSurface > 0, true, "opening the comparison unmounted the source stage");
    results.push(["close compare", await toggleDiff(), overlayBudget]);
    assert.equal(await page.locator(".file-viewer-diff-banner").count(), 0, "the comparison banner did not close");
  } else {
    console.log("no HEAD comparison offered for this file — overlay checks skipped");
  }

  const visible = await domCounts();
  assert.equal(visible.visibleStages, 1, `exactly one stage must be visible, saw ${visible.visibleStages}`);

  let failed = 0;
  for (const [label, ms, budget] of results) {
    const over = ms > budget;
    if (over) failed++;
    console.log(`${over ? "FAIL" : "ok  "} ${label.padEnd(14)} ${String(ms).padStart(5)}ms  (budget ${budget}ms)`);
  }

  // Keep-alive: every stage the user has visited is still in the DOM.
  assert.equal(visible.sourceSurface > 0, true, "the source stage disappeared after switching away");
  assert.ok(visible.hiddenStages >= 1, "no stage was kept mounted behind the visible one");

  // Source writes, Preview renders (fork:perf-viewer-two-modes).
  assert.equal(visible.sourceEditors > 0, true, "the Source stage is not an editable CodeMirror surface");
  assert.equal(visible.previewEditors, 0, "the Preview stage mounted an editor; it must be a read-only render");

  // The git diff is fetched once per open, not again on every mode switch.
  console.log(`git diff requests during the run: ${diffRequests.length}`);

  // ---- Source writes, Preview renders: the PR-02b contract, end to end ----------------
  // Uses its own scratch file so the check never touches a tracked one.
  const scratchName = ".picodex-viewer-probe.md";
  const scratchPath = join(project, scratchName);
  mkdirSync(dirname(scratchPath), { recursive: true });
  writeFileSync(scratchPath, "# probe\n\noriginal line\n", "utf8");
  try {
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await openFilePanel();
    // Refresh so the new file shows up in the tree.
    await page.locator('.file-panel-body [title*="刷新"], .file-panel-body [title^="刷新"]').first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await treeRow(scratchName).click({ timeout: 15_000 });
    await page.waitForTimeout(3000);

    await page.locator('.file-viewer-mode-switch .file-viewer-mode-button:has-text("Source")').first().click();
    await page.waitForTimeout(700);
    const editable = await page.evaluate(() =>
      document.querySelectorAll('[data-file-stage="source"] .cm-content[contenteditable="true"]').length);
    assert.equal(editable, 1, "a markdown file must be editable in the Source stage");

    await page.locator('[data-file-stage="source"] .cm-content').click();
    await page.keyboard.press("Meta+End").catch(() => {});
    await page.keyboard.press("Control+End").catch(() => {});
    await page.keyboard.type("typed by the gate");
    await page.waitForTimeout(2500); // the autosave debounce is 500ms

    const onDisk = readFileSync(scratchPath, "utf8");
    assert.ok(onDisk.includes("typed by the gate"), "the markdown edit never reached disk");
    console.log("ok   markdown source edit saved to disk");

    await page.locator('.file-viewer-mode-switch .file-viewer-mode-button:has-text("Preview")').first().click();
    await page.waitForTimeout(1200);
    const preview = await page.evaluate(() => ({
      editors: document.querySelectorAll('[data-file-stage="preview"] .cm-content, [data-file-stage="preview"] .ProseMirror').length,
      text: (document.querySelector('[data-file-stage="preview"]')?.textContent ?? "").trim(),
    }));
    assert.equal(preview.editors, 0, "the Preview stage mounted an editor; it must be read-only");
    assert.ok(preview.text.includes("typed by the gate"), "the Preview stage rendered a stale snapshot of the buffer");
    console.log("ok   preview renders the saved buffer read-only");
  } finally {
    rmSync(scratchPath, { force: true });
  }

  if (failed > 0) {
    console.error(`\n${failed}/${results.length} switches exceeded their budget`);
    process.exitCode = 1;
  } else {
    console.log(`\nall ${results.length} switches within budget`);
  }
} catch (error) {
  process.exitCode = 1;
  console.error(error);
  await page.screenshot({ path: "test-results/file-viewer-modes.png" }).catch(() => {});
} finally {
  await browser.close();
}
