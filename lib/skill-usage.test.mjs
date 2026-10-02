import assert from "node:assert/strict";
import test from "node:test";
import { homedir } from "node:os";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  collectExplicitSkillActivations,
  collectSkillActivations,
  collectSuccessfulSkillReadActivations,
  getSkillSlugFromEntryPath,
  mergeSkillActivations,
} = await jiti.import("./skill-usage.ts");

const HOME = homedir();

function readCall(id, path) {
  return {
    type: "toolCall",
    toolCallId: id,
    toolName: "read",
    input: { file_path: path },
  };
}

function assistant(...blocks) {
  return { role: "assistant", content: blocks, model: "m", provider: "p" };
}

function okResult(id) {
  return { role: "toolResult", toolCallId: id, content: [{ type: "text", text: "# skill" }] };
}

function errorResult(id) {
  return { role: "toolResult", toolCallId: id, content: [{ type: "text", text: "no such file" }], isError: true };
}

function user(text) {
  return { role: "user", content: text };
}

/** 一条读成功 + 一条读报错，指向两个不同的 skill。 */
function turn(overrides = {}) {
  return [
    user("do the thing"),
    assistant(
      readCall("1", `${HOME}/.pi/agent/skills/skill-creator/SKILL.md`),
      readCall("2", `${HOME}/.pi/agent/skills/broken/SKILL.md`),
    ),
    okResult("1"),
    errorResult("2"),
    ...(overrides.messages ?? []),
  ];
}

test("a paired, non-erroring read of SKILL.md activates the skill", () => {
  assert.deepEqual(collectSuccessfulSkillReadActivations(turn()), [
    { slug: "skill-creator", sources: ["read"], workspaceSkillPath: "skill-creator/SKILL.md" },
  ]);
});

test("a bare tool_call with no tool_result never becomes an activation", () => {
  // 模型可能压根没读到（路径拼错、被权限拒绝、还在流式）。裸调用不算证据。
  const messages = [
    user("go"),
    assistant(readCall("1", `${HOME}/.pi/agent/skills/skill-creator/SKILL.md`)),
  ];
  assert.deepEqual(collectSuccessfulSkillReadActivations(messages), []);
});

test("an errored tool_result does not activate the skill", () => {
  const messages = [
    user("go"),
    assistant(readCall("1", `${HOME}/.pi/agent/skills/skill-creator/SKILL.md`)),
    errorResult("1"),
  ];
  assert.deepEqual(collectSuccessfulSkillReadActivations(messages), []);
});

test("an errored result consumes the pending call so a later result cannot revive it", () => {
  const messages = [
    assistant(readCall("1", `${HOME}/.pi/agent/skills/skill-creator/SKILL.md`)),
    errorResult("1"),
    okResult("1"),
  ];
  assert.deepEqual(collectSuccessfulSkillReadActivations(messages), []);
});

test("a bare tool_result with no preceding call is ignored", () => {
  assert.deepEqual(collectSuccessfulSkillReadActivations([okResult("ghost")]), []);
});

test("reads other files and other tools never look like a skill", () => {
  const messages = [
    assistant(
      readCall("1", `${HOME}/.pi/agent/skills/skill-creator/README.md`),
      { type: "toolCall", toolCallId: "2", toolName: "bash", input: { command: `cat ${HOME}/.pi/agent/skills/x/SKILL.md` } },
      { type: "toolCall", toolCallId: "3", toolName: "write", input: { file_path: `${HOME}/skills/y/SKILL.md` } },
    ),
    okResult("1"),
    okResult("2"),
    okResult("3"),
  ];
  assert.deepEqual(collectSuccessfulSkillReadActivations(messages), []);
});

test("accepts pi's raw file-format field names and Windows separators", () => {
  // 落盘格式 `{id, name, arguments}`（normalizeToolCalls 之前）+ 反斜杠路径。
  const messages = [
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "1", name: "read", arguments: { path: "C:\\Users\\me\\.pi\\agent\\skills\\skill-creator\\SKILL.md" } }],
      model: "m",
      provider: "p",
    },
    okResult("1"),
  ];
  assert.deepEqual(collectSuccessfulSkillReadActivations(messages), [
    { slug: "skill-creator", sources: ["read"], workspaceSkillPath: "skill-creator/SKILL.md" },
  ]);
});

