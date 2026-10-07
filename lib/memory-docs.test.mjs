// fork:memory-docs —— 记忆文档的列出 / 读 / 写，重点在**路径边界**。
//
// 这一层是唯一的授权点：面板只传 `scope` + `project` + `name` 三段，路径在服务端拼。
// 所以下面把「段不干净」「符号链接指到根外」「不是 .md」逐条钉住 —— 记忆目录里同时躺着
// 36 MB 的 sessions.db 与扩展自己的锁文件，一个拼错就是「把别处的文件读出来再写回去」。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  MEMORY_DOC_MAX_BYTES,
  listMemoryDocuments,
  listMemoryProjects,
  readMemoryDocument,
  resolveMemoryDocument,
  writeMemoryDocument,
} = await createJiti(import.meta.url, { moduleCache: false }).import("./memory-docs.ts");

/** 造一个「像真的」记忆目录：文档 + 内部件（sqlite / 点文件 / json）。 */
function fixture() {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-memdocs-"));
  const global = join(agentDir, "pi-hermes-memory");
  const projects = join(agentDir, "projects-memory");
  mkdirSync(join(global, "daily"), { recursive: true });
  mkdirSync(join(global, "recovery"), { recursive: true });
  mkdirSync(join(projects, "PI NEXT"), { recursive: true });
  mkdirSync(join(projects, "pi-web-chat"), { recursive: true });

  writeFileSync(join(global, "MEMORY.md"), "# Memory\n\n- 一条记忆\n");
  writeFileSync(join(global, "failures.md"), "# Failures\n");
  writeFileSync(join(global, "daily", "2026-09-18.md"), "# 2026-09-18\n");
  // 内部件：一律不该出现在清单里
  writeFileSync(join(global, "sessions.db"), "sqlite");
  writeFileSync(join(global, ".pi-hermes-locks.sqlite"), "lock");
  writeFileSync(join(global, ".skills-migrated-to-extension-storage"), "25");
  writeFileSync(join(global, "recovery", "abc.json"), "{}");
  // 项目记忆
  writeFileSync(join(projects, "PI NEXT", "MEMORY.md"), "- 项目记忆\n");
  // 空项目目录（pi-web-chat 在真机上也可能是空的）
  return { agentDir, global, projects };
}

test("清单只收 .md：全局在前，然后逐个项目（项目名带出来）", () => {
  const { agentDir } = fixture();
  const docs = listMemoryDocuments(agentDir);
  assert.deepEqual(
    docs.map((d) => [d.scope, d.project, d.name]),
    [
      // 同一根内按 `localeCompare` 排（d < f < m）——「daily 在前」是副作用不是约定。
      ["global", null, "daily/2026-09-18.md"],
      ["global", null, "failures.md"],
      ["global", null, "MEMORY.md"],
      ["project", "PI NEXT", "MEMORY.md"],
    ],
  );
  // 内部件一个都不许出现（sqlite / 点文件 / recovery 里的 json）。
  const names = docs.map((d) => d.name).join(" ");
  for (const hidden of ["sessions.db", "locks", "skills-migrated", ".json"]) {
    assert.ok(!names.includes(hidden), `不该列出 ${hidden}`);
  }
});

test("listMemoryProjects 只看目录、跳过点开头", () => {
  const { agentDir, projects } = fixture();
  writeFileSync(join(projects, "README.txt"), "not a project");
  assert.deepEqual(listMemoryProjects(agentDir), ["PI NEXT", "pi-web-chat"]);
});

