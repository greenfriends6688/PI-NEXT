import assert from "node:assert/strict";
import test from "node:test";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { TurnSkillUsageSummary } = await jiti.import("./TurnSkillUsageSummary.tsx");
const { collectSkillActivations } = await jiti.import("@/lib/skill-usage");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const componentSource = await readFile(new URL("./TurnSkillUsageSummary.tsx", import.meta.url), "utf8");
const messageViewSource = await readFile(new URL("../MessageView.tsx", import.meta.url), "utf8");

const skill = (slug, overrides = {}) => ({
  slug,
  sources: ["read"],
  workspaceSkillPath: `${slug}/SKILL.md`,
  ...overrides,
});

function render(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

test("one chip per skill, each with the sparkles icon and the skill name", () => {
  const html = render(
    React.createElement(TurnSkillUsageSummary, {
      skills: [skill("skill-creator"), skill("guizang-ppt-skill")],
      onOpenSkill: () => {},
    }),
  );
  // 抬头行一枚 sparkles + 每枚芯片一枚。
assert.equal(html.match(/data-ico="sparkles"/g).length, 3);
  assert.match(html, /class="d-chips"/);
  assert.match(html, /class="d-chipbtn"/);
  assert.match(html, /skill-creator/);
  assert.match(html, /guizang-ppt-skill/);
});

test("nothing renders while the turn is still streaming", () => {
  // 流式里每读到一份 SKILL.md 就多一枚 chip、失败一次就少一枚 —— 逐帧增删的闪烁
  // 比没有这行信息更伤，所以只在回合结束后出现。
  const html = render(
    React.createElement(TurnSkillUsageSummary, {
      skills: [skill("skill-creator")],
      isStreaming: true,
      onOpenSkill: () => {},
    }),
  );
  assert.equal(html, "");
});

test("an empty list renders nothing", () => {
  assert.equal(render(React.createElement(TurnSkillUsageSummary, { skills: [], onOpenSkill: () => {} })), "");
});

test("the chip never shows an absolute path and is disabled without an opener", () => {
  const activation = collectSkillActivations([
    { role: "user", content: "go" },
    {
      role: "assistant",
      model: "m",
      provider: "p",
      content: [{ type: "toolCall", toolCallId: "1", toolName: "read", input: { file_path: `${homedir()}/.pi/agent/skills/skill-creator/SKILL.md` } }],
    },
    { role: "toolResult", toolCallId: "1", content: [{ type: "text", text: "# skill" }] },
  ])[0];

  const html = render(React.createElement(TurnSkillUsageSummary, { skills: [activation] }));
  assert.equal(activation.workspaceSkillPath, "skill-creator/SKILL.md");
  assert.ok(!html.includes(homedir()));
  assert.match(html, /title="skill-creator\/SKILL\.md"/);
  // 没有定位回调时 chip 不可点（`.d-chipbtn:disabled`），但仍显示用了什么。
  assert.match(html, /disabled=""/);
});

test("the display name wins over the slug when the mention spelled it differently", () => {
  const html = render(
    React.createElement(TurnSkillUsageSummary, { skills: [skill("skill-creator", { name: "Skill Creator" })], onOpenSkill: () => {} }),
  );
  assert.match(html, /Skill Creator/);
});

test("source: the chips sit in TurnWrittenFiles' row and use only board classes", () => {
  // 同一个 header 下：两个组件是同一个 flex 行（`.fork-turn-summary`）里的两个芯片容器
  // （`.d-chips`），不是各自另起一个区块。fork:v5-landing 把 `.pw-wrap`/`.pw-chip`
  // 换成画板 D-03e 帧 B 的 `.d-chips`/`.d-chipbtn`，窄屏走 PWA 的 `.m-tray` 系列。
  const row = messageViewSource.slice(messageViewSource.indexOf('<div className="fork-turn-summary">'));
  assert.match(row.slice(0, 400), /<TurnWrittenFiles/);
  assert.match(row.slice(0, 400), /<TurnSkillUsageSummary/);
  assert.match(row.slice(0, 400), /isStreaming=\{isStreaming\}/);

  const classes = [...componentSource.matchAll(/className="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
  for (const name of classes) assert.match(name, /^(m-(tray|tray-chip)|d-(chips|chipbtn|row|t-sm|grow))$/, `unexpected class ${name}`);
  // 流式中不渲染 —— 逐帧增删的闪烁比没有这行信息更伤。
  assert.match(componentSource, /if \(isStreaming \|\| skills\.length === 0\) return null;/);
});