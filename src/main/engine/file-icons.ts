import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { protocol } from "electron";
import { FILE_ICON_SCHEME, getFileIconMapping, iconsDir, readIcon } from "./file-icons-base.ts";
import { MEDIA_SCHEME } from "@shared/media-preview";

/**
 * File icons come from the Material Icon Theme VS Code extension
 * (`material-icon-theme`), the most-installed file icon pack. It ships ~1250 SVG
 * icons plus a `material-icons.json` association table; Pinext serves the SVGs
 * over a private scheme and hands the renderer the lookup table, so the chat's
 * change chips and the project file tree share one icon source.
 *
 * This half is the desktop's: the `pinext-icon://` scheme and its privileges, which need
 * Electron. The directory, the name check and the lookup table itself live in
 * `file-icons-base.ts`, because the browser client is served the same table over HTTP by
 * a host that cannot import this file.
 */
export { FILE_ICON_SCHEME, fileIconsDirectory, getFileIconMapping } from "./file-icons-base.ts";

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
  protocol.handle(FILE_ICON_SCHEME, (request) => {
    const name = new URL(request.url).pathname.replace(/^\/+/, "").replace(/\.svg$/, "");
    const body = readIcon(name);
    if (!body) return new Response("Bad icon name", { status: 400 });
    return new Response(new Uint8Array(body), {
      headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
    });
  });
}