test("resolveMemoryDocument：形状不干净一律 400，不猜也不回显", () => {
  const { agentDir } = fixture();
  const bad = [
    { scope: "nope", name: "MEMORY.md" },
    { scope: "global", name: "" },
    { scope: "global", name: "MEMORY.txt" },
    { scope: "global", name: "../MEMORY.md" },
    { scope: "global", name: "daily/../../MEMORY.md" },
    { scope: "global", name: "/etc/passwd.md" },
    { scope: "project", project: "../PI NEXT", name: "MEMORY.md" },
    { scope: "project", project: "PI NEXT/../pi-web-chat", name: "MEMORY.md" },
    { scope: "project", name: "MEMORY.md" },
  ];
  for (const input of bad) {
    const result = resolveMemoryDocument(input, agentDir);
    assert.equal(result.ok, false, `${JSON.stringify(input)} 不该通过`);
    assert.equal(result.status, 400);
  }
  // 合法的两条：全局与项目
  assert.equal(resolveMemoryDocument({ scope: "global", name: "MEMORY.md" }, agentDir).ok, true);
  assert.equal(
    resolveMemoryDocument({ scope: "project", project: "PI NEXT", name: "MEMORY.md" }, agentDir).ok,
    true,
  );
});

test("符号链接指到根外：拒绝（resolve 不跟链接，realpath 复核兜底）", () => {
  const { agentDir, global } = fixture();
  const outside = join(agentDir, "outside.md");
  writeFileSync(outside, "不该被读到\n");
  symlinkSync(outside, join(global, "link.md"));
  const result = resolveMemoryDocument({ scope: "global", name: "link.md" }, agentDir);
  assert.equal(result.ok, false, "指向根外的符号链接必须被拒");
  assert.equal(readMemoryDocument({ scope: "global", name: "link.md" }, agentDir).ok, false);
});

test("读：缺文件 404，正常文件回全文", () => {
  const { agentDir } = fixture();
  assert.equal(readMemoryDocument({ scope: "global", name: "nope.md" }, agentDir).status, 404);

  const read = readMemoryDocument({ scope: "global", name: "MEMORY.md" }, agentDir);
  assert.equal(read.ok, true);
  assert.equal(read.document.content, "# Memory\n\n- 一条记忆\n");
  assert.equal(read.document.project, null);

  const project = readMemoryDocument({ scope: "project", project: "PI NEXT", name: "MEMORY.md" }, agentDir);
  assert.equal(project.ok, true);
  assert.equal(project.document.project, "PI NEXT");
  assert.equal(project.document.content, "- 项目记忆\n");
});

test("写：原子写 + 自动建目录 + 原文往返；越界与超限都拒", () => {
  const { agentDir } = fixture();
  // 目录还不存在时也能写（daily/ 可能还没建）
  const created = writeMemoryDocument(
    { scope: "global", name: "daily/2026-10-07.md", content: "# 新的一天\n" },
    agentDir,
  );
  assert.equal(created.ok, true);
  assert.equal(
    readMemoryDocument({ scope: "global", name: "daily/2026-10-07.md" }, agentDir).document.content,
    "# 新的一天\n",
  );

  // 覆盖既有文档：清单里的 bytes / mtime 跟着更新
  const rewritten = writeMemoryDocument({ scope: "global", name: "MEMORY.md", content: "# 改过了\n" }, agentDir);
  assert.equal(rewritten.ok, true);
  const doc = listMemoryDocuments(agentDir).find((d) => d.name === "MEMORY.md");
  assert.equal(doc.bytes, Buffer.byteLength("# 改过了\n", "utf8"));

  // 写不能越界（复用读那条边界）
  assert.equal(writeMemoryDocument({ scope: "global", name: "../x.md", content: "x" }, agentDir).status, 400);
  // content 必须是字符串
  assert.equal(writeMemoryDocument({ scope: "global", name: "MEMORY.md", content: 42 }, agentDir).status, 400);
  // 超限
  const huge = "a".repeat(MEMORY_DOC_MAX_BYTES + 1);
  assert.equal(
    writeMemoryDocument({ scope: "global", name: "MEMORY.md", content: huge }, agentDir).status,
    413,
  );
  // 根不存在 → 404（不是 400：形状是对的，只是还没这回事）
  const { agentDir: emptyDir } = { agentDir: mkdtempSync(join(tmpdir(), "pi-memdocs-empty-")) };
  assert.equal(resolveMemoryDocument({ scope: "global", name: "MEMORY.md" }, emptyDir).status, 404);
});
