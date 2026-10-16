/**
 * Artifacts — a reply saying 「这一段是一份东西」 rather than 「这一段是文本」.
 *
 * A model writing a chart, a page or a diagram today writes a fenced block, and the reader
 * gets source code they have to save before they can look at it. The directive is the
 * difference: a block a model *names* (an identifier, a type, a title) is something the app
 * can draw, keep a history of, and hand back when the model revises it.
 *
 *   :::artifact{identifier="revenue" type="html" title="Revenue chart"}
 *   ```html
 *   <canvas id="c"></canvas>
 *   ```
 *   :::
 *
 * The syntax is LibreChat's, parsed by a line scanner rather than `remark-directive`: the
 * remark plugin turns any `:name` in ordinary prose into a directive, and a reply about
 * colon-separated config would arrive full of them. A line scanner only looks at lines whose
 * first non-space characters are the directive itself.
 *
 * **Streaming is the normal case.** A directive that has no closing `:::` yet is not an
 * artifact; it is the source of one that is still being written, which is what the reader
 * should see — a half-finished page is worse than the code that will become it. The same goes
 * for a fence that never closes.
 */

export const ARTIFACT_FENCE = "pinext-artifact";
const DIRECTIVE = /^\s*:::artifact\s*\{([^}]*)\}\s*$/;
const CLOSE = /^\s*:::\s*$/;
const KINDS = ["html", "react", "svg", "mermaid", "markdown", "code"] as const;
export type ArtifactType = (typeof KINDS)[number];

export type ArtifactBlock = {
  identifier: string;
  title: string;
  type: ArtifactType;
  /** The inner fence's language, kept for the code view. */
  language?: string;
  body: string;
};

/**
 * The type a directive names, or the one its fence implies.
 *
 * `application/vnd.ant.react` and friends are the spellings that come out of real models; a
 * type nobody recognises is `code` rather than a refusal, because the alternative is dropping
 * the block on the floor.
 */
function artifactType(declared: string | undefined, language: string | undefined): ArtifactType {
  const name = (declared ?? "").trim().toLowerCase();
  const fence = (language ?? "").trim().toLowerCase();
  if (name === "application/vnd.ant.react" || name === "text/jsx" || name === "application/javascript") return "react";
  if (name === "text/html" || name === "application/xhtml+xml") return "html";
  if (name === "image/svg+xml") return "svg";
  if (name === "text/markdown" || name === "text/x-markdown") return "markdown";
  const candidate = (KINDS as readonly string[]).includes(name) ? (name as ArtifactType) : undefined;
  if (candidate) return candidate;
  if (fence === "jsx" || fence === "tsx" || fence === "react") return "react";
  if ((KINDS as readonly string[]).includes(fence)) return fence as ArtifactType;
  return "code";
}

