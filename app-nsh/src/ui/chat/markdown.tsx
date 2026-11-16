// Copied from the NSH gallery's chat demo (`examples/gallery/demos/chat/markdown.tsx`,
// 56 lines): the reply's Markdown, drawn by `TextView` at a chat's scale, with
// the streaming caret. Only the imports changed (the gallery's `../../ui` is
// our `../kit`), and the gallery's `ImageViewer` demo is not here, so a press
// on an image reports nothing (`onImagePress` is left out).
import type { JSX } from "nsh";
import { TextView } from "nsh/base";
import { colors } from "../kit";
import { mono, sans } from "../fonts";
import { t } from "../i18n";

/**
 * A reply's Markdown, shown by `TextView` at a chat's scale (its default
 * typography otherwise, in the theme's colors).
 *
 * While a reply streams (`streaming`), syntax its end leaves open shows as
 * if closed and only the block being written renders again; `caret` is
 * drawn at the end of the last block, inline with its text.
 *
 * Every block (and each list item and table cell) is one selectable text:
 * a long press highlights it and offers Copy. Code blocks carry
 * `TextView`'s built-in copy action.
 */
export function Markdown(props: {
  md: string;
  id: string;
  streaming?: boolean;
  caret?: JSX.Element;
}) {
  return (
    <TextView
      markdown={props.md}
      options={{ streaming: !!props.streaming }}
      selectable
      codeBlockScrollbar={false}
      streamingCaret={props.caret}
      styles={{
        // A chat's scale: tighter than a document's. The font is the app's
        // (Chinese first, then the platform's Latin face); code and keys take
        // the monospaced list, whose Chinese glyphs come from the same face.
        // The theme's `font-mono` token holds one family only, so the cascade
        // list has to come from a style.
        root: { gap: 12, fontSize: 15, lineHeight: 22, color: colors.text, fontFamily: sans },
        heading1: { fontSize: 20, lineHeight: 26 },
        heading2: { fontSize: 17, lineHeight: 22 },
        heading3: { fontSize: 15, lineHeight: 22 },
        code: { color: colors.code, fontFamily: mono },
        codeBlockCode: { color: colors.code, fontFamily: mono },
        link: { color: colors.accent },
      }}
      codeBlockActions={[{ id: "copy", label: t("chat.copyCode") }]}
    />
  );
}
