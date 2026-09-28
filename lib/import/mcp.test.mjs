import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { MCP_MAX_CANDIDATES, MCP_MAX_FILE_BYTES, scanMcpImports } = await jiti.import("./mcp.ts");

function fixtureHome(t) {
  const home = mkdtempSync(join(tmpdir(), "pi-import-mcp-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

test("claude desktop stdio server: env key becomes hasSecret only", async (t) => {
  const home = fixtureHome(t);
  const secret = "sk-test-mcp-desktop-88aa";
  write(
    join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    JSON.stringify({
      mcpServers: {
        files: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"], env: { API_KEY: secret } },
      },
    }),
  );

  const result = await scanMcpImports({ home });
  const candidate = result.candidates.find((entry) => entry.id === "claude-desktop:files");
  assert.ok(candidate);
  assert.equal(candidate.transport, "stdio");
  assert.equal(candidate.command, "npx");
  assert.deepEqual(candidate.args, ["-y", "@modelcontextprotocol/server-filesystem"]);
  assert.equal(candidate.hasSecret, true);
  assert.equal(candidate.destination, join(home, ".pi", "agent", "mcp.json"));
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("cursor: url wins over a declared stdio type, and userinfo is redacted", async (t) => {
  const home = fixtureHome(t);
  const secret = "sk-test-mcp-url-99bb";
  write(join(home, ".cursor", "mcp.json"), JSON.stringify({
    mcpServers: {
      remote: {
        type: "stdio",
        url: `https://user:${secret}@mcp.example.com/sse`,
        headers: { Authorization: `Bearer ${secret}` },
      },
    },
  }));

  const result = await scanMcpImports({ home });
  const candidate = result.candidates.find((entry) => entry.id === "cursor:remote");
  assert.ok(candidate);
  assert.equal(candidate.transport, "http");
  assert.equal(candidate.url, "https://mcp.example.com/sse");
  assert.equal(candidate.hasSecret, true);
  assert.equal(candidate.command, undefined);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("claude code: two files dedupe by deterministic id", async (t) => {
  const home = fixtureHome(t);
  write(join(home, ".claude.json"), JSON.stringify({
    mcpServers: { github: { command: "github-mcp", args: ["--stdio"] } },
  }));
  write(join(home, ".claude", "settings.json"), JSON.stringify({
    mcpServers: { github: { command: "shadowed" } },
  }));

  const result = await scanMcpImports({ home });
  const matches = result.candidates.filter((entry) => entry.id === "claude:github");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].command, "github-mcp");
  // Both files were still counted as sources.
  const claudeSources = result.sources.filter((source) => source.source === "claude");
  assert.equal(claudeSources.length, 2);
});

test("codex TOML: mcp_servers parse with arrays and inline env tables", async (t) => {
  const home = fixtureHome(t);
  const secret = "sk-test-mcp-codex-aacc";
  write(join(home, ".codex", "config.toml"), [
    "[mcp_servers.codex-srv]",
    "command = \"node\"",
    "args = [\"server.js\", \"--port\", \"0\"]",
    `env = { API_KEY = "${secret}" }`,
    "",
    "[mcp_servers.remote-srv]",
    "url = \"https://remote.example.com/mcp\"",
    "transport = \"sse\"",
    "",
  ].join("\n"));

  const result = await scanMcpImports({ home });
  const local = result.candidates.find((entry) => entry.id === "codex:codex-srv");
  const remote = result.candidates.find((entry) => entry.id === "codex:remote-srv");
  assert.ok(local);
  assert.equal(local.transport, "stdio");
  assert.deepEqual(local.args, ["server.js", "--port", "0"]);
  assert.equal(local.hasSecret, true);
  assert.ok(remote);
  assert.equal(remote.transport, "http");
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("opencode: local packs argv into command, remote maps to http", async (t) => {
  const home = fixtureHome(t);
  write(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({
    mcp: {
      local: { type: "local", command: ["uvx", "some-server", "--flag"], environment: { TOKEN: "sk-test-mcp-oc-bbdd" } },
      remote: { type: "remote", url: "https://oc.example.com/mcp", headers: { "x-api-key": "sk-test-mcp-oc-ccee" } },
    },
  }));

  const result = await scanMcpImports({ home });
  const local = result.candidates.find((entry) => entry.id === "opencode:local");
  const remote = result.candidates.find((entry) => entry.id === "opencode:remote");
  assert.ok(local);
  assert.equal(local.transport, "stdio");
  assert.equal(local.command, "uvx");
  assert.deepEqual(local.args, ["some-server", "--flag"]);
  assert.equal(local.hasSecret, true);
  assert.ok(remote);
  assert.equal(remote.transport, "http");
  assert.equal(remote.url, "https://oc.example.com/mcp");
  assert.equal(remote.hasSecret, true);
  assert.ok(!JSON.stringify(result).includes("sk-test-mcp-oc-bbdd"));
  assert.ok(!JSON.stringify(result).includes("sk-test-mcp-oc-ccee"));
});

test("accepts `servers` nesting, bare maps, declared sse-only, and disabled flags", async (t) => {
  const home = fixtureHome(t);
  write(join(home, ".cursor", "mcp.json"), JSON.stringify({
    servers: {
      sseOnly: { type: "sse" },
      off: { command: "node", disabled: true },
    },
  }));
  write(join(home, ".claude", "settings.json"), JSON.stringify({
    permissions: { allow: [] },
    bare: { command: "bare-server" },
  }));

  const result = await scanMcpImports({ home });
  const sseOnly = result.candidates.find((entry) => entry.id === "cursor:sseOnly");
  const off = result.candidates.find((entry) => entry.id === "cursor:off");
  const bare = result.candidates.find((entry) => entry.id === "claude:bare");
  assert.ok(sseOnly);
  assert.equal(sseOnly.transport, "http");
  assert.equal(sseOnly.url, undefined);
  assert.ok(off);
  assert.equal(off.disabled, true);
  assert.ok(bare);
  assert.equal(bare.command, "bare-server");
});

test("a malformed config becomes a diagnostic without hiding the other sources", async (t) => {
  const home = fixtureHome(t);
  const secret = "sk-test-mcp-broken-ddee";
  write(join(home, ".cursor", "mcp.json"), `{"mcpServers":{"x":{"env":{"KEY":"${secret}"`);
  write(join(home, ".claude.json"), JSON.stringify({ mcpServers: { fine: { command: "ok" } } }));

  const result = await scanMcpImports({ home });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].id, "claude:fine");
  const cursorDiagnostic = result.sources.find((source) => source.source === "cursor");
  assert.ok(cursorDiagnostic);
  assert.equal(cursorDiagnostic.exists, true);
  assert.equal(cursorDiagnostic.error, "malformed JSON");
  assert.ok(!JSON.stringify(result).includes(secret));
});

test(`files above the ${MCP_MAX_FILE_BYTES}-byte guard are reported, not parsed`, async (t) => {
  const home = fixtureHome(t);
  write(join(home, ".cursor", "mcp.json"), " ".repeat(MCP_MAX_FILE_BYTES + 1));
  const result = await scanMcpImports({ home });
  assert.deepEqual(result.candidates, []);
  const cursorDiagnostic = result.sources.find((source) => source.source === "cursor");
  assert.ok(cursorDiagnostic);
  assert.equal(cursorDiagnostic.exists, true);
  assert.equal(cursorDiagnostic.error, "file too large");
});

test(`the ${MCP_MAX_CANDIDATES}-candidate ceiling holds and reports truncation`, async (t) => {
  const home = fixtureHome(t);
  const servers = {};
  const total = MCP_MAX_CANDIDATES + 5;
  for (let index = 0; index < total; index += 1) {
    servers[`server-${String(index).padStart(4, "0")}`] = { command: "node", args: ["index.js"] };
  }
  write(
    join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    JSON.stringify({ mcpServers: servers }),
  );

  const result = await scanMcpImports({ home });
  assert.equal(result.candidates.length, MCP_MAX_CANDIDATES);
  const desktopDiagnostic = result.sources.find((source) => source.source === "claude-desktop");
  assert.ok(desktopDiagnostic);
  assert.equal(desktopDiagnostic.truncated, true);
  assert.equal(desktopDiagnostic.exists, true);
});
