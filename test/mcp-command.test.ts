import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeMcpCommand, parseMcpCommand, splitCommandLine } from "../src/shared/mcp-command.ts";
import { parseMcpJson } from "../src/shared/mcp-config.ts";

/**
 * A README gives you a line to paste, not JSON. These are the four lines the MCP servers
 * people actually install tell you to run, and the point of reading them is that the reader
 * does not have to translate a CLI's flags into a config object by hand — or, worse, get it
 * half right.
 *
 * The parser is a reader, not an executor: nothing here runs anything, and every result goes
 * through the same validation a pasted JSON entry does.
 */

test("a command line splits on whitespace, not inside quotes", () => {
  assert.deepEqual(splitCommandLine("claude mcp add docs -- npx -y @acme/mcp"), ["claude", "mcp", "add", "docs", "--", "npx", "-y", "@acme/mcp"]);
  assert.deepEqual(splitCommandLine('claude mcp add x --header "Authorization: Bearer sk-1"'), ["claude", "mcp", "add", "x", "--header", "Authorization: Bearer sk-1"]);
  assert.deepEqual(splitCommandLine("claude mcp add x --env A='a b'"), ["claude", "mcp", "add", "x", "--env", "A=a b"]);
  assert.deepEqual(splitCommandLine('a "b\\"c" d'), ["a", 'b"c', "d"], "a backslash escapes inside double quotes");
  assert.deepEqual(splitCommandLine("  spaced   out  "), ["spaced", "out"]);
  assert.deepEqual(splitCommandLine(""), []);
  // No expansion: a variable name is text, and this never ran a shell.
  assert.deepEqual(splitCommandLine("x $HOME ~/y"), ["x", "$HOME", "~/y"]);
});

test("claude mcp add, both shapes", () => {
  const local = parseMcpCommand("claude mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem /tmp");
  assert.deepEqual(local.entry, {
    name: "filesystem",
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
  });
  assert.equal(local.literalSecret, false);

  const env = parseMcpCommand('claude mcp add github -e GITHUB_TOKEN=abc -- npx -y server-github');
  assert.deepEqual(env.entry?.config, { command: "npx", args: ["-y", "server-github"], env: { GITHUB_TOKEN: "abc" } });

  const http = parseMcpCommand('claude mcp add --transport http docs https://example.com/mcp --header "Authorization: Bearer abc"');
  assert.deepEqual(http.entry, {
    name: "docs",
    config: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer abc" } },
  });

  // A URL in the positional slot is an HTTP server even without --transport.
  assert.equal(parseMcpCommand("claude mcp add docs https://example.com/mcp").entry?.config.type, "http");
  // --scope is a placement, not a server detail; the app stores global anyway.
  assert.equal(parseMcpCommand("claude mcp add --scope user docs -- npx -y x").entry?.name, "docs");
});

test("claude mcp add-json keeps the object as written", () => {
  const result = parseMcpCommand(`claude mcp add-json docs '{"command":"npx","args":["-y","x"],"env":{"K":"v"}}'`);
  assert.deepEqual(result.entry, { name: "docs", config: { command: "npx", args: ["-y", "x"], env: { K: "v" } } });
  assert.equal(parseMcpCommand("claude mcp add-json docs not-json").entry, null);
  assert.ok(parseMcpCommand("claude mcp add-json docs not-json").reason);
});

test("codex and pi take the same verbs, with --url on the command line", () => {
  assert.deepEqual(parseMcpCommand("codex mcp add docs --url https://example.com/mcp").entry, {
    name: "docs",
    config: { type: "http", url: "https://example.com/mcp" },
  });
  assert.deepEqual(parseMcpCommand("codex mcp add fs -- npx -y x").entry, { name: "fs", config: { command: "npx", args: ["-y", "x"] } });
  assert.deepEqual(parseMcpCommand("pi mcp add fs -- npx -y x").entry?.name, "fs");
  // A CLI reached through a runner is still the CLI.
  assert.equal(parseMcpCommand("npx -y claude mcp add fs -- npx -y x").entry?.name, "fs");
});

test("VS Code's --add-mcp, inline or as the next word", () => {
  const inline = parseMcpCommand(`code --add-mcp={"name":"docs","command":"npx","args":["-y","x"]}`);
  assert.deepEqual(inline.entry, { name: "docs", config: { command: "npx", args: ["-y", "x"] } });
  const spaced = parseMcpCommand(`code --add-mcp '{"name":"docs","url":"https://example.com/mcp"}'`);
  assert.deepEqual(spaced.entry, { name: "docs", config: { url: "https://example.com/mcp" } });
  assert.equal(parseMcpCommand(`code --add-mcp '{"command":"npx"}'`).entry, null, "no name");
  assert.ok(parseMcpCommand(`code --add-mcp 'nope'`).reason);
});

test("a command nobody recognises reads as nothing, not as a guess", () => {
  assert.equal(parseMcpCommand("git clone https://example.com/repo").entry, null);
  assert.equal(parseMcpCommand("codex mcp add").entry, null);
  assert.ok(parseMcpCommand("codex mcp add").reason);
  assert.equal(parseMcpCommand("claude mcp list").entry, null);
  assert.equal(parseMcpCommand("").entry, null);
});

test("a credential written out in full is reported, a placeholder is not", () => {
  assert.equal(parseMcpCommand('claude mcp add x https://example.com/mcp --header "Authorization: Bearer sk-abcdefghijklmnop"').literalSecret, true);
  assert.equal(parseMcpCommand('claude mcp add x https://example.com/mcp --header "Authorization: Bearer ${GITHUB_TOKEN}"').literalSecret, false);
  assert.equal(parseMcpCommand("claude mcp add x -e OPENAI_API_KEY=ghp_abcdefghijklmnopqrst -- npx -y s").literalSecret, true);
  assert.equal(parseMcpCommand("claude mcp add x -- npx -y some-server").literalSecret, false);
});

test("a paste is routed: JSON stays JSON, a command becomes a server", () => {
  assert.equal(looksLikeMcpCommand('{"mcpServers":{}}'), false);
  assert.equal(looksLikeMcpCommand("claude mcp add x -- npx -y y"), true);
  assert.equal(looksLikeMcpCommand("hello world"), false);

  const fromCommand = parseMcpJson("claude mcp add docs -- npx -y @acme/mcp");
  assert.equal(fromCommand.fromCommand, true);
  assert.equal(fromCommand.errors.length, 0);
  assert.deepEqual(fromCommand.servers[0], {
    id: "docs",
    name: "docs",
    enabled: true,
    transport: "stdio",
    command: "npx",
    args: ["-y", "@acme/mcp"],
  });

  // JSON still goes through the JSON path, and is not reported as a command.
  const fromJson = parseMcpJson('{"mcpServers":{"docs":{"command":"npx"}}}');
  assert.equal(fromJson.fromCommand, undefined);
  assert.equal(fromJson.servers[0]?.name, "docs");

  // An unreadable command says why, the way an unreadable JSON body does.
  const broken = parseMcpJson("claude mcp add-json docs oops");
  assert.equal(broken.servers.length, 0);
  assert.equal(broken.errors[0]?.code, "json");
});
