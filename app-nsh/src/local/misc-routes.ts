// The odds and ends a session asks for: its HTML export, a generated name, and
// the app's own update check.
//
// Answered here:
//   GET  /api/sessions/[id]/export?inline=1   a self-contained HTML document
//   POST /api/sessions/[id]/auto-name         { title, usage } and a
//                                             `session_info` entry in the file
//   GET  /api/app-update                      AppUpdateResponse
//
// The old server built the export with pi's Node `exportFromFile()` and then
// ran `patchExportHtml()` over the result. This runtime has neither Node nor
// pi's template files under a granted path, so the transcript is rendered here,
// from the `.jsonl` itself: the same active branch, message/tool/thinking
// blocks, timestamps and header statistics, with everything (styles included)
// in one document. There is no external asset and no script.
//
// Auto-name is deterministic by design: no model call exists in this runtime,
// so the first user message is used as the title (trimmed and cut to the old
// route's 80 code points). The `session_info` entry is appended the same way
// `PATCH /api/sessions/[id]` appends one.
import { readFile, stat, writeFile } from "fs/promises";
import path from "path";
import process, { spawn } from "process";
import { appInfo } from "nsh";
import {
  isNewerStableVersion,
  pickLatestRelease,
  type AppUpdateResponse,
} from "../lib/app-update";
import { dataDirectory, loginShellRun } from "../pi/install";
import {
  describe,
  errorResponse,
  homeDirectory,
  isInside,
  jsonResponse,
  sessionFilePath,
  sessionsDirectory,
  type LocalRequest,
  type LocalResponse,
} from "./request";

// ---------------------------------------------------------------------------
// shared little helpers
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseLine(line: string): JsonObject | null {
  if (!line.trim()) return null;
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

interface ParsedSession {
  header: JsonObject | null;
  entries: JsonObject[];
}

/** Every valid line: the first `session` header, then the entries in file order. */
function parseSessionText(value: string): ParsedSession {
  let header: JsonObject | null = null;
  const entries: JsonObject[] = [];
  for (const rawLine of value.split("\n")) {
    const entry = parseLine(stripCarriageReturn(rawLine));
    if (!entry) continue;
    if (entry.type === "session") {
      if (!header) header = entry;
      continue;
    }
    entries.push(entry);
  }
  return { header, entries };
}

/** The text blocks of a message (`content` may be a string or block array). */
function messageText(message: JsonObject): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== "text") continue;
    if (typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

/** How many image bytes an export embeds (`base64` is ~4/3 of the file). */
const MAX_INLINE_IMAGE_BYTES = 6 * 1024 * 1024;
/** How much of the transcript itself an export keeps. */
const MAX_EXPORT_BODY_BYTES = 12 * 1024 * 1024;

/** What is left of this export's inline-image budget (one export at a time). */
let inlineImageBudget = MAX_INLINE_IMAGE_BYTES;

function messageImages(message: JsonObject): string {
  const content = message.content;
  if (!Array.isArray(content)) return "";
  const images: string[] = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== "image") continue;
    const source = isRecord(block.source) ? block.source : null;
    const data = typeof block.data === "string"
      ? block.data
      : source && typeof source.data === "string"
        ? source.data
        : undefined;
    const mime = typeof block.mimeType === "string"
      ? block.mimeType
      : source && typeof source.media_type === "string"
        ? source.media_type
        : "image/png";
    if (data === undefined || !/^image\/[a-z0-9.+-]+$/i.test(mime)) continue;
    // A session of screenshots is tens of megabytes of base64; embedding all
    // of it ran the window's JS heap out and the export died. Past the budget
    // the image is named instead of drawn.
    if (inlineImageBudget - data.length < 0) {
      images.push(`<div class="message-image-omitted">[image omitted: export size limit]</div>`);
      continue;
    }
    inlineImageBudget -= data.length;
    images.push(`<img class="message-image" loading="lazy" alt="" src="data:${escapeHtml(mime)};base64,${escapeHtml(data)}">`);
  }
  return images.length === 0 ? "" : `<div class="message-images">${images.join("")}</div>`;
}

function shortenPath(value: string): string {
  const home = homeDirectory();
  if (home && value === home) return "~";
  if (home && value.startsWith(`${home}${path.sep}`)) return `~${value.slice(home.length)}`;
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomHex(length: number): string {
  const digits = "0123456789abcdef";
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += digits[Math.floor(Math.random() * 16)];
  }
  return value;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// session export
// ---------------------------------------------------------------------------

/** `exportFromFile()` could read any size; this keeps one file inside memory. */
const MAX_SESSION_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TITLE_LENGTH = 80;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function splitText(value: string): string[] {
  return value.replace(/\r\n?/g, "\n").split("\n");
}

/** A URL is a link only when its scheme is one a document may open. */
function safeLink(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return lower.startsWith("http://")
    || lower.startsWith("https://")
    || lower.startsWith("mailto:")
    || lower.startsWith("#")
    || lower.startsWith("/")
    || lower.startsWith("./")
    || lower.startsWith("../");
}

function renderInlineLinksAndEmphasis(raw: string): string {
  const link = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  let out = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = link.exec(raw)) !== null) {
    out += emphasis(escapeHtml(raw.slice(last, match.index)));
    const label = emphasis(escapeHtml(match[1]));
    const url = match[2];
    out += safeLink(url)
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${label}</a>`
      : label;
    last = match.index + match[0].length;
  }
  return out + emphasis(escapeHtml(raw.slice(last)));
}

function emphasis(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
}

/** Inline code first, then links and emphasis; everything else is escaped. */
function renderInline(raw: string): string {
  const code = /`([^`\n]+)`/g;
  let out = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = code.exec(raw)) !== null) {
    out += renderInlineLinksAndEmphasis(raw.slice(last, match.index));
    out += `<code>${escapeHtml(match[1])}</code>`;
    last = match.index + match[0].length;
  }
  return out + renderInlineLinksAndEmphasis(raw.slice(last));
}

