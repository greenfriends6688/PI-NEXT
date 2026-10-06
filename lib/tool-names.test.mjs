import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { isApplyPatchToolName, isEditToolName, isWebToolName, isWriteToolName } = await jiti.import("./tool-names.ts");

test("写 / 改 / patch 三种谓词认装饰过的工具名", () => {
  assert.equal(isWriteToolName("write"), true);
  assert.equal(isWriteToolName("mcp.fs.write"), true);
  assert.equal(isEditToolName("str_replace_based_edit_tool"), true);
  assert.equal(isApplyPatchToolName("apply_patch"), true);
  assert.equal(isWriteToolName("read"), false);
});

test("isWebToolName：联网 / 浏览器类工具（画板 D-27 帧 C 的「正在搜索」那一档）", () => {
  for (const name of ["browser_navigate", "web_search", "websearch", "webfetch", "fetch", "http_request", "mcp.browser_click"]) {
    assert.equal(isWebToolName(name), true, name);
  }
  for (const name of ["read", "write", "edit", "grep", "bash", "apply_patch"]) {
    assert.equal(isWebToolName(name), false, name);
  }
});