/** `identifier="x"` / `title="y"` inside a directive. Quotes required, single or double. */
function attributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of text.matchAll(/([A-Za-z][\w-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    out[match[1]!.toLowerCase()] = match[3] ?? match[4] ?? "";
  }
  return out;
}

/** A fence line: ``` or ~~~, three or more, with an optional language. */
function fenceOpen(line: string): { marker: string; language?: string } | null {
  const match = /^\s*(`{3,}|~{3,})\s*([\w+-.]*)\s*$/.exec(line);
  if (!match) return null;
  return { marker: match[1]!, ...(match[2] ? { language: match[2] } : {}) };
}

const closes = (line: string, marker: string): boolean =>
  new RegExp(`^\\s*${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`).test(line);

export type ParsedArtifact = { artifact: ArtifactBlock; /** Line index of the directive. */ line: number; /** Line index just past the closing `:::`. */ endLine: number };

/**
 * Every complete artifact in a text, in order.
 *
 * An artifact whose directive is never closed, or whose inner fence is never closed, is not
 * returned at all — the caller keeps the text as it is, which draws it as source.
 */
export function parseArtifacts(text: string): ParsedArtifact[] {
  const lines = text.split("\n");
  const found: ParsedArtifact[] = [];
  for (let index = 0; index < lines.length; index++) {
    const directive = DIRECTIVE.exec(lines[index]!);
    if (!directive) continue;
    const attributesFound = attributes(directive[1] ?? "");
    // The inner fence, after any blank line the model left between them.
    let opened = index + 1;
    while (opened < lines.length && lines[opened]!.trim() === "") opened++;
    const fence = opened < lines.length ? fenceOpen(lines[opened]!) : null;
    if (!fence) continue;

    let bodyEnd = -1;
    let closeLine = -1;
    for (let scan = opened + 1; scan < lines.length; scan++) {
      if (!closes(lines[scan]!, fence.marker)) continue;
      let after = scan + 1;
      while (after < lines.length && lines[after]!.trim() === "") after++;
      if (after < lines.length && CLOSE.test(lines[after]!)) {
        bodyEnd = scan;
        closeLine = after;
        break;
      }
      // A fence that is not followed by `:::` is the fallback: it is where the artifact ends
      // when the model forgot the closing directive — but only if the scan finds no better
      // candidate, because a Markdown artifact nests fences of its own at the same length.
      if (bodyEnd === -1) bodyEnd = scan;
    }
    if (bodyEnd === -1) continue;
    if (closeLine === -1) {
      // No `:::` anywhere: the fence itself ends the artifact, and a `:::` that follows it
      // (written but not seen where the scan started) is consumed with it. What is *not*
      // accepted is a fence that never closed — that one is still streaming, and drawing a
      // half-written page is worse than showing the source that will become it.
      closeLine = bodyEnd;
      let after = bodyEnd + 1;
      while (after < lines.length && lines[after]!.trim() === "") after++;
      if (after < lines.length && CLOSE.test(lines[after]!)) closeLine = after;
    }

    const identifier = attributesFound.identifier?.trim();
    found.push({
      line: index,
      endLine: closeLine + 1,
      artifact: {
        identifier: identifier && identifier.length > 0 ? identifier : `block-${found.length + 1}`,
        title: attributesFound.title?.trim() || identifier || "Artifact",
        type: artifactType(attributesFound.type, fence.language),
        ...(fence.language ? { language: fence.language } : {}),
        body: lines.slice(opened + 1, bodyEnd).join("\n"),
      },
    });
    index = closeLine;
  }
  return found;
}

/**
 * The same markdown with every artifact rewritten into a fence the renderer can route.
 *
 * `pinext-artifact` carries a JSON header on its first line, so `react-markdown` hands the
 * whole thing to the code renderer as one block — the transcript then knows it is an artifact
 * without a second parse pass and without teaching the markdown pipeline about directives.
 * Text with no artifact is returned unchanged (same string identity, so the memoised render
 * still skips it).
 */
export function encodeArtifactsForMarkdown(text: string): string {
  const parsed = parseArtifacts(text);
  if (parsed.length === 0) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  let index = 0;
  let next = 0;
  while (index < lines.length) {
    const item = parsed[next];
    if (!item || item.line !== index) {
      out.push(lines[index]!);
      index++;
      continue;
    }
    const header = JSON.stringify({
      identifier: item.artifact.identifier,
      title: item.artifact.title,
      type: item.artifact.type,
      ...(item.artifact.language ? { language: item.artifact.language } : {}),
    });
    out.push(`\`\`\`${ARTIFACT_FENCE}`, header, ...item.artifact.body.split("\n"), "```");
    index = item.endLine;
    next++;
  }
  return out.join("\n");
}

/** One occurrence of an artifact, oldest first — a revision is just another occurrence. */
export type ArtifactVersion = ArtifactBlock & { /** 1-based, in transcript order. */ version: number };

/**
 * Versions per identifier, in the order they appear.
 *
 * Every occurrence in the loaded transcript is a version; that is all a version *is* here. A
 * model revising its own work rewrites the whole block, so the history is the transcript's
 * own order and nothing has to be stored or cleaned up.
 */
export function collectArtifacts(assistantTexts: readonly string[]): Map<string, ArtifactVersion[]> {
  const versions = new Map<string, ArtifactVersion[]>();
  for (const text of assistantTexts) {
    for (const { artifact } of parseArtifacts(text)) {
      const list = versions.get(artifact.identifier) ?? [];
      list.push({ ...artifact, version: list.length + 1 });
      versions.set(artifact.identifier, list);
    }
  }
  return versions;
}

/**
 * Whether an artifact is small and quiet enough to draw where it was written.
 *
 * Mermaid, SVG and Markdown are drawn inline; a page or a component goes to the panel, where
 * it has room and where scripts belong. `react` is never inline: it needs the preview runtime
 * and, more to the point, a page that runs code should be something the reader opened.
 */
export function shouldInlineArtifact(artifact: ArtifactBlock): boolean {
  if (artifact.type === "react") return false;
  if (artifact.type === "code") return false;
  if (artifact.type === "html") return artifact.body.length <= 4_000;
  return artifact.body.length <= 32_000;
}