/**
 * A deliberately small Markdown renderer: fenced code, headings, lists,
 * quotes, rules and paragraphs. Tables, images and nested lists stay plain
 * text, which keeps the export self-contained without a Markdown library.
 */
function renderMarkdown(value: string): string {
  const lines = splitText(value);
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  let fence: { language: string; lines: string[] } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    out.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (list === null) return;
    const tag = list.ordered ? "ol" : "ul";
    out.push(`<${tag}>${list.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`);
    list = null;
  };
  const flushQuote = (): void => {
    if (quote.length === 0) return;
    out.push(`<blockquote>${quote.map(renderInline).join("<br>")}</blockquote>`);
    quote = [];
  };
  const flush = (): void => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    if (fence !== null) {
      if (/^\s*```/.test(line)) {
        out.push(`<pre><code${fence.language ? ` class="language-${escapeHtml(fence.language)}"` : ""}>${escapeHtml(fence.lines.join("\n"))}</code></pre>`);
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }

    const openFence = /^\s*```(\S*)\s*$/.exec(line);
    if (openFence) {
      flush();
      fence = { language: openFence[1] ?? "", lines: [] };
      continue;
    }

    if (/^\s*$/.test(line)) {
      flush();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      out.push("<hr>");
      continue;
    }

    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }
    flushQuote();

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list === null || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }

  if (fence !== null) {
    out.push(`<pre><code${fence.language ? ` class="language-${escapeHtml(fence.language)}"` : ""}>${escapeHtml(fence.lines.join("\n"))}</code></pre>`);
  }
  flush();
  return out.join("\n");
}

function markdownBlock(value: string, className = "markdown-content"): string {
  if (!value.trim()) return "";
  return `<div class="${className}">${renderMarkdown(value)}</div>`;
}

