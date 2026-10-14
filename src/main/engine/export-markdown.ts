import type { ChatMessage } from "../../shared/types.ts";

/**
 * A conversation as Markdown.
 *
 * The HTML export comes from the SDK, which knows about parts the transcript does not
 * (a compaction summary's shape, a boundary's meaning). Markdown is the other half of that:
 * the format a person pastes into a document, an issue, or a message — so it is written here,
 * deliberately **plain**, and it says nothing the transcript does not say.
 *
 * Two choices worth naming:
 *
 *  - **Thinking is kept, tool calls are kept as a one-line record.** A reader of the export
 *    is usually asking "what happened", and dropping the tool calls answers a different
 *    question. The bodies are not inlined: they belong to the files, which are not part of
 *    this document.
 *  - **No timestamps in the body.** They are in the header, where a reader looks for them;
 *    inline they are noise that makes diffs of two exports unreadable.
 */

export type MarkdownExportOptions = {
  /** Shown as the title. Falls back to the first user message. */
  title?: string;
  /** Where the conversation ran; useful context for a pasted export. */
  cwd?: string;
  /** ISO instant; omitted when unknown. */
  exportedAt?: string;
  /** Include assistant thinking blocks. Off by default: it is long and rarely what was asked. */
  includeThinking?: boolean;
};

function oneLine(text: string, limit = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/** Fence a block, widening the fence when the body contains one. */
function fenced(body: string, language = ""): string {
  const longest = Math.max(0, ...[...body.matchAll(/^`+/gm)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${body.replace(/\n+$/, "")}\n${fence}`;
}

function renderTool(message: ChatMessage): string[] {
  return message.tools.map((tool) => {
    // One line per call: the name and the first thing it acted on. The result is not inlined
    // — a transcript records that a tool ran, the file holds what it did.
    const summary = oneLine(JSON.stringify(tool.args ?? {}), 120);
    return `- \`${tool.name}\` ${summary}`;
  });
}

export function conversationToMarkdown(messages: readonly ChatMessage[], options: MarkdownExportOptions = {}): string {
  const firstUser = messages.find((message) => message.role === "user")?.text ?? "";
  const title = options.title?.trim() || oneLine(firstUser, 80) || "Conversation";

  const lines: string[] = [`# ${title}`, ""];
  const meta = [
    options.cwd ? `- Working directory: \`${options.cwd}\`` : "",
    options.exportedAt ? `- Exported: ${options.exportedAt}` : "",
  ].filter(Boolean);
  if (meta.length > 0) {
    lines.push(...meta, "");
  }

  for (const message of messages) {
    if (message.role === "system") continue;
    lines.push(message.role === "user" ? "## User" : "## Assistant", "");
    if (options.includeThinking && message.thinking?.trim()) {
      lines.push("<details>", "<summary>Thinking</summary>", "", fenced(message.thinking.trim()), "", "</details>", "");
    }
    if (message.text.trim()) {
      lines.push(message.text.trim(), "");
    }
    if (message.tools.length > 0) {
      lines.push(...renderTool(message), "");
    }
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
