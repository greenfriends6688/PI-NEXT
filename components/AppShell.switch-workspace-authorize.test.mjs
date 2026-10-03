import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fix:switch-workspace-authorize（用户 2026-10-03：「选了新任务后提示没有模型」）
// `startSessionIn` 是 AppShell 里「切目录 + 起新会话」的唯一漏斗；漏斗里必须有
// /api/cwd/validate（它调 allowFileRoot 把目录加进白名单），否则新会话拉
// /api/models?cwd=… 会 403「Access denied」，选择器就显示「No models」。
// 这里是源码形状检查：真跑一次要起浏览器 + 一个没被授权的目录。
const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

function startSessionInBody() {
  const start = source.indexOf("const startSessionIn = useCallback");
  assert.notEqual(start, -1, "startSessionIn callback not found");
  const end = source.indexOf("\n  const newSessionTargets", start);
  assert.notEqual(end, -1, "newSessionTargets not found after startSessionIn");
  return source.slice(start, end);
}

test("the workspace-switch funnel authorizes the cwd before adopting it", () => {
  const body = startSessionInBody();
  assert.match(body, /fetch\("\/api\/cwd\/validate"/);
  // 只解析服务端身份后切换：先校验再 handleCwdChange，顺序不能反（反了就又 403）。
  assert.ok(
    body.indexOf("/api/cwd/validate") < body.indexOf("handleCwdChange("),
    "cwd must be validated before handleCwdChange runs",
  );
});

test("no caller adopts a cwd without going through the funnel", () => {
  // 曾经 startSessionAtPath 是唯一带 validate 的入口，芯片菜单 / worktree /
  // 最近项目都直接 handleCwdChange。现在它们只能调 startSessionIn。
  assert.doesNotMatch(source, /startSessionAtPath/);
  assert.doesNotMatch(source, /handleCwdChange\(\s*project\.root|handleCwdChange\(\s*path\b/);
});