import { createContext, forwardRef, memo, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { remarkStrictInlineMath } from "@/lib/remark-strict-inline-math";
import { rehypeHeadingIds } from "@/lib/rehype-heading-ids";
import { isPathLike, remarkPathLinks } from "@/lib/remark-path-links";
import { useValidatedMarkdownPaths } from "@/lib/markdown-path-validation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, SourceCodeIcon, Tick02Icon, ViewIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { MermaidBlock } from "@/components/chat/mermaid-block";
import { PathLink } from "@/components/path-menu";
import { useHighlightedCode } from "@/lib/highlight";
import { fenceDocument } from "@/lib/markdown-fence";
import { ARTIFACT_FENCE, encodeArtifactsForMarkdown, type ArtifactBlock } from "@shared/artifacts";
import { ArtifactCard } from "@/components/chat/artifact-card";
import { inlineDocumentUrl } from "@shared/inline-document";
import { splitMarkdownBlocks } from "@/lib/markdown-blocks";
import { useSessionStore } from "@/stores/session";
import { resolvePath } from "@/lib/workspace-path";
import { stripMemoryCitation } from "@shared/memory-citation";
import { markdownMedia } from "@/lib/markdown-media";
import { cn } from "@/lib/utils";
import { DiffView } from "./diff-view";
import { InlineMediaItem } from "./inline-preview";

/**
 * Markdown, with math.
 *
 * `remark-math` + `rehype-katex` are wired in with the options the app needs, and
 * both are **module-level constants**: `react-markdown` builds its processor from
 * these props, and inline arrays would be a new identity on every render of every
 * streamed token — the one thing `memo` on this component exists to prevent.
 *
 * `remarkStrictInlineMath` follows `remark-math` because it inspects what that
 * plugin tokenized: `$HOME`, `$PATH` and `$5 到 $10` are prose here, not formulas.
 */
const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath, remarkStrictInlineMath, remarkPathLinks];
const REHYPE_PLUGINS: PluggableList = [
  [
    rehypeKatex,
    {
      // A half-streamed formula is the normal case, not an error: KaTeX must never
      // throw into React, just draw the offending fragment in the error colour.
      throwOnError: false,
      // …and it must not warn about the constructs it merely tolerates (\tag,
      // unicode text). A broken formula is shown, not logged.
      strict: false,
      errorColor: "var(--destructive)",
    },
  ],
];

/**
 * The same pipeline plus heading ids, for the file pane's document view.
 *
 * A module-level constant like `REHYPE_PLUGINS`: a new array identity per render is
 * what makes `react-markdown` rebuild its processor for every streamed token.
 */
const REHYPE_PLUGINS_WITH_HEADING_IDS: PluggableList = [...REHYPE_PLUGINS, rehypeHeadingIds];

/** Fence languages whose body is a diff, drawn by `DiffView` rather than Shiki. */
const DIFF_LANGUAGES = new Set(["diff", "patch"]);
const MAX_CODE_PREVIEW_CHARS = 24_000;
const MarkdownPathContext = createContext<ReadonlySet<string>>(new Set());

