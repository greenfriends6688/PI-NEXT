import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

/*
 * fork:zc-18 / fork:pr11-mcp — pins the MCP OAuth entry points.
 *
 * Two halves:
 *  - the command builders handed to the user (copied to the clipboard): server
 *    names come from a user-editable mcp.json, so the injection cases below are
 *    the security contract — a name must never smuggle a second slash command
 *    or a second line into the generated string. pi 1.0's built-in extension
 *    registers `/mcp login` / `/mcp logout`.
 *  - the server-side flow helpers, which must call pi's `signInMcpServer` and
 *    `McpOAuthCredentialStore` (fake internals injected, no network).
 */

async function loadSubject() {
  return jiti.import("./mcp-auth-command.ts");
}

test("isRemoteMcpServer accepts url-based http/sse servers only", async () => {
  const { isRemoteMcpServer } = await loadSubject();

  assert.equal(isRemoteMcpServer({ kind: "url", url: "https://example.com/mcp" }), true);
  assert.equal(isRemoteMcpServer({ transport: "http", url: "http://127.0.0.1:8931/mcp" }), true);
  assert.equal(isRemoteMcpServer({ transport: "sse", url: "https://example.com/sse" }), true);
  // Raw mcp.json definition with both command and url: the route derives kind from
  // url first, so this is the http/sse server the panel shows.
  assert.equal(isRemoteMcpServer({ command: "npx", url: "https://example.com/mcp" }), true);

  assert.equal(isRemoteMcpServer({ kind: "command", command: "npx", args: ["-y", "server"] }), false);
  assert.equal(isRemoteMcpServer({ kind: "socket", socket: "/tmp/mcp.sock" }), false);
  assert.equal(isRemoteMcpServer({ transport: "stdio", command: "npx" }), false);
  assert.equal(isRemoteMcpServer({ kind: "url" }), false);
  assert.equal(isRemoteMcpServer({ kind: "url", url: "file:///tmp/mcp.sock" }), false);
  assert.equal(isRemoteMcpServer(null), false);
  assert.equal(isRemoteMcpServer(undefined), false);
});

test("buildMcpAuthCommand / buildMcpLogoutCommand build pi 1.0's exact commands", async () => {
  const { buildMcpAuthCommand, buildMcpLogoutCommand } = await loadSubject();

  assert.equal(buildMcpAuthCommand("github"), "/mcp login github");
  assert.equal(buildMcpAuthCommand("my server"), "/mcp login my server");
  assert.equal(buildMcpLogoutCommand("github"), "/mcp logout github");
  assert.equal(buildMcpLogoutCommand("my server"), "/mcp logout my server");
});

test("a newline in the server name cannot start a second slash command", async () => {
  const { buildMcpAuthCommand, buildMcpLogoutCommand } = await loadSubject();

  const injected = "foo\n/mcp logout bar";
  assert.equal(buildMcpAuthCommand(injected), null);
  assert.equal(buildMcpLogoutCommand(injected), null);

  // Every line terminator JavaScript treats as one, plus CRLF and the Unicode
  // separators, must be rejected the same way.
  assert.equal(buildMcpAuthCommand("foo\r\n/mcp logout bar"), null);
  assert.equal(buildMcpAuthCommand("foo\r/mcp logout bar"), null);
  assert.equal(buildMcpAuthCommand("foo\u2028/mcp logout bar"), null);
  assert.equal(buildMcpAuthCommand("foo\u2029/mcp logout bar"), null);
  assert.equal(buildMcpAuthCommand("foo\u0000bar"), null);
  assert.equal(buildMcpAuthCommand("foo\u007fbar"), null);
});

test("shell metacharacters stay inside one single-line command", async () => {
  const { buildMcpAuthCommand } = await loadSubject();

  const command = buildMcpAuthCommand("foo; rm -rf /");
  // Slash commands are not shell lines, so the metacharacters remain part of the
  // (nonexistent) server name. The security property to pin is that the string
  // is exactly one line with no second command to run.
  assert.equal(command, "/mcp login foo; rm -rf /");
  assert.equal(command.split("\n").length, 1);
  assert.equal(command.includes("\n"), false);
  assert.equal(command.includes("\r"), false);
  assert.equal(command.startsWith("/mcp login "), true);
});

