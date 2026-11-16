// The app's translations: one locale signal, and `t()` for every string the UI
// draws.
//
// The dictionaries are pi-next's own (`../i18n/messages/{en,zh-CN,zh-TW}.ts`,
// 1,721 keys each): the two products say the same things, so a screen written
// against pi-next's keys reads the same in every language it supports.
//
// Why a signal and not a provider: NSH components run once (`tsx.md`), so a
// language change must re-run exactly the bindings that read the text. A
// signal read inside the binding does that; a `t()` that captured a locale at
// mount would not.
import { computed, localeSettings, signal } from "nsh";
import { readPref, setPref } from "../state/prefs";
import { interpolateMessage } from "../i18n/format";
import { enLocale } from "../i18n/messages/en";
import { zhCNLocale } from "../i18n/messages/zh-CN";
import { zhTWLocale } from "../i18n/messages/zh-TW";
import type { Locale, LocalePlugin, TranslationParams } from "../i18n/types";

/** Where the choice is kept (pi-next's own key, so a web build shares it). */
export const LOCALE_PREF = "pi-locale";

const plugins: LocalePlugin[] = [enLocale, zhCNLocale, zhTWLocale];

/** The label a language picker shows, in that language. */
export const LOCALES: ReadonlyArray<{ id: Locale; label: string }> = [
  { id: "en", label: "English" },
  { id: "zh-CN", label: "简体中文" },
  { id: "zh-TW", label: "繁體中文" },
];

/**
 * The language on first run: the one this machine asks for, as pi-next does
 * (`AGENTS.md` "the default locale", `lib/i18n/registry.ts`
 * `resolveBrowserLocale` over `localeSettings().languages`, the system's own
 * preference list in `docs/dev/js-modules.md` "locale"). A Chinese system
 * starts in Simplified Chinese; an English one starts in English.
 *
 * A stored choice wins over it, so a switch survives the next launch.
 */
function initialLocale(): Locale {
  const stored = readPref<Locale | null>(LOCALE_PREF, null);
  if (stored !== null) return stored;
  const preferred = localeSettings().languages;
  for (const language of preferred) {
    const tag = language.toLowerCase();
    if (tag === "en" || tag.startsWith("en-")) return "en";
    if (tag === "zh" || tag.startsWith("zh-hans") || tag.startsWith("zh-cn") || tag.startsWith("zh-sg")) return "zh-CN";
    if (tag.startsWith("zh-")) return "zh-TW";
  }
  return "en";
}

/** The language the UI draws in; `setLocale` writes the preference too. */
export const locale = signal<Locale>(initialLocale());

/** `zh-CN` and `zh-TW` read the same for digits, but the tag matters for dates. */
export const isChinese = computed(() => locale() !== "en");

export function setLocale(next: Locale): void {
  if (locale() === next) return;
  locale.set(next);
  void setPref(LOCALE_PREF, next);
}

/** The active dictionary, for the rare caller that needs a whole table. */
export function activeMessages(): Record<string, string> {
  const id = locale();
  return (plugins.find((plugin) => plugin.id === id) ?? enLocale).messages;
}

/**
 * One translated string.
 *
 * `t("settings.done")` reads `locale()` inside the call, so a JSX binding
 * that calls it re-runs when the language changes. `params` fill `{name}`
 * placeholders (`i18n/format.ts` `interpolateMessage`).
 *
 * A key the dictionaries lack returns the key itself, which is how a missing
 * translation shows up in a screenshot rather than as an empty label; the
 * parity check in `tests/i18n.test.tsx` is what keeps that from shipping.
 */
export function t(key: string, params?: TranslationParams): string {
  const id = locale();
  const messages = (plugins.find((plugin) => plugin.id === id) ?? enLocale).messages;
  const message = messages[key] ?? enLocale.messages[key];
  if (message === undefined) return key;
  return params === undefined ? message : interpolateMessage(message, params);
}

/** `t()` for a key that may be absent: `null` stays null, so a binding can skip. */
export function tMaybe(key: string | null | undefined): string | null {
  if (key === null || key === undefined || key === "") return null;
  return t(key);
}
