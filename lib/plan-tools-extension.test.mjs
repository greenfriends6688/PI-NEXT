import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// fork:pr52-plan-tools —— 工具注册形状 + 真落盘行为（临时目录里跑真的 fs，不 mock 路径安全）。
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createPlanToolsExtension, HOST_PLAN_TOOLS_EXTENSION_NAME } = await jiti.import("./plan-tools-extension.ts");
const { RESERVED_SUBAGENT_TOOL_NAMES, PLAN_DOCUMENTS_PER_SESSION_LIMIT } = await jiti.import("./plan-documents.ts");

const NOW = new Date(2026, 9, 2, 9, 30);
const PLAN_DIR_RELATIVE = ".pi/plans";

function makeWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), "pi-web-plan-"));
  const cwd = path.join(root, "repo");
  mkdirSync(cwd);
  return { root, cwd, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function loadTools(options = {}) {
  const tools = new Map();
  const handlers = [];
  const extension = createPlanToolsExtension({
    getRoots: () => new Set([options.cwd]),
    now: () => NOW,
    ...options,
  });
  extension.factory({
    registerTool(tool) { tools.set(tool.name, tool); },
    on(name, handler) { handlers.push({ name, handler }); },
  });
  const ctx = {
    cwd: options.cwd,
    sessionManager: { getBranch: () => options.branch ?? [] },
  };
  const run = (name, params) => tools.get(name).execute("call-1", params, undefined, undefined, ctx);
  const emit = async (name) => {
    for (const entry of handlers) {
      if (entry.name === name) await entry.handler({}, ctx);
    }
  };
  return { extension, tools, run, emit };
}

test("注册形状：两个工具、不占保留名、参数与说明齐全", () => {
  const { cwd } = makeWorkspace();
  const { extension, tools } = loadTools({ cwd });
  assert.equal(extension.name, HOST_PLAN_TOOLS_EXTENSION_NAME);
  assert.equal(extension.hidden, true);
  assert.deepEqual([...tools.keys()].sort(), ["read_plan", "write_plan"]);
  for (const name of RESERVED_SUBAGENT_TOOL_NAMES) assert.equal(tools.has(name), false);

  const write = tools.get("write_plan");
  assert.ok(write.description.includes(".pi/plans"));
  assert.ok(write.description.includes("todo"), "工具描述要点名 todo（计划文档 ≠ 执行清单）");
  assert.ok(write.promptSnippet);
  assert.deepEqual(Object.keys(write.parameters.properties ?? {}).sort(), ["content", "path", "title"]);
  assert.deepEqual(Object.keys(tools.get("read_plan").parameters.properties ?? {}), ["path"]);
});

test("第一次 write_plan 落盘到 <cwd>/.pi/plans/<日期>-<slug>.md，并带回可点的 details", async (t) => {
  const workspace = makeWorkspace();
  t.after(workspace.cleanup);
  const { run } = loadTools({ cwd: workspace.cwd });

  const result = await run("write_plan", { title: "Login flow", content: "# Plan\n\n1. add the route\n" });
  assert.equal(result.isError, undefined);
  assert.equal(result.details.kind, "pi-web-plan");
  assert.equal(result.details.tool, "write_plan");
  assert.equal(result.details.action, "created");
  assert.equal(result.details.relativePath, `${PLAN_DIR_RELATIVE}/2026-10-02-login-flow.md`);
  assert.equal(result.details.filePath, path.join(workspace.cwd, ".pi", "plans", "2026-10-02-login-flow.md"));
  assert.equal(result.details.title, "Login flow");

  const written = readFileSync(result.details.filePath, "utf8");
  assert.equal(written, "# Plan\n\n1. add the route\n");
  // 原子落盘：staging 用的临时文件不许留在目录里
  assert.deepEqual(readdirSync(path.dirname(result.details.filePath)), ["2026-10-02-login-flow.md"]);
  // 给模型的一句话里要带上路径（它要转述给用户）
  assert.match(result.content[0].text, /2026-10-02-login-flow\.md/);
});

test("同标题改版覆盖同一个文件；换标题才另立一份", async (t) => {
  const workspace = makeWorkspace();
  t.after(workspace.cleanup);
  const { run } = loadTools({ cwd: workspace.cwd });

  const first = await run("write_plan", { title: "Login flow", content: "v1" });
  const second = await run("write_plan", { title: "Login flow", content: "v2" });
  assert.equal(first.details.filePath, second.details.filePath);
  assert.equal(second.details.action, "updated");
  assert.deepEqual(readdirSync(path.join(workspace.cwd, ".pi", "plans")), ["2026-10-02-login-flow.md"]);
  assert.equal(readFileSync(second.details.filePath, "utf8"), "v2");

  const other = await run("write_plan", { title: "Billing", content: "b" });
  assert.notEqual(other.details.filePath, second.details.filePath);
  assert.equal(readdirSync(path.join(workspace.cwd, ".pi", "plans")).length, 2);
});

test("一个会话最多 8 份计划，第 9 份被拒（且不写盘）", async (t) => {
  const workspace = makeWorkspace();
  t.after(workspace.cleanup);
  const { run } = loadTools({ cwd: workspace.cwd });

  for (let index = 0; index < PLAN_DOCUMENTS_PER_SESSION_LIMIT; index += 1) {
    const result = await run("write_plan", { title: `Plan ${index}`, content: `body ${index}` });
    assert.equal(result.isError, undefined, `第 ${index + 1} 份不该失败`);
  }
  const overflow = await run("write_plan", { title: "Plan 9", content: "too many" });
  assert.equal(overflow.isError, true);
  assert.match(overflow.content[0].text, /limit 8/);
  assert.equal(readdirSync(path.join(workspace.cwd, ".pi", "plans")).length, PLAN_DOCUMENTS_PER_SESSION_LIMIT);
});

test("显式 path 只允许改本会话计划目录里的计划文档", async (t) => {
  const workspace = makeWorkspace();
  t.after(workspace.cleanup);
  const planDirectory = path.join(workspace.cwd, ".pi", "plans");
  mkdirSync(planDirectory, { recursive: true });
  const elsewhere = path.join(workspace.cwd, "src", "a.ts");
  mkdirSync(path.dirname(elsewhere), { recursive: true });
  writeFileSync(elsewhere, "original");
  const { run } = loadTools({ cwd: workspace.cwd });

  const outsideDirectory = await run("write_plan", { title: "x", content: "y", path: elsewhere });
  assert.equal(outsideDirectory.isError, true);
  assert.equal(readFileSync(elsewhere, "utf8"), "original", "计划工具不许改别的文件");

  const nested = await run("write_plan", { title: "x", content: "y", path: path.join(planDirectory, "sub", "a.md") });
  assert.equal(nested.isError, true);

  const traversal = await run("write_plan", { title: "x", content: "y", path: `${planDirectory}/../../a.md` });
  assert.equal(traversal.isError, true);
  assert.match(traversal.content[0].text, /\.\./);

  const relative = await run("write_plan", { title: "x", content: "y", path: ".pi/plans/a.md" });
  assert.equal(relative.isError, true);
  assert.match(relative.content[0].text, /absolute/);

  const approved = path.join(planDirectory, "2026-10-01-older.md");
  const result = await run("write_plan", { title: "Older", content: "revised", path: approved });
  assert.equal(result.isError, undefined);
  assert.equal(result.details.action, "created");
  assert.equal(readFileSync(approved, "utf8"), "revised");
});

test("会话工作目录之外的一切都拒（授权只走 path-security 的 roots）", async (t) => {
  const workspace = makeWorkspace();
  const outsider = makeWorkspace();
  t.after(workspace.cleanup);
  t.after(outsider.cleanup);
  const { run } = loadTools({ cwd: workspace.cwd });

  const escaped = await run("write_plan", {
    title: "Escape",
    content: "x",
    path: path.join(outsider.cwd, ".pi", "plans", "2026-10-02-escape.md"),
  });
  assert.equal(escaped.isError, true);
  assert.equal(escaped.details.error, "Access denied");
  assert.equal(existsSyncPlan(outsider.cwd), false, "一根目录都不许在 roots 之外建出来");

  // 会话 cwd 自己不在 roots 里时，连建目录这一步就该被挡下
  const outsideCwd = path.join(outsider.cwd, "nested-cwd");
  mkdirSync(outsideCwd);
  const fromOutside = loadTools({ cwd: outsideCwd, getRoots: () => new Set([workspace.cwd]) });
  const denied = await fromOutside.run("write_plan", { title: "Denied", content: "x" });
  assert.equal(denied.isError, true, "cwd 不在 roots 里时不得写盘");
  assert.equal(existsSyncPlan(outsideCwd), false);
});

test("目标是符号链接时拒绝写入（realpath 复核，不是词法判断）", async (t) => {
  const workspace = makeWorkspace();
  t.after(workspace.cleanup);
  const planDirectory = path.join(workspace.cwd, ".pi", "plans");
  mkdirSync(planDirectory, { recursive: true });
  const secret = path.join(workspace.cwd, "secret.md");
  writeFileSync(secret, "do not touch");
  symlinkSync(secret, path.join(planDirectory, "2026-10-02-link.md"));

  const { run } = loadTools({ cwd: workspace.cwd });
  const result = await run("write_plan", { title: "Link", content: "overwritten", path: path.join(planDirectory, "2026-10-02-link.md") });
  assert.equal(result.isError, true);
  assert.equal(readFileSync(secret, "utf8"), "do not touch");
});

test("内容为空 / 超限 / 无标题都被拒", async (t) => {
  const workspace = makeWorkspace();
  t.after(workspace.cleanup);
  const { run } = loadTools({ cwd: workspace.cwd });

  const empty = await run("write_plan", { title: "Empty", content: "   \n" });
  assert.equal(empty.isError, true);
  const huge = await run("write_plan", { title: "Huge", content: "x".repeat(256 * 1024 + 1) });
  assert.equal(huge.isError, true);
  assert.match(huge.content[0].text, /limit/);
  const untitled = await run("write_plan", { title: "  ", content: "body" });
  assert.equal(untitled.isError, true);
  assert.equal(existsSyncPlan(workspace.cwd), false);
});

test("read_plan 默认回读本会话最近写的那份，显式 path 可以读别的 roots 里的计划", async (t) => {
  const workspace = makeWorkspace();
  const other = makeWorkspace();
  t.after(workspace.cleanup);
  t.after(other.cleanup);
  const { run } = loadTools({ cwd: workspace.cwd, getRoots: () => new Set([workspace.cwd, other.cwd]) });

  const noPlanYet = await run("read_plan", {});
  assert.equal(noPlanYet.isError, true);
  assert.match(noPlanYet.content[0].text, /no plan document/);

  await run("write_plan", { title: "First", content: "first body" });
  const latest = await run("write_plan", { title: "Second", content: "second body" });
  const read = await run("read_plan", {});
  assert.equal(read.isError, undefined);
  assert.equal(read.details.tool, "read_plan");
  assert.equal(read.details.action, "read");
  assert.equal(read.details.filePath, latest.details.filePath);
  assert.match(read.content[0].text, /second body/);

  const foreignPlan = path.join(other.cwd, ".pi", "plans", "2026-09-30-foreign.md");
  mkdirSync(path.dirname(foreignPlan), { recursive: true });
  writeFileSync(foreignPlan, "foreign body");
  const foreign = await run("read_plan", { path: foreignPlan });
  assert.equal(foreign.isError, undefined);
  assert.match(foreign.content[0].text, /foreign body/);

  const notAPlan = await run("read_plan", { path: path.join(workspace.cwd, "src", "a.ts") });
  assert.equal(notAPlan.isError, true);
  assert.match(notAPlan.content[0].text, /not a plan document/);

  // `..` 在 resolve 之前就被拒（与 write_plan 同一道门）
  const traversal = await run("read_plan", { path: `${planDirectoryOf(workspace.cwd)}/../2026-10-02-a.md` });
  assert.equal(traversal.isError, true);
  assert.match(traversal.content[0].text, /\.\./);
});

test("分支重建：session_tree 之后「最近写的那份」跟着分支走", async (t) => {
  const workspace = makeWorkspace();
  t.after(workspace.cleanup);
  const planDirectory = path.join(workspace.cwd, ".pi", "plans");
  mkdirSync(planDirectory, { recursive: true });
  const planPath = path.join(planDirectory, "2026-10-02-branched.md");
  writeFileSync(planPath, "branch body");

  const branch = [{
    type: "message",
    message: {
      role: "toolResult",
      toolName: "write_plan",
      details: {
        kind: "pi-web-plan",
        tool: "write_plan",
        action: "created",
        filePath: planPath,
        fileName: "2026-10-02-branched.md",
        relativePath: `${PLAN_DIR_RELATIVE}/2026-10-02-branched.md`,
        bytes: 11,
        updatedAt: "2026-10-02T09:00:00.000Z",
      },
    },
  }];
  const { run, emit } = loadTools({ cwd: workspace.cwd, branch });
  await emit("session_start");
  const read = await run("read_plan", {});
  assert.equal(read.isError, undefined);
  assert.equal(read.details.filePath, planPath);
  assert.match(read.content[0].text, /branch body/);
});

test("session_tree 会重建状态（同一路径改版不会在清单里留下两份）", async (t) => {
  const workspace = makeWorkspace();
  t.after(workspace.cleanup);
  const planPath = path.join(workspace.cwd, ".pi", "plans", "2026-10-02-a.md");
  const entry = (updatedAt) => ({
    type: "message",
    message: {
      role: "toolResult",
      toolName: "write_plan",
      details: {
        kind: "pi-web-plan", tool: "write_plan", action: "created",
        filePath: planPath, fileName: "2026-10-02-a.md",
        relativePath: `${PLAN_DIR_RELATIVE}/2026-10-02-a.md`, bytes: 1, updatedAt,
      },
    },
  });
  const { run, emit } = loadTools({ cwd: workspace.cwd, branch: [entry("2026-10-02T09:00:00.000Z"), entry("2026-10-02T10:00:00.000Z")] });
  await emit("session_tree");
  // 同一份文件写过两次 → 状态里一份；读回来的是最后一次的内容
  const read = await run("read_plan", {});
  assert.equal(read.details.filePath, planPath);
  // 再写一次仍然是「更新」而不是新建第 2 份
  const rewritten = await run("write_plan", { title: "A", content: "third", path: planPath });
  assert.equal(rewritten.details.action, "updated");
});

function planDirectoryOf(cwd) {
  return path.join(cwd, ".pi", "plans");
}

function existsSyncPlan(cwd) {
  try {
    return readdirSync(path.join(cwd, ".pi")).length > 0;
  } catch {
    return false;
  }
}