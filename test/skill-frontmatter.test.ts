import test from "node:test";
import assert from "node:assert/strict";
import { hasUnclosedFrontmatter, readsDisabledForModel, withDisabledForModel } from "../src/shared/skill-frontmatter.ts";

/**
 * A skill is a person's own markdown. Toggling it must be indistinguishable from them having
 * typed the line themselves — everything else in the file (their description, comments, keys
 * this app has never heard of, CRLF, the body) has to survive byte for byte. And a file
 * toggled off and on again has to come back exactly as it was.
 */

const simple = `---
name: pdf
description: Work with PDF files
---

# PDF

Read a PDF.
`;

test("the key reads as off only when it says so", () => {
  assert.equal(readsDisabledForModel(simple), false);
  assert.equal(readsDisabledForModel(`---\nname: x\ndisable-model-invocation: true\n---\nbody\n`), true);
  assert.equal(readsDisabledForModel(`---\nname: x\ndisable-model-invocation: TRUE\n---\nbody\n`), true);
  assert.equal(readsDisabledForModel(`---\nname: x\ndisable-model-invocation: false\n---\nbody\n`), false);
  assert.equal(readsDisabledForModel(`---\nname: x\ndisable-model-invocation: "true"\n---\nbody\n`), false, "a quoted string is not the boolean");
  assert.equal(readsDisabledForModel("no frontmatter here\n"), false);
  assert.equal(readsDisabledForModel(""), false);
});

test("switching off adds one line and changes nothing else", () => {
  const off = withDisabledForModel(simple, true);
  assert.equal(off, `---
name: pdf
description: Work with PDF files
disable-model-invocation: true
---

# PDF

Read a PDF.
`);
});

test("the body is never touched, even when it mentions the key", () => {
  const text = `---
name: pdf
description: x
---

Set \`disable-model-invocation: true\` to keep this out of the prompt.
`;
  const off = withDisabledForModel(text, true);
  assert.equal(readsDisabledForModel(off), true);
  assert.ok(off.includes("Set `disable-model-invocation: true` to keep this out of the prompt."));
  assert.equal(off.split("disable-model-invocation").length - 1, 2, "the body copy is untouched");
});

test("the other frontmatter keys keep their order, comments and unknown names", () => {
  const text = `---
name: pdf            # the folder name
description: |
  Multi-line and
  hand wrapped.
allowed-tools: read, write
ext: something-else
---

body
`;
  const off = withDisabledForModel(text, true);
  assert.ok(off.includes('name: pdf            # the folder name'), "a trailing comment stays in place");
  assert.ok(off.includes("description: |\n  Multi-line and\n  hand wrapped."), "a block scalar is not re-wrapped");
  assert.ok(off.includes("allowed-tools: read, write"));
  assert.ok(off.includes("ext: something-else"));
  assert.equal(withDisabledForModel(off, false), text, "off then on is the file the author saved");
});

test("turning it back on removes the line, not just the value", () => {
  const off = `---
name: pdf
disable-model-invocation: true
description: x
---

body
`;
  assert.equal(withDisabledForModel(off, false), `---
name: pdf
description: x
---

body
`);
  assert.equal(withDisabledForModel(simple, false), simple, "a skill that was never off is returned as it is");
});

test("line endings are the file's own", () => {
  const crlf = "---\r\nname: pdf\r\n---\r\n\r\nbody\r\n";
  const off = withDisabledForModel(crlf, true);
  assert.equal(off, "---\r\nname: pdf\r\ndisable-model-invocation: true\r\n---\r\n\r\nbody\r\n");
  assert.equal(readsDisabledForModel(off), true);
  assert.equal(withDisabledForModel(off, false), crlf);
});

test("a skill with no frontmatter gets one, and switching it back on takes it away again", () => {
  const bare = "# Skill\n\nDo a thing.\n";
  assert.equal(withDisabledForModel(bare, false), bare, "nothing to remove, nothing written");
  const off = withDisabledForModel(bare, true);
  assert.equal(readsDisabledForModel(off), true);
  assert.ok(off.endsWith(bare));
  assert.equal(withDisabledForModel(off, false), bare, "the scaffolding goes with the key");
});

test("a skill whose frontmatter never closes is refused, not half-edited", () => {
  const broken = "---\nname: pdf\n\nbody with no closing fence\n";
  assert.equal(hasUnclosedFrontmatter(broken), true);
  assert.equal(withDisabledForModel(broken, true), broken, "adding a second block in front of a broken one helps nobody");
  assert.equal(hasUnclosedFrontmatter(simple), false);
  assert.equal(hasUnclosedFrontmatter("no frontmatter\n"), false);
});
