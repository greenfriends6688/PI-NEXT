// Pi's semantic colors for canvas drawing (`Canvas`'s `strokeStyle`).
//
// `token()` reads the app's theme (`theme.json`, shadcn/ui's registry
// `cssVars`) in the appearance shown, and a read in a `draw` follows a theme
// or appearance change. The pi tokens are mapped in `theme.json`:
//
//   --bg            -> background            --accent          -> primary
//   --bg-panel      -> card                  --accent-contrast -> primary-foreground
//   --bg-hover      -> accent                --user-bg         -> user-bubble
//   --bg-selected   -> secondary             --assistant-bg    -> assistant-bubble
//   --border        -> border                --tool-bg         -> tool-card
//   --text          -> foreground            --bg-subtle       -> muted
//   --text-muted    -> muted-foreground
//
// The names below are roles (`icon`, `page`, `surface`), the tokens beside
// them what `theme.json` defines.
//
// TODO(nsh): verify that the custom token names below reach `.nsh/types/nsh/tokens.d.ts`
// (`nsh` generates it from `theme.json`; not run here).
import { token } from "nsh";

export const colors = {
  /** Text and icons on the page. */
  get text(): string {
    return token("foreground");
  },
  /** Secondary text: captions, timestamps, hints. */
  get muted(): string {
    return token("muted-foreground");
  },
  /** The page behind the cards. */
  get page(): string {
    return token("background");
  },
  /** A panel: the session list, a card. */
  get surface(): string {
    return token("card");
  },
  /** A row's hover / press fill. */
  get hover(): string {
    return token("accent");
  },
  /** A chosen row's fill. */
  get selected(): string {
    return token("secondary");
  },
  /** Hairlines and dividers. */
  get line(): string {
    return token("border");
  },
  /** The accent as a fill or a stroke (the main action, focus, links). */
  get accent(): string {
    return token("primary");
  },
  /** Text and icons on `accent`. */
  get onAccent(): string {
    return token("primary-foreground");
  },
  /** Errors. */
  get danger(): string {
    return token("destructive");
  },
  /** A user message's bubble. */
  get userBubble(): string {
    return token("user-bubble");
  },
  /** An assistant message's bubble. */
  get assistantBubble(): string {
    return token("assistant-bubble");
  },
  /** A tool call's card. */
  get toolCard(): string {
    return token("tool-card");
  },
};
