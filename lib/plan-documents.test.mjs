import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  MAX_PLAN_DOCUMENT_BYTES,
  PLAN_DOCUMENTS_DIRECTORY,
  PLAN_DOCUMENTS_PER_SESSION_LIMIT,
  PLAN_DOCUMENT_SLUG_MAX_LENGTH,
  PLAN_TOOL_NAMES,
  RESERVED_SUBAGENT_TOOL_NAMES,
  currentPlanDocument,
  extractPlanDocuments,
  findPlanDocumentReferences,
  isPlanArtifactToolCall,
  isPlanDocumentPath,
  isPlanToolDetails,
  planDocumentFileName,
  planDocumentPath,
  planDocumentRelativePath,
  planDocumentSlug,
  planDocumentTitleFromFileName,
  planDocumentsDirectory,
} = await jiti.import("./plan-documents.ts");

const CWD = "/repo/pi-web";
const PLAN_DIR = "/repo/pi-web/.pi/plans";

// ── 落盘规则：放哪 ────────────────────────────────────────────────────────────
test("计划文档目录固定是会话 cwd 里的 .pi/plans/", () => {
  assert.equal(PLAN_DOCUMENTS_DIRECTORY, ".pi/plans");
  assert.equal(planDocumentsDirectory(CWD), PLAN_DIR);
  // 结尾分隔符不产生 `//plans`
  assert.equal(planDocumentsDirectory("/repo/pi-web/"), PLAN_DIR);
  // Windows 形态的 cwd 用原生分隔符（要交给 fs 的路径不能是 POSIX 样子）
  assert.equal(planDocumentsDirectory("D:\\repo\\pi-web"), "D:\\repo\\pi-web\\.pi\\plans");
  // 内部比较一律正斜杠，所以两种写法都认
  assert.ok(isPlanDocumentPath("D:/repo/pi-web/.pi/plans/2026-10-02-a.md"));
});

// ── 落盘规则：叫什么 ──────────────────────────────────────────────────────────
test("文件名 = 本地日期 + 标题 slug + .md", () => {
  const now = new Date(2026, 9, 2, 9, 30); // 本地 2026-10-02
  assert.equal(planDocumentFileName("Login flow", now), "2026-10-02-login-flow.md");
  assert.equal(planDocumentPath(CWD, "Login flow", now), `${PLAN_DIR}/2026-10-02-login-flow.md`);
});

test("slug 规则：小写、连字符、截断、中文回落", () => {
  assert.equal(planDocumentSlug("Login Flow!"), "login-flow");
  assert.equal(planDocumentSlug("  --Fix  the  BUG--  "), "fix-the-bug");
  assert.equal(planDocumentSlug("a".repeat(80)).length, PLAN_DOCUMENT_SLUG_MAX_LENGTH);
  assert.equal(planDocumentSlug("a".repeat(80)).endsWith("-"), false);
  // 全中文标题塌成空 → 回落 plan（工具描述因此要求 ASCII 英文标题）
  assert.equal(planDocumentSlug("登录流程"), "plan");
  assert.equal(planDocumentSlug(undefined), "plan");
  assert.equal(planDocumentTitleFromFileName("2026-10-02-login-flow.md"), "login flow");
});

// ── 落盘规则：识别（不是授权）────────────────────────────────────────────────
test("只认 .pi/plans/ 下的扁平 .md，且拒绝 .. 与目录", () => {
  assert.ok(isPlanDocumentPath(`${PLAN_DIR}/2026-10-02-a.md`));
  assert.equal(isPlanDocumentPath(`${PLAN_DIR}/nested/a.md`), false, "计划目录是平铺的");
  assert.equal(isPlanDocumentPath(`${PLAN_DIR}/2026-10-02-a.txt`), false);
  assert.equal(isPlanDocumentPath(`${PLAN_DIR}/`), false, "结尾分隔符 = 目录");
  assert.equal(isPlanDocumentPath("/repo/.pi/plans/../../etc/passwd"), false);
  assert.equal(isPlanDocumentPath("/repo/docs/plans/a.md"), false, "不是 .pi/plans");
  assert.equal(isPlanDocumentPath(".pi/plans/a.md"), false, "相对路径要先有 cwd 才谈得上");
  assert.equal(isPlanDocumentPath(""), false);
});

