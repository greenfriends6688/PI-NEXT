// The app's font families: Simplified Chinese first, the platform's Latin
// face after it.
//
// `fontFamily` takes CSS's `font-family` list, most preferred first
// (`nsh` `TextStyle.fontFamily`: "a list of them as CSS writes it, most
// preferred first (`"Brand, 'Noto Sans SC', sans-serif"`): characters the
// first lacks come from the next that has them"). On macOS and iOS that is
// CoreText's cascade list (`kCTFontCascadeListAttribute`: the first family
// CoreText has is the font, the others it has its cascade list, `docs/dev/
// macos.md` "Text"); Windows resolves the list with DirectWrite, Android
// with its installed and registered families, Linux with Pango, the web with
// CSS.
//
// So every list here starts with a Chinese face and keeps the Latin one
// behind it. Without one, macOS draws Chinese in whatever the system font
// falls back to (Hiragino Sans, a Japanese face: 直, 骨 and 者 come out in
// their Japanese forms), which is what "the default font is not Chinese"
// was.
//
// A theme token cannot carry these: `theme.json`'s `font-*` values keep only
// the first family of the list they are given (`nsh-base/src/theme.rs`
// `font_family`), so the cascade would be lost. A style's `fontFamily`
// carries the list whole.
//
// `platform.os` is the environment's OS (`docs/dev/js-modules.md` "os":
// `"macos"`, `"windows"`, `"linux"`, `"ios"`, `"android"`, `"web"`).
import type { TextStyle } from "nsh";
import { platform } from "nsh";

/** The app's text: Chinese first, then the platform's own Latin face. */
export const sans: string = (() => {
  switch (platform.os) {
    // CoreText, the same engine on both: PingFang SC is the system's
    // Simplified-Chinese face, Hiragino Sans GB the older one, and
    // Helvetica Neue draws the Latin the Chinese face leaves.
    case "macos":
    case "ios":
      return "'PingFang SC', 'Hiragino Sans GB', 'Helvetica Neue', Helvetica, sans-serif";
    // Microsoft YaHei UI is Windows' Simplified-Chinese UI face; Segoe UI
    // the Latin one.
    case "windows":
      return "'Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI', 'Noto Sans SC', sans-serif";
    // Noto Sans CJK SC ships with the distributions' CJK packages; DejaVu
    // Sans is the Latin fallback every distribution has.
    case "linux":
      return "'Noto Sans CJK SC', 'Source Han Sans SC', 'Noto Sans SC', 'DejaVu Sans', sans-serif";
    // Android's own CJK face is Noto Sans CJK (named by language, so ask
    // for the SC one); Roboto is its Latin one.
    case "android":
      return "'Noto Sans CJK SC', 'Noto Sans SC', Roboto, sans-serif";
    // The browser picks by the reader's OS, so the list holds every
    // platform's face in the order each would use them.
    default:
      return "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', 'Segoe UI', Roboto, 'Helvetica Neue', 'DejaVu Sans', sans-serif";
  }
})();

/** Code, API names and identifiers: a Latin monospaced face first (its
 * figures line up), then the Chinese face its glyphs come from, then the
 * platform's monospace. */
export const mono: string = (() => {
  switch (platform.os) {
    case "macos":
    case "ios":
      return "'JetBrains Mono', 'SF Mono', Menlo, 'PingFang SC', 'Hiragino Sans GB', monospace";
    case "windows":
      return "'JetBrains Mono', 'Cascadia Mono', Consolas, 'Microsoft YaHei UI', monospace";
    case "linux":
      return "'JetBrains Mono', 'Noto Sans Mono CJK SC', 'DejaVu Sans Mono', monospace";
    case "android":
      return "'JetBrains Mono', 'Noto Sans Mono CJK SC', monospace";
    default:
      return "'JetBrains Mono', 'SF Mono', Menlo, 'Cascadia Mono', Consolas, 'Noto Sans Mono CJK SC', 'PingFang SC', 'Microsoft YaHei UI', monospace";
  }
})();

/**
 * A text style in the app's font at `size` points and `weight`, with `extra`
 * over it (`fontFamily: sans` unless `extra` names another). Text styles
 * inherit, so a view carrying one styles the texts inside it.
 */
export function textStyle(size: number, weight: TextStyle["fontWeight"] = "normal", extra: TextStyle = {}): TextStyle {
  return { fontFamily: sans, fontSize: size, fontWeight: weight, ...extra };
}

/** `textStyle` in the monospaced family, for code and identifiers. */
export function monoTextStyle(size: number, weight: TextStyle["fontWeight"] = "normal", extra: TextStyle = {}): TextStyle {
  return { fontFamily: mono, fontSize: size, fontWeight: weight, ...extra };
}

/** The app's font alone, for a view whose texts should all take it (text
 * styles inherit down the tree, as CSS's do). */
export const sansStyle: TextStyle = { fontFamily: sans };

/** The monospaced family alone, for a view of code. */
export const monoStyle: TextStyle = { fontFamily: mono };
