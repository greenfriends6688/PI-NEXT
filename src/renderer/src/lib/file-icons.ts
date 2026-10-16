import { useEffect, useState } from "react";
import { fileIconUrl as sharedFileIconUrl } from "@shared/media-base";
import type { FileIconMapping } from "@shared/types";

/**
 * Material Icon Theme lookups. The association table is fetched once from Main
 * and cached for the whole renderer; the icons themselves are served under the
 * `pinext-icon` scheme, so a chip or a file-tree row only needs the icon name.
 */
let cache: FileIconMapping | null = null;
let pending: Promise<FileIconMapping> | null = null;
let resolved: Map<string, string> | null = null;

export function loadFileIcons(): Promise<FileIconMapping> {
  if (!pending) {
    pending = window.pinext.workspace
      .fileIcons()
      .then((mapping) => {
        cache = mapping;
        return mapping;
      })
      .catch((error: unknown) => {
        // A failed load must not be cached as the answer. This held a rejected promise for
        // the life of the page, so one call that failed while the connection was still
        // coming up meant no icons anywhere for the rest of the session.
        pending = null;
        throw error;
      });
  }
  return pending;
}

export function useFileIcons(): FileIconMapping | null {
  const [mapping, setMapping] = useState<FileIconMapping | null>(cache);
  useEffect(() => {
    if (cache) return;
    let active = true;
    void loadFileIcons()
      .then((value) => {
        if (active) setMapping(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return mapping;
}

/** Extensions sorted longest-first so `d.ts` wins over `ts`. */
function sortedExtensions(mapping: FileIconMapping): Array<[string, string]> {
  return Object.entries(mapping.fileExtensions).sort((a, b) => b[0].length - a[0].length);
}

/** Resolve a file or folder name to a Material Icon Theme icon name. */
export function resolveFileIcon(mapping: FileIconMapping | null | undefined, name: string, kind: "file" | "folder" = "file"): string {
  // A table that arrived without its lookups is treated as no table. It once arrived as
  // `{ files: {}, folders: {} }` — a stub one host answered with — and reading
  // `undefined.fileNames["auth.ts"]` for that threw out of a render and blanked the app.
  if (!mapping?.fileNames || !mapping.fileExtensions) return "file";
  const lower = name.toLowerCase();
  if (kind === "folder") return mapping.folder ?? "folder";
  if (!resolved) resolved = new Map();
  const hit = resolved.get(lower);
  if (hit) return hit;
  const named = mapping.fileNames[lower];
  let icon = named;
  if (!icon) {
    for (const [extension, candidate] of sortedExtensions(mapping)) {
      if (lower.endsWith(`.${extension}`)) {
        icon = candidate;
        break;
      }
    }
  }
  const value = icon ?? mapping.file ?? "file";
  resolved.set(lower, value);
  return value;
}

/**
 * Where to fetch one icon.
 *
 * `pinext-icon://` is a `protocol.handle` registered in Main, which serves the icon
 * theme's directory to the desktop window; the browser client gets the same files over
 * HTTP from the server that served it. `shared/media-base.ts` is the one place that
 * decides, so a new caller cannot pick the wrong one.
 */
export function fileIconUrl(icon: string): string {
  return sharedFileIconUrl(icon);
}
