/**
 * fork:import-scan — filesystem helpers for the import scanner.
 *
 * The candidate/diagnostic **types** moved to `./contract.ts`, because the settings UI
 * imports them from a client component and this file pulls in `node:fs/promises`. This
 * module re-exports the contract so existing `./types` imports keep working.
 */

import { open, readFile, stat } from "node:fs/promises";

export * from "./contract";
import { errorLabel } from "./contract";

/** Read at most `maxBytes` from the head of a file. Null when unreadable. */
export async function readFileHead(filePath: string, maxBytes: number): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return null;
    const length = Math.min(maxBytes, stats.size);
    if (length <= 0) return "";
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(length);
    const read = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, read.bytesRead).toString("utf8");
  } catch {
    return null;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // best effort
      }
    }
  }
}

export interface CappedTextRead {
  exists: boolean;
  text?: string;
  error?: string;
}

/** Read a whole text file only when it is within `maxBytes`. */
export async function readTextFileCapped(
  filePath: string,
  maxBytes: number,
): Promise<CappedTextRead> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return { exists: false };
    if (stats.size > maxBytes) return { exists: true, error: "file too large" };
    return { exists: true, text: await readFile(filePath, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
    return { exists: true, error: errorLabel(error) };
  }
}

export interface CappedJsonRead {
  exists: boolean;
  data?: unknown;
  error?: string;
}

/** Capped read + parse; malformed JSON becomes an error code, never a throw. */
export async function readJsonFileCapped(
  filePath: string,
  maxBytes: number,
): Promise<CappedJsonRead> {
  const read = await readTextFileCapped(filePath, maxBytes);
  if (!read.exists) return { exists: false };
  if (read.error !== undefined) return { exists: true, error: read.error };
  try {
    return { exists: true, data: JSON.parse(read.text ?? "") as unknown };
  } catch {
    return { exists: true, error: "malformed JSON" };
  }
}
