// What the app starts, and with which runtime: the server it ships, the Node
// runtime it ships, and how to launch them on this platform.
//
// pi's agent is a Node SDK (`@earendil-works/pi-coding-agent`): a QuickJS app
// cannot load it, so the server that owns it runs in a Node process. The app
// carries both — the server payload at `<app>/pi-web` and the runtime at
// `<app>/node/bin/node` — so a user installs one app and nothing else: no
// system Node, no `npm i -g @agegr/pi-web`, no network on first run. This is the
// same shape as PI NEXT's Electron shell, where Node is the Electron binary and
// the server is the `.next` next to it.
//
// `import.meta.url` of this module is the app's own directory as a `file:` URL
// (the host's `${pluginDir}`, `crates/nsh-js/src/dom.rs` `meta_url`), which is
// how the bundle is found wherever the app was installed.
//
// One sandbox rule shapes the code below: a child's environment is cleared and
// `capabilities.process.execute` matches **exactly**, so a path that moves with
// the install (`/Applications/…` vs `~/Applications/…`) cannot be the only way
// in. On POSIX the first candidate therefore goes through `/usr/bin/env` with a
// `PATH` starting at the app's own `node/bin`: a fixed, granted executable that
// finds the embedded runtime wherever the app sits.
import { exists } from "fs/promises";
import process from "process";

/** The port the app's server listens on: fixed, so the window's origin is fixed. */
export const SERVER_PORT = 30142;
/** Loopback only: the server is this app's own, not a LAN service. */
export const SERVER_HOST = "127.0.0.1";

/** The app's own directory (a `file:` URL's path), or "" when unknown. */
export function appDir(): string {
  try {
    const url = import.meta.url;
    if (url.startsWith("file:")) {
      const path = decodeURIComponent(url.replace(/^file:\/\//, ""));
      // `.../nsh/bundle.nshc` → `.../nsh` (the packaged app: one bundle at the
      // plugin root, which is also where `node/` and `pi-web/` sit).
      const slash = path.lastIndexOf("/");
      const dir = slash > 0 ? path.slice(0, slash) : path;
      // `nsh run` loads the sources one by one: `.../app-nsh/src/lib/
      // app-bundle.ts` → `.../app-nsh`, which is the same root in development.
      const source = /^(.*)\/src\/[^/]+$/.exec(dir);
      return source ? source[1] : dir;
    }
  } catch {
    // No module URL on this host: fall back to the candidates below.
  }
  return "";
}

/** Where a server build may sit: what the environment names, then the app's own. */
export function bundleCandidates(): string[] {
  const own = appDir();
  const configured = process.env.PI_NSH_SERVER;
  return [
    // Development: `nsh run` with `PI_NSH_SERVER=<repo>` talks to that build.
    ...(configured ? [configured] : []),
    // The package: the server sits next to the app's own bundle.
    ...(own ? [`${own}/pi-web`] : []),
    // Installs made before the payload moved under `nsh/`.
    "/Applications/PI NEXT.app/Contents/Resources/nsh/pi-web",
    "/Applications/PI NEXT.app/Contents/Resources/pi-web",
    "/Applications/pi-web.app/Contents/Resources/pi-web",
    "/usr/local/lib/node_modules/@agegr/pi-web",
    "/opt/homebrew/lib/node_modules/@agegr/pi-web",
  ];
}

/** Whether a path is there (a refusal outside the granted roots is a no). */
async function isThere(path: string): Promise<boolean> {
  try {
    return await exists(path);
  } catch {
    return false;
  }
}

/** The first candidate holding a built server, or null. */
export async function findServerBundle(): Promise<string | null> {
  for (const dir of bundleCandidates()) {
    const next = await isThere(`${dir}/node_modules/next/dist/bin/next`);
    // `next start` wants the build, not just the dependency: a dev tree has the
    // launcher from install day and `.next` only after `npm run build`.
    if (next && (await isThere(`${dir}/.next/BUILD_ID`))) return dir;
  }
  return null;
}

/** The `next` launcher inside a bundle. */
export function nextBin(bundle: string): string {
  return `${bundle}/node_modules/next/dist/bin/next`;
}

/** The Node runtime this app ships (`<app>/node/bin/node`), or null. */
export async function findNodeRuntime(): Promise<string | null> {
  const configured = process.env.PI_NSH_NODE;
  if (configured && (await isThere(configured))) return configured;
  const own = appDir();
  if (!own) return null;
  const exe = process.platform === "windows" ? "node.exe" : "node";
  const runtime = `${own}/node/bin/${exe}`;
  return (await isThere(runtime)) ? runtime : null;
}

/** One way to start the server: a command, its arguments, and what to call it. */
export interface ServerLaunch {
  command: string;
  args: string[];
  /** Shown in the log and in a failure, so a user can see what ran. */
  label: string;
}

/**
 * `next start`'s arguments. The directory is passed instead of being the child's
 * cwd: the sandbox only lets a child run inside a writable root, and the app's
 * own bundle is read-only (the server writes to `~/.pi` and the data directory).
 */
function nextArgs(bundle: string, port: number): string[] {
  return [nextBin(bundle), "start", bundle, "-H", SERVER_HOST, "-p", String(port)];
}

/** What the server needs in its environment, as `env(1)` assignments. */
function envAssignments(nodeDir: string): string[] {
  const hostPath = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  return [
    // The app's runtime first, so anything the server starts itself (extensions,
    // shells) finds the same `node` the app ships.
    `PATH=${nodeDir}:${hostPath}`,
    "NODE_ENV=production",
    "NEXT_TELEMETRY_DISABLED=1",
  ];
}

/**
 * Every way to start the server, best first: the shipped runtime, then the
 * machine's own `node` (so `nsh run` in development works with no packaging step
 * at all). They are tried in order: the sandbox refusing one is not fatal.
 */
export async function launchCandidates(bundle: string, port = SERVER_PORT): Promise<ServerLaunch[]> {
  const launches: ServerLaunch[] = [];
  const runtime = await findNodeRuntime();
  if (runtime) {
    const nodeDir = runtime.slice(0, runtime.lastIndexOf("/"));
    if (process.platform === "windows") {
      // Windows has no `/usr/bin/env`. `cmd /c` runs the shipped Node by path
      // (the quoting `/s` expects), and `cmd` is granted by name: the manifest
      // cannot name `C:\Windows\System32\cmd.exe`, because capabilities are
      // validated on the build machine too (`access.rs:1653-1663`: a bare name,
      // or an absolute POSIX path).
      launches.push({
        command: "cmd",
        args: [
          "/d",
          "/s",
          "/c",
          `""${runtime}" "${nextBin(bundle)}" start "${bundle}" -H ${SERVER_HOST} -p ${port}"`,
        ],
        label: `the app's own Node (${runtime})`,
      });
    } else {
      // `/usr/bin/env PATH=… node …`: granted by its fixed path, and it finds the
      // embedded runtime wherever the app was installed.
      launches.push({
        command: "/usr/bin/env",
        args: [...envAssignments(nodeDir), "node", ...nextArgs(bundle, port)],
        label: `the app's own Node (${runtime})`,
      });
    }
    launches.push({
      command: runtime,
      args: nextArgs(bundle, port),
      label: `the app's own Node (${runtime})`,
    });
  }
  launches.push({
    command: "node",
    args: nextArgs(bundle, port),
    label: "node from PATH",
  });
  return launches;
}