test("相对路径反推：只反推得出计划文档", () => {
  assert.equal(planDocumentRelativePath(`${PLAN_DIR}/2026-10-02-a.md`), ".pi/plans/2026-10-02-a.md");
  assert.equal(planDocumentRelativePath("/repo/docs/a.md"), null);
});

// ── 从消息里认引用 ───────────────────────────────────────────────────────────
test("正文里的绝对计划路径被认出来，标上文件名与相对路径", () => {
  const text = `我按计划做了：\n\n- 见 ${PLAN_DIR}/2026-10-02-login-flow.md\n- 再看 /repo/other/.pi/plans/2026-10-02-b.md`;
  const references = findPlanDocumentReferences(text);
  assert.deepEqual(references.map((reference) => reference.relativePath), [
    ".pi/plans/2026-10-02-login-flow.md",
    ".pi/plans/2026-10-02-b.md",
  ]);
  assert.ok(references.every((reference) => reference.absolute));
});

test("相对引用要给了 cwd 才认，句末标点不粘进路径", () => {
  assert.deepEqual(findPlanDocumentReferences("见 `.pi/plans/2026-10-02-a.md`。"), []);
  const [reference] = findPlanDocumentReferences("见 `.pi/plans/2026-10-02-a.md`。", { cwd: CWD });
  assert.equal(reference?.filePath, `${PLAN_DIR}/2026-10-02-a.md`);
  assert.equal(reference?.title, "a");
  // 结尾的句号 / 反引号 / 括号都不属于路径字符
  assert.equal(reference?.fileName, "2026-10-02-a.md");
});

test("URL 里的同样片段不算计划引用（那是一条链接，点开只会 403）", () => {
  assert.deepEqual(findPlanDocumentReferences("https://example.com/.pi/plans/2026-10-02-a.md"), []);
});

test("重复引用只留一份，且有上限", () => {
  const once = `${PLAN_DIR}/2026-10-02-a.md`;
  assert.equal(findPlanDocumentReferences(`${once} 和 ${once}`).length, 1);
  const many = Array.from({ length: 20 }, (_, index) => `${PLAN_DIR}/2026-10-02-p${index}.md`).join(" ");
  assert.equal(findPlanDocumentReferences(many).length, 8);
});

test("跟计划目录无关的普通路径一律不认", () => {
  assert.deepEqual(findPlanDocumentReferences("/repo/src/index.ts 和 docs/plans/a.md"), []);
});

// ── 转录里的计划清单（与 todo-state 同一套状态模式）───────────────────────────
function toolResult(toolName, details) {
  return { type: "message", message: { role: "toolResult", toolName, details } };
}

function writeDetails(overrides = {}) {
  return {
    kind: "pi-web-plan",
    tool: "write_plan",
    action: "created",
    filePath: `${PLAN_DIR}/2026-10-02-a.md`,
    fileName: "2026-10-02-a.md",
    relativePath: ".pi/plans/2026-10-02-a.md",
    title: "a",
    bytes: 12,
    updatedAt: "2026-10-02T09:00:00.000Z",
    ...overrides,
  };
}

test("从当前分支读回写过哪些计划，最新的在前", () => {
  const documents = extractPlanDocuments([
    toolResult("todo", { kind: "pi-web-todo" }),
    toolResult("write_plan", writeDetails()),
    toolResult("write_plan", writeDetails({
      filePath: `${PLAN_DIR}/2026-10-02-b.md`,
      fileName: "2026-10-02-b.md",
      relativePath: ".pi/plans/2026-10-02-b.md",
      title: "b",
      updatedAt: "2026-10-02T10:00:00.000Z",
    })),
    toolResult("write_plan", { ...writeDetails(), error: "Access denied" }),
  ]);
  assert.deepEqual(documents.map((document) => document.title), ["b", "a"]);
  assert.equal(currentPlanDocument([
    toolResult("write_plan", writeDetails()),
    toolResult("write_plan", writeDetails({
      filePath: `${PLAN_DIR}/2026-10-02-b.md`,
      fileName: "2026-10-02-b.md",
      relativePath: ".pi/plans/2026-10-02-b.md",
      updatedAt: "2026-10-02T10:00:00.000Z",
    })),
  ])?.fileName, "2026-10-02-b.md");
  // 读工具的结果不进清单（那是读取，不是产物）
  assert.deepEqual(extractPlanDocuments([toolResult("read_plan", writeDetails({ tool: "read_plan" }))]), []);
  assert.equal(currentPlanDocument([]), null);
});

