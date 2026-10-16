/**
 * Mermaid, loaded on demand and rendered in the app's own colours.
 *
 * A diagram in a reply is one of the few things a reader cannot judge from the source, so
 * ```mermaid fences are drawn — but the library is ~1 MB of parser and layout engines and
 * most conversations never contain one, so it is a dynamic import behind the first fence
 * that needs it. Nothing else in the renderer knows mermaid exists.
 *
 * Two decisions worth keeping:
 *
 * - **`securityLevel: "strict"`.** The diagram is written by a model, so the generated SVG
 *   is sanitized and labels are not interpreted as HTML. A diagram must not be a way to put
 *   markup into the document.
 * - **`suppressErrorRendering`.** A half-streamed or malformed diagram throws, and mermaid's
 *   default reaction is to inject its own error graphic into the page, next to a rendering
 *   attempt that has already been abandoned. The caller draws the failure instead, with the
 *   source still on screen.
 *
 * Colours come from the app's own custom properties at render time, so a diagram belongs to
 * whichever of the twenty-four themes is active rather than being a white rectangle in a
 * dark chat. The caller passes the theme key so a theme change re-renders.
 */

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
};

let module: Promise<MermaidApi> | null = null;
let sequence = 0;

async function mermaid(): Promise<MermaidApi> {
  module ??= import("mermaid").then((loaded) => loaded.default as unknown as MermaidApi);
  return module;
}

/**
 * The app's palette in mermaid's vocabulary.
 *
 * Read from the document rather than from a theme table: `applyTheme` writes every token as
 * an inline custom property on `<html>`, so this is the same colour the CSS would paint and
 * a new theme needs no entry here.
 */
export function diagramThemeVariables(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  const background = read("--background", "#ffffff");
  const foreground = read("--foreground", "#111111");
  const card = read("--card", background);
  const muted = read("--muted", card);
  const border = read("--border", foreground);
  const mutedForeground = read("--muted-foreground", foreground);
  const primary = read("--primary", foreground);
  const primaryForeground = read("--primary-foreground", background);
  return {
    background,
    // Nodes read as cards: filled like the surface around them, outlined with the hairline
    // every other panel uses.
    primaryColor: muted,
    primaryTextColor: foreground,
    primaryBorderColor: border,
    secondaryColor: card,
    secondaryTextColor: foreground,
    secondaryBorderColor: border,
    tertiaryColor: background,
    tertiaryTextColor: mutedForeground,
    tertiaryBorderColor: border,
    mainBkg: muted,
    nodeBorder: border,
    nodeTextColor: foreground,
    lineColor: mutedForeground,
    textColor: foreground,
    titleColor: foreground,
    edgeLabelBackground: background,
    labelBackground: background,
    clusterBkg: card,
    clusterBorder: border,
    // The accent, where a diagram has a place for one.
    activationBkgColor: muted,
    activationBorderColor: primary,
    errorBkgColor: read("--destructive", "#b91c1c"),
    errorTextColor: primaryForeground,
    fontFamily: read("--font-sans", "sans-serif"),
    fontSize: "14px",
  };
}

/** Render one diagram to SVG. Rejects with the parser's own message on invalid input. */
export async function renderDiagram(code: string, themeVariables: Record<string, string>): Promise<string> {
  const api = await mermaid();
  api.initialize({
    startOnLoad: false,
    // A reply is untrusted input; the generated SVG is sanitized and labels stay text.
    securityLevel: "strict",
    theme: "base",
    themeVariables,
    fontFamily: themeVariables.fontFamily,
    // A sequence diagram's own numbering is noise beside a chat's scroll position.
    flowcharts: { useMaxWidth: true },
    suppressErrorRendering: true,
  });
  sequence += 1;
  const { svg } = await api.render(`pinext-mermaid-${sequence}`, code);
  return svg;
}
