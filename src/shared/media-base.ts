/**
 * Where a file's bytes are fetched from, for the shell this page is running in.
 *
 * The desktop window has two private schemes (`pinext-media:`, `pinext-icon:`) that Main
 * answers with `protocol.handle`. A browser has neither — there is no `protocol` object in
 * a page — so the same bytes come over HTTP from the server that served the page, at
 * `/api/media` and `/icons/`.
 *
 * One module decides, because the alternative is what this replaced: every caller building
 * its own URL and the browser ones silently 404-ing on an image. The desktop scheme stays
 * the default, since that is where the app has always run.
 */

/**
 * Whether this page is the browser client rather than an Electron window.
 *
 * `pathForFile` is the tell: the preload provides it (it is the one bridge member that
 * needs Electron), and `web-bridge.ts` deliberately does not. A platform string cannot
 * answer this — the server reports `darwin` for a Mac host to a browser client too.
 *
 * Read structurally rather than off the `Window` type: this module is shared with Main,
 * whose tsconfig has no `window.pinext` declaration at all.
 */
export function isWebClient(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as { pinext?: { pathForFile?: unknown } }).pinext;
  return typeof bridge?.pathForFile !== "function";
}

/** The URL that streams one file's bytes (an image, a video, a PDF, or a served HTML page). */
export function mediaUrl(filePath: string): string {
  if (!isWebClient()) {
    const url = new URL("pinext-media://media/play");
    url.searchParams.set("path", filePath);
    return url.toString();
  }
  const url = new URL("/api/media", window.location.origin);
  url.searchParams.set("path", filePath);
  return url.toString();
}

/**
 * The URL one inline document is served at — a page a reply wrote in a fence, with no file
 * behind it (`shared/inline-document.ts` carries the text).
 */
export function mediaDocumentUrl(payload: string): string {
  if (!isWebClient()) return `pinext-media://doc/${payload}`;
  return new URL(`/api/media/doc/${payload}`, window.location.origin).toString();
}

/** The URL for one file-icon SVG, by icon name (without the extension). */
export function fileIconUrl(icon: string): string {
  if (!isWebClient()) return `pinext-icon://icons/${icon}.svg`;
  return `/icons/${encodeURIComponent(icon)}.svg`;
}
