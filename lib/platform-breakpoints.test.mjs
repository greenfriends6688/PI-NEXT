import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PLATFORM_BREAKPOINTS,
  PLATFORM_MEDIA,
  platformTierForWidth,
} from "./platform-breakpoints.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("platform tiers cover the Apple handoff boundaries exactly once", () => {
  assert.equal(platformTierForWidth(0), "phone");
  assert.equal(platformTierForWidth(639), "phone");
  assert.equal(platformTierForWidth(640), "tablet");
  assert.equal(platformTierForWidth(1023), "tablet");
  assert.equal(platformTierForWidth(1024), "desktop");
  assert.equal(platformTierForWidth(1920), "desktop");
});

test("platform media queries are derived from the shared values", () => {
  assert.equal(PLATFORM_MEDIA.phone, "(max-width: 639px)");
  assert.equal(PLATFORM_MEDIA.tablet, "(min-width: 640px) and (max-width: 1023px)");
  assert.equal(PLATFORM_MEDIA.tabletOrSmaller, "(max-width: 1023px)");
  assert.equal(PLATFORM_MEDIA.desktop, "(min-width: 1024px)");
  assert.equal(PLATFORM_MEDIA.landscapePhone, "(max-width: 1023px) and (max-height: 500px)");
  assert.equal(PLATFORM_BREAKPOINTS.phoneMax + 1, PLATFORM_BREAKPOINTS.tabletMin);
  assert.equal(PLATFORM_BREAKPOINTS.tabletMax + 1, PLATFORM_BREAKPOINTS.desktopMin);
});

test("Apple-first font aliases and semantic radius roles stay owned", () => {
  const base = read("../design/v5/base.css");
  const web = read("../design/v5/web/tokens.css");
  const pwa = read("../design/v5/pwa/tokens.css");
  const globals = read("../app/globals.css");

  assert.match(base, /--nx-font-ui:\s*-apple-system,/);
  assert.doesNotMatch(base, /--nx-font-ui:\s*"Geist"/);
  assert.match(globals, /--font-ui:\s*var\(--nx-font-ui\)/);
  assert.match(globals, /--font-mono:\s*var\(--nx-font-mono\)/);

  for (const role of ["control", "row", "card", "pane", "popover", "sheet", "pill"]) {
    assert.match(base, new RegExp(`--nx-radius-${role}:`));
    assert.match(web, new RegExp(`--nx-radius-${role}:`));
    assert.match(pwa, new RegExp(`--nx-radius-${role}:`));
  }
});
