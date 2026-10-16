import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon, Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/icon-button";
import { MermaidBlock } from "@/components/chat/mermaid-block";
import { MarkdownView } from "@/components/chat/markdown-view";
import { ArtifactSource, artifactAt } from "@/components/chat/artifact-card";
import { useSessionStore } from "@/stores/session";
import { useSidePaneStore } from "@/stores/side-pane";
import { inlineDocumentUrl } from "@shared/inline-document";
import { cn } from "@/lib/utils";

/**
 * One artifact, in the right pane, with its versions.
 *
 * The document is the same one the card draws — a page served through `shared/inline-document.ts`
 * and framed without `allow-same-origin` — only with room, which is the whole reason the pane
 * exists. `react` is drawn as code here: running a component needs the preview runtime, and a
 * page that executes code should be something the reader asked to run rather than something a
 * panel started when it was opened.
 *
 * The versions come from the transcript (`artifactAt`), so a reply the model revised is a list
 * to step through, and there is nothing to store: the transcript *is* the history.
 */
export function SidePaneArtifact({ tabId }: { tabId: string }): JSX.Element {
  const { t } = useTranslation("sidepane");
  const tab = useSidePaneStore((state) => state.tabs.find((item) => item.id === tabId));
  const patchTab = useSidePaneStore((state) => state.patchTab);
  const messages = useSessionStore((state) => (state.activeId === tab?.conversationId ? state.messages : []));
  const [copied, setCopied] = useState(false);
  const resolved = artifactAt(messages, tab?.artifactId, tab?.artifactVersion);
  const total = resolved?.total ?? 0;
  const version = resolved?.version ?? 0;

  // A version the chat no longer has (a reload that truncated it, a retry that rewrote the
  // reply) falls back to the newest: an empty pane would read as a broken artifact.
  useEffect(() => {
    if (!tab || total === 0 || tab.artifactVersion === undefined) return;
    if (tab.artifactVersion > total) patchTab(tabId, { artifactVersion: total });
  }, [patchTab, tab, tabId, total]);

  if (!tab || !resolved) {
    return <p className="px-3 py-3 text-sm text-muted-foreground">{t("artifact.missing")}</p>;
  }
  const { artifact } = resolved;

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(artifact.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={artifact.title}>{artifact.title}</span>
        <Badge variant="secondary" className="shrink-0 font-normal">{artifact.type}</Badge>
        {total > 1 ? (
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              label={t("artifact.previous")}
              size="icon-xs"
              variant="ghost"
              disabled={version <= 1}
              onClick={() => patchTab(tabId, { artifactVersion: Math.max(1, version - 1) })}
            >
              <HugeiconsIcon strokeWidth={2} icon={ArrowLeft01Icon} />
            </IconButton>
            <span className="text-xs text-muted-foreground tabular-nums">{t("artifact.version", { version, total })}</span>
            <IconButton
              label={t("artifact.next")}
              size="icon-xs"
              variant="ghost"
              disabled={version >= total}
              onClick={() => patchTab(tabId, { artifactVersion: Math.min(total, version + 1) })}
            >
              <HugeiconsIcon strokeWidth={2} icon={ArrowRight01Icon} />
            </IconButton>
          </div>
        ) : null}
        <Button size="xs" variant="ghost" onClick={() => void copy()}>
          <HugeiconsIcon strokeWidth={2} icon={copied ? Tick02Icon : Copy01Icon} />
          {copied ? t("artifact.copied") : t("artifact.copy")}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {artifact.type === "mermaid" ? (
          <MermaidBlock code={artifact.body} source={<ArtifactSource code={artifact.body} language={artifact.language} />} />
        ) : artifact.type === "markdown" ? (
          <div className="chat-markdown px-3 py-3 text-sm">
            <MarkdownView text={artifact.body} />
          </div>
        ) : artifact.type === "html" || artifact.type === "svg" ? (
          <iframe
            title={artifact.title}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            className={cn("w-full border-0 bg-white", artifact.type === "svg" ? "h-full min-h-64" : "h-full min-h-80")}
            src={inlineDocumentUrl(artifact.body)}
          />
        ) : (
          <ArtifactSource code={artifact.body} language={artifact.language} />
        )}
      </div>
    </div>
  );
}
