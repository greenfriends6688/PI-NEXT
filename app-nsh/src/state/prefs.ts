// Preferences: one JSON object in the app's storage.
//
// Replaces pi-web's 25 `localStorage` keys with a single record under
// `pi-web:prefs` (plan §5.4). NSH's `Storage` is asynchronous (`nsh`'s
// `Storage.getItem` / `setItem`, 5 MB, `setItem` rejecting with
// `ERR_NSH_QUOTA_EXCEEDED`) and lives on the device, not in a page origin, so
// the shape is: signal first, disk later.
//
// Reads are synchronous for the UI (`prefs()` / `pref(key, fallback)`), and a
// write updates the signal at once, then reaches the disk at most once per
// 200 ms burst. A failed write (quota, an unreadable file) is logged and
// dropped: the in-memory value stays, the UI never sees an exception.

import { signal, Storage, untracked } from "nsh";

/** The one key this app keeps. `pi-web:` so a future web build shares the server's namespace. */
export const PREFS_KEY = "pi-web:prefs";

/** How long writes to the same key coalesce before one `setItem`. */
export const WRITE_DEBOUNCE_MS = 200;

/** Every preference, keyed by its old localStorage name (`pi-theme`, `pi-web:sidebar-*`, …). */
export const prefs = signal<Record<string, unknown>>({});

let loadPromise: Promise<void> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
/** Writes run one after another: `Storage` applies them in call order and the last one wins. */
let writeChain: Promise<void> = Promise.resolve();
let loaded = false;

/**
 * True once the stored preferences have been read (or the read failed).
 *
 * A signal, not a plain flag: a native field takes its `value` at mount and
 * does not follow a later one, so the composer mounts its input only once the
 * stored draft is known. Mounting before that showed an empty box while the
 * text was there (a historical session's restored draft).
 */
export const prefsLoaded = signal(false);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePrefs(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) return parsed;
    console.warn(`[prefs] ${PREFS_KEY} is not a JSON object; starting from the defaults`);
    return {};
  } catch (error) {
    console.warn(`[prefs] ${PREFS_KEY} could not be parsed; starting from the defaults`, error);
    return {};
  }
}

/**
 * Reads `pi-web:prefs` once. Called at module load, and available to callers
 * that want to await the first read before rendering. Safe to call twice: the
 * same promise comes back.
 */
export function loadPrefs(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    let raw: string | null = null;
    try {
      raw = await Storage.getItem(PREFS_KEY);
    } catch (error) {
      console.warn(`[prefs] could not read ${PREFS_KEY}; starting from the defaults`, error);
      markLoaded();
      return;
    }
    const stored = parsePrefs(raw);
    markLoaded();
    if (Object.keys(stored).length === 0) return;
    // Values written while the read was in flight win over the file.
    prefs.set({ ...stored, ...untracked(() => prefs()) });
  })();
  return loadPromise;
}

/** The current value of `key`, or `fallback`. Reads the signal, so a caller in render tracks it. */
export function pref<T>(key: string, fallback: T): T {
  const value = prefs()[key];
  return value === undefined ? fallback : (value as T);
}

/** The current value of `key` without tracking (event handlers, timers). */
export function readPref<T>(key: string, fallback: T): T {
  return untracked(() => pref(key, fallback));
}

function scheduleWrite(): void {
  if (writeTimer !== undefined) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = undefined;
    flushPrefs();
  }, WRITE_DEBOUNCE_MS);
}

/** Sets `key` and schedules the write. The signal changes now; the disk follows. */
export function setPref(key: string, value: unknown): void {
  prefs.set({ ...untracked(() => prefs()), [key]: value });
  scheduleWrite();
}

/** Changes several keys in one write. */
export function setPrefs(values: Record<string, unknown>): void {
  prefs.set({ ...untracked(() => prefs()), ...values });
  scheduleWrite();
}

/** Drops `key` (its default applies again) and schedules the write. */
export function removePref(key: string): void {
  const current = untracked(() => prefs());
  if (!(key in current)) return;
  const next = { ...current };
  delete next[key];
  prefs.set(next);
  scheduleWrite();
}

/**
 * Writes the current record now (the debounce's timer is dropped, not
 * awaited). A failure is logged; the in-memory value is kept.
 */
export function flushPrefs(): Promise<void> {
  if (writeTimer !== undefined) {
    clearTimeout(writeTimer);
    writeTimer = undefined;
  }
  const snapshot = untracked(() => prefs());
  writeChain = writeChain.then(async () => {
    try {
      await Storage.setItem(PREFS_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.warn(`[prefs] could not write ${PREFS_KEY}; keeping the in-memory value`, error);
    }
  });
  return writeChain;
}

/** Empties every preference and removes the key from the device. */
export async function clearPrefs(): Promise<void> {
  if (writeTimer !== undefined) {
    clearTimeout(writeTimer);
    writeTimer = undefined;
  }
  prefs.set({});
  try {
    await Storage.removeItem(PREFS_KEY);
  } catch (error) {
    console.warn(`[prefs] could not remove ${PREFS_KEY}`, error);
  }
}

/** Keep the flag and the signal in step (`loaded` is what `pref()` checks). */
function markLoaded(): void {
  loaded = true;
  prefsLoaded.set(true);
}

// Start the read; `loadPrefs()` stays awaitable for a splash screen that wants it.
void loadPrefs();
