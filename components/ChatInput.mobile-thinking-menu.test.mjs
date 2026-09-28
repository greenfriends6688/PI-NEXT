import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

test("anchors the collapsed reasoning menu to its left edge", () => {
  // fork:pwa-tablet-tier — the flag is `narrowControls` (the tablet breakpoint), not
  // `isMobile`: the strip is collapsed on any viewport that cannot fit it inline.
  assert.match(
    source,
    /thinkingDropdownOpen[\s\S]*?bottom: "calc\(100% \+ 6px\)"[\s\S]*?narrowControls \? \{ left: 0 \} : \{ right: 0 \}/,
  );
});