function formatTimestamp(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

function entryId(entry: JsonObject): string {
  return typeof entry.id === "string" ? entry.id : "";
}

function entryAnchor(entry: JsonObject): string {
  const id = entryId(entry);
  return id ? `entry-${escapeHtml(id)}` : "";
}

interface ToolResult {
  message: JsonObject;
  text: string;
  error: boolean;
}

interface ExportContext {
  toolResults: Map<string, ToolResult>;
  leadingSystemId: string | null;
}

function toolResultMap(entries: readonly JsonObject[]): Map<string, ToolResult> {
  const results = new Map<string, ToolResult>();
  for (const entry of entries) {
    if (entry.type !== "message" || !isRecord(entry.message)) continue;
    const message = entry.message;
    if (message.role !== "toolResult") continue;
    const callId = text(message.toolCallId);
    if (!callId) continue;
    results.set(callId, {
      message,
      text: messageText(message),
      error: message.isError === true,
    });
  }
  return results;
}

function renderOutputBlock(label: string, value: string, open = false): string {
  if (!value) return "";
  const lines = value.split("\n");
  const count = lines.length;
  const suffix = count === 1 ? "1 line" : `${count} lines`;
  return `<details class="tool-output-details"${open || count <= 12 ? " open" : ""}>
    <summary>${escapeHtml(label)} (${suffix})</summary>
    <pre class="tool-output">${escapeHtml(value)}</pre>
  </details>`;
}

function readRange(offset: unknown, limit: unknown): string {
  const start = numberOrUndefined(offset);
  const count = numberOrUndefined(limit);
  if (start === undefined && count === undefined) return "";
  const first = start ?? 1;
  return count === undefined ? `:${first}` : `:${first}-${first + count - 1}`;
}

function renderDiff(value: string): string {
  const lines = splitText(value).map((line) => {
    const className = line.startsWith("+") ? "diff-added" : line.startsWith("-") ? "diff-removed" : "diff-context";
    return `<div class="${className}">${escapeHtml(line)}</div>`;
  });
  return `<div class="tool-diff">${lines.join("")}</div>`;
}

function renderToolCall(call: JsonObject, context: ExportContext): string {
  const name = text(call.name) ?? text(call.toolName) ?? "tool";
  const callId = text(call.id) ?? text(call.toolCallId) ?? "";
  const argsValue = isRecord(call.arguments) ? call.arguments : isRecord(call.input) ? call.input : {};
  const result = callId ? context.toolResults.get(callId) : undefined;
  const status = result ? (result.error ? "error" : "success") : "pending";
  const domId = callId ? `tool-call-${escapeHtml(callId)}` : "";

  let body = "";
  if (name === "bash") {
    const command = text(argsValue.command);
    body += `<div class="tool-command">$ ${command === undefined ? "[invalid command]" : escapeHtml(command)}</div>`;
    if (result) body += renderOutputBlock("Output", result.text.trim());
  } else if (name === "read") {
    const filePath = text(argsValue.file_path) ?? text(argsValue.path) ?? "";
    const range = readRange(argsValue.offset, argsValue.limit);
    body += `<div class="tool-header"><span class="tool-name">read</span> <span class="tool-path">${escapeHtml(shortenPath(filePath))}</span>${range ? `<span class="line-numbers">${escapeHtml(range)}</span>` : ""}</div>`;
    if (result) body += messageImages(result.message) + renderOutputBlock("Output", result.text);
  } else if (name === "write") {
    const filePath = text(argsValue.file_path) ?? text(argsValue.path) ?? "";
    const content = text(argsValue.content);
    body += `<div class="tool-header"><span class="tool-name">write</span> <span class="tool-path">${escapeHtml(shortenPath(filePath))}</span>`;
    if (content) body += ` <span class="line-count">(${content.split("\n").length} lines)</span>`;
    body += "</div>";
    if (content) body += renderOutputBlock("Content", content, content.split("\n").length <= 10);
    if (result) body += messageImages(result.message) + renderOutputBlock("Result", result.text.trim());
  } else if (name === "edit") {
    const filePath = text(argsValue.file_path) ?? text(argsValue.path) ?? "";
    body += `<div class="tool-header"><span class="tool-name">edit</span> <span class="tool-path">${escapeHtml(shortenPath(filePath))}</span></div>`;
    const details = result && isRecord(result.message.details) ? result.message.details : null;
    const diff = details ? text(details.diff) : undefined;
    if (diff) body += renderDiff(diff);
    if (result && !diff) body += renderOutputBlock("Result", result.text.trim());
  } else if (name === "ls") {
    const directory = text(argsValue.path) ?? "";
    const limit = numberOrUndefined(argsValue.limit);
    body += `<div class="tool-header"><span class="tool-name">ls</span> <span class="tool-path">${escapeHtml(shortenPath(directory || "."))}</span>${limit === undefined ? "" : ` <span class="line-count">(limit ${limit})</span>`}</div>`;
    if (result) body += renderOutputBlock("Output", result.text);
  } else {
    body += `<div class="tool-header"><span class="tool-name">${escapeHtml(name)}</span></div>`;
    const input = JSON.stringify(argsValue, null, 2);
    if (input && input !== "{}") body += renderOutputBlock("Input", input, true);
    if (result) body += messageImages(result.message) + renderOutputBlock("Output", result.text);
  }

  if (result && name !== "read" && name !== "write") body += messageImages(result.message);
  return `<div class="tool-execution ${status}"${domId ? ` id="${domId}"` : ""}>${body}</div>`;
}

function systemMessageText(message: JsonObject): string {
  const parts: string[] = [];
  const content = messageText(message);
  if (content.trim()) parts.push(content);
  const sections = isRecord(message.sections) ? message.sections : null;
  if (sections) {
    for (const value of Object.values(sections)) {
      if (typeof value === "string" && value.trim()) parts.push(value);
    }
  }
  return parts.join("\n\n");
}

function toolsAddedHtml(message: JsonObject): string {
  if (!Array.isArray(message.toolsAdded) || message.toolsAdded.length === 0) return "";
  const names: string[] = [];
  for (const tool of message.toolsAdded) {
    if (isRecord(tool) && typeof tool.name === "string") names.push(tool.name);
  }
  if (names.length === 0) return "";
  return `<div class="tools-list"><div class="tools-header">Tools</div><div class="tools-content">${names.map((name) => `<div class="tool-item"><span class="tool-item-name">${escapeHtml(name)}</span></div>`).join("")}</div></div>`;
}

function renderSystemEntry(entry: JsonObject, message: JsonObject, context: ExportContext): string {
  const full = systemMessageText(message);
  const timestamp = formatTimestamp(entry.timestamp);
  const isLeading = context.leadingSystemId !== null && entryId(entry) === context.leadingSystemId;
  const label = isLeading ? "System prompt" : "System prompt update";
  if (!full && toolsAddedHtml(message) === "") return "";
  return `<details class="system-entry" id="${entryAnchor(entry)}">
    <summary>${label}${timestamp ? ` · ${timestamp}` : ""}</summary>
    ${full ? `<pre class="system-prompt">${escapeHtml(full)}</pre>` : ""}
    ${toolsAddedHtml(message)}
  </details>`;
}

function renderEntry(entry: JsonObject, context: ExportContext): string {
  const type = text(entry.type) ?? "";
  const timestamp = formatTimestamp(entry.timestamp);
  const tsHtml = timestamp ? `<div class="message-timestamp">${timestamp}</div>` : "";
  const id = entryAnchor(entry);
  const idAttribute = id ? ` id="${id}"` : "";

  if (type === "message" && isRecord(entry.message)) {
    const message = entry.message;
    const role = text(message.role);
    if (role === "user") {
      const value = messageText(message);
      const images = messageImages(message);
      if (!value.trim() && !images) return "";
      return `<div class="user-message"${idAttribute}>${tsHtml}${images}${value.trim() ? markdownBlock(value) : ""}</div>`;
    }
    if (role === "assistant") {
      const content = Array.isArray(message.content) ? message.content : [];
      let html = "";
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          html += `<div class="assistant-text">${markdownBlock(block.text)}</div>`;
        } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
          html += `<div class="thinking-block"><div class="thinking-text">${escapeHtml(block.thinking)}</div></div>`;
        }
      }
      for (const block of content) {
        if (isRecord(block) && block.type === "toolCall") html += renderToolCall(block, context);
      }
      if (message.stopReason === "aborted") html += `<div class="error-text">Aborted</div>`;
      else if (message.stopReason === "error") html += `<div class="error-text">Error: ${escapeHtml(text(message.errorMessage) ?? "Unknown error")}</div>`;
      if (!html) return "";
      return `<div class="assistant-message"${idAttribute}>${tsHtml}${html}</div>`;
    }
    if (role === "bashExecution") {
      const command = text(message.command) ?? "";
      const output = text(message.output) ?? "";
      const cancelled = message.cancelled === true;
      const exitCode = numberOrUndefined(message.exitCode);
      const failed = cancelled || (exitCode !== undefined && exitCode !== 0);
      let html = `<div class="tool-execution ${failed ? "error" : "success"}"${idAttribute}>${tsHtml}`;
      html += `<div class="tool-command">$ ${escapeHtml(command)}</div>`;
      html += renderOutputBlock("Output", output);
      if (cancelled) html += `<div class="error-text">(cancelled)</div>`;
      else if (exitCode !== undefined && exitCode !== 0) html += `<div class="error-text">(exit ${exitCode})</div>`;
      return `${html}</div>`;
    }
    if (role === "system") return renderSystemEntry(entry, message, context);
    if (role === "custom") {
      const customType = text(message.customType) ?? "custom";
      const value = messageText(message);
      if (!value.trim()) return "";
      return `<div class="hook-message"${idAttribute}>${tsHtml}<div class="hook-type">[${escapeHtml(customType)}]</div>${markdownBlock(value)}</div>`;
    }
    return "";
  }

  if (type === "model_change") {
    const provider = text(entry.provider) ?? "";
    const model = text(entry.modelId) ?? "";
    return `<div class="model-change"${idAttribute}>${tsHtml}Switched to model: <span class="model-name">${escapeHtml(provider)}/${escapeHtml(model)}</span></div>`;
  }

  if (type === "thinking_level_change") {
    const level = text(entry.thinkingLevel) ?? "";
    return `<div class="setting-change"${idAttribute}>${tsHtml}Thinking: <span class="model-name">${escapeHtml(level)}</span></div>`;
  }

  if (type === "compaction") {
    const tokens = numberOrUndefined(entry.tokensBefore) ?? 0;
    const summary = text(entry.summary) ?? "";
    const timestamp = formatTimestamp(entry.timestamp);
    return `<details class="compaction"${idAttribute}>
      <summary>[compaction] Compacted from ${formatCount(tokens)} tokens${timestamp ? ` · ${timestamp}` : ""}</summary>
      ${markdownBlock(summary)}
    </details>`;
  }

  if (type === "branch_summary") {
    const summary = text(entry.summary) ?? "";
    return `<details class="branch-summary"${idAttribute}>
      <summary>Branch Summary${timestamp ? ` · ${timestamp}` : ""}</summary>
      ${markdownBlock(summary)}
    </details>`;
  }

  if (type === "custom_message") {
    const customType = text(entry.customType) ?? "custom";
    const content = typeof entry.content === "string" ? entry.content : "";
    const hidden = entry.display === false;
    if (!content.trim()) return "";
    return `<div class="hook-message${hidden ? " hook-message-hidden" : ""}"${idAttribute}>${tsHtml}
      <div class="hook-type">[${escapeHtml(customType)}]${hidden ? " · hidden in terminal" : ""}</div>
      ${markdownBlock(content)}
    </div>`;
  }

  return "";
}

