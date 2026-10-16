import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every namespace is read by a person in one of two languages, and a key that exists
 * in only one of them renders as the raw key — or as nothing at all — in the other.
 * Nothing else in the build catches that: `tsc` sees strings, and i18next answers a
 * missing key with the key itself rather than throwing.
 *
 * `test/settings-copy.test.ts` already holds this line for `settings.json` (it also
 * caps the length of a description). This file holds it for the other five and for any
 * namespace added later: the list is read from the directory, not written down here, so
 * a new namespace is covered the moment its file lands.
 */

const BASE = new URL("../src/renderer/src/locales/", import.meta.url);
const LANGUAGES = ["zh", "en"] as const;

/**
 * i18next's plural suffixes. English inflects (`1 day` / `2 days`) and Chinese does
 * not, so English is allowed to carry a form Chinese has no use for — and only that
 * direction: a Chinese-only key is a key nothing can ever render.
 */
const PLURAL = /_(zero|one|two|few|many|other)$/;
const plural = (key: string): boolean => PLURAL.test(key);

function namespaces(): string[] {
  return readdirSync(new URL("zh/", BASE))
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function flatten(node: unknown, path: string[] = []): Array<[string, string]> {
  if (node === null || typeof node !== "object") {
    return typeof node === "string" ? [[path.join("."), node]] : [];
  }
  // An object or array is a key of its own (`t("usage.weekdays", { returnObjects: true })`).
  // It carries no copy of its own, so it is recorded as an empty value and only ever
  // used to answer "does this key exist".
  const self: Array<[string, string]> = path.length > 0 ? [[path.join("."), ""]] : [];
  return self.concat(
    Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      value !== null && typeof value === "object"
        ? flatten(value, [...path, key])
        : [[[...path, key].join("."), String(value)]],
    ),
  );
}

function read(language: string, namespace: string): Map<string, string> {
  const file = new URL(`${language}/${namespace}`, BASE);
  return new Map(flatten(JSON.parse(readFileSync(file, "utf8"))));
}

test("every namespace exists in both languages", () => {
  const names = namespaces();
  assert.ok(names.length >= 6, `only ${names.length} namespaces found — the directory moved?`);
  assert.ok(names.includes("settings.json"), "settings.json is the one namespace everything else is modelled on");
  for (const language of LANGUAGES) {
    if (language === "zh") continue;
    const there = new Set(readdirSync(new URL(`${language}/`, BASE)));
    for (const name of names) assert.ok(there.has(name), `${language}/${name} is missing`);
  }
});

test("the two languages cover the same keys in every namespace", () => {
  for (const namespace of namespaces()) {
    const zh = read("zh", namespace);
    const en = read("en", namespace);
    for (const key of zh.keys()) assert.ok(en.has(key), `en/${namespace} is missing ${key}`);
    for (const key of en.keys()) {
      assert.ok(zh.has(key) || plural(key), `zh/${namespace} is missing ${key}`);
    }
  }
});

test("every key the renderer asks for by name exists", () => {
  /**
   * The parity check above catches a key that exists in one language only. This one
   * catches the other half: a `t("…")` whose key exists in neither, which renders as
   * the raw key with nothing in the build to notice. It only judges the calls it can
   * read — a literal key in a file whose namespace is also a literal. A file that
   * builds its key (`t(`a.${x}`)`) or takes its namespace from a variable is skipped
   * rather than guessed at, because a gate with false alarms gets switched off.
   */
  const tables = namespaces().map((name) => [name.slice(0, -5), read("zh", name), read("en", name)] as const);
  const missing: string[] = [];
  let checked = 0;

  for (const file of sourceFiles(SOURCE)) {
    const source = readFileSync(file, "utf8");
    const namespacesUsed = [...source.matchAll(/useTranslation\(\s*["']([a-z]+)["']\s*\)/g)].map((m) => m[1]!);
    const unique = [...new Set(namespacesUsed)];
    if (unique.length !== 1) continue;
    const namespace = unique[0]!;
    const table = tables.find(([name]) => name === namespace);
    if (!table) {
      missing.push(`${relative(ROOT, file)} uses namespace ${namespace}, which has no locale file`);
      continue;
    }
    for (const match of source.matchAll(/(?<![\w.])t\(\s*["']([^"'`$]+)["']\s*(,[\s\S]{0,120}?)?\)/g)) {
      const key = match[1]!;
      if (key.length === 0) continue;
      checked += 1;
      const options = match[2] ?? "";
      // `{ ns: "other" }` reads from another namespace, and `count` makes i18next resolve
      // the plural form rather than the base key. Both are the caller saying so, not a guess.
      const override = /ns:\s*["']([a-z]+)["']/.exec(options)?.[1];
      const counted = /(?:^|[{,\s])count\s*:/.test(options);
      const prefixed = key.includes(":");
      const namespaceName = override ?? (prefixed ? key.slice(0, key.indexOf(":")) : namespace);
      const owner = tables.find(([name]) => name === namespaceName);
      const bare = prefixed && !override ? key.slice(key.indexOf(":") + 1) : key;
      if (!owner) {
        missing.push(`${relative(ROOT, file)} uses t("${key}"), which names no namespace`);
        continue;
      }
      const known =
        owner[1].has(bare) ||
        owner[2].has(bare) ||
        (counted && [...owner[2].keys()].some((other) => other.startsWith(`${bare}_`) && PLURAL.test(other)));
      if (!known) missing.push(`${relative(ROOT, file)} uses t("${key}")`);
    }
  }

  assert.ok(checked > 200, `only ${checked} literal keys were found — the scanner stopped matching?`);
  assert.deepEqual(missing, [], "keys that no locale defines");
});

const ROOT = new URL("../", import.meta.url).pathname;
const SOURCE = new URL("../src/renderer/src/", import.meta.url);

function sourceFiles(dir: URL): string[] {
  const base = dir.pathname;
  const out: string[] = [];
  const walk = (path: string): void => {
    for (const entry of readdirSync(path)) {
      if (entry === "locales" || entry === "mock" || entry === "node_modules") continue;
      const next = join(path, entry);
      if (statSync(next).isDirectory()) walk(next);
      else if (/\.tsx?$/.test(next)) out.push(next);
    }
  };
  walk(base);
  return out;
}
