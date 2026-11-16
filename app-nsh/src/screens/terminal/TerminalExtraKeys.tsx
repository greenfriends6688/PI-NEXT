// The touch keyboard's missing keys: Ctrl, Alt, Esc, Tab and the arrows,
// as `pi-next/components/TerminalExtraKeys.tsx` has them, in the kit's look.
//
// The sequences are pi-next's (`lib/terminal-extra-keys.ts:23-65`), copied
// rather than invented: `Terminal` receives every key as bytes, so a touch
// screen needs the bar to send the escapes a hardware keyboard would.
//
// What NSH does not tell the bar (TODO(nsh)): `TerminalRef` exposes
// `write` / `reset` / `text` / `focus` only (`.nsh/types/nsh/base.d.ts:
// 4922-4933`), so the emulator's DECCKM state is unknown and the arrows use
// the normal-mode `CSI A` form. A terminal in application-cursor mode (vim,
// less) would want `SS3 A`; the API needs to report `TerminalModes`.
//
// The bar shows on phones and tablets (`platform.idiom !== "desktop"`).
// TODO(nsh): NSH has no `(pointer: coarse)` query, so a touch desktop is
// the one case this misses; `platform.idiom` is the closest signal it
// exposes. Add the query (or a `platform.pointer` field) and OR it in here.

import { signal, Text, View } from "nsh";
import { platform } from "nsh";
import { t } from "../../ui/i18n";
import { colors, mono, Press } from "../../ui/kit";

export type TerminalExtraKey =
  | "Escape" | "/" | "-" | "Home" | "ArrowUp" | "End" | "PageUp"
  | "Tab" | "ArrowLeft" | "ArrowDown" | "ArrowRight" | "PageDown";

export type TerminalModifier = "ctrl" | "alt";
export type TerminalExtraKeyName = TerminalExtraKey | TerminalModifier;

export interface TerminalModifiers {
  ctrl: boolean;
  alt: boolean;
}

export const NO_TERMINAL_MODIFIERS: TerminalModifiers = { ctrl: false, alt: false };

/** pi-next's two rows of seven (`lib/terminal-extra-keys.ts:14-17`). */
export const TERMINAL_EXTRA_KEY_ROWS: readonly (readonly TerminalExtraKeyName[])[] = [
  ["Escape", "/", "-", "Home", "ArrowUp", "End", "PageUp"],
  ["Tab", "ctrl", "alt", "ArrowLeft", "ArrowDown", "ArrowRight", "PageDown"],
];

/** pi-next's labels (`components/TerminalExtraKeys.tsx:13-16`), with the
 * arrows pointing the way they move (pi rotates its two horizontal ones). */
const KEY_LABELS: Record<TerminalExtraKeyName, string> = {
  Escape: "ESC",
  "/": "/",
  "-": "-",
  Home: "HOME",
  ArrowUp: "↑",
  End: "END",
  PageUp: "PGUP",
  Tab: "TAB",
  ctrl: "CTRL",
  alt: "ALT",
  ArrowLeft: "←",
  ArrowDown: "↓",
  ArrowRight: "→",
  PageDown: "PGDN",
};

/** What screen readers name the keys whose glyph says nothing (the dictionary's keys). */
const KEY_NAME_KEYS: Partial<Record<TerminalExtraKeyName, string>> = {
  Escape: "terminal.key.escape",
  Home: "terminal.key.home",
  End: "terminal.key.end",
  PageUp: "terminal.key.pageUp",
  PageDown: "terminal.key.pageDown",
  Tab: "terminal.key.tab",
  ArrowUp: "terminal.key.up",
  ArrowDown: "terminal.key.down",
  ArrowLeft: "terminal.key.left",
  ArrowRight: "terminal.key.right",
  ctrl: "terminal.key.control",
  alt: "terminal.key.alt",
};

/** Two rows of 42-point keys (pi-next's `.terminal-extra-keys`, `app/globals.css:805-819`). */
const KEY_ROW_HEIGHT = 42;
const KEY_GAP = 4;

const CURSOR_FINALS: Partial<Record<TerminalExtraKey, string>> = {
  ArrowUp: "A",
  ArrowDown: "B",
  ArrowRight: "C",
  ArrowLeft: "D",
  Home: "H",
  End: "F",
};

const TILDE_CODES: Partial<Record<TerminalExtraKey, number>> = { PageUp: 5, PageDown: 6 };

/** xterm's modifier parameter: 1 + Shift(1) + Alt(2) + Ctrl(4). */
function modifierParam({ ctrl, alt }: TerminalModifiers): number {
  return 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0);
}

function ctrlChar(char: string): string {
  if (/^[a-z]$/i.test(char)) return String.fromCharCode(char.toUpperCase().charCodeAt(0) & 0x1f);
  const code = char.charCodeAt(0);
  if (code >= 64 && code <= 95) return String.fromCharCode(code & 0x1f);
  if (char === " ") return "\x00";
  if (char === "/" || char === "-") return "\x1f";
  if (char === "?") return "\x7f";
  return char;
}