interface ExportStats {
  userMessages: number;
  assistantMessages: number;
  toolResults: number;
  customMessages: number;
  compactions: number;
  branchSummaries: number;
  toolCalls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  models: string[];
}

function exportStats(entries: readonly JsonObject[]): ExportStats {
  const stats: ExportStats = {
    userMessages: 0,
    assistantMessages: 0,
    toolResults: 0,
    customMessages: 0,
    compactions: 0,
    branchSummaries: 0,
    toolCalls: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    models: [],
  };
  const models = new Set<string>();
  for (const entry of entries) {
    if (entry.type === "message" && isRecord(entry.message)) {
      const message = entry.message;
      if (message.role === "user") stats.userMessages += 1;
      if (message.role === "toolResult") stats.toolResults += 1;
      if (message.role === "assistant") {
        stats.assistantMessages += 1;
        const model = text(message.model);
        const provider = text(message.provider);
        if (model) models.add(provider ? `${provider}/${model}` : model);
        const content = Array.isArray(message.content) ? message.content : [];
        stats.toolCalls += content.filter((block) => isRecord(block) && block.type === "toolCall").length;
        const usage = isRecord(message.usage) ? message.usage : null;
        if (usage) {
          stats.input += numberOrUndefined(usage.input) ?? 0;
          stats.output += numberOrUndefined(usage.output) ?? 0;
          stats.cacheRead += numberOrUndefined(usage.cacheRead) ?? 0;
          stats.cacheWrite += numberOrUndefined(usage.cacheWrite) ?? 0;
          const cost = isRecord(usage.cost) ? usage.cost : null;
          if (cost) {
            const total = numberOrUndefined(cost.total);
            stats.cost += total ?? (
              (numberOrUndefined(cost.input) ?? 0)
              + (numberOrUndefined(cost.output) ?? 0)
              + (numberOrUndefined(cost.cacheRead) ?? 0)
              + (numberOrUndefined(cost.cacheWrite) ?? 0)
            );
          }
        }
      }
    } else if (entry.type === "compaction") {
      stats.compactions += 1;
    } else if (entry.type === "branch_summary") {
      stats.branchSummaries += 1;
    } else if (entry.type === "custom_message") {
      stats.customMessages += 1;
    }
  }
  stats.models = [...models];
  return stats;
}

function sessionName(entries: readonly JsonObject[]): string | null {
  let name: string | null = null;
  for (const entry of entries) {
    if (entry.type !== "session_info") continue;
    const value = text(entry.name);
    if (value && value.trim()) name = value.trim();
  }
  return name;
}

/** The branch the file ends on (`SessionManager` takes the last entry as leaf). */
function activeBranch(entries: readonly JsonObject[]): JsonObject[] {
  const byId = new Map<string, JsonObject>();
  let leafId = "";
  for (const entry of entries) {
    const id = entryId(entry);
    if (!id) continue;
    byId.set(id, entry);
    leafId = id;
  }
  const pathEntries: JsonObject[] = [];
  const seen = new Set<string>();
  let current = leafId ? byId.get(leafId) : undefined;
  while (current) {
    const id = entryId(current);
    if (id) {
      if (seen.has(id)) break;
      seen.add(id);
    }
    pathEntries.push(current);
    const parentId = text(current.parentId);
    if (!parentId || parentId === id) break;
    current = byId.get(parentId);
  }
  pathEntries.reverse();
  return pathEntries.length > 0 ? pathEntries : [...entries];
}

function sidebarLabel(entry: JsonObject): string {
  const type = text(entry.type) ?? "";
  if (type === "message" && isRecord(entry.message)) {
    const message = entry.message;
    const role = text(message.role) ?? "message";
    if (role === "user") return `User · ${firstLine(messageText(message))}`;
    if (role === "assistant") {
      const content = Array.isArray(message.content) ? message.content : [];
      const firstText = content.find((block) => isRecord(block) && block.type === "text" && typeof block.text === "string");
      return `Assistant · ${firstLine(isRecord(firstText) && typeof firstText.text === "string" ? firstText.text : "")}`;
    }
    if (role === "toolResult") return "Tool result";
    if (role === "bashExecution") return `Bash · ${firstLine(text(message.command) ?? "")}`;
    if (role === "system") return "System prompt";
    if (role === "custom") return firstLine(text(message.customType) ?? "Custom");
    return role;
  }
  if (type === "model_change") return "Model change";
  if (type === "thinking_level_change") return "Thinking level";
  if (type === "compaction") return "Compaction";
  if (type === "branch_summary") return "Branch summary";
  if (type === "custom_message") return firstLine(text(entry.customType) ?? "Custom message");
  return "";
}

