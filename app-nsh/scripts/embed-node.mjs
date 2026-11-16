// Puts a Node runtime inside the packaged app, so the app is the only thing a
// user installs: no system Node, no `npm i -g pi-web`, no network on first run.
//
//   node scripts/embed-node.mjs [app] [--node <path>]
//
// The target is `<App>.app/Contents/Resources/nsh/node/bin/node` — next to the
// server bundle `scripts/bundle-server.mjs` copies, which
// `src/state/server-process.ts` starts with it. pi's agent is a Node SDK, so a
// Node runtime has to exist somewhere; inside the app it is invisible, which is
// exactly what PI NEXT's Electron shell does with the Node it carries.
//
// The runtime is the one that builds the app (`process.execPath`) unless
// `--node` or `PI_NEXT_NODE` names another: same machine, same architecture,
// same version as the server was built and tested with. Only the binary is
// copied, plus its LICENSE, so the app redistributes Node under its own terms.
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** pi-web's own floor (`package.json` engines; `bin/node-version.js` checks it). */
const MIN_NODE = [22, 19, 0];

const args = process.argv.slice(2);
const nodeFlag = args.indexOf("--node");
const explicit = nodeFlag >= 0 ? args[nodeFlag + 1] : process.env.PI_NEXT_NODE;
const app = resolve(args.find((arg, index) => !arg.startsWith("--") && index !== nodeFlag + 1) ?? "release/PI NEXT.app");
const exe = process.platform === "win32" ? "node.exe" : "node";
const target = join(app, `Contents/Resources/nsh/node/bin/${exe}`);

function versionOf(binary) {
  const text = execFileSync(binary, ["-v"], { encoding: "utf8" }).trim();
  const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!match) throw new Error(`${binary} did not answer with a version (${text})`);
  return { text, parts: match.slice(1).map(Number) };
}

function meetsFloor(parts) {
  for (let index = 0; index < MIN_NODE.length; index += 1) {
    if (parts[index] !== MIN_NODE[index]) return parts[index] > MIN_NODE[index];
  }
  return true;
}

/** The binary to ship: `--node`, `PI_NEXT_NODE`, then the one running this script. */
function source() {
  const candidates = [explicit, process.execPath].filter(Boolean);
  for (const candidate of candidates) {
    const path = resolve(candidate);
    if (!existsSync(path)) {
      if (candidate === explicit) throw new Error(`no Node at ${path} (--node / PI_NEXT_NODE)`);
      continue;
    }
    const { text, parts } = versionOf(path);
    if (!meetsFloor(parts)) {
      if (candidate === explicit) {
        throw new Error(`Node ${text} at ${path} is older than ${MIN_NODE.join(".")} (pi-web's floor)`);
      }
      continue;
    }
    return { path, version: text };
  }
  throw new Error(
    `no Node ${MIN_NODE.join(".")}+ found. Install it, or point --node / PI_NEXT_NODE at one.`,
  );
}

if (!existsSync(app)) {
  console.error(`no app at ${app}: run \`npm run package:macos\` first`);
  process.exit(1);
}

const { path: from, version } = source();
await mkdir(dirname(target), { recursive: true });
await copyFile(from, target);
execFileSync("chmod", ["755", target]);

// Node ships symbols and a signature; the app only needs the code. Stripping
// saves ~20 MB, and it invalidates the signature, so the copy is ad-hoc signed
// again — the app is signed the same way (`codesign --sign -`). Any failure
// leaves the untouched copy in place: a runtime that cannot start is worse than
// a large one, and the check below runs either way.
let stripped = false;
if (process.platform === "darwin") {
  const sizeBefore = (await stat(target)).size;
  try {
    execFileSync("strip", ["-x", target], { stdio: "ignore" });
    execFileSync("codesign", ["--force", "--sign", "-", target], { stdio: "ignore" });
    const sizeAfter = (await stat(target)).size;
    stripped = sizeBefore - sizeAfter > 1024 * 1024;
    console.log(`stripped the runtime: ${(sizeBefore / 1024 / 1024).toFixed(1)} MB → ${(sizeAfter / 1024 / 1024).toFixed(1)} MB`);
  } catch {
    await copyFile(from, target);
    execFileSync("chmod", ["755", target]);
  }
}

// Node ships its licence next to the binary; keep the attribution with the copy.
const licence = ["LICENSE", "LICENSE.md"]
  .map((name) => join(dirname(from), "..", name))
  .find((path) => existsSync(path));
if (licence) await copyFile(licence, join(dirname(target), "..", "LICENSE"));

// A copy inside the app must still run: check the binary we actually wrote
// (which is what catches a strip that took too much).
const copied = versionOf(target);
const bytes = (await stat(target)).size;
const bundled = execFileSync(target, ["-p", "process.execPath"], { encoding: "utf8" }).trim();
if (bundled !== target) throw new Error(`the copied Node resolves itself as ${bundled}, not ${target}`);

// The app's own manifest is a good place for what was shipped (Settings › About
// reads the app's version from it): "node" says which runtime is inside.
const manifestFile = join(app, "Contents/Resources/nsh/app.json");
try {
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  manifest.runtime = { node: copied.text, bytes };
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
} catch {
  // No manifest (an older package): the copy alone is what matters.
}

// Leftovers from a previous run would bloat the bundle without being used.
const binDir = dirname(target);
for (const name of await readdir(binDir).catch(() => [])) {
  if (name !== exe && name !== "LICENSE") console.warn(`unexpected file in the runtime: ${name}`);
}

console.log(
  `embedded Node ${copied.text} (asked for ${version}) into ${target} — `
  + `${(bytes / 1024 / 1024).toFixed(1)} MB`,
);
