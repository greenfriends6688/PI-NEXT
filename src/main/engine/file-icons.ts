import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { protocol } from "electron";
import { availableIconNames, FILE_ICON_SCHEME, iconsDir } from "./file-icons-base.ts";
import { MEDIA_SCHEME } from "@shared/media-preview";
import type { FileIconMapping } from "@shared/types";

/**
 * File icons come from the Material Icon Theme VS Code extension
 * (`material-icon-theme`), the most-installed file icon pack. It ships ~1250 SVG
 * icons plus a `material-icons.json` association table; Pinext serves the SVGs
 * over a private scheme and hands the renderer the lookup table, so the chat's
 * change chips and (later) the project file tree share one icon source.
 */
export { FILE_ICON_SCHEME, fileIconsDirectory } from "./file-icons-base.ts";

type ThemeManifest = {
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  file: string;
  folder: string;
  folderExpanded: string;
};

let cachedMapping: FileIconMapping | null = null;

function available(): Set<string> {
  return availableIconNames();
}

function iconOrFallback(name: string, fallback: string): string {
  return available().has(name.toLowerCase()) && existsSync(join(iconsDir(), `${name}.svg`)) ? name : fallback;
}

/**
 * Must run before `app.whenReady()` so the schemes are usable from the renderer.
 * Electron accepts this call only once, so the icon scheme and the local video
 * scheme are declared together. `stream` is what lets a `<video>` seek: without it
 * the response is buffered whole and range requests never play.
 */
export function registerFileIconScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FILE_ICON_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);
}

/** Serves `pinext-icon://icons/<name>.svg` out of the icon package. */
export function registerFileIconProtocol(): void {
  const directory = iconsDir();
  protocol.handle(FILE_ICON_SCHEME, (request) => {
    const name = new URL(request.url).pathname.replace(/^\/+/, "").replace(/\.svg$/, "");
    if (!/^[a-z0-9._-]+$/i.test(name)) return new Response("Bad icon name", { status: 400 });
    const file = join(directory, `${name}.svg`);
    // Unknown names (the manifest references some generated clones) fall back to
    // the generic file glyph instead of a broken image.
    const target = existsSync(file) ? file : join(directory, "file.svg");
    return new Response(readFileSync(target), {
      headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
    });
  });
}

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
