import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [shellSource, globalsCss, sidebarCss, settingsCss, mobileHook, panelLayout] = await Promise.all([
  readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/sidebar.css", import.meta.url), "utf8"),
  readFile(new URL("../app/settings.css", import.meta.url), "utf8"),
  readFile(new URL("../hooks/useIsMobile.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/panel-layout.ts", import.meta.url), "utf8"),
]);

test("shell modes share one 767px phone boundary and a 1024px split boundary", () => {
  assert.match(mobileHook, /MOBILE_QUERY = "\(max-width: 767px\)"/);
  assert.match(panelLayout, /MOBILE_MAX_WIDTH = 767/);
  assert.match(panelLayout, /SPLIT_PANEL_MIN_WIDTH = 1024/);
  assert.match(globalsCss, /@media \(max-width: 767px\)/);
  assert.match(globalsCss, /@media \(min-width: 768px\)/);
  assert.match(globalsCss, /@media \(min-width: 1024px\)/);
  assert.doesNotMatch(globalsCss, /@media \(max-width: 640px\)/);
});

test("the shell exposes semantic desktop and phone surfaces", () => {
  for (const className of [
    "app-shell",
    "app-sidebar",
    "app-main",
    "app-topbar",
    "app-content",
    "app-right-panel",
  ]) {
    assert.ok(shellSource.includes(className), `${className} is rendered by the shell`);
  }
  assert.match(shellSource, /data-layout=\{isMobile \? "mobile" : "desktop"\}/);
  assert.match(globalsCss, /\.app-shell \{/);
  assert.match(globalsCss, /\.app-main \{/);
  assert.match(globalsCss, /\.app-right-panel \{/);
});

test("phones use a full-viewport drawer and desktop settings use a navigation rail", () => {
  assert.match(globalsCss, /\.sidebar-container \{[^}]*width: 100vw !important;/s);
  assert.match(globalsCss, /\.sidebar-overlay-backdrop \{\s*display: none !important;/);
  assert.match(sidebarCss, /\.sidebar-mobile-close \{\s*display: flex;/);
  assert.match(settingsCss, /grid-template-columns: 220px minmax\(0, 1fr\)/);
  assert.match(settingsCss, /\.settings-dialog-surface \{[^}]*display: flex;[^}]*width: 100vw;/s);
});

test("touch layouts reserve safe areas and reachable control sizes", () => {
  assert.match(globalsCss, /--chrome-button-size: 44px/);
  assert.match(globalsCss, /padding-top: env\(safe-area-inset-top\)/);
  assert.match(globalsCss, /height: 44px !important/);
  assert.match(sidebarCss, /\.sidebar-footer > button \{[^}]*height: 44px;/s);
});