const CodeBlock = memo(function CodeBlock({ language, code }: { language?: string; code: string }): JSX.Element {
  const { t } = useTranslation("chat");
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // The head alone is not an identity: two streamed/replaced blocks can share it while
  // differing in the tail, which would leak the expanded state from one block to another.
  const identity = `${language ?? ""}:${code.length}:${code.slice(0, 128)}:${code.slice(-128)}`;
  const previousIdentity = useRef(identity);
  // A mermaid fence is drawn rather than read, so it opens as the diagram with the source a
  // click away — the opposite default to a page fence, which must never start itself.
  const diagram = language !== undefined && language.toLowerCase() === "mermaid";
  const [view, setView] = useState<"code" | "view">(diagram ? "view" : "code");
  useEffect(() => {
    if (previousIdentity.current === identity) return;
    previousIdentity.current = identity;
    setExpanded(false);
    setView(diagram ? "view" : "code");
  }, [identity, diagram]);
  const diff = language !== undefined && DIFF_LANGUAGES.has(language.toLowerCase());
  // A `pinext-artifact` fence is not code at all: it is an artifact the reply named, encoded
  // by `encodeArtifactsForMarkdown` so the markdown pipeline hands it over as one block. The
  // header line carries the metadata and everything after it is the body.
  const artifact = language === ARTIFACT_FENCE ? artifactFromFence(code) : null;
  const truncated = code.length > MAX_CODE_PREVIEW_CHARS;
  const displayCode = truncated && !expanded
    ? `${code.slice(0, MAX_CODE_PREVIEW_CHARS)}\n…`
    : code;
  // Keep copying lossless, but do not parse or syntax-highlight a pathological
  // block until the reader explicitly asks to see it all. This bounds both the
  // initial DOM and the work done by a streaming code fence.
  const html = useHighlightedCode(diff || artifact ? "" : displayCode, diff || artifact ? undefined : language);
  // A fence that is a whole page can be looked at instead of read. The button is the only
  // thing that starts it: a transcript reopening must never run a script somebody wrote into
  // a reply, and the same rule the file pane follows applies here.
  const page = fenceDocument(language, code);
  // The highlighted body, built once: a diagram's fallback and the 源码 view are the same
  // node, and only one of them is ever mounted.
  const codeBody = (
    <div className="code-shiki overflow-x-auto text-sm leading-5">
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="font-mono">{displayCode}</pre>
      )}
    </div>
  );

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  // **After every hook.** An artifact replaces the whole block, so this return has to sit
  // below the ones above it — a return between them is a hook count that changes with the
  // content, which React answers with error #310.
  if (artifact) return <ArtifactCard artifact={artifact} />;

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-muted/40">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-xs font-medium text-muted-foreground">{language || "code"}</span>
        <div className="flex items-center gap-1">
          {diagram || page ? (
            <Button size="xs" variant="ghost" onClick={() => setView((value) => (value === "view" ? "code" : "view"))}>
              <HugeiconsIcon strokeWidth={2} icon={view === "view" ? SourceCodeIcon : ViewIcon} />
              {t(view === "view" ? "message.fenceSource" : "message.fencePreview")}
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" onClick={() => void copy()}>
            {copied ? <HugeiconsIcon strokeWidth={2} icon={Tick02Icon} /> : <HugeiconsIcon strokeWidth={2} icon={Copy01Icon} />}
            {copied ? t("message.copied") : t("message.copy")}
          </Button>
        </div>
      </div>
      {diagram && view === "view" ? (
        <MermaidBlock code={code} source={codeBody} />
      ) : view === "view" && page ? (
        <iframe
          title={language ?? "preview"}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className="h-72 w-full border-0 bg-white"
          src={inlineDocumentUrl(page.document)}
        />
      ) : diff ? (
        <DiffView text={displayCode} className="mt-0 rounded-none border-0 bg-transparent" />
      ) : (
        codeBody
      )}
      {truncated ? (
        <div className="border-t border-border px-2 py-1">
          <Button size="xs" variant="ghost" onClick={() => setExpanded((value) => !value)}>
            {t(expanded ? "message.collapseCode" : "message.expandCode", { count: code.length - MAX_CODE_PREVIEW_CHARS })}
          </Button>
        </div>
      ) : null}
    </div>
  );
});

/** The artifact a `pinext-artifact` fence carries: a JSON header line, then the body. */
function artifactFromFence(code: string): ArtifactBlock | null {
  const newline = code.indexOf("\n");
  const header = (newline === -1 ? code : code.slice(0, newline)).trim();
  const body = newline === -1 ? "" : code.slice(newline + 1);
  try {
    const parsed = JSON.parse(header) as Partial<ArtifactBlock>;
    if (typeof parsed.identifier !== "string" || typeof parsed.type !== "string") return null;
    return {
      identifier: parsed.identifier,
      title: typeof parsed.title === "string" && parsed.title ? parsed.title : parsed.identifier,
      type: parsed.type,
      ...(typeof parsed.language === "string" ? { language: parsed.language } : {}),
      body,
    } as ArtifactBlock;
  } catch {
    return null;
  }
}

function markdownPath(href: string): string | undefined {
  if (href.startsWith("fvpath:")) return decodeURIComponent(href.slice("fvpath:".length));
  if (href.startsWith("file:")) return decodeURI(href.replace("file://", ""));
  if (href.startsWith("/")) return href;
  return undefined;
}

/**
 * `react-markdown` drops any protocol it does not know — `file:`, `data:` — and every image
 * a reply writes by path would arrive with an empty `src`. These are the sources the media
 * mapping below turns into a loadable preview, and a path link the path-link plugin made.
 */
