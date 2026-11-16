// The route table of the local API: every module that answers `/api/*` in the
// window. One module per area, each returning `null` for a path it does not own;
// the first answer wins. `link.ts` falls back to the pipe (a dev build's Next
// server) when nothing here answers, so the port can land route by route.
//
// Adding an area: write `handleX()` in its own file, then add it below. Nothing
// else in the app changes — `src/api/*` and the screens still call `fetch`.
import { readdir } from "fs/promises";
import { handleAgent } from "./agent-routes";
import { handleFiles } from "./file-routes";
import { handleGit } from "./git-routes";
import { handleMcp } from "./mcp-routes";
import { handleMisc } from "./misc-routes";
import { handleModelSettings } from "./model-settings-routes";
import { handleServerOnly } from "./server-only-routes";
import { handlePlugins } from "./plugin-routes";
import { handleSkills } from "./skills-routes";
import { handleUpload } from "./upload-routes";
import { describe, errorResponse, homeDirectory, type LocalHandler, type LocalRequest } from "./request";
import { handleSessions } from "./session-routes";
import { handleSettings } from "./settings-routes";
import { handleTerminal } from "./terminal-routes";
import { handleTrust } from "./trust-routes";

const handlers: LocalHandler[] = [
  handleAgent,
  handleSessions,
  handleFiles,
  handleGit,
  handleSettings,
  handleMcp,
  handleSkills,
  handlePlugins,
  handleUpload,
  handleMisc,
  handleModelSettings,
  handleServerOnly,
  handleTerminal,
  handleTrust,
];

/**
 * Whether this runtime has a native filesystem at all. A headless test engine
 * and the browser target do not (`ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`): every
 * route here reads pi's files, so none of them can answer, and the request must
 * fall through to whatever the caller used before (the dev server, the pipe).
 * Asked once.
 */
let fsUsable: boolean | null = null;
async function nativeFilesystem(): Promise<boolean> {
  if (fsUsable !== null) return fsUsable;
  try {
    await readdir(homeDirectory());
    fsUsable = true;
  } catch {
    // No directories to read: a headless test engine, a browser, or a host
    // whose grants do not cover the home folder. The request then goes on to
    // whatever served it before (the dev server, the bundled server).
    fsUsable = false;
  }
  return fsUsable;
}

export interface LocalCall {
  method: string;
  headers: Record<string, string>;
  body: string | null;
  /** A binary body (a multipart upload), with the boundary in `contentType`. */
  bytes?: Uint8Array;
  contentType?: string;
  signal?: AbortSignal;
}

/** Answers `url` locally, or `null` when no module owns it. */
export async function handleLocally(
  url: string,
  call: LocalCall,
): Promise<import("./request").LocalResponse | null> {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://local");
  } catch {
    return null;
  }
  if (!parsed.pathname.startsWith("/api/")) return null;
  if (!(await nativeFilesystem())) return null;

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(call.headers)) headers[name.toLowerCase()] = value;

  const request: LocalRequest = {
    method: call.method.toUpperCase(),
    url,
    params: parsed.searchParams,
    segments: parsed.pathname.split("/").filter((part) => part !== "").map(decodeURIComponent),
    headers,
    body: call.body,
    bytes: call.bytes,
    contentType: call.contentType,
    signal: call.signal,
  };

  for (const handler of handlers) {
    let reply;
    try {
      reply = await handler(request);
    } catch (cause) {
      // A route that threw is this app's bug, not the caller's: answer it as a
      // route's own failure so `req()` keeps one error path (`ApiError`).
      return errorResponse(describe(cause), 500);
    }
    if (reply !== null) return reply;
  }
  return null;
}
