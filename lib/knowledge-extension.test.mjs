// lib/knowledge-extension.ts + lib/knowledge-store.ts 的单测。
// 所有文件读写都在 os.tmpdir() 里，绝不触碰 ~/.pi/。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  HOST_KNOWLEDGE_EXTENSION_NAME,
  KNOWLEDGE_BLOCK_START,
  KNOWLEDGE_BLOCK_END,
  KNOWLEDGE_PROPOSE_TOOL_NAME,
  KNOWLEDGE_WRITE_TOOL_NAME,
  applyManagedBlock,
  createKnowledgeExtension,
  isValidKnowledgeSlug,
  knowledgeCandidateId,
  knowledgeWriteDeniedMessage,
  routeKnowledgeTarget,
  slugifyKnowledgeTitle,
  writeKnowledgeEntry,
} = await jiti.import("./knowledge-extension.ts");
const {
  isKnowledgeMaintenanceApproved,
  readKnowledgeMaintenanceState,
  writeKnowledgeMaintenanceApproval,
} = await jiti.import("./knowledge-store.ts");

function createTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-knowledge-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function createProject(root) {
  const project = path.join(root, "project");
  fs.mkdirSync(project, { recursive: true });
  return project;
}

/** 捕获扩展注册的工具，返回 name → tool 的 Map。 */
function captureTools(extension) {
  const tools = new Map();
  extension.factory({ registerTool: (tool) => tools.set(tool.name, tool) });
  return tools;
}

function runTool(tool, params, cwd) {
  return tool.execute("call-1", params, undefined, undefined, { cwd });
}

// ---------------------------------------------------------------------------
// 授权门：拒绝路径（本 PR 的核心）
// ---------------------------------------------------------------------------

test("未授权时 knowledge_write 返回拒绝，且没有产生任何文件", async (t) => {
  const root = createTempRoot(t);
  const project = createProject(root);
  const storePath = path.join(root, "store.json");
  const tools = captureTools(createKnowledgeExtension({ storePath }));

  const result = await runTool(
    tools.get(KNOWLEDGE_WRITE_TOOL_NAME),
    { target: "agents_md", title: "Commands", body: "npm test" },
    project,
  );

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not been approved/);
  assert.match(result.content[0].text, /knowledge_propose/);
  // 授权说明必须给出可操作入口
  assert.match(result.content[0].text, /Settings/);
  // 拒绝路径绝不留文件：项目目录与授权 store 都不存在。
  assert.deepEqual(fs.readdirSync(project), []);
  assert.equal(fs.existsSync(storePath), false);
});

test("拒绝信息是纯函数生成的，包含项目路径", () => {
  const message = knowledgeWriteDeniedMessage("/tmp/demo-project");
  assert.match(message, /knowledge_propose/);
  assert.match(message, /\/tmp\/demo-project/);
  assert.match(message, /knowledge-maintenance/);
});

test("未授权的扩展仍然允许 knowledge_propose（只读）", async (t) => {
  const root = createTempRoot(t);
  const project = createProject(root);
  const tools = captureTools(createKnowledgeExtension({ isApproved: () => false }));

  const result = await runTool(
    tools.get(KNOWLEDGE_PROPOSE_TOOL_NAME),
    { kind: "project_fact", title: "Build", body: "Runs with npm test" },
    project,
  );

  assert.equal(result.isError, undefined);
  assert.equal(result.details.candidateId, knowledgeCandidateId("project_fact", "Build", "Runs with npm test"));
  assert.equal(result.details.target, "agents_md");
  assert.deepEqual(fs.readdirSync(project), []);
});