/** Applies a pending Ctrl/Alt to one typed character (`lib/terminal-extra-keys.ts:43-47`). */
export function applyTerminalModifiers(data: string, modifiers: TerminalModifiers): string {
  if ((!modifiers.ctrl && !modifiers.alt) || [...data].length !== 1) return data;
  const char = modifiers.ctrl ? ctrlChar(data) : data;
  return modifiers.alt ? `\x1b${char}` : char;
}

/**
 * The bytes of a key of the bar, with the pending modifiers
 * (`lib/terminal-extra-keys.ts:49-65`). `applicationCursorKeys` is the
 * emulator's DECCKM state, which NSH does not expose yet (see the TODO at
 * the top): pass `false` for the normal-mode form.
 */
export function terminalExtraKeySequence(
  key: TerminalExtraKey,
  modifiers: TerminalModifiers,
  applicationCursorKeys = false,
): string {
  const modified = modifiers.ctrl || modifiers.alt;
  const final = CURSOR_FINALS[key];
  if (final) {
    if (modified) return `\x1b[1;${modifierParam(modifiers)}${final}`;
    return applicationCursorKeys ? `\x1bO${final}` : `\x1b[${final}`;
  }
  const tilde = TILDE_CODES[key];
  if (tilde) return modified ? `\x1b[${tilde};${modifierParam(modifiers)}~` : `\x1b[${tilde}~`;
  if (key === "Escape") return modifiers.alt ? "\x1b\x1b" : "\x1b";
  if (key === "Tab") return modifiers.alt ? "\x1b\t" : "\t";
  return applyTerminalModifiers(key, modifiers);
}

const isModifier = (key: TerminalExtraKeyName): key is TerminalModifier => key === "ctrl" || key === "alt";

export interface TerminalExtraKeysProps {
  /** Sends one sequence to the pty (`writeTerminalInput` in the view). */
  onKey: (sequence: string) => void;
}

/**
 * The bar under the terminal: the keys a software keyboard leaves out, in
 * two rows. Ctrl and Alt latch (lit while on) for the next key, then clear
 * as pi-next's do; every other key sends its sequence at once.
 */
export function TerminalExtraKeys(props: TerminalExtraKeysProps) {
  const modifiers = signal<TerminalModifiers>(NO_TERMINAL_MODIFIERS);

  const press = (key: TerminalExtraKeyName): void => {
    if (isModifier(key)) {
      const current = modifiers();
      modifiers.set({ ...current, [key]: !current[key] });
      return;
    }
    const current = modifiers();
    modifiers.set(NO_TERMINAL_MODIFIERS);
    props.onKey(terminalExtraKeySequence(key, current));
  };

  return (
    <View
      style={{
        flexShrink: 0,
        gap: KEY_GAP,
        padding: KEY_GAP,
        paddingBottom: KEY_GAP,
        borderTopWidth: 1,
        borderTopColor: colors.line,
        backgroundColor: colors.inset,
      }}
      accessibilityLabel={t("terminal.extraKeys")}
      role="toolbar"
    >
      <Each of={TERMINAL_EXTRA_KEY_ROWS} key="index">
        {(row) => (
          <View style={{ flexDirection: "row", gap: KEY_GAP }}>
            <Each of={row()} key="index">
              {(name) => {
                const key = name();
                const modifier = isModifier(key);
                return (
                  <Press
                    onPress={() => press(key)}
                    accessibilityLabel={KEY_NAME_KEYS[key] ? t(KEY_NAME_KEYS[key]) : KEY_LABELS[key]}
                    accessibilityState={modifier ? { checked: modifiers()[key as TerminalModifier] } : undefined}
                    role={modifier ? "switch" : "button"}
                    style={{ flex: 1, height: KEY_ROW_HEIGHT }}
                  >
                    <View
                      style={{
                        flex: 1,
                        borderRadius: 8,
                        alignItems: "center",
                        justifyContent: "center",
                        // The lit modifier is the accent's tint, as pi's
                        // `.is-active` turns its label the accent.
                        get backgroundColor() {
                          return modifier && modifiers()[key as TerminalModifier] ? colors.raised : "transparent";
                        },
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: mono,
                          fontSize: 12,
                          fontWeight: "500",
                          get color() {
                            return modifier && modifiers()[key as TerminalModifier] ? colors.accent : colors.muted;
                          },
                        }}
                      >
                        {KEY_LABELS[key]}
                      </Text>
                    </View>
                  </Press>
                );
              }}
            </Each>
          </View>
        )}
      </Each>
    </View>
  );
}

/** Whether the platform gets the bar: every idiom that is not a desktop
 * (phones, pads, Mac Catalyst, the web's phone layout). */
export const showTerminalExtraKeys = platform.idiom !== "desktop";