test("details 守卫认得自己的 kind，不认别的工具的 details", () => {
  assert.ok(isPlanToolDetails(writeDetails()));
  assert.ok(isPlanToolDetails(writeDetails({ tool: "read_plan" })));
  assert.equal(isPlanToolDetails({ kind: "pi-web-todo" }), false);
  assert.equal(isPlanToolDetails({ ...writeDetails(), tool: "write_file" }), false);
  assert.equal(isPlanToolDetails(null), false);
});

// ── 工具名 ────────────────────────────────────────────────────────────────────
test("工具名不占保留名，也不与既有工具重名", () => {
  for (const name of RESERVED_SUBAGENT_TOOL_NAMES) {
    assert.equal(PLAN_TOOL_NAMES.includes(name), false, `占了保留名 ${name}`);
  }
  for (const name of ["read", "write", "edit", "bash", "grep", "find", "ls", "todo", "Agent"]) {
    assert.equal(PLAN_TOOL_NAMES.includes(name), false, `与既有工具重名 ${name}`);
  }
});

// ── 计划模式的放行判据（给 lib/plan-mode.ts 用，本 PR 不改那个文件）────────────
test("计划模式判据只放行本工具 + 计划目录里的 Markdown，且 fail closed", () => {
  const inside = { path: `${PLAN_DIR}/2026-10-02-a.md` };
  assert.equal(isPlanArtifactToolCall("write_plan", inside, PLAN_DIR), true);
  assert.equal(isPlanArtifactToolCall("read_plan", inside, PLAN_DIR), true);
  assert.equal(isPlanArtifactToolCall("read_plan", {}, PLAN_DIR), true, "不带 path = 读本会话当前那份");

  // 没给计划目录 → 一律 false（fail closed）
  assert.equal(isPlanArtifactToolCall("write_plan", inside, undefined), false);
  // 别的工具、别的目录、目录外面的文件、子目录里的文件，都不放行
  assert.equal(isPlanArtifactToolCall("write", inside, PLAN_DIR), false);
  assert.equal(isPlanArtifactToolCall("bash", { command: "cat x" }, PLAN_DIR), false);
  assert.equal(isPlanArtifactToolCall("write_plan", { path: "/repo/src/a.ts" }, PLAN_DIR), false);
  assert.equal(isPlanArtifactToolCall("write_plan", { path: `${PLAN_DIR}/nested/a.md` }, PLAN_DIR), false);
  assert.equal(isPlanArtifactToolCall("write_plan", { path: "/repo/.pi/plans/x.md" }, PLAN_DIR), false);
  assert.equal(isPlanArtifactToolCall("write_plan", { path: `${PLAN_DIR}/../secret.md` }, PLAN_DIR), false);
  assert.equal(isPlanArtifactToolCall("write_plan", { path: 42 }, PLAN_DIR), false);
  // 大小写与分隔符：Windows 上比较要折大小写
  assert.equal(
    isPlanArtifactToolCall("write_plan", { path: "D:/Repo/.pi/plans/2026-10-02-a.md" }, "D:\\Repo\\.pi\\plans"),
    true,
  );
});

// ── 常量 ──────────────────────────────────────────────────────────────────────
test("上限常量不是随手写的", () => {
  assert.equal(PLAN_DOCUMENTS_PER_SESSION_LIMIT, 8);
  assert.equal(MAX_PLAN_DOCUMENT_BYTES, 256 * 1024);
});