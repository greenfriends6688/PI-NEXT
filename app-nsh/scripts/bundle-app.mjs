// Makes the packaged app self-contained: the server it serves and the Node
// runtime it starts it with, both inside the bundle.
//
//   node scripts/bundle-app.mjs ["release/PI NEXT.app"] [pi-web-source]
//
// Runs `bundle-server.mjs` then `embed-node.mjs`, then checks the result the way
// the app checks it at launch (`src/lib/app-bundle.ts`): a built server with a
// `.next/BUILD_ID`, and a Node binary that answers. A bundle that fails here is
// one a user would open into a dead connection card.
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(process.argv[2] ?? "release/PI NEXT.app");
const source = process.argv[3];

function run(script, args) {
  execFileSync(process.execPath, [join(here, script), ...args], { stdio: "inherit" });
}

run("bundle-server.mjs", source ? [app, source] : [app]);
run("embed-node.mjs", [app]);

const nsh = join(app, "Contents/Resources/nsh");
const exe = process.platform === "win32" ? "node.exe" : "node";
const node = join(nsh, `node/bin/${exe}`);
const required = [
  join(nsh, "pi-web/.next/BUILD_ID"),
  // The app runs the server in-process (`next()` in `host/main.mjs`), so the
  // traced output's server entry is what must be there — not Next's CLI.
  join(nsh, "pi-web/node_modules/next/dist/server/next.js"),
  join(nsh, "pi-web/.next/static"),
  join(nsh, "pi-web/host/main.mjs"),
  node,
];

let failed = false;
for (const path of required) {
  const there = existsSync(path);
  if (!there) failed = true;
  console.log(`${there ? "ok  " : "MISS"} ${path.slice(app.length + 1)}`);
}
if (failed) {
  console.error(`\n${app} is not self-contained: fix the lines above.`);
  process.exit(1);
}

// The runtime must actually run from inside the app (quarantine, symlinks and
// architecture mismatches only show up there).
const version = execFileSync(node, ["-v"], { encoding: "utf8" }).trim();
const nodeBytes = (await stat(node)).size;

// And the agent must answer when this Node starts it: a prune that took a
// module the server requires (`yaml/dist/doc`, say) is invisible to a file check
// and only turns into a 500 in the window. This drives `<pi-web>/host/main.mjs`
// exactly as the window does — one process, one pipe, no port — and asks it for
// the session list.
async function smoke() {
  const bundle = join(nsh, "pi-web");
  const cwd = await mkdtemp(join(tmpdir(), "pi-next-smoke-"));
  const child = spawn(node, [join(bundle, "host/main.mjs")], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
  });

  let buffered = "";
  const messages = [];
  const waiters = [];
  const push = (message) => {
    messages.push(message);
    for (const waiter of waiters.splice(0)) waiter();
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    for (;;) {
      const at = buffered.indexOf("\n");
      if (at < 0) break;
      const line = buffered.slice(0, at).trim();
      buffered = buffered.slice(at + 1);
      if (!line) continue;
      try {
        push(JSON.parse(line));
      } catch {
        push({ event: "text", text: line });
      }
    }
  });
  let noise = "";
  child.stderr.on("data", (chunk) => {
    noise += chunk;
  });

  const nextMessage = async (predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = messages.find(predicate);
      if (found) return found;
      if (child.exitCode !== null) return null;
      if (Date.now() > deadline) return null;
      await new Promise((done) => {
        waiters.push(done);
        setTimeout(done, 300);
      });
    }
  };

  const ready = await nextMessage((message) => message.event === "ready", 40_000);
  let status = 0;
  if (ready) {
    child.stdin.write(`${JSON.stringify({ id: 1, path: "/api/sessions", method: "GET" })}\n`);
    const answer = await nextMessage((message) => message.id === 1 && (message.status !== undefined || message.error), 20_000);
    status = answer?.status ?? 0;
    if (!status && answer?.error) noise += `\n${answer.error.message}`;
  }

  child.kill("SIGTERM");
  await rm(cwd, { recursive: true, force: true });

  if (status !== 200) {
    const why = messages.filter((message) => message.event === "log" || message.event === "failed" || message.event === "text")
      .map((message) => message.text ?? message.message ?? "")
      .concat(noise.split("\n"))
      .filter((line) => line.trim())
      .slice(-6)
      .join("\n");
    console.error(`\nthe bundled agent did not answer (status ${status}):\n${why}`);
    process.exit(1);
  }
  console.log(`ok   the bundled agent answers over the pipe (get /api/sessions ${status})`);
}

await smoke();

async function size(dir, seen = { bytes: 0 }) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await size(path, seen);
    else seen.bytes += (await stat(path)).size;
  }
  return seen.bytes;
}

const total = await size(app);
console.log(
  `\n${app} runs on its own: Node ${version} (${(nodeBytes / 1024 / 1024).toFixed(1)} MB)`
  + ` + the server, ${(total / 1024 / 1024).toFixed(0)} MB in total.`,
);
