import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverAgents } from "../resources/extensions/subagent/agents.ts";

/**
 * `inherit_context`, the one part of pi-web's subagent prompting this project did not have.
 *
 * A delegated run normally shares nothing with its parent — the brief in the tool call is
 * the whole task — so the flag has to be off unless a role file says otherwise, and it has
 * to be spelled the way pi-web's own profiles spell it so a file written for either runtime
 * means the same thing.
 */

test("默认不继承父上下文，写 inherit_context: true 才继承", () => {
  const dir = mkdtempSync(join(tmpdir(), "pinext-agents-"));
  const project = mkdtempSync(join(tmpdir(), "pinext-project-"));
  try {
    writeFileSync(
      join(project, "AGENTS.md"),
      "",
    );
    // A project agents directory is discovered from the cwd upward.
    const agentsDir = join(project, ".agents", "agents");
    rmSync(agentsDir, { recursive: true, force: true });
    writeFileSync(join(project, "marker"), "");
    void dir;

    const result = discoverAgents(project, "user");
    for (const agent of result.agents) {
      assert.equal(agent.inheritContext, false, `${agent.name} 默认不该继承`);
    }
    // The three roles pi-web ships are among them, with their own tool sets.
    const explore = result.agents.find((agent) => agent.name === "explore");
    assert.ok(explore, "explore 应当在内置角色里");
    assert.deepEqual(explore.tools, ["read", "grep", "find", "ls"]);
    assert.equal(explore.inheritContext, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});
