import { type JSX } from "react";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MermaidBlock } from "@/components/chat/mermaid-block";
import { MarkdownView } from "@/components/chat/markdown-view";
import { useHighlightedCode } from "@/lib/highlight";
import { useSessionStore } from "@/stores/session";
import { useSidePaneStore } from "@/stores/side-pane";
import type { ChatMessage } from "@shared/types";
import { inlineDocumentUrl } from "@shared/inline-document";
import { collectArtifacts, shouldInlineArtifact, type ArtifactBlock } from "@shared/artifacts";
import { cn } from "@/lib/utils";

/**
 * One `:::artifact` block, drawn where the model wrote it.
 *
 * What the reader gets here is decided by {@link shouldInlineArtifact}: a diagram, an icon or
 * a short Markdown block is drawn inline, because it is finished and small and opening a pane
 * for it would be a detour. A page, a component or code goes to the right pane, where it has
 * room — and, for anything that runs scripts, where the reader opened it on purpose. A card
 * is always there either way, so the thing has a name to click.
 *
 * The frame is the one `preview-panel.tsx` uses for a real `.html` file: the document rides in
 * the URL (`shared/inline-document.ts`), Main answers it with `INLINE_HTML_CSP`, and the
 * sandbox has no `allow-same-origin` — a page written by a model may run its own code and
 * reaches none of the app.
 */
export function ArtifactCard({ artifact }: { artifact: ArtifactBlock }): JSX.Element {
  const { t } = useTranslation("chat");
  const conversationId = useSessionStore((state) => state.activeId);
  const openArtifact = useSidePaneStore((state) => state.openArtifact);
  const inline = shouldInlineArtifact(artifact);

  return (
    <section className="my-2 overflow-hidden rounded-lg border border-border bg-muted/40" data-artifact={artifact.identifier}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{artifact.title}</span>
        <Badge variant="secondary" className="shrink-0 font-normal">{artifact.type}</Badge>
        <Button
          size="xs"
          variant="ghost"
          disabled={!conversationId}
          onClick={() => conversationId && openArtifact(conversationId, artifact.identifier, artifact.title)}
        >
          <HugeiconsIcon strokeWidth={2} icon={ArrowUpRight01Icon} />
          {t("artifact.open")}
        </Button>
      </header>
      {inline ? (
        <div className="max-h-96 overflow-auto">
          {artifact.type === "mermaid" ? (
            <MermaidBlock code={artifact.body} source={<ArtifactSource code={artifact.body} language={artifact.language} />} />
          ) : artifact.type === "markdown" ? (
            <div className="chat-markdown px-3 py-2 text-sm">
              <MarkdownView text={artifact.body} />
            </div>
          ) : artifact.type === "svg" || artifact.type === "html" ? (
            <iframe
              title={artifact.title}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              className={cn("w-full border-0 bg-white", artifact.type === "svg" ? "h-48" : "h-64")}
              src={inlineDocumentUrl(artifact.body)}
            />
          ) : (
            <ArtifactSource code={artifact.body} language={artifact.language} />
          )}
        </div>
      ) : (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("artifact.inPanel", { type: artifact.type })}</p>
      )}
    </section>
  );
}

/** One artifact's body as source, highlighted when a grammar is known. */
export function ArtifactSource({ code, language }: { code: string; language?: string }): JSX.Element {
  const highlighted = useHighlightedCode(code, language);
  return (
    <div className="code-shiki overflow-x-auto text-sm leading-5">
      {highlighted ? <div dangerouslySetInnerHTML={{ __html: highlighted }} /> : <pre className="px-3 py-2 font-mono">{code}</pre>}
    </div>
  );
}

/**
 * How many versions of one artifact this chat holds, counted from the transcript itself.
 *
 * A version is an occurrence: the model revises by rewriting the whole block, so the history
 * *is* the transcript's order and nothing has to be stored, keyed or cleaned up. Counting
 * happens on the assistant texts — the same strings the cards were rendered from — so the two
 * can never disagree about how many there are.
 */
export function countArtifactVersions(messages: readonly ChatMessage[], identifier: string | undefined): number {
  if (!identifier) return 0;
  const texts = messages.filter((message) => message.role === "assistant").map((message) => message.text);
  return collectArtifacts(texts).get(identifier)?.length ?? 0;
}

/** The artifact at one version (1-based), or the newest when `version` is absent. */
export function artifactAt(messages: readonly ChatMessage[], identifier: string | undefined, version?: number): { artifact: ArtifactBlock; version: number; total: number } | null {
  if (!identifier) return null;
  const texts = messages.filter((message) => message.role === "assistant").map((message) => message.text);
  const versions = collectArtifacts(texts).get(identifier);
  if (!versions || versions.length === 0) return null;
  const index = Math.min(Math.max(1, version ?? versions.length), versions.length);
  return { artifact: versions[index - 1]!, version: index, total: versions.length };
}
