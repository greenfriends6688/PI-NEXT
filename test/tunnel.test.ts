import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTunnelUrl, resolveCloudflared, respawnDelayMs } from "../src/main/engine/tunnel.ts";

/**
 * The three pure pieces of the tunnel supervisor, pinned here because the rest of it
 * spawns `cloudflared` and cannot run in `node --test`.
 *
 * - `parseTunnelUrl` reads the address out of cloudflared's log. If it is wrong the pane
 *   never shows an address; if it is too eager it shows a half-line.
 * - `resolveCloudflared` is the PATH-independence. The order is the point: a real binary
 *   beats the npm JS wrapper, which beats nothing.
 * - `respawnDelayMs` is the reconnect backoff; an uncapped one would stop retrying for
 *   longer than anyone waits.
 */

/** A real quick-tunnel log, copied from cloudflared's own output shape. */
const REAL_LOG = [
  "2026-10-07T12:34:56Z INF Thank you for trying Cloudflare Tunnel. Doing so means you are the best.",
  "2026-10-07T12:34:56Z INF Requesting new quick Tunnel on trycloudflare.com...",
  "+--------------------------------------------------------------------------------------------+",
  "|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |",
  "|  https://random-words-here.trycloudflare.com                                              |",
  "+--------------------------------------------------------------------------------------------+",
  "2026-10-07T12:34:57Z INF Registered tunnel connection connIndex=0 connection=0",
].join("\n");

test("the quick-tunnel address is read from a real cloudflared log", () => {
  assert.equal(parseTunnelUrl(REAL_LOG), "https://random-words-here.trycloudflare.com");
});

test("no address yet, or none at all, is null rather than a guess", () => {
  assert.equal(parseTunnelUrl("2026-10-07T12:34:56Z INF Requesting new quick Tunnel..."), null);
  assert.equal(parseTunnelUrl(""), null);
  // A different tunnel host (a named tunnel) is not a quick tunnel address.
  assert.equal(parseTunnelUrl("https://tunnel.example.com"), null);
});

/** Create a fake `cloudflared` package root. `bin` / `js` choose which files exist. */
function fakeRoot(base: string, options: { bin?: boolean; js?: boolean }): string {
  const root = join(base, "cloudflared");
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "lib"), { recursive: true });
  if (options.bin) writeFileSync(join(root, "bin", "cloudflared"), "#!/bin/sh\n");
  if (options.js) writeFileSync(join(root, "lib", "cloudflared.js"), "module.exports = {};\n");
  return root;
}

test("a package's real binary is preferred over its JS wrapper", () => {
  const base = mkdtempSync(join(tmpdir(), "pinext-tunnel-"));
  try {
    const root = fakeRoot(base, { bin: true, js: true });
    const resolved = resolveCloudflared({
      packageRoots: [root],
      binDirs: [],
      execPath: join(base, "node", "bin", "node"),
      home: base,
      env: {},
    });
    assert.equal(resolved.command, join(root, "bin", "cloudflared"));
    assert.equal(resolved.viaNode, false);
    assert.deepEqual(resolved.prefix, []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("without a real binary the npm JS wrapper runs through our own runtime", () => {
  const base = mkdtempSync(join(tmpdir(), "pinext-tunnel-"));
  try {
    const root = fakeRoot(base, { bin: false, js: true });
    const execPath = join(base, "node", "bin", "node");
    const resolved = resolveCloudflared({
      packageRoots: [root],
      binDirs: [],
      execPath,
      home: base,
      env: {},
    });
    assert.equal(resolved.command, execPath);
    assert.equal(resolved.viaNode, true);
    assert.deepEqual(resolved.prefix, [join(root, "lib", "cloudflared.js")]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a standalone binary is preferred over a JS wrapper too", () => {
  const base = mkdtempSync(join(tmpdir(), "pinext-tunnel-"));
  try {
    const root = fakeRoot(base, { js: true });
    const brew = join(base, "brew", "cloudflared");
    mkdirSync(join(base, "brew"), { recursive: true });
    writeFileSync(brew, "#!/bin/sh\n");
    const resolved = resolveCloudflared({
      packageRoots: [root],
      binDirs: [brew],
      execPath: join(base, "node", "bin", "node"),
      home: base,
      env: {},
    });
    assert.equal(resolved.command, brew);
    assert.equal(resolved.viaNode, false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("nothing found falls back to the bare name rather than throwing", () => {
  const base = mkdtempSync(join(tmpdir(), "pinext-tunnel-"));
  try {
    const resolved = resolveCloudflared({
      packageRoots: [],
      binDirs: [],
      execPath: join(base, "node", "bin", "node"),
      home: base,
      env: {},
    });
    assert.equal(resolved.command, "cloudflared");
    assert.equal(resolved.viaNode, false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("an explicit CLOUDFLARED_BIN outranks everything discovered", () => {
  const base = mkdtempSync(join(tmpdir(), "pinext-tunnel-"));
  try {
    const root = fakeRoot(base, { bin: true });
    const resolved = resolveCloudflared({
      packageRoots: [root],
      binDirs: [],
      execPath: join(base, "node", "bin", "node"),
      home: base,
      env: { CLOUDFLARED_BIN: "/custom/cloudflared" },
    });
    assert.equal(resolved.command, "/custom/cloudflared");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the respawn backoff grows then caps at two minutes", () => {
  assert.equal(respawnDelayMs(0), 3_000);
  assert.equal(respawnDelayMs(1), 3_000);
  assert.equal(respawnDelayMs(10), 30_000);
  assert.equal(respawnDelayMs(40), 120_000);
  assert.equal(respawnDelayMs(1_000), 120_000);
});
