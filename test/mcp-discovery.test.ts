import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverMcpServers, parseCodexMcpToml } from "../src/main/pinext/mcp/discovery.ts";

/**
 * Discovery reads *other* agents' config files, so the shapes it has to survive are theirs,
 * not ours: five JSON spellings and one TOML, any of which may be malformed, and any of which
 * may describe a server this app cannot use.
 *
 * The rule being tested throughout: discovery **reports**, it does not adopt. Whatever it
 * finds is a proposal for the person to accept.
 */

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "pinext-mcp-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "pinext-mcp-cwd-"));
  return {
    home,
    cwd,
    write(rel: string, body: string, root = cwd) {
      const full = join(root, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body);
    },
    cleanup: () => {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

test("the JSON shapes of five different tools are all read", () => {
  const f = fixture();
  try {
    f.write(".cursor/mcp.json", JSON.stringify({ mcpServers: { cursorOne: { command: "npx", args: ["-y", "a"] } } }));
    f.write(".vscode/mcp.json", JSON.stringify({ servers: { vscodeOne: { command: "node", args: ["b.js"] } } }));
    f.write(".claude/mcp.json", JSON.stringify({ mcpServers: { claudeOne: { url: "https://example.test/mcp" } } }));
    const found = discoverMcpServers(f.cwd, f.home);
    const names = found.map((server) => server.name).sort();
    assert.deepEqual(names, ["claudeOne", "cursorOne", "vscodeOne"]);
    // `servers` is VS Code's key; the parser has to have been told which one to read.
    assert.equal(found.find((server) => server.name === "vscodeOne")?.tool, "vscode");
  } finally {
    f.cleanup();
  }
});

test("codex's TOML is parsed, including its env table", () => {
  const parsed = parseCodexMcpToml(`
[mcp_servers.one]
command = "npx"
args = ["-y", "pkg"]

[mcp_servers.one.env]
API_KEY = "sk-secret"
`);
  assert.equal(parsed.one.command, "npx");
  assert.deepEqual(parsed.one.args, ["-y", "pkg"]);
  assert.deepEqual(parsed.one.env, { API_KEY: "sk-secret" });
});

test("a project definition wins over a user one, and the loser is marked shadowed", () => {
  const f = fixture();
  try {
    f.write(".claude.json", JSON.stringify({ mcpServers: { same: { command: "user-version" } } }), f.home);
    f.write(".cursor/mcp.json", JSON.stringify({ mcpServers: { same: { command: "project-version" } } }));
    const found = discoverMcpServers(f.cwd, f.home);
    const project = found.find((server) => server.name === "same" && server.scope === "project");
    const user = found.find((server) => server.name === "same" && server.scope === "user");
    assert.equal(project?.shadowed, false);
    assert.equal(user?.shadowed, true, "the shadowed one is still reported — the pane decides what to show");
  } finally {
    f.cleanup();
  }
});

test("a file that is not JSON, and one with no servers, are both survivable", () => {
  const f = fixture();
  try {
    f.write(".cursor/mcp.json", "{ not json at all");
    f.write(".windsurf/mcp_config.json", JSON.stringify({ mcpServers: {} }));
    assert.deepEqual(discoverMcpServers(f.cwd, f.home), []);
  } finally {
    f.cleanup();
  }
});

test("a definition this app cannot use is dropped rather than reported as importable", () => {
  const f = fixture();
  try {
    // Neither a command nor a url: there is nothing to connect to, so offering it would
    // only produce a row that fails on save.
    f.write(".cursor/mcp.json", JSON.stringify({ mcpServers: { nonsense: { timeout: 30 } } }));
    assert.deepEqual(discoverMcpServers(f.cwd, f.home), []);
  } finally {
    f.cleanup();
  }
});

test("a disabled server is reported as disabled, not silently left out", () => {
  const f = fixture();
  try {
    f.write(".cursor/mcp.json", JSON.stringify({ mcpServers: { off: { command: "npx", disabled: true } } }));
    const [found] = discoverMcpServers(f.cwd, f.home);
    assert.equal(found?.disabled, true);
  } finally {
    f.cleanup();
  }
});