function urlTransform(url: string): string {
  if (url.startsWith("file://") || url.startsWith("fvpath:")) return url;
  if (/^data:(image|video)\//i.test(url)) return url;
  return defaultUrlTransform(url);
}

/** A markdown image: a picture, or — when the path says so — a video or an HTML page. */
function MarkdownImage({ src, alt }: { src?: string; alt?: string }): JSX.Element | null {
  const cwd = useSessionStore((state) => state.conversations.find((item) => item.id === state.activeId)?.cwd);
  const preview = markdownMedia(src, alt, (path) => resolvePath(path, cwd));
  if (preview) return <InlineMediaItem preview={preview} />;
  if (!src) return null;
  return <img src={src} alt={alt ?? ""} className="my-2 max-h-80 max-w-full rounded-lg border border-border" />;
}

// Stable component identities keep streamed updates from remounting CodeBlock.
const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => {
    const validPaths = useContext(MarkdownPathContext);
    const path = href ? markdownPath(href) : undefined;
    // `remarkPathLinks` deliberately marks candidates before the async stat result
    // arrives. Keep an invalid candidate as ordinary text; leaving the generated
    // `fvpath:` anchor in the DOM would still make a branch or endpoint look linked.
    if (path) return validPaths.has(path) ? <PathLink path={path}>{children}</PathLink> : <>{children}</>;
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => <MarkdownImage src={typeof src === "string" ? src : undefined} alt={alt} />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-96 border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border bg-muted/60 px-2 py-1.5 font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-border px-2 py-1.5 align-top">{children}</td>,
  pre: ({ node, children }) => {
    // Block code always has a pre parent, even for empty or unlabelled single-line fences.
    const codeNode = node?.children.find((child) => child.type === "element" && child.tagName === "code");
    if (!codeNode || codeNode.type !== "element") return <pre>{children}</pre>;
    const classes = codeNode.properties.className;
    const className = Array.isArray(classes) ? classes.join(" ") : String(classes ?? "");
    const language = /language-([^\s]+)/.exec(className)?.[1];
    return <CodeBlock language={language} code={nodeText(children).replace(/\n$/, "")} />;
  },
  code: ({ children }) => {
    const validPaths = useContext(MarkdownPathContext);
    const text = nodeText(children);
    // File paths are commonly written as inline code in agent replies. Keep the
    // code styling, but make the whole span behave like a previewable path.
    if (isPathLike(text) && validPaths.has(text)) {
      return (
        <code>
          <PathLink path={text}>{children}</PathLink>
        </code>
      );
    }
    return <code>{children}</code>;
  },
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
};

/**
 * One block of markdown, memoised on its exact text.
 *
 * `react-markdown` re-parses everything it is handed, so what makes a long answer
 * affordable is that a settled block's text never changes again: this component then
 * skips the render entirely, and only the block being streamed into is re-parsed.
 */
const MarkdownBlock = memo(function MarkdownBlock({ text, headingIds }: { text: string; headingIds?: boolean }): JSX.Element {
  // The block in flight still re-parses on each flush; keep the urgent UI (caret,
  // scroll) ahead of it and let React apply the markdown at lower priority.
  const deferred = useDeferredValue(text);
  const cwd = useSessionStore((state) => state.conversations.find((item) => item.id === state.activeId)?.cwd);
  const validPaths = useValidatedMarkdownPaths(deferred, cwd);
  return (
    <MarkdownPathContext.Provider value={validPaths}>
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={headingIds ? REHYPE_PLUGINS_WITH_HEADING_IDS : REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
        urlTransform={urlTransform}
      >
        {deferred}
      </Markdown>
    </MarkdownPathContext.Provider>
  );
});

/**
 * Memoised on `text`: without this, every streamed token re-parsed the markdown
 * of every message already on screen.
 *
 * The text is cut into independently parsed blocks (`splitMarkdownBlocks`), which is
 * what bounds the cost of a *single* long answer — one pass over 50 KB of prose costs
 * ~100 ms, and it used to be paid again at every flush. The blocks stay siblings
 * inside one column so a collapsed prompt can clip them together; a position still
 * keeps its content because blocks only grow at the end.
 */
export const MarkdownView = memo(forwardRef<HTMLDivElement, { text: string; className?: string; headingIds?: boolean }>(function MarkdownView({ text, className, headingIds }, ref): JSX.Element {
  // A reply that used memory ends with a citation block the pipeline reads; the reader does
  // not. Artifacts are rewritten into one routable fence each (`\`\`\`pinext-artifact` + a JSON
  // header), which is what turns a directive into a card without teaching the markdown
  // pipeline about directives — and it goes through `splitMarkdownBlocks` as one block, so a
  // diagram or a page is never cut in half by the block splitter.
  const blocks = useMemo(
    () => splitMarkdownBlocks(encodeArtifactsForMarkdown(stripMemoryCitation(text))),
    [text],
  );
  return (
    <div ref={ref} className={cn("chat-markdown-flow", className)}>
      {blocks.map((block, index) => (
        // Blocks only ever grow at the end, so a position keeps its content.
        <MarkdownBlock key={index} text={block} headingIds={headingIds} />
      ))}
    </div>
  );
}));

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return nodeText(props?.children);
  }
  return "";
}