function firstLine(value: string): string {
  const line = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(line);
  return characters.length > 70 ? `${characters.slice(0, 69).join("")}…` : line;
}

function renderSidebar(entries: readonly JsonObject[], rendered: ReadonlyArray<{ entry: JsonObject; html: string }>): string {
  const items: string[] = [];
  for (const item of rendered) {
    if (!item.html) continue;
    const label = sidebarLabel(item.entry);
    if (!label) continue;
    const anchor = entryAnchor(item.entry);
    const content = escapeHtml(label);
    items.push(`<div class="tree-item">${anchor ? `<a href="#${anchor}">${content}</a>` : content}</div>`);
  }
  return `<aside id="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-title">Session</div>
      <div class="sidebar-hint">${entries.length === 0 ? "No entries" : `${entries.length} active branch ${entries.length === 1 ? "entry" : "entries"}`}</div>
    </div>
    <div class="tree-container">${items.join("")}</div>
  </aside>`;
}

const EXPORT_STYLE = `
    :root {
      --text: #e6e6e6;
      --muted: #a0a0a0;
      --dim: #707070;
      --accent: #e8a33d;
      --body-bg: #18181e;
      --container-bg: #1f1f26;
      --userMessageBg: #2b2b35;
      --userMessageText: #f0f0f0;
      --thinkingText: #a9a9c0;
      --toolPendingBg: #25252e;
      --toolSuccessBg: #1e2a22;
      --toolErrorBg: #2e1e20;
      --toolText: #d8d8d8;
      --mdHeading: #f0c674;
      --mdLink: #7cb7ff;
      --mdCode: #f0c674;
      --mdQuote: #b0b0b0;
      --mdQuoteBorder: #555566;
      --mdHr: #3a3a46;
      --mdListBullet: #e8a33d;
      --mdCodeBlockBorder: #3a3a46;
      --diffAdded: #9ecb7a;
      --diffRemoved: #e07b7b;
      --line-height: 18px;
      --sidebar-width: 300px;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --text: #24242a;
        --muted: #62626c;
        --dim: #8a8a94;
        --accent: #a66200;
        --body-bg: #f5f5f7;
        --container-bg: #ffffff;
        --userMessageBg: #e8e8ee;
        --userMessageText: #1c1c22;
        --thinkingText: #66667a;
        --toolPendingBg: #f0f0f3;
        --toolSuccessBg: #e9f5ec;
        --toolErrorBg: #fbeaea;
        --toolText: #24242a;
        --mdHeading: #8a5a00;
        --mdLink: #0a5bb5;
        --mdCode: #8a4a00;
        --mdQuote: #555560;
        --mdQuoteBorder: #c8c8d0;
        --mdHr: #d8d8de;
        --mdListBullet: #a66200;
        --mdCodeBlockBorder: #d8d8de;
        --diffAdded: #2f7a2f;
        --diffRemoved: #a83232;
      }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, "DejaVu Sans Mono", monospace;
      font-size: 12px;
      line-height: var(--line-height);
      color: var(--text);
      background: var(--body-bg);
    }
    #app { display: flex; min-height: 100vh; }
    #sidebar {
      width: var(--sidebar-width);
      min-width: var(--sidebar-width);
      max-width: var(--sidebar-width);
      background: var(--container-bg);
      border-right: 1px solid var(--dim);
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: auto;
      flex-shrink: 0;
    }
    .sidebar-header { padding: 12px; border-bottom: 1px solid var(--mdHr); }
    .sidebar-title { font-weight: 700; color: var(--text); }
    .sidebar-hint { color: var(--dim); font-size: 11px; margin-top: 4px; }
    .tree-container { padding: 6px 0; }
    .tree-item { padding: 2px 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tree-item a { color: var(--muted); text-decoration: none; }
    .tree-item a:hover { color: var(--text); }
    #content { flex: 1; min-width: 0; padding: 18px 22px 40px; max-width: 1100px; }
    .header { margin-bottom: 18px; }
    .header h1 { font-size: 15px; line-height: 1.4; font-weight: 700; color: var(--text); word-break: break-all; }
    .session-name { margin-top: 4px; color: var(--accent); font-size: 13px; }
    .help-bar { margin: 8px 0 10px; color: var(--dim); }
    .help-hint { font-size: 11px; }
    .header-info { display: flex; flex-wrap: wrap; gap: 4px 16px; border-top: 1px solid var(--mdHr); border-bottom: 1px solid var(--mdHr); padding: 8px 0; }
    .info-item { display: flex; gap: 4px; min-width: 140px; }
    .info-label { color: var(--dim); }
    .info-value { color: var(--text); }
    #messages { display: flex; flex-direction: column; gap: var(--line-height); }
    .message-timestamp { font-size: 10px; color: var(--dim); opacity: 0.85; }
    .user-message { background: var(--userMessageBg); color: var(--userMessageText); padding: var(--line-height); border-radius: 4px; }
    .user-message > .message-timestamp { color: var(--muted); margin-bottom: 4px; }
    .assistant-message { position: relative; }
    .assistant-message > .message-timestamp { padding-left: var(--line-height); }
    .assistant-text { padding: var(--line-height); padding-bottom: 0; }
    .message-timestamp + .assistant-text, .message-timestamp + .thinking-block { padding-top: 0; }
    .thinking-block + .assistant-text { padding-top: 0; }
    .thinking-text { padding: var(--line-height); color: var(--thinkingText); font-style: italic; white-space: pre-wrap; }
    .message-images { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 0 8px; }
    .message-image, .tool-image { max-width: 100%; max-height: 420px; border-radius: 4px; display: block; }
    .tool-execution { padding: var(--line-height); border-radius: 4px; background: var(--toolPendingBg); color: var(--toolText); }
    .tool-execution.success { background: var(--toolSuccessBg); }
    .tool-execution.error { background: var(--toolErrorBg); }
    .tool-execution + .tool-execution, .assistant-text + .tool-execution { margin-top: var(--line-height); }
    .tool-header, .tool-name { font-weight: 700; }
    .tool-path { color: var(--accent); word-break: break-all; }
    .line-numbers { color: #c9a227; margin-left: 4px; }
    .line-count { color: var(--dim); }
    .tool-command { white-space: pre-wrap; word-break: break-word; margin: var(--line-height) 0; }
    .tool-output-details { margin-top: 8px; }
    .tool-output-details > summary { cursor: pointer; color: var(--muted); font-size: 11px; }
    .tool-output-details[open] > summary { margin-bottom: 6px; }
    .tool-output, .system-prompt {
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
      font-family: inherit;
      font-size: 12px;
      line-height: var(--line-height);
      background: rgba(128, 128, 128, 0.10);
      border-radius: 4px;
      padding: 8px;
      max-height: 520px;
      overflow: auto;
    }
    .tool-diff { background: rgba(128, 128, 128, 0.10); border-radius: 4px; padding: 8px; overflow: auto; max-height: 520px; }
    .tool-diff > div { white-space: pre-wrap; word-break: break-word; }
    .diff-added { color: var(--diffAdded); }
    .diff-removed { color: var(--diffRemoved); }
    .diff-context { color: var(--muted); }
    .error-text { color: var(--diffRemoved); margin-top: 4px; }
    .system-entry, .compaction, .branch-summary { border: 1px solid var(--mdHr); border-radius: 4px; padding: 8px var(--line-height); }
    .system-entry > summary, .compaction > summary, .branch-summary > summary { cursor: pointer; color: var(--muted); }
    .system-entry[open] > summary, .compaction[open] > summary, .branch-summary[open] > summary { color: var(--text); margin-bottom: 8px; }
    .tools-list { margin-top: 8px; }
    .tools-header { color: var(--muted); font-weight: 700; margin-bottom: 4px; }
    .tool-item { padding: 1px 0; }
    .tool-item-name { color: var(--accent); }
    .model-change, .setting-change { color: var(--muted); }
    .model-name { color: var(--text); }
    .hook-message { border-left: 3px solid var(--accent); padding: 4px 0 4px var(--line-height); }
    .hook-message-hidden { opacity: 0.72; }
    .hook-type { color: var(--accent); font-size: 11px; }
    .markdown-content h1, .markdown-content h2, .markdown-content h3,
    .markdown-content h4, .markdown-content h5, .markdown-content h6 {
      color: var(--mdHeading); margin: var(--line-height) 0 0; font-weight: 700; font-size: 1em;
    }
    .markdown-content p { margin: 0; }
    .markdown-content p + p { margin-top: var(--line-height); }
    .markdown-content a { color: var(--mdLink); text-decoration: underline; }
    .markdown-content code { background: rgba(128, 128, 128, 0.20); color: var(--mdCode); padding: 0 4px; border-radius: 3px; font-family: inherit; }
    .markdown-content pre { background: transparent; margin: var(--line-height) 0; overflow-x: auto; }
    .markdown-content pre code { display: block; background: rgba(128, 128, 128, 0.12); color: var(--text); padding: 8px; }
    .markdown-content blockquote { border-left: 3px solid var(--mdQuoteBorder); padding-left: var(--line-height); margin: var(--line-height) 0; color: var(--mdQuote); font-style: italic; }
    .markdown-content ul, .markdown-content ol { margin: var(--line-height) 0; padding-left: calc(var(--line-height) * 2); }
    .markdown-content li { margin: 0; }
    .markdown-content li::marker { color: var(--mdListBullet); }
    .markdown-content hr { border: none; border-top: 1px solid var(--mdHr); margin: var(--line-height) 0; }
    @media (max-width: 820px) {
      #sidebar { display: none; }
      #content { padding: 14px 12px 30px; }
    }
`;

