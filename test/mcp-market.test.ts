import test from "node:test";
import assert from "node:assert/strict";
import { entriesFromCatalog, entryFromRegistry, readMcpMarketSources } from "../src/main/pi/mcp-market.ts";

/**
 * The market is a reader of two shapes: the official registry's records, and whatever catalog
 * file somebody publishes. One reader for both, so a file cannot mean something a registry row
 * does not — and everything it produces is a *candidate*, validated on the way into mcp.json
 * by the same code a pasted config goes through.
 *
 * The rows that matter most here are the ones that must not be dropped: a record offering a
 * package this app cannot run still shows up with the reason, because a row that silently
 * disappears reads as a broken search.
 */

const registryRow = {
  server: {
    id: "acme/database",
    name: "acme-database",
    description: "Query a database",
    packages: [{ registryType: "npm", identifier: "@acme/mcp-db", version: "1.2.3" }],
  },
};

test("an npm record becomes npx with the version it published", () => {
  const entry = entryFromRegistry(registryRow, "Official registry")!;
  assert.equal(entry.name, "acme-database");
  assert.equal(entry.source, "Official registry");
  assert.deepEqual(entry.server, {
    name: "acme-database",
    enabled: true,
    transport: "stdio",
    command: "npx",
    args: ["-y", "@acme/mcp-db@1.2.3"],
  });
});

test("a remote record becomes an https server, and only https", () => {
  const remote = entryFromRegistry(
    { server: { name: "docs", remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }] } },
    "Official registry",
  )!;
  assert.deepEqual(remote.server, { name: "docs", enabled: true, transport: "http", url: "https://example.com/mcp" });
  // http is refused: the app would be sending a credential over the clear.
  const insecure = entryFromRegistry(
    { server: { name: "docs", remotes: [{ type: "streamable-http", url: "http://example.com/mcp" }] } },
    "Official registry",
  )!;
  assert.equal(insecure.server, null);
  assert.ok(insecure.reason);
});

test("PyPI is offered with the prerequisite named, and anything else says why", () => {
  const pypi = entryFromRegistry(
    { server: { name: "py", packages: [{ registryType: "pypi", identifier: "acme-mcp" }] } },
    "Official registry",
  )!;
  assert.equal(pypi.server?.command, "uvx");
  assert.deepEqual(pypi.server?.args, ["acme-mcp"]);
  assert.match(pypi.reason ?? "", /uv/);

  const other = entryFromRegistry({ server: { name: "oci", packages: [{ registryType: "oci", identifier: "x" }] } }, "src")!;
  assert.equal(other.server, null);
  assert.ok(other.reason);
  assert.equal(entryFromRegistry({}, "src"), null, "a record with no name is not a row");
  assert.equal(entryFromRegistry({ server: { name: "x" } }, "src")?.server, null, "no package and no remote");
});

test("a registry row is read bare as well as wrapped", () => {
  const bare = entryFromRegistry({ name: "docs", packages: [{ registryType: "npm", identifier: "@acme/docs" }] }, "src")!;
  assert.equal(bare.server?.command, "npx");
  assert.deepEqual(bare.server?.args, ["-y", "@acme/docs"], "no version means no spec");
});

test("a catalog takes the market schema, a bare array, or an mcpServers map", () => {
  const market = entriesFromCatalog({ servers: [registryRow.server] }, "Team");
  assert.equal(market.length, 1);
  assert.equal(market[0]!.source, "Team");
  assert.equal(entriesFromCatalog([registryRow.server], "Team").length, 1);

  const map = entriesFromCatalog(
    { mcpServers: { fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] }, api: { url: "https://example.com/mcp" } } },
    "Team",
  );
  assert.deepEqual(map.map((entry) => [entry.name, entry.server?.transport]), [["fs", "stdio"], ["api", "http"]]);
  assert.equal(entriesFromCatalog({ nope: true }, "Team").length, 0);
  assert.deepEqual(entriesFromCatalog(null, "Team"), []);
});

test("the sources a user added are read defensively", () => {
  const settings = {
    mcpMarketSources: [
      { name: "Team", url: "https://example.com/catalog.json", kind: "catalog" },
      { url: "https://registry.example.com/v0/servers", kind: "registry" },
      { url: "http://insecure.example.com/catalog.json" },
      { name: "broken" },
      "not an object",
      { url: "https://example.com/2.json", kind: "nonsense" },
    ],
  };
  assert.deepEqual(readMcpMarketSources(settings).map((source) => [source.name, source.kind]), [
    ["Team", "catalog"],
    ["registry.example.com", "registry"],
    ["example.com", "catalog"],
  ]);
  assert.deepEqual(readMcpMarketSources({}), []);
  assert.deepEqual(readMcpMarketSources({ mcpMarketSources: "nope" }), []);
});
