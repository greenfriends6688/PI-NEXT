import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { findSkillBySlug } = await jiti.import("./SkillsConfig.tsx");

const skills = [
  { name: "image-gen", filePath: "/Users/me/.pi/agent/skills/image-gen/SKILL.md" },
  { name: "skill-creator", filePath: "/Users/me/.pi/agent/skills/skill-creator/SKILL.md" },
  { name: "local", filePath: "/repo/.pi/skills/skill-creator/SKILL.md" },
];

test("matches a skill by the slug directory name, not by the absolute path", () => {
  // The chip only knows the slug (lib/skill-usage.ts never exposes a path), so the
  // settings list has to recover the row from the same `skills/<slug>/SKILL.md` shape.
  assert.equal(findSkillBySlug(skills, "image-gen"), skills[0]);
  // Same slug in two roots: first hit wins rather than silently picking the other scope.
  assert.equal(findSkillBySlug(skills, "skill-creator"), skills[1]);
  assert.equal(findSkillBySlug(skills, "nope"), undefined);
});

test("a slug that only appears as a substring never matches", () => {
  assert.equal(findSkillBySlug([{ name: "x", filePath: "/Users/me/notes/skills/image-gen-copy/SKILL.md" }], "image-gen"), undefined);
  assert.equal(findSkillBySlug([{ name: "x", filePath: "/Users/me/skills/image-gen/README.md" }], "image-gen"), undefined);
});