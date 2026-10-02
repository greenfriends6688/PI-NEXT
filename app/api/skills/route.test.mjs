import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// fork:bulk-routes（上游 `eceac13` #1020 移植）—— `PATCH /api/skills` 的
// 批量形态（技能页的「整组开/关」）与单条形态：一次请求、逐条作答。
// 部分失败语义是这里最要紧的一条：被拒的那条**保持原状**、如实报出，其余照改。

const root = await mkdtemp(join(tmpdir(), "pi-web-skills-route-"));
const agentDir = join(root, "agent");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { PATCH } = await jiti.import("./route.ts");

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

async function writeSkill(dir, name, frontmatter = "") {
  const filePath = join(dir, name, "SKILL.md");
  await mkdir(join(dir, name), { recursive: true });
  await writeFile(filePath, `---\nname: ${name}\n${frontmatter}description: ${name} skill\n---\n\n# ${name}\n`);
  return filePath;
}

function patchSkills(body) {
  return PATCH(new Request("http://localhost/api/skills", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

test("a batch hides every listed skill and reports each file on its own", async () => {
  const skillsDir = join(agentDir, "skills");
  const visible = await writeSkill(skillsDir, "visible");
  const hidden = await writeSkill(skillsDir, "hidden", "disable-model-invocation: true\n");
  const outside = await writeSkill(join(root, "outside"), "outside");
  const missing = join(skillsDir, "missing", "SKILL.md");
  const hiddenBefore = await stat(hidden);
  const outsideBefore = await readFile(outside, "utf8");

  const response = await patchSkills({
    filePaths: [visible, hidden, outside, missing, visible],
    disableModelInvocation: true,
  });

  assert.equal(response.status, 200);
  // 去重：重复出现的 `visible` 只答一条。
  assert.deepEqual(await response.json(), {
    results: [
      { filePath: visible },
      { filePath: hidden },
      { filePath: outside, error: "Access denied" },
      { filePath: missing, error: "file not found" },
    ],
  });
  assert.equal(
    await readFile(visible, "utf8"),
    "---\ndisable-model-invocation: true\nname: visible\ndescription: visible skill\n---\n\n# visible\n",
  );
  // 已经在目标状态的技能不重写，被拒的那条一个字节都不动。
  assert.equal((await stat(hidden)).mtimeMs, hiddenBefore.mtimeMs);
  assert.equal(await readFile(outside, "utf8"), outsideBefore);
});

test("a batch keeps going past a skill whose frontmatter cannot be edited", async () => {
  const skillsDir = join(agentDir, "skills");
  const shown = await writeSkill(skillsDir, "to-show", "disable-model-invocation: true\n");
  const unsupported = join(skillsDir, "unsupported", "SKILL.md");
  await mkdir(join(skillsDir, "unsupported"), { recursive: true });
  // 解析成 frontmatter，但那个键待在一行流式映射里，外科手术式的编辑器拒绝改写。
  await writeFile(unsupported, "---\n{ name: unsupported, disable-model-invocation: true }\n---\nbody\n");

  const response = await patchSkills({ filePaths: [unsupported, shown], disableModelInvocation: false });
  const { results } = await response.json();

  assert.equal(response.status, 200);
  assert.match(results[0].error, /unsupported frontmatter formatting/);
  assert.deepEqual(results[1], { filePath: shown });
  assert.doesNotMatch(await readFile(shown, "utf8"), /disable-model-invocation/);
});

test("a single-skill toggle keeps its original response shape", async () => {
  const skill = await writeSkill(join(agentDir, "skills"), "single");

  const response = await patchSkills({ filePath: skill, disableModelInvocation: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.match(await readFile(skill, "utf8"), /disable-model-invocation: true/);

  const refused = await patchSkills({
    filePath: join(root, "outside", "outside", "SKILL.md"),
    disableModelInvocation: true,
  });
  assert.equal(refused.status, 403);
});

test("a malformed batch is rejected before any file is edited", async () => {
  const skill = await writeSkill(join(agentDir, "skills"), "untouched");
  const before = await readFile(skill, "utf8");

  assert.equal((await patchSkills({ filePaths: [skill, 42], disableModelInvocation: true })).status, 400);
  assert.equal((await patchSkills({ filePaths: skill, disableModelInvocation: true })).status, 400);
  assert.equal((await patchSkills({ filePaths: [skill], disableModelInvocation: "yes" })).status, 400);
  assert.equal(await readFile(skill, "utf8"), before);
});

test("only markdown files are edited, however they are named in the request", async () => {
  // auth.json 与 settings.json 就在允许根里，往它们顶上插 frontmatter 会把它们弄坏。
  const authPath = join(agentDir, "auth.json");
  const auth = JSON.stringify({ provider: { type: "api_key", key: "test" } });
  await mkdir(agentDir, { recursive: true });
  await writeFile(authPath, auth);

  const single = await patchSkills({ filePath: authPath, disableModelInvocation: true });
  assert.equal(single.status, 400);
  const batch = await patchSkills({ filePaths: [authPath], disableModelInvocation: true });
  assert.deepEqual(await batch.json(), { results: [{ filePath: authPath, error: "Not a skill file" }] });
  assert.equal(await readFile(authPath, "utf8"), auth);
});