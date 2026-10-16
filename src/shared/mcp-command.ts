/**
 * The other way a server arrives: a command somebody copied out of a README.
 *
 * A server's own instructions almost never give you JSON. They give you a line to paste —
 * `claude mcp add docs -- npx -y @acme/mcp`, `codex mcp add docs --url https://…`,
 * `code mcp-add '{"name":…}'` — and the person reading them has to translate. This module
 * does the translation instead, so the settings pane can take either.
 *
 * It is deliberately a *reader*, not an executor: nothing here runs the command, and the
 * result goes through the same `serverFromEntry` validation a pasted JSON entry does. A line
 * this file does not recognise is not an error to shout about — the caller falls back to
 * saying it could not read it, exactly as it would for malformed JSON.
 *
 * One thing it does say out loud: a pasted command is where a bearer token usually rides
 * (`--header "Authorization: Bearer sk-…"`), and a paste came from somewhere. A literal
 * secret is reported so the pane can warn before it is stored.
 */

export type McpCommandResult = {
  /** The server the command describes, in the `mcpServers` shape, or null when unreadable. */
  entry: { name: string; config: Record<string, unknown> } | null;
  /** Why it could not be read, when `entry` is null. */
  reason?: string;
  /** True when a value in the command looks like a credential rather than a placeholder. */
  literalSecret: boolean;
};

/**
 * Split a command line into words, honouring quotes.
 *
 * Shell quoting only, no expansion: `$HOME` stays `$HOME` and a backslash keeps whatever it
 * precedes. Enough for the argument lists these commands carry, and safe to run on text
 * nobody has executed.
 */
export function splitCommandLine(text: string): string[] {
  const words: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (quote) {
      if (character === quote) quote = null;
      else if (character === "\\" && quote === '"' && index + 1 < text.length) current += text[++index]!;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) words.push(current);
      current = "";
      started = false;
      continue;
    }
    current += character;
    started = true;
  }
  if (started) words.push(current);
  return words;
}

/** `KEY=value` pairs from repeated flags, the way every one of these CLIs takes them. */
function pairs(words: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const word of words) {
    const separator = word.indexOf("=");
    if (separator <= 0) continue;
    out[word.slice(0, separator)] = word.slice(separator + 1);
  }
  return out;
}

