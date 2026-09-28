import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  SKILLS_MAX_CANDIDATES,
  SKILLS_MAX_FRONTMATTER_BYTES,
  scanSkillImports,
} = await jiti.import("./skills.ts");

function fixtureHome(t) {
  const home = mkdtempSync(join(tmpdir(), "pi-import-skills-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

test("discovers SKILL.md roots, nested SKILL.md, and direct root .md files", async (t) => {
  const home = fixtureHome(t);
  write(join(home, ".claude", "skills", "alpha", "SKILL.md"), "---\nname: alpha-skill\ndescription: Alpha does things\n---\n\nBody\n");
  write(join(home, ".claude", "skills", "alpha", "child", "SKILL.md"), "---\nname: should-not-appear\n---\n");
  write(join(home, ".claude", "skills", "nested", "deeper", "SKILL.md"), "---\nname: deep-skill\n---\n");
  write(join(home, ".claude", "skills", "plain.md"), "No frontmatter here\n");
  write(join(home, ".claude", "skills", "beta", "SKILL.md"), "---\ndescription: Beta only\n---\n");

  const result = await scanSkillImports({ home });
  assert.equal(result.candidates.length, 4);
  const byName = new Map(result.candidates.map((candidate) => [candidate.name, candidate]));
  assert.ok(byName.has("alpha-skill"));
  assert.ok(byName.has("deep-skill"));
  assert.ok(byName.has("plain"));
  assert.ok(byName.has("beta"));
  assert.ok(!byName.has("should-not-appear"));

  const alpha = byName.get("alpha-skill");
  assert.equal(alpha.source, "claude");
  assert.equal(alpha.id, `claude:${join(home, ".claude", "skills", "alpha", "SKILL.md")}`);
  assert.equal(alpha.description, "Alpha does things");
  assert.equal(alpha.destination, join(home, ".agents", "skills"));

  const beta = byName.get("beta");
  assert.equal(beta.source, "claude");
  assert.equal(beta.description, "Beta only");
  assert.equal(beta.name, "beta");
});

test("malformed frontmatter falls back to the directory name instead of throwing", async (t) => {
  const home = fixtureHome(t);
  write(join(home, ".claude", "skills", "weird", "SKILL.md"), "---\n: : [not yaml\n---\n\nBody\n");
  const result = await scanSkillImports({ home });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].name, "weird");
  assert.equal(result.candidates[0].description, null);
});

test("skill body contents never reach the scan result", async (t) => {
  const home = fixtureHome(t);
  const secret = "sk-test-skills-77aa";
  write(join(home, ".claude", "skills", "secretive", "SKILL.md"), `---\nname: secretive\ndescription: Safe description\n---\n\nInstructions: ${secret}\n`);
  const result = await scanSkillImports({ home });
  assert.equal(result.candidates.length, 1);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("only the first 128 KiB are read, which still covers the frontmatter", async (t) => {
  const home = fixtureHome(t);
  write(
    join(home, ".claude", "skills", "huge", "SKILL.md"),
    `---\nname: huge-skill\ndescription: Huge body\n---\n\n${"x".repeat(SKILLS_MAX_FRONTMATTER_BYTES * 3)}`,
  );
  const result = await scanSkillImports({ home });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].name, "huge-skill");
  assert.equal(result.candidates[0].description, "Huge body");
});

test("missing skill roots are empty diagnostics, not errors", async (t) => {
  const home = fixtureHome(t);
  const result = await scanSkillImports({ home });
  assert.deepEqual(result.candidates, []);
  // One real source plus the destination diagnostic — the destination is reported but
  // never walked (fork:import-self-source).
  assert.equal(result.sources.length, 2);
  const source = result.sources.find((entry) => entry.source === "claude");
  assert.equal(source.exists, false);
  assert.equal(source.count, 0);
  const destination = result.sources.find((entry) => entry.source === "agents");
  assert.equal(destination.error, "destination");
  assert.equal(destination.count, 0);
});

test("the destination tree is never a candidate source", async (t) => {
  const home = fixtureHome(t);
  write(join(home, ".agents", "skills", "already-mine", "SKILL.md"), "---\nname: already-mine\n---\n");
  write(join(home, ".claude", "skills", "incoming", "SKILL.md"), "---\nname: incoming\n---\n");

  const result = await scanSkillImports({ home });
  assert.deepEqual(result.candidates.map((candidate) => candidate.name), ["incoming"]);
  const destination = result.sources.find((entry) => entry.source === "agents");
  assert.equal(destination.exists, true);
  assert.equal(destination.error, "destination");
});

test(`the ${SKILLS_MAX_CANDIDATES}-candidate ceiling holds and reports truncation`, async (t) => {
  const home = fixtureHome(t);
  const total = SKILLS_MAX_CANDIDATES + 5;
  for (let index = 0; index < total; index += 1) {
    const name = `skill-${String(index).padStart(4, "0")}`;
    write(join(home, ".claude", "skills", name, "SKILL.md"), `---\nname: ${name}\n---\n`);
  }

  const result = await scanSkillImports({ home });
  assert.equal(result.candidates.length, SKILLS_MAX_CANDIDATES);
  const claudeDiagnostic = result.sources.find((source) => source.source === "claude");
  assert.ok(claudeDiagnostic);
  assert.equal(claudeDiagnostic.truncated, true);
  assert.equal(claudeDiagnostic.exists, true);
});
