// Copies the built pi-web server into the packaged app, so one app runs both:
//
//   node scripts/bundle-server.mjs [app] [pi-web-source]
//
// The server is the same build the web UI and the Electron shell ship (`next
// start`'s payload: `.next`, `public`, `bin`, `next.config.mjs` and the runtime
// `node_modules`). It goes to `<App>.app/Contents/Resources/nsh/pi-web`, which
// `nsh.json` grants as `${pluginDir}/pi-web` and `src/lib/app-bundle.ts` finds;
// `src/state/server-process.ts` starts it with the Node runtime
// `scripts/embed-node.mjs` puts next to it (`nsh/node/bin/node`).
//
// Source defaults to this repo's root (where `npm run build` wrote `.next`).
//
// What is left out is everything `next start` never reads: the dev graph and
// build cache inside `.next`, source maps, and the packages that only exist for
// building (webpack, swc, TypeScript, test runners, Electron). The Electron
// build prunes the same names; unpruned this copy is ~1.8 GB, pruned ~0.3 GB.
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const app = resolve(process.argv[2] ?? "release/PI NEXT.app");
const source = resolve(process.argv[3] ?? repo);
const target = join(app, "Contents/Resources/nsh/pi-web");

for (const required of [".next/BUILD_ID", "node_modules/next/dist/bin/next", "bin/pi-web.js"]) {
  if (!existsSync(join(source, required))) {
    console.error(`no pi-web build at ${source}: ${required} is missing (run \`npm run build\` in ${repo})`);
    process.exit(1);
  }
}
if (!existsSync(app)) {
  console.error(`no app at ${app}: run \`nsh package --target macos\` first`);
  process.exit(1);
}

/** Directory names that are never part of a running server. */
const SKIP_DIRS = new Set([
  "test",
  "tests",
  "__tests__",
  "example",
  "examples",
  "docs",
  "doc",
  "bench",
  "benchmarks",
  ".turbo",
  ".git",
  ".github",
  ".cache",
  ".bin",
]);

/** Inside `.next`: the dev graph and the build cache, which `next start` ignores. */
const SKIP_NEXT_DIRS = new Set(["cache", "dev"]);

/** Packages only the build needs (the Electron `files` list prunes these too). */
const SKIP_PACKAGES = new Set([
  "typescript",
  "eslint",
  "prettier",
  "tailwindcss",
  "postcss",
  "autoprefixer",
  "esbuild",
  "lightningcss",
  "lightningcss-darwin-arm64",
  "lightningcss-darwin-x64",
  "lightningcss-linux-x64-gnu",
  "lightningcss-linux-arm64-gnu",
  "lightningcss-win32-x64-msvc",
  "playwright",
  "playwright-core",
  "vitest",
  "jest",
  "sharp",
  "@esbuild",
  "@resvg",
  "@img",
  "@next/swc-darwin-arm64",
  "@next/swc-darwin-x64",
  "@next/swc-linux-x64-gnu",
  "@next/swc-linux-arm64-gnu",
  "@next/swc-win32-x64-msvc",
  "@next/swc-win32-arm64-msvc",
  "@playwright",
  "@types",
  "@vitest",
  "@jest",
  "electron",
  "electron-builder",
  "electron-winstaller",
  "electron-installer-dmg",
  "caniuse-lite",
]);

/** Files that never matter once the bundle is built. */
const SKIP_FILE = /(\.map|\.md|\.markdown|\.tsbuildinfo|\.DS_Store)$/;

async function copy(from, to, { inNext = false, scope = "", packageRoot = false } = {}) {
  await mkdir(to, { recursive: true });
  // The two skip lists only apply where they mean something: packages live
  // directly under `node_modules` (or a scope, `node_modules/@scope`), and
  // `test`/`docs`/`example` are only throwaway at a package's own root — a
  // directory named `doc` deeper in (`yaml/dist/doc`) is code.
  const atPackages = /(^|\/)node_modules$/.test(from) || /(^|\/)node_modules\/@[^/]+$/.test(from);
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const { name } = entry;
    // A scoped package's own name is `@scope/name`: the skip list is written
    // that way, so a copy inside `node_modules/@next` must be told the scope.
    const packageName = scope ? `${scope}/${name}` : name;
    // Links (`.bin`, a `file:` dependency) are copied as what they point at:
    // `readdir` on a link to a file fails, and a link into the source tree would
    // leave the app depending on this repo.
    if (entry.isSymbolicLink()) {
      await cp(join(from, name), join(to, name), { recursive: true, dereference: true });
      continue;
    }
    if (entry.isFile()) {
      if (SKIP_FILE.test(name)) continue;
      await cp(join(from, name), join(to, name));
      continue;
    }
    if (name === ".git") continue;
    if (inNext && SKIP_NEXT_DIRS.has(name)) continue;
    if (atPackages) {
      if (SKIP_PACKAGES.has(packageName)) continue;
    } else if (packageRoot && SKIP_DIRS.has(name)) {
      continue;
    }
    await copy(join(from, name), join(to, name), {
      inNext: inNext || name === ".next",
      scope: atPackages && name.startsWith("@") ? name : "",
      packageRoot: atPackages && !name.startsWith("@"),
    });
  }
}

async function measure(dir, seen = { bytes: 0 }) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await measure(path, seen);
    else seen.bytes += (await stat(path).catch(() => ({ size: 0 }))).size;
  }
  return seen;
}

await rm(target, { recursive: true, force: true });

/**
 * Next's traced output (`.next/standalone`): only the files the server requires
 * — 91 MB of `node_modules` instead of 400 MB. The build asks for it with
 * `PI_NEXT_STANDALONE=1 npm run build` (`next.config.mjs`); without it the copy
 * falls back to the whole tree, which works but is ~300 MB larger.
 */
const standalone = join(source, ".next/standalone");
const traced = existsSync(join(standalone, "node_modules/next/dist/server/next.js"));

if (traced) {
  await copy(standalone, target);
  // Next leaves these out of `standalone` on purpose: the app serves them.
  await copy(join(source, ".next/static"), join(target, ".next/static"), { inNext: true });
  for (const part of ["public", "bin", "next.config.mjs"]) {
    const from = join(source, part);
    if (!existsSync(from)) continue;
    if ((await stat(from)).isDirectory()) await copy(from, join(target, part));
    else await cp(from, join(target, part));
  }
} else {
  console.warn("no .next/standalone: copying the whole node_modules (build with PI_NEXT_STANDALONE=1 to slim it)");
  for (const part of [".next", "public", "bin", "package.json", "next.config.mjs"]) {
    const from = join(source, part);
    if (!existsSync(from)) continue;
    const info = await stat(from);
    if (info.isDirectory()) await copy(from, join(target, part), { inNext: part === ".next" });
    else await cp(from, join(target, part));
  }
  await copy(join(source, "node_modules"), join(target, "node_modules"));
}

// The agent's own entry point: the window starts `<pi-web>/host/main.mjs` and
// talks to it over a pipe (`app-nsh/host/main.mjs`, `src/api/link.ts`).
await copy(join(here, "../host"), join(target, "host"));

// `next start` needs these to exist; a prune that took one is a broken app.
for (const required of [".next/BUILD_ID", ".next/static", "node_modules/next/dist/server/next.js", "host/main.mjs"]) {
  if (!existsSync(join(target, required))) {
    console.error(`the copy is missing ${required}`);
    process.exit(1);
  }
}

const { bytes } = await measure(target);
console.log(
  `bundled the server from ${source} into ${target} — ${(bytes / 1024 / 1024).toFixed(1)} MB`
  + (traced ? " (traced output)" : ""),
);