test("授权后 knowledge_write 落盘；撤销后再次拒绝", async (t) => {
  const root = createTempRoot(t);
  const project = createProject(root);
  const storePath = path.join(root, "store.json");
  const tools = captureTools(createKnowledgeExtension({ storePath }));

  assert.equal(isKnowledgeMaintenanceApproved(project, storePath), false);
  writeKnowledgeMaintenanceApproval(project, true, storePath);
  assert.equal(isKnowledgeMaintenanceApproved(project, storePath), true);

  const written = await runTool(
    tools.get(KNOWLEDGE_WRITE_TOOL_NAME),
    { target: "agents_md", title: "Commands", body: "npm test" },
    project,
  );
  assert.equal(written.isError, undefined);
  assert.equal(written.details.action, "created");
  assert.match(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"), /npm test/);

  writeKnowledgeMaintenanceApproval(project, false, storePath);
  const denied = await runTool(
    tools.get(KNOWLEDGE_WRITE_TOOL_NAME),
    { target: "agents_md", title: "Commands", body: "npm run test" },
    project,
  );
  assert.equal(denied.isError, true);
});

test("损坏的授权 store 一律 fail closed，且写入路径不会覆盖它", async (t) => {
  const root = createTempRoot(t);
  const project = createProject(root);
  const storePath = path.join(root, "store.json");
  fs.writeFileSync(storePath, "{");

  assert.equal(isKnowledgeMaintenanceApproved(project, storePath), false);
  assert.throws(() => readKnowledgeMaintenanceState(storePath));
  assert.throws(() => writeKnowledgeMaintenanceApproval(project, true, storePath));
  assert.equal(fs.readFileSync(storePath, "utf8"), "{");
});

test("授权 store 保留不认识的字段", async (t) => {
  const root = createTempRoot(t);
  const project = createProject(root);
  const storePath = path.join(root, "store.json");
  fs.writeFileSync(storePath, JSON.stringify({ version: 1, approvedProjects: [], future: 7 }));
  writeKnowledgeMaintenanceApproval(project, true, storePath);
  assert.deepEqual(JSON.parse(fs.readFileSync(storePath, "utf8")), {
    version: 1,
    approvedProjects: [fs.realpathSync(project)],
    future: 7,
  });
});

// ---------------------------------------------------------------------------
// 路由与候选 id（纯函数）
// ---------------------------------------------------------------------------

test("路由表把 kind 映射到 AGENTS.md / memory / skill", () => {
  assert.equal(routeKnowledgeTarget("project_fact").target, "agents_md");
  assert.equal(routeKnowledgeTarget("command").target, "agents_md");
  assert.equal(routeKnowledgeTarget("architecture").target, "agents_md");
  assert.equal(routeKnowledgeTarget("preference").target, "memory");
  assert.equal(routeKnowledgeTarget("decision").target, "memory");
  assert.equal(routeKnowledgeTarget("procedure").target, "skill");
  assert.equal(routeKnowledgeTarget("workflow").target, "skill");
  // 显式 target 覆盖路由
  assert.equal(routeKnowledgeTarget("procedure", "agents_md").target, "agents_md");
  assert.equal(routeKnowledgeTarget("procedure", "agents_md").reason, "explicit");
  // 未知 kind 默认 memory
  assert.equal(routeKnowledgeTarget("whatever").target, "memory");
});

test("candidate id 稳定且随内容变化；slug 归一化合法", () => {
  assert.equal(
    knowledgeCandidateId("a", "b", "c"),
    knowledgeCandidateId("a", "b", "c"),
  );
  assert.notEqual(knowledgeCandidateId("a", "b", "c"), knowledgeCandidateId("a", "b", "d"));
  assert.equal(slugifyKnowledgeTitle("Build & Test!"), "build-test");
  assert.equal(slugifyKnowledgeTitle("中文标题"), "knowledge");
  assert.equal(isValidKnowledgeSlug("my-skill"), true);
  assert.equal(isValidKnowledgeSlug("../evil"), false);
  assert.equal(isValidKnowledgeSlug("Upper"), false);
  assert.equal(isValidKnowledgeSlug("-leading"), false);
});

// ---------------------------------------------------------------------------
// 写盘纪律：AGENTS.md 受管区块
// ---------------------------------------------------------------------------

test("applyManagedBlock 只替换区块，区块外一个字节都不动", () => {
  const existing = [
    "# My Project",
    "",
    "user prose before",
    "",
    KNOWLEDGE_BLOCK_START,
    "old managed content",
    KNOWLEDGE_BLOCK_END,
    "",
    "user prose after",
    "",
  ].join("\n");

  const { content, action } = applyManagedBlock(existing, "# New\n\nbody");
  assert.equal(action, "updated");
  assert.ok(content.startsWith("# My Project\n\nuser prose before\n\n"));
  assert.ok(content.endsWith("\n\nuser prose after\n"));
  assert.match(content, /# New\n\nbody/);
  assert.doesNotMatch(content, /old managed content/);
  // 只有一份区块
  assert.equal(content.split(KNOWLEDGE_BLOCK_START).length - 1, 1);
});

test("applyManagedBlock 在无区块时追加，不重写用户内容", () => {
  const existing = "# My Project\n\nuser prose\n";
  const { content, action } = applyManagedBlock(existing, "# Commands\n\nnpm test");
  assert.equal(action, "appended");
  assert.ok(content.startsWith(existing));
  assert.match(content, /npm test/);
});

test("applyManagedBlock 对新文件返回 created；相同内容返回 unchanged", () => {
  const first = applyManagedBlock(null, "# T\n\nB");
  assert.equal(first.action, "created");
  const second = applyManagedBlock(first.content, "# T\n\nB");
  assert.equal(second.action, "unchanged");
  assert.equal(second.content, first.content);
});

test("AGENTS.md 写入保留用户内容，重复写入原地更新", (t) => {
  const root = createTempRoot(t);
  const project = createProject(root);
  const agentsPath = path.join(project, "AGENTS.md");
  fs.writeFileSync(agentsPath, "# My Project\n\nDo not touch this line.\n");

  writeKnowledgeEntry({ projectRoot: project, target: "agents_md", title: "Commands", body: "npm test" });
  const afterFirst = fs.readFileSync(agentsPath, "utf8");
  assert.ok(afterFirst.startsWith("# My Project\n\nDo not touch this line.\n"));
  assert.match(afterFirst, /npm test/);

  const result = writeKnowledgeEntry({ projectRoot: project, target: "agents_md", title: "Commands", body: "npm run test" });
  assert.equal(result.action, "updated");
  const afterSecond = fs.readFileSync(agentsPath, "utf8");
  assert.ok(afterSecond.startsWith("# My Project\n\nDo not touch this line.\n"));
  assert.match(afterSecond, /npm run test/);
  assert.doesNotMatch(afterSecond, /npm test(?!\s*$)/m);
  // 不留原子写的临时文件
  assert.ok(!fs.readdirSync(project).some((name) => name.endsWith(".tmp")));
});

test("memory 目标新建文件，已存在则扩展受管区块", (t) => {
  const root = createTempRoot(t);
  const project = createProject(root);

  const first = writeKnowledgeEntry({ projectRoot: project, target: "memory", slug: "lessons", title: "Lesson", body: "Always run tsc." });
  assert.equal(first.action, "created");
  const memoryPath = path.join(project, "memory", "lessons.md");
  assert.ok(fs.existsSync(memoryPath));

  const second = writeKnowledgeEntry({ projectRoot: project, target: "memory", slug: "lessons", title: "Lesson", body: "Always run lint too." });
  assert.equal(second.action, "updated");
  assert.match(fs.readFileSync(memoryPath, "utf8"), /Always run lint too\./);
});

// ---------------------------------------------------------------------------
// 写盘纪律：skill 只新建
// ---------------------------------------------------------------------------

test("skill 只新建：同名目录已存在就拒绝，且不改动已有内容", (t) => {
  const root = createTempRoot(t);
  const project = createProject(root);

  const created = writeKnowledgeEntry({
    projectRoot: project,
    target: "skill",
    slug: "release-check",
    title: "Release check",
    body: "1. run tests",
  });
  assert.equal(created.action, "created");
  const skillPath = path.join(project, ".agents", "skills", "release-check", "SKILL.md");
  assert.match(fs.readFileSync(skillPath, "utf8"), /name: "release-check"/);
  assert.match(fs.readFileSync(skillPath, "utf8"), /description: "Release check"/);

  fs.writeFileSync(skillPath, "user edited skill\n");
  assert.throws(
    () => writeKnowledgeEntry({
      projectRoot: project,
      target: "skill",
      slug: "release-check",
      title: "Release check",
      body: "1. run tests again",
    }),
    (error) => error.code === "already_exists",
  );
  assert.equal(fs.readFileSync(skillPath, "utf8"), "user edited skill\n");
});

test("非法 slug / 空标题 / 空 body 一律拒绝", (t) => {
  const root = createTempRoot(t);
  const project = createProject(root);

  assert.throws(
    () => writeKnowledgeEntry({ projectRoot: project, target: "memory", slug: "../escape", title: "T", body: "B" }),
    (error) => error.code === "invalid_slug",
  );
  assert.throws(
    () => writeKnowledgeEntry({ projectRoot: project, target: "memory", slug: "notes", title: "  ", body: "B" }),
    (error) => error.code === "invalid_input",
  );
  assert.throws(
    () => writeKnowledgeEntry({ projectRoot: project, target: "agents_md", title: "T", body: "   " }),
    (error) => error.code === "invalid_input",
  );
  assert.deepEqual(fs.readdirSync(project), []);
});

// ---------------------------------------------------------------------------
// 路径边界
// ---------------------------------------------------------------------------

test("memory 是指向项目外的符号链接时拒绝写入", (t) => {
  const root = createTempRoot(t);
  const project = createProject(root);
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside, { recursive: true });
  try {
    fs.symlinkSync(outside, path.join(project, "memory"), "dir");
  } catch {
    t.skip("symlink not supported here");
    return;
  }

  assert.throws(
    () => writeKnowledgeEntry({ projectRoot: project, target: "memory", slug: "notes", title: "T", body: "B" }),
    (error) => error.code === "outside_root",
  );
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("AGENTS.md 是指向项目外的符号链接时拒绝写入", (t) => {
  const root = createTempRoot(t);
  const project = createProject(root);
  const outsideFile = path.join(root, "outside.md");
  fs.writeFileSync(outsideFile, "outside\n");
  try {
    fs.symlinkSync(outsideFile, path.join(project, "AGENTS.md"), "file");
  } catch {
    t.skip("symlink not supported here");
    return;
  }

  assert.throws(
    () => writeKnowledgeEntry({ projectRoot: project, target: "agents_md", title: "T", body: "B" }),
    (error) => error.code === "outside_root",
  );
  assert.equal(fs.readFileSync(outsideFile, "utf8"), "outside\n");
});

// ---------------------------------------------------------------------------
// 工具名
// ---------------------------------------------------------------------------

test("工具名不占用子代理保留名", () => {
  const reserved = new Set(["Agent", "get_subagent_result", "steer_subagent"]);
  const tools = captureTools(createKnowledgeExtension({ isApproved: () => false }));
  assert.equal(tools.has(KNOWLEDGE_PROPOSE_TOOL_NAME), true);
  assert.equal(tools.has(KNOWLEDGE_WRITE_TOOL_NAME), true);
  for (const name of tools.keys()) assert.equal(reserved.has(name), false);
  assert.equal(HOST_KNOWLEDGE_EXTENSION_NAME, "pi-web-knowledge");
});

test("knowledge_propose 是只读工具：计划档放行、ask 档不弹卡；knowledge_write 相反", async () => {
  const { decideApproval } = await jiti.import("./approval-policy.ts");
  const { decidePlanModeToolCall } = await jiti.import("./plan-mode.ts");
  assert.equal(decideApproval({ mode: "ask", toolName: KNOWLEDGE_PROPOSE_TOOL_NAME, input: {} }).needsApproval, false);
  assert.equal(decidePlanModeToolCall(KNOWLEDGE_PROPOSE_TOOL_NAME, {}).allowed, true);
  assert.equal(decideApproval({ mode: "ask", toolName: KNOWLEDGE_WRITE_TOOL_NAME, input: {} }).needsApproval, true);
  assert.equal(decidePlanModeToolCall(KNOWLEDGE_WRITE_TOOL_NAME, {}).allowed, false);
});
