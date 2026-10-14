import { chmodSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Write a private file so a reader never sees a half-written one.
 *
 * Same directory, temp name, `0600` on the temp file, then `rename` — the pattern the rest
 * of this host uses for anything holding a credential (see `engine/account.ts`). The
 * `chmod` is not redundant with `mode`: the file may already exist with wider permissions,
 * and `writeFileSync` does not narrow an existing file's mode.
 */
export function writePrivateFileAtomicSync(path: string, contents: string): void {
  const temp = join(dirname(path), `.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(temp, contents, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}