test("getSkillSlugFromEntryPath normalizes Windows separators", () => {
  assert.equal(getSkillSlugFromEntryPath("C:\\Users\\me\\.pi\\agent\\skills\\skill-creator\\SKILL.md"), "skill-creator");
  assert.equal(getSkillSlugFromEntryPath("skills/skill-creator/SKILL.md"), "skill-creator");
  assert.equal(getSkillSlugFromEntryPath("/Users/me/.agents/skills/skill-creator/skill.md"), "skill-creator");
  assert.equal(getSkillSlugFromEntryPath("/Users/me/skills/skill-creator/README.md"), null);
  assert.equal(getSkillSlugFromEntryPath("/Users/me/skills/skill-creator"), null);
});

test("no field ever carries the absolute path back out", () => {
  const messages = [
    user("use /skill:skill-creator now"),
    assistant(readCall("1", `${HOME}/.pi/agent/skills/skill-creator/SKILL.md`)),
    okResult("1"),
  ];
  const serialized = JSON.stringify(collectSkillActivations(messages));
  assert.ok(!serialized.includes(HOME), `absolute path leaked: ${serialized}`);
  assert.ok(!serialized.includes("/Users/"));
  assert.deepEqual(Object.keys(collectSkillActivations(messages)[0]).sort(), ["slug", "sources", "workspaceSkillPath"]);
});

test("a merged activation cannot smuggle a path in through mergeSkillActivations", () => {
  const merged = mergeSkillActivations([
    { slug: "skill-creator", sources: ["read"], workspaceSkillPath: `${HOME}/.pi/agent/skills/skill-creator/SKILL.md` },
    { slug: "evil", sources: ["read"], workspaceSkillPath: "../../etc/passwd" },
    { slug: "", sources: ["read"], workspaceSkillPath: "x/SKILL.md" },
  ]);
  // 调用方传进来的 workspaceSkillPath 一律不信：按校验过的 slug 重算。
  assert.deepEqual(merged, [
    { slug: "skill-creator", sources: ["read"], workspaceSkillPath: "skill-creator/SKILL.md" },
    { slug: "evil", sources: ["read"], workspaceSkillPath: "evil/SKILL.md" },
  ]);
  assert.ok(!JSON.stringify(merged).includes("etc/passwd"));
});

test("slugs carrying traversal characters are rejected", () => {
  assert.equal(getSkillSlugFromEntryPath("/Users/me/skills/../SKILL.md"), null);
  assert.equal(getSkillSlugFromEntryPath("/Users/me/skills/..%2f..%2fetc/SKILL.md"), null);
  // `/skill:` mention 里带 `..` / 路径分隔符 / 点号的，一概不算 skill。
  const messages = [
    user("/skill:../evil and /skill:a/b and /skill:foo.md"),
    assistant(readCall("1", "/Users/me/skills/../SKILL.md")),
    okResult("1"),
  ];
  assert.deepEqual(collectExplicitSkillActivations(messages), []);
  assert.deepEqual(collectSuccessfulSkillReadActivations(messages), []);
  assert.deepEqual(mergeSkillActivations([{ slug: "..", sources: ["read"], workspaceSkillPath: "../SKILL.md" }]), []);
});

test("a /skill: mention activates the skill only when its SKILL.md was read", () => {
  const messages = [
    user("please use /skill:skill-creator for this"),
    assistant(readCall("1", `${HOME}/.pi/agent/skills/skill-creator/SKILL.md`)),
    okResult("1"),
  ];
  assert.deepEqual(collectExplicitSkillActivations(messages), [
    { slug: "skill-creator", sources: ["explicit"], workspaceSkillPath: "skill-creator/SKILL.md" },
  ]);
});

