import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { FileIconMapping } from "@shared/types";

/**
 * Where the file-icon SVGs are, and which names are real — the half of `file-icons.ts`
 * that does not need Electron.
 *
 * Split out because the remote server serves the same directory over HTTP for the browser
 * client, and that server is Electron-free by design (the headless Agent loads it). The
 * private `pinext-icon://` scheme, `protocol.handle` and the scheme privileges stay in
 * `file-icons.ts`, which only the desktop host imports.
 *
 * Icons come from the Material Icon Theme VS Code extension (`material-icon-theme`), the
 * most-installed VS Code file icon pack: ~1250 SVGs plus a `material-icons.json`
 * association table.
 */

/** The private scheme the desktop window loads icons over. */
export const FILE_ICON_SCHEME = "pinext-icon";

const require_ = createRequire(import.meta.url);

/** The package's icon directory, resolved through its manifest rather than a guessed path. */
export function iconsDir(): string {
  const manifest = require_.resolve("material-icon-theme/package.json");
  return join(dirname(manifest), "icons");
}

/**
 * Where the SVGs are, for a transport that cannot use the private scheme.
 *
 * The browser client has no `protocol.handle`, so the remote server serves the same
 * directory over HTTP (`server/server.ts`). One directory, two transports — the same
 * reason the call table itself is shared.
 */
export function fileIconsDirectory(): string {
  return iconsDir();
}

let availableIcons: Set<string> | null = null;

/** Icon names that actually ship as files (the manifest also names generated clones). */
export function availableIconNames(): Set<string> {
  if (!availableIcons) {
    availableIcons = new Set(
      readdirSync(iconsDir())
        .filter((file) => file.endsWith(".svg"))
        .map((file) => file.slice(0, -4).toLowerCase()),
    );
  }
  return availableIcons;
}

/**
 * The file one icon name resolves to, or null when the name is unusable.
 *
 * Checked against the directory's own listing and the fallback glyph rather than joined
 * onto the path: the name arrives from a URL in the server's case, and `../../etc/passwd`
 * must not become a path.
 */
export function iconFileFor(rawName: string): string | null {
  const name = rawName.trim();
  if (!/^[a-z0-9._-]+$/i.test(name) || name.includes("..")) return null;
  const directory = iconsDir();
  const file = join(directory, `${name}.svg`);
  // Unknown names (the manifest references some generated clones) fall back to the
  // generic file glyph instead of a broken image.
  return existsSync(file) ? file : join(directory, "file.svg");
}

/** The bytes of one icon, or null for a name that is not usable. */
export function readIcon(name: string): Buffer | null {
  const file = iconFileFor(name);
  if (!file) return null;
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}

type ThemeManifest = {
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  file: string;
  folder: string;
  folderExpanded: string;
};

let cachedMapping: FileIconMapping | null = null;

/**
 * The association table the renderer resolves a file or folder name against.
 *
 * It lives here, beside the directory it is built from, rather than in `file-icons.ts`:
 * **both hosts serve it** and only one of them can import Electron. It was answered by a
 * stub on the browser side — `{ files: {}, folders: {} }` — which is not that shape at
 * all, so every `FileIcon` in the browser client read `undefined.fileNames["auth.ts"]`
 * and took the whole window down with `Cannot read properties of undefined`. A table that
 * is wrong is worse than one that is missing: a missing one leaves the generic glyph.
 */
export function getFileIconMapping(): FileIconMapping {
  if (cachedMapping) return cachedMapping;
  const manifest = JSON.parse(
    readFileSync(join(iconsDir(), "..", "dist", "material-icons.json"), "utf8"),
  ) as ThemeManifest;
  const pick = (name: string): string => iconOrFallback(name, manifest.file);
  cachedMapping = {
    fileExtensions: Object.fromEntries(
      Object.entries(manifest.fileExtensions).map(([extension, icon]) => [extension, pick(icon)]),
    ),
    fileNames: Object.fromEntries(
      Object.entries(manifest.fileNames).map(([name, icon]) => [name, pick(icon)]),
    ),
    file: manifest.file,
    folder: iconOrFallback(manifest.folder, manifest.file),
    folderExpanded: iconOrFallback(manifest.folderExpanded, manifest.file),
  };
  return cachedMapping;
}

function iconOrFallback(name: string, fallback: string): string {
  return availableIconNames().has(name.toLowerCase()) && existsSync(join(iconsDir(), `${name}.svg`)) ? name : fallback;
}
