import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { skippedDeps } = createRequire(import.meta.url)("../scripts/check-packaged-deps.cjs") as { skippedDeps: (name: string, platform?: string) => Set<string> };

/**
 * Nothing is dropped by a single platform any more: 电脑操控 was removed, and with it the
 * only entry this map held. The check that matters now is that a package's declared
 * dependency is *not* excused — an empty exception list must not swallow a real gap.
 */
test("no dependency is skipped on any platform", () => {
  for (const platform of ["darwin", "win32", "linux", undefined]) {
    assert.equal(skippedDeps("pinext", platform).size, 0, String(platform));
    assert.equal(skippedDeps("some-package", platform).size, 0, String(platform));
  }
});