test("a /skill: mention with no successful read produces no explicit activation", () => {
  const messages = [
    user("please use /skill:skill-creator for this"),
    assistant(readCall("1", `${HOME}/.pi/agent/skills/skill-creator/SKILL.md`)),
    errorResult("1"),
  ];
  assert.deepEqual(collectExplicitSkillActivations(messages), []);
  assert.deepEqual(collectSkillActivations(messages), []);
});

test("a failed read leaves the explicit source off while another skill keeps its read chip", () => {
  const activations = collectSkillActivations([
    user("/skill:guizang-ppt-skill"),
    assistant(
      readCall("1", `${HOME}/.pi/agent/skills/guizang-ppt-skill/SKILL.md`),
      readCall("2", `${HOME}/.pi/agent/skills/skill-creator/SKILL.md`),
    ),
    okResult("1"),
    errorResult("2"),
  ]);
  assert.deepEqual(activations, [
    { slug: "guizang-ppt-skill", sources: ["explicit", "read"], workspaceSkillPath: "guizang-ppt-skill/SKILL.md" },
  ]);
});

test("an explicitly named skill still gets its read chip when the mention never matched", () => {
  const activations = collectSkillActivations(turn());
  assert.deepEqual(activations, [
    { slug: "skill-creator", sources: ["read"], workspaceSkillPath: "skill-creator/SKILL.md" },
  ]);
});

test("the spelled-out mention spelling is kept as the display name", () => {
  const activations = collectSkillActivations([
    user("use /skill:Skill-Creator"),
    assistant(readCall("1", `${HOME}/.pi/agent/skills/skill-creator/SKILL.md`)),
    okResult("1"),
  ]);
  assert.deepEqual(activations, [
    { slug: "skill-creator", name: "Skill-Creator", sources: ["explicit", "read"], workspaceSkillPath: "skill-creator/SKILL.md" },
  ]);
});

test("merge dedupes by slug and orders sources explicit-then-read regardless of input order", () => {
  const merged = mergeSkillActivations(
    [
      { slug: "b-skill", sources: ["read"], workspaceSkillPath: "b-skill/SKILL.md" },
      { slug: "a-skill", sources: ["read"], workspaceSkillPath: "a-skill/SKILL.md" },
    ],
    [
      { slug: "a-skill", sources: ["read"], workspaceSkillPath: "a-skill/SKILL.md" },
      { slug: "c-skill", sources: ["read"], workspaceSkillPath: "c-skill/SKILL.md" },
      { slug: "a-skill", sources: ["explicit"], workspaceSkillPath: "a-skill/SKILL.md" },
    ],
  );
  // 首次出现顺序（b, a, c），a 的来源归一到 ["explicit","read"]。
  assert.deepEqual(merged.map((a) => a.slug), ["b-skill", "a-skill", "c-skill"]);
  assert.deepEqual(merged[1].sources, ["explicit", "read"]);
});

test("merge drops unknown sources and backfills a later real name", () => {
  const merged = mergeSkillActivations([
    { slug: "a-skill", sources: ["nope", "read"], workspaceSkillPath: "a-skill/SKILL.md" },
    { slug: "a-skill", name: "  A Skill  ", sources: [], workspaceSkillPath: "a-skill/SKILL.md" },
  ]);
  assert.deepEqual(merged, [
    { slug: "a-skill", name: "A Skill", sources: ["read"], workspaceSkillPath: "a-skill/SKILL.md" },
  ]);
});

test("reading the same SKILL.md twice is still one chip", () => {
  const messages = [
    assistant(readCall("1", `${HOME}/.pi/agent/skills/skill-creator/SKILL.md`)),
    okResult("1"),
    assistant(readCall("2", `${HOME}/skills/skill-creator/SKILL.md`)),
    okResult("2"),
  ];
  assert.deepEqual(collectSkillActivations(messages), [
    { slug: "skill-creator", sources: ["read"], workspaceSkillPath: "skill-creator/SKILL.md" },
  ]);
});

test("an empty turn yields no activations", () => {
  assert.deepEqual(collectSkillActivations([]), []);
  assert.deepEqual(collectSkillActivations([user("just chatting"), assistant({ type: "text", text: "hi" })]), []);
});