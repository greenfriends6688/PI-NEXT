import { useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { diagramThemeVariables, renderDiagram } from "@/lib/mermaid";
import { useSettingsStore } from "@/stores/settings";

/**
 * One ```mermaid fence, drawn.
 *
 * Rendering waits for the text to stop moving. A reply streams a diagram one token at a
 * time and every render is a full parse and layout, so drawing on each change would spend
 * the whole stream re-laying-out a half-written diagram — the same reason the transcript
 * only folds a run once it has settled. Until then the source is what the caller shows; the
 * reader watches the diagram appear rather than flicker.
 *
 * A failure is drawn, not thrown: a diagram nobody finished, or one with a syntax error, is
 * ordinary here. The message is the parser's own — it names the offending line — with the
 * source left on screen so it can be fixed or copied.
 */
const RENDER_DELAY_MS = 600;

type RenderState =
  | { status: "waiting" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

/**
 * The theme a diagram is drawn for. Changing any of the three re-renders every diagram on
 * screen, which is what keeps a diagram from being the one thing that keeps the old palette.
 */
function useThemeKey(): string {
  const { lightTheme, darkTheme, themeMode } = useSettingsStore((state) => state.settings);
  return `${themeMode}:${lightTheme}:${darkTheme}`;
}

export function MermaidBlock({ code, source }: { code: string; source: ReactNode }): JSX.Element {
  const { t } = useTranslation("chat");
  const themeKey = useThemeKey();
  const [state, setState] = useState<RenderState>({ status: "waiting" });
  const [attempt, setAttempt] = useState(0);
  // Only for the "waiting" gate: a long diagram sits here until it stops growing, and every
  // intermediate value of `code` must not start a render of its own.
  const variables = useMemo(() => diagramThemeVariables(), [themeKey, attempt]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void renderDiagram(code, variables)
        .then((svg) => {
          if (!cancelled) setState({ status: "ready", svg });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
        });
    }, RENDER_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code, variables]);

  if (state.status === "ready") {
    // The SVG is produced by mermaid with `securityLevel: "strict"`, which sanitizes it and
    // forbids HTML in labels. It is the library's output, never the reply's own markup.
    return (
      <div
        className="mermaid-diagram overflow-x-auto px-3 py-3"
        // eslint-disable-next-line react/no-danger -- mermaid's own sanitized SVG
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }
  // Not drawn yet: the reader sees the source, which is also what a diagram that never
  // finishes (a stream that was stopped mid-fence) leaves on screen.
  return (
    <div>
      {state.status === "error" ? (
        <div className="flex items-center gap-2 border-t border-border px-2 py-1 text-xs">
          <span className="min-w-0 flex-1 whitespace-pre-wrap text-destructive">
            {t("message.mermaidFailed", { message: state.message })}
          </span>
          <Button size="xs" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            {t("message.mermaidRetry")}
          </Button>
        </div>
      ) : null}
      {source}
    </div>
  );
}