function buildExportHtml(
  header: JsonObject | null,
  entries: readonly JsonObject[],
  filePath: string,
): string {
  const pathEntries = activeBranch(entries);
  const context: ExportContext = {
    toolResults: toolResultMap(entries),
    leadingSystemId: null,
  };
  for (const entry of pathEntries) {
    if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "system") continue;
    context.leadingSystemId = entryId(entry) || null;
    break;
  }

  const stats = exportStats(entries);
  const name = sessionName(entries);
  inlineImageBudget = MAX_INLINE_IMAGE_BYTES;
  const rendered: Array<{ entry: JsonObject; html: string }> = [];
  let bodyBytes = 0;
  for (const entry of pathEntries) {
    const html = renderEntry(entry, context);
    // Past the budget the rest is named, not rendered: the page still opens.
    if (bodyBytes + html.length > MAX_EXPORT_BODY_BYTES) {
      rendered.push({
        entry,
        html: `<div class="export-truncated">[export truncated at ${Math.round(MAX_EXPORT_BODY_BYTES / 1024 / 1024)} MB: the rest of this session is in the file]</div>`,
      });
      break;
    }
    bodyBytes += html.length;
    rendered.push({ entry, html });
  }
  const headerId = header ? text(header.id) ?? path.basename(filePath, ".jsonl") : path.basename(filePath, ".jsonl");
  const headerDate = formatTimestamp(header?.timestamp);
  const headerCwd = header ? text(header.cwd) ?? "" : "";

  const messageParts: string[] = [];
  if (stats.userMessages) messageParts.push(`${stats.userMessages} user`);
  if (stats.assistantMessages) messageParts.push(`${stats.assistantMessages} assistant`);
  if (stats.toolResults) messageParts.push(`${stats.toolResults} tool results`);
  if (stats.customMessages) messageParts.push(`${stats.customMessages} custom`);
  if (stats.compactions) messageParts.push(`${stats.compactions} compactions`);
  if (stats.branchSummaries) messageParts.push(`${stats.branchSummaries} branch summaries`);

  const tokenParts: string[] = [];
  if (stats.input) tokenParts.push(`↑${formatCount(stats.input)}`);
  if (stats.output) tokenParts.push(`↓${formatCount(stats.output)}`);
  if (stats.cacheRead) tokenParts.push(`R${formatCount(stats.cacheRead)}`);
  if (stats.cacheWrite) tokenParts.push(`W${formatCount(stats.cacheWrite)}`);

  const branchNote = entries.length === 0
    ? "No entries"
    : `${pathEntries.length} of ${entries.length} ${entries.length === 1 ? "entry" : "entries"} on the active branch`;
  const cwdInfo = headerCwd
    ? `<div class="info-item"><span class="info-label">CWD:</span><span class="info-value">${escapeHtml(shortenPath(headerCwd))}</span></div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session Export</title>
  <style>${EXPORT_STYLE}</style>
</head>
<body>
  <div id="app">
    ${renderSidebar(pathEntries, rendered)}
    <main id="content">
      <div id="header-container">
        <div class="header">
          <h1>Session: ${escapeHtml(headerId)}</h1>
          ${name ? `<div class="session-name">${escapeHtml(name)}</div>` : ""}
          <div class="help-bar"><span class="help-hint">Exported ${escapeHtml(formatTimestamp(nowIso()))} · ${escapeHtml(branchNote)}</span></div>
          <div class="header-info">
            <div class="info-item"><span class="info-label">Date:</span><span class="info-value">${escapeHtml(headerDate || "unknown")}</span></div>
            <div class="info-item"><span class="info-label">Models:</span><span class="info-value">${escapeHtml(stats.models.join(", ") || "unknown")}</span></div>
            <div class="info-item"><span class="info-label">Messages:</span><span class="info-value">${escapeHtml(messageParts.join(", ") || "0")}</span></div>
            <div class="info-item"><span class="info-label">Tool Calls:</span><span class="info-value">${stats.toolCalls}</span></div>
            <div class="info-item"><span class="info-label">Tokens:</span><span class="info-value">${escapeHtml(tokenParts.join(" ") || "0")}</span></div>
            <div class="info-item"><span class="info-label">Cost:</span><span class="info-value">$${stats.cost.toFixed(3)}</span></div>
            ${cwdInfo}
          </div>
        </div>
      </div>
      <div id="messages">
        ${rendered.map((item) => item.html).filter((html) => html !== "").join("\n        ")}
      </div>
    </main>
  </div>
</body>
</html>
`;
}

