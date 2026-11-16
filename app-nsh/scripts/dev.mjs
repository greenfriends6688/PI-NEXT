// Development: one command that gives you the app talking to a live server.
//
//   npm run dev                # nsh run --target macos, server from this repo
//   npm run dev -- --target web
//
// The app already reuses a server it finds answering (`src/state/server-process.ts`
// probes first), so this starts the repo's `next dev` when nothing is on the
// port, waits for it, runs the app, and stops only the server it started. The
// packaged app needs none of this: it carries both halves (`npm run dist:mac`).
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const repo = resolve(appDir, "..");
const ORIGIN = "http://127.0.0.1:30142";
const passthrough = process.argv.slice(2);

async function answers() {
  try {
    const response = await fetch(`${ORIGIN}/api/sessions`, { signal: AbortSignal.timeout(2000) });
    // 401 (a LAN gate) also means a server is there.
    return response.ok || response.status === 401;
  } catch {
    return false;
  }
}

let server = null;
if (await answers()) {
  console.log(`using the server already on ${ORIGIN}`);
} else {
  console.log(`starting the server from ${repo}…`);
  server = spawn("npm", ["run", "dev"], { cwd: repo, stdio: "inherit", env: process.env });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await answers()) break;
    if (server.exitCode !== null) {
      console.error("the dev server exited before it answered");
      process.exit(1);
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  if (!(await answers())) {
    console.error(`the dev server did not answer on ${ORIGIN}`);
    server.kill();
    process.exit(1);
  }
  console.log(`server ready on ${ORIGIN}`);
}

const app = spawnSync("nsh", ["run", ...(passthrough.length > 0 ? passthrough : [])], {
  cwd: appDir,
  stdio: "inherit",
  env: { ...process.env, PI_NSH_SERVER: repo },
});

if (server) {
  server.kill();
  // `npm run dev` is `next dev`: give the child a moment to go with its parent.
  setTimeout(() => process.exit(app.status ?? 0), 500);
} else {
  process.exit(app.status ?? 0);
}