test("empty, padded and non-string names are rejected", async () => {
  const { buildMcpAuthCommand, buildMcpLogoutCommand } = await loadSubject();

  assert.equal(buildMcpAuthCommand(""), null);
  assert.equal(buildMcpAuthCommand("   "), null);
  assert.equal(buildMcpAuthCommand(" padded"), null);
  assert.equal(buildMcpAuthCommand("padded "), null);
  assert.equal(buildMcpAuthCommand(undefined), null);
  assert.equal(buildMcpAuthCommand(null), null);
  assert.equal(buildMcpAuthCommand(42), null);
  assert.equal(buildMcpLogoutCommand(""), null);
  assert.equal(buildMcpLogoutCommand(undefined), null);
});

/** Fake internals for the server-side helpers: records calls, never touches the SDK. */
function fakeAuthInternals({ cancel = false, fail = null, removed = false, seen } = {}) {
  class FakeCancelledError extends Error {}
  class FakeCredentialStore {
    forServer(name, serverUrl) {
      seen.storeKey = [name, serverUrl];
      return { load: async () => undefined, save: async () => {} };
    }
    remove(name, serverUrl) {
      seen.removed = [name, serverUrl];
      return removed;
    }
  }
  return {
    signInMcpServer: async (options) => {
      seen.signIn = options;
      if (cancel) throw new FakeCancelledError("Sign-in cancelled");
      if (fail) throw new Error(fail);
    },
    McpOAuthCredentialStore: FakeCredentialStore,
    McpSignInCancelledError: FakeCancelledError,
    resolveConfigValueOrThrow: (value, description) => {
      seen.resolved = [value, description];
      return `resolved(${value})`;
    },
  };
}

test("signInMcpServerWithPrompt forwards the URL, resolved secret and store to pi", async () => {
  const { signInMcpServerWithPrompt } = await loadSubject();
  const seen = {};
  const prompt = { showAuthorizationUrl() {}, promptForRedirectUrl: async () => undefined };
  const outcome = await signInMcpServerWithPrompt({
    name: "docs",
    server: {
      url: "https://example.com/mcp",
      oauth: { clientId: "client", clientSecret: "${DOCS_SECRET}", scope: "read" },
    },
    prompt,
    internals: fakeAuthInternals({ seen }),
  });

  assert.deepEqual(outcome, { ok: true });
  assert.equal(seen.signIn.serverUrl, "https://example.com/mcp");
  assert.equal(seen.signIn.prompt, prompt);
  assert.equal(seen.signIn.settings.clientId, "client");
  assert.equal(seen.signIn.settings.clientSecret, "resolved(${DOCS_SECRET})");
  assert.deepEqual(seen.resolved, ["${DOCS_SECRET}", 'MCP server "docs" oauth.clientSecret']);
  assert.deepEqual(seen.storeKey, ["docs", "https://example.com/mcp"]);
});

test("signInMcpServerWithPrompt reports cancellation and failures without throwing", async () => {
  const { signInMcpServerWithPrompt } = await loadSubject();
  const prompt = { showAuthorizationUrl() {}, promptForRedirectUrl: async () => undefined };

  const cancelled = await signInMcpServerWithPrompt({
    name: "docs",
    server: { url: "https://example.com/mcp" },
    prompt,
    internals: fakeAuthInternals({ cancel: true, seen: {} }),
  });
  assert.deepEqual(cancelled, { ok: false, cancelled: true, error: "Sign-in cancelled" });

  const failed = await signInMcpServerWithPrompt({
    name: "docs",
    server: { url: "https://example.com/mcp" },
    prompt,
    internals: fakeAuthInternals({ fail: "token endpoint rejected the client", seen: {} }),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.cancelled, false);
  assert.match(failed.error, /token endpoint rejected/);
});

test("signOutMcpServerWithPrompt removes exactly this server's credentials", async () => {
  const { signOutMcpServerWithPrompt } = await loadSubject();
  const seen = {};
  const removed = await signOutMcpServerWithPrompt({
    name: "docs",
    url: "https://example.com/mcp",
    internals: fakeAuthInternals({ seen, removed: true }),
  });
  assert.equal(removed, true);
  assert.deepEqual(seen.removed, ["docs", "https://example.com/mcp"]);
});