function encodeHeaderValue(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function contentDisposition(fileName: string, inline: boolean): string {
  const fallback = fileName.replace(/[^\x20-\x7E]|["\\;\r\n]/g, "_") || "session.html";
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeHeaderValue(fileName)}`;
}

async function readSessionFile(filePath: string): Promise<string> {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("Session not found");
  if (info.size > MAX_SESSION_FILE_BYTES) throw new Error("Session file is too large");
  return readFile(filePath, "utf8");
}

async function handleExport(request: LocalRequest, id: string): Promise<LocalResponse> {
  let filePath: string | null;
  try {
    filePath = await sessionFilePath(id);
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
  if (filePath === null) return errorResponse("Session not found", 404);

  let value: string;
  try {
    value = await readSessionFile(filePath);
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }

  const parsed = parseSessionText(value);
  let html: string;
  try {
    html = buildExportHtml(parsed.header, parsed.entries, filePath);
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }

  const fileName = `pi-session-${path.basename(filePath, ".jsonl")}.html`;
  return {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": contentDisposition(fileName, request.params.get("inline") === "1"),
      "cache-control": "no-cache",
      "content-security-policy": "frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
    body: html,
  };
}

// ---------------------------------------------------------------------------
// auto-name (heuristic)
// ---------------------------------------------------------------------------

function firstUserText(entries: readonly JsonObject[]): string {
  for (const entry of entries) {
    if (entry.type !== "message" || !isRecord(entry.message)) continue;
    const message = entry.message;
    if (message.role !== "user") continue;
    const value = messageText(message);
    if (value.trim()) return value;
  }
  return "";
}

function stripWrappingQuotes(value: string): string {
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["\u201c", "\u201d"],
    ["\u300c", "\u300d"],
    ["\u300e", "\u300f"],
  ];
  for (const [start, end] of pairs) {
    if (value.startsWith(start) && value.endsWith(end) && value.length > start.length + end.length) {
      return value.slice(start.length, -end.length).trim();
    }
  }
  return value;
}

/**
 * The old title parser's cleanup, without a model: one line, no wrapping
 * quotes or "Title:" label, no trailing sentence punctuation, and at most 80
 * code points (the old route's MAX_TITLE_LENGTH).
 */
function heuristicTitle(raw: string): string | null {
  let value = raw.trim().replace(/\r\n?/g, "\n");
  value = value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+[.)]\s+/gm, "");
  value = value.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  value = value.replace(/`([^`]*)`/g, "$1");
  value = value.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1");
  value = value.replace(/^(?:session\s+title|title|标题)\s*[:：-]\s*/i, "");
  value = value.replace(/\s+/g, " ").trim();
  value = stripWrappingQuotes(value).replace(/\s+/g, " ").trim();
  value = value.replace(/[。.!]+$/u, "").trim();
  if (!/[\p{L}\p{N}]/u.test(value)) return null;
  const characters = Array.from(value);
  if (characters.length > MAX_TITLE_LENGTH) value = characters.slice(0, MAX_TITLE_LENGTH).join("").trim();
  return value || null;
}

async function posixShell(): Promise<string | null> {
  if (process.platform === "windows") return null;
  for (const candidate of ["/bin/zsh", "/bin/bash"]) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // Try the next shell.
    }
  }
  return null;
}

/** Same append as PATCH's rename: `cat >>` through the POSIX shell. */
async function appendSessionLine(filePath: string, line: string, existingText: string): Promise<void> {
  if (!isInside(sessionsDirectory(), filePath)) throw new Error("refusing to write outside pi's sessions");
  const payload = `${existingText.endsWith("\n") || existingText === "" ? "" : "\n"}${line}\n`;
  const shell = await posixShell();
  if (shell !== null) {
    const cwd = await dataDirectory();
    await new Promise<void>((resolve, reject) => {
      let child;
      try {
        child = spawn(shell, ["-c", `cat >> ${shellQuote(filePath)}`], { cwd, stdin: "pipe", timeoutMs: 30_000 });
      } catch (cause) {
        reject(cause);
        return;
      }
      let stderr = "";
      child.on("stderr", (chunk) => {
        stderr += chunk;
        if (stderr.length > 8192) stderr = stderr.slice(-8192);
      });
      child.on("exit", (result) => {
        if (result.error) {
          reject(new Error(result.error));
          return;
        }
        if (result.code !== 0) {
          reject(new Error(stderr.trim() || `append failed (exit ${result.code})`));
          return;
        }
        resolve();
      });
      try {
        child.write(payload);
        child.end();
      } catch (cause) {
        child.kill();
        reject(cause);
      }
    });
    return;
  }

  // No POSIX shell (Windows): rewrite, bounded by the runtime's 8 MiB write cap.
  const next = `${existingText}${payload}`;
  if (utf8Length(next) > MAX_WRITE_BYTES) throw new Error("session file is too large to rename on this platform");
  await writeFile(filePath, next);
}

const MAX_WRITE_BYTES = 8 * 1024 * 1024;

function sessionInfoEntry(leafId: string | null, name: string): JsonObject {
  return {
    type: "session_info",
    id: randomHex(8),
    parentId: leafId,
    timestamp: nowIso(),
    name,
  };
}

function lastEntryId(entries: readonly JsonObject[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const id = entryId(entries[index]);
    if (id) return id;
  }
  return null;
}

async function handleAutoName(id: string): Promise<LocalResponse> {
  let filePath: string | null;
  try {
    filePath = await sessionFilePath(id);
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
  if (filePath === null) return errorResponse("Session not found", 404);

  let value: string;
  try {
    value = await readSessionFile(filePath);
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }

  const parsed = parseSessionText(value);
  const title = heuristicTitle(firstUserText(activeBranch(parsed.entries)));
  if (title === null) {
    // The old route's generateSessionTitle() threw exactly this when the
    // transcript carried no usable text; its route answered it with a 500.
    return errorResponse("The session has no usable text to name", 500);
  }

  const name = title.replace(/[\r\n]+/g, " ").trim();
  try {
    await appendSessionLine(filePath, JSON.stringify(sessionInfoEntry(lastEntryId(parsed.entries), name)), value);
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
  return jsonResponse({ title, usage: null });
}

// ---------------------------------------------------------------------------
// app update
// ---------------------------------------------------------------------------

// PI NEXT's releases, not pi-web's npm package: this card answers for the app
// that is running. The API is read without a token (the repository is public),
// and its anonymous rate limit is why a failed read stays an offline answer.
const RELEASES_URL =
  "https://api.github.com/repos/greenfriends6688/PI-NEXT/releases?per_page=20";
const UPDATE_TTL_MS = 12 * 60 * 60 * 1000;

let updateCache: { value: AppUpdateResponse; expiresAt: number } | null = null;
let updateInFlight: Promise<AppUpdateResponse> | null = null;

/** The app's own manifest (`nsh.json`'s version, as this build was made). */
function currentAppVersion(): string {
  try {
    const version = appInfo().version;
    if (typeof version === "string" && version.trim()) return version.trim();
  } catch {
    // A host without appInfo still gets a usable answer.
  }
  return "0.0.0";
}

function offlineUpdate(currentVersion: string): AppUpdateResponse {
  return { currentVersion, latestVersion: currentVersion, updateAvailable: false, releaseUrl: "" };
}

async function fetchUpdate(currentVersion: string): Promise<AppUpdateResponse> {
  // `curl` runs inside the login shell, as the app's pi check does; the
  // runtime itself has no fetch(). GitHub's answer is the release list, so a
  // newer pre-release or a stale `latest` flag cannot make this build look old.
  const body = await loginShellRun(
    `curl -fsSL --max-time 15 "${RELEASES_URL}"`,
    20_000,
  );
  const latest = pickLatestRelease(body);
  if (latest === null) throw new Error("GitHub Releases returned no stable release");
  return {
    currentVersion,
    latestVersion: latest.version,
    updateAvailable: isNewerStableVersion(latest.version, currentVersion),
    releaseUrl: latest.releaseUrl,
  };
}

async function loadAppUpdate(): Promise<AppUpdateResponse> {
  const currentVersion = currentAppVersion();
  if (process.env.PI_WEB_SKIP_VERSION_CHECK === "1") return offlineUpdate(currentVersion);

  const now = Date.now();
  if (updateCache !== null && updateCache.expiresAt > now) return updateCache.value;
  if (updateInFlight !== null) return updateInFlight;

  updateInFlight = fetchUpdate(currentVersion)
    .then((value) => {
      updateCache = { value, expiresAt: Date.now() + UPDATE_TTL_MS };
      return value;
    })
    .catch(() => offlineUpdate(currentVersion))
    .finally(() => {
      updateInFlight = null;
    });
  return updateInFlight;
}

// ---------------------------------------------------------------------------
// routing
// ---------------------------------------------------------------------------

function methodNotAllowed(): LocalResponse {
  return errorResponse("Method not allowed", 405);
}

export async function handleMisc(request: LocalRequest): Promise<LocalResponse | null> {
  const segments = request.segments;
  if (segments[0] !== "api") return null;

  if (segments.length === 2 && segments[1] === "app-update") {
    if (request.method !== "GET") return methodNotAllowed();
    return jsonResponse(await loadAppUpdate());
  }

  if (segments[1] !== "sessions" || segments.length !== 4) return null;
  const id = segments[2];
  if (segments[3] === "export") {
    if (request.method !== "GET") return methodNotAllowed();
    return handleExport(request, id);
  }
  if (segments[3] === "auto-name") {
    if (request.method !== "POST") return methodNotAllowed();
    return handleAutoName(id);
  }
  return null;
}