/** `"Name: value"` header flags, keeping everything after the first colon. */
function headers(words: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const word of words) {
    const separator = word.indexOf(":");
    if (separator <= 0) continue;
    const name = word.slice(0, separator).trim();
    const value = word.slice(separator + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

const SECRET_HINTS = [/\bsk-[A-Za-z0-9_-]{8,}/, /\bgh[pousr]_[A-Za-z0-9]{16,}/, /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/];

/** Whether any value in a command looks like a credential written out in full. */
function hasLiteralSecret(config: Record<string, unknown>): boolean {
  const values: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") values.push(value);
    else if (Array.isArray(value)) for (const item of value) collect(item);
    else if (value && typeof value === "object") for (const item of Object.values(value)) collect(item);
  };
  collect(config);
  return values.some((value) => SECRET_HINTS.some((pattern) => pattern.test(value)));
}

/** Everything after `--`, which is how these CLIs separate their own flags from the command. */
function afterDashDash(words: string[]): string[] {
  const at = words.indexOf("--");
  return at === -1 ? [] : words.slice(at + 1);
}

function stdioOrHttp(name: string, command: string, args: string[], env: Record<string, string>, header: Record<string, string>, transport?: string): McpCommandResult["entry"] {
  const url = /^https?:\/\//i.test(command) || transport === "http" || transport === "sse";
  const config: Record<string, unknown> = url
    ? { type: "http", url: command, ...(Object.keys(header).length ? { headers: header } : {}) }
    : { command, ...(args.length ? { args } : {}), ...(Object.keys(env).length ? { env } : {}) };
  return { name, config };
}

/**
 * Read one pasted command.
 *
 * The verbs are the four an MCP README actually uses; anything else is `null` rather than a
 * guess, because a wrong guess would store a server that then fails to connect for a reason
 * nobody can see.
 */
export function parseMcpCommand(text: string): McpCommandResult {
  const words = splitCommandLine(text.trim());
  if (words.length === 0) return { entry: null, literalSecret: false };
  // A command may be prefixed with a runner (`npx -y …`, `pnpm dlx …`); find the CLI itself.
  const start = words.findIndex((word) => /^(claude|codex|pi|gemini)$/.test(word.split("/").pop() ?? ""));
  const cli = start === -1 ? null : (words[start]!.split("/").pop() as string);
  const rest = start === -1 ? [] : words.slice(start + 1);

  if (cli && rest[0] === "mcp" && rest[1] === "add-json") {
    const name = rest[2];
    const json = rest.slice(3).find((word) => word.trim().startsWith("{"));
    if (!name || !json) return { entry: null, literalSecret: false, reason: "add-json needs a name and a JSON object" };
    try {
      const parsed = JSON.parse(json) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      return { entry: { name, config: parsed as Record<string, unknown> }, literalSecret: hasLiteralSecret(parsed as Record<string, unknown>) };
    } catch {
      return { entry: null, literalSecret: false, reason: "the JSON in add-json could not be read" };
    }
  }

  if (cli && rest[0] === "mcp" && rest[1] === "add") {
    const tail = rest.slice(2);
    const env: string[] = [];
    const header: string[] = [];
    let transport: string | undefined;
    let url: string | undefined;
    const positional: string[] = [];
    for (let index = 0; index < tail.length; index++) {
      const word = tail[index]!;
      if (word === "--") {
        positional.push(...tail.slice(index + 1));
        break;
      }
      if (word === "--env" || word === "-e") env.push(tail[++index] ?? "");
      else if (word === "--header" || word === "-H") header.push(tail[++index] ?? "");
      else if (word === "--transport" || word === "-t") transport = tail[++index];
      else if (word === "--url") url = tail[++index];
      else if (word === "--scope" || word === "-s") index++;
      else if (word.startsWith("--")) continue;
      else positional.push(word);
    }
    const [name, command, ...args] = positional;
    if (!name) return { entry: null, literalSecret: false, reason: "no server name" };
    if (!command && !url) return { entry: null, literalSecret: false, reason: "no command or URL" };
    const entry = stdioOrHttp(name, (url ?? command)!, url ? args : args, pairs(env), headers(header), url ? "http" : transport);
    return { entry, literalSecret: entry ? hasLiteralSecret(entry.config) : false };
  }

  // VS Code and its forks: `code --add-mcp '{"name":"x","command":"y"}'`, or `--add-mcp={…}`.
  // Read off the raw text rather than the split words: a JSON object is mostly quotes, and
  // the tokenizer is doing shell quoting — `--add-mcp={"name":"x"}` would lose them all.
  const addMcp = /--add-mcp(?:=|\s+)(?<json>[\s\S]+)/.exec(text);
  if (addMcp?.groups?.json) {
    // A shell-quoted payload arrives with its quotes; JSON inside may be wrapped in
    // either, so strip only a matching pair at the very ends.
    const raw = addMcp.groups.json.trim();
    const quote = raw[0];
    const inline = (quote === "'" || quote === '"') && raw.endsWith(quote) ? raw.slice(1, -1) : raw;
    if (!inline) return { entry: null, literalSecret: false, reason: "--add-mcp needs a JSON object" };
    try {
      const parsed = JSON.parse(inline) as Record<string, unknown>;
      const name = typeof parsed.name === "string" ? parsed.name : "";
      if (!name) throw new Error("no name");
      const { name: _name, ...config } = parsed;
      const entry = { name, config };
      return { entry, literalSecret: hasLiteralSecret(config) };
    } catch {
      return { entry: null, literalSecret: false, reason: "--add-mcp could not be read as JSON" };
    }
  }

  return { entry: null, literalSecret: false };
}

/** Whether a paste is worth handing to `parseMcpCommand` at all. */
export function looksLikeMcpCommand(text: string): boolean {
  const source = text.trim();
  if (source.startsWith("{") || source.startsWith("[")) return false;
  if (source.length === 0 || source.includes("\n")) return source.split("\n").length <= 4 && /\bmcp\b/.test(source);
  return /\bmcp\b/.test(source);
}
