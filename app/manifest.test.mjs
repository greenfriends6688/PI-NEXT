import assert from "node:assert/strict";
import test from "node:test";
import manifest, { dynamic } from "./manifest.ts";

// fork:upstream-0.12-infra —— PWA 应用名运行时配置（#1148）。
test("manifest reads the app name at runtime without changing other metadata", () => {
  const original = process.env.PI_WEB_APP_NAME;
  try {
    assert.equal(dynamic, "force-dynamic");
    delete process.env.PI_WEB_APP_NAME;
    const defaults = manifest();
    assert.equal(defaults.name, "PI NEXT");
    assert.equal(defaults.short_name, "PI NEXT");

    // 复用同一个已导入的函数：环境变量不能在模块加载时被捕获（也不能被烘进静态生成的 manifest）。
    for (const [value, expected] of [
      ["", "PI NEXT"],
      [" \t\n ", "PI NEXT"],
      ["Work Pi", "Work Pi"],
      ["  工作 Pi 🚀 \n", "工作 Pi 🚀"],
      ["Another Pi", "Another Pi"],
    ]) {
      process.env.PI_WEB_APP_NAME = value;
      assert.deepEqual(manifest(), {
        ...defaults,
        name: expected,
        short_name: expected,
      });
    }
  } finally {
    if (original === undefined) delete process.env.PI_WEB_APP_NAME;
    else process.env.PI_WEB_APP_NAME = original;
  }
});
