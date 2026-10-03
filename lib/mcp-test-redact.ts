/**
 * fork:mcp-live-test —— 真连测试的**脱敏**部分，取自上游 `lib/mcp-test.ts` 的同款逻辑
 * （上游那份还带着队列与连接，这里只需要「输出怎么掩」）。
 *
 * 为什么单独拆出来：测试结果里的 error / stderr 是服务器原样吐回来的东西，里面可能带着
 * 用户自己写的密钥、命令与 URL 里的凭据。**先掩码、再截断** —— 反过来的话，一个被
 * 截断切一半的密钥就再也匹配不上了（`REDACT_WINDOW_CHARS` 的注释即此）。
 */
import type { McpServerConfig, McpTransport, PiSdkInternals } from "./pi-sdk-internals";
import { resolvedConfigValues } from "./mcp-config-values";
import {
  argSecretParts,
  commandSecretParts,
  isReferenceOnly,
  maskArgs,
  maskCommand,
  maskUrl,
  SECRET_MASK,
  urlSecretParts,
} from "./mcp-secrets";

interface Replacement {
  raw: string;
  shown: string;
  word: boolean;
}

const STDERR_TAIL_CHARS = 2_000;
/** The start of an error message a result keeps: a JSON-RPC error or an HTTP body may run to megabytes. */
const ERROR_MAX_CHARS = 2_000;
/**
 * How much of a message is masked before it is shortened: masking first means
 * a secret the cut would halve is still found whole. The transport keeps at
 * most 64 KiB of stderr; an error message is cut to this first.
 */
const REDACT_WINDOW_CHARS = 64 * 1024;
const TEXT_MAX_CHARS = 300;
/** Literal and resolved values shorter than this are not masked in messages: no secret is this short, and masking `1` or `true` would garble them. */
const MASK_MIN_LENGTH = 6;
/** The SDK's words before the text of a `!command` that failed (`resolveConfigValueOrThrow()`). */
const SHELL_COMMAND_QUOTE = "from shell command: ";

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The start of a message, masked and then shortened. */
function headOf(text: string, redact: (text: string) => string, max: number): string {
  return clip(redact(text.slice(0, REDACT_WINDOW_CHARS)), max);
}

/** The end of a stderr tail, masked and then shortened. */
function tailOf(text: string, redact: (text: string) => string, max: number): string {
  return redact(text.slice(-REDACT_WINDOW_CHARS)).slice(-max);
}

/** A status's `error`, as a test and a session's MCP host record it: masked, then its start. */
export function maskStatusError(text: string, redact: (text: string) => string): string {
  return headOf(text, redact, ERROR_MAX_CHARS);
}

/** A status's `stderr`, as a test and a session's MCP host record it: masked, then its end. */
export function maskStatusStderr(text: string, redact: (text: string) => string): string {
  return tailOf(text, redact, STDERR_TAIL_CHARS);
}

/** Whether connecting resolves a `!command`: in a stdio entry's env, an HTTP entry's headers or `oauth.clientSecret`. */
export function runsShellCommand(config: unknown, internals: Pick<PiSdkInternals, "isCommandConfigValue">): boolean {
  return resolvedConfigValues(config).some(({ value }) => internals.isCommandConfigValue(value));
}

// ---------------------------------------------------------------------------
// Masking what reaches the browser
// ---------------------------------------------------------------------------

const AUTHORIZATION_SCHEME = /^(?:bearer|basic|token)$/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One text to replace: everywhere, or (`word`) only where it is not part of a longer word. */
interface Replacement {
  raw: string;
  shown: string;
  word: boolean;
}

/**
 * Replaces, in a message or a stderr tail, what the masking rule keeps from
 * the browser: the text of a `!command` where the SDK quotes it, the literal
 * env and header values and `oauth.clientSecret`, what the transports resolved
 * them to (a token a `${VAR}` read), and the parts of the command, arguments
 * and URL that GET masks, also where one of them is quoted on its own (a key
 * from the URL's query, a userinfo password, the URL as `new URL()` spells it).
 * A server that echoes one is not trusted to keep it out of its own output,
 * nor out of the tool descriptions and server info it sends.
 *
 * A whole secret is replaced wherever it appears. Words split from a value
 * (`Bearer <token>`) are replaced only as words, so a short word of a command
 * or a phrase never garbles a longer one (`auth` in `authentication`). A
 * `!command`'s stderr is discarded by the SDK, so its text can only appear
 * where the SDK quotes it after `from shell command: `; elsewhere it is
 * replaced as a word from 6 characters, so `!env` never masks `env` in the
 * SDK's own `env "TOKEN"`.
 */
export function createTestRedactor(
  config: McpServerConfig,
  transports: readonly McpTransport[],
  internals: Pick<PiSdkInternals, "isCommandConfigValue">,
  /** Values resolved outside the transports, such as the `oauth.clientSecret` a sign-in resolved. */
  resolvedSecrets: readonly string[] = [],
): (text: string) => string {
  const replacements = new Map<string, Replacement>();
  const add = (raw: string, shown: string, word: boolean) => {
    const existing = replacements.get(raw);
    // A text found both ways is replaced everywhere.
    if (!existing || (existing.word && !word)) replacements.set(raw, { raw, shown, word });
  };
  const secret = (value: string | undefined) => {
    if (value === undefined) return;
    const trimmed = value.trim();
    if (trimmed.length >= MASK_MIN_LENGTH) add(trimmed, SECRET_MASK, false);
    // `Bearer <token>`: the token alone may be echoed.
    for (const word of trimmed.split(/\s+/)) {
      if (word !== trimmed && word.length >= MASK_MIN_LENGTH && !AUTHORIZATION_SCHEME.test(word)) add(word, SECRET_MASK, true);
    }
  };
  const masked = (raw: string, shown: { value: string; masked: boolean }) => {
    if (shown.masked && raw.length >= MASK_MIN_LENGTH) add(raw, shown.value, false);
  };
  for (const { value } of resolvedConfigValues(config)) {
    if (internals.isCommandConfigValue(value)) {
      const text = value.slice(1);
      if (text.trim()) add(`${SHELL_COMMAND_QUOTE}${text}`, `${SHELL_COMMAND_QUOTE}${SECRET_MASK}`, false);
      if (text.trim().length >= MASK_MIN_LENGTH) add(text.trim(), SECRET_MASK, true);
    } else if (!isReferenceOnly(value)) {
      secret(value);
    }
  }
  const resolved = transports.map((transport) =>
    (transport as { options?: { env?: Record<string, string>; headers?: Record<string, string> } }).options ?? {});
  if ("url" in config) {
    for (const options of resolved) for (const value of Object.values(options.headers ?? {})) secret(value);
    masked(config.url, maskUrl(config.url));
    try {
      // `new URL()` adds the `/` of an empty path and lowercases the host, and messages quote it that way.
      const href = new URL(config.url).href;
      if (href !== config.url) masked(href, maskUrl(href));
    } catch {
      // Not a URL the SDK could have fetched; the raw text is all a message can quote.
    }
    for (const part of urlSecretParts(config.url)) secret(part);
  } else {
    // Only the entry's own names: the rest of a stdio server's environment is the host's, sanitized.
    for (const options of resolved) for (const name of Object.keys(config.env ?? {})) secret(options.env?.[name]);
    masked(config.command, maskCommand(config.command));
    for (const part of commandSecretParts(config.command)) secret(part);
    const args = config.args ?? [];
    const shown = maskArgs(args).args;
    args.forEach((arg, index) => masked(arg, { value: shown[index] ?? SECRET_MASK, masked: shown[index] !== arg }));
    for (const part of argSecretParts(args)) secret(part);
  }
  for (const value of resolvedSecrets) secret(value);
  // Longest first, so a value is never left half replaced by a shorter one inside it.
  const ordered = [...replacements.values()]
    .sort((a, b) => b.raw.length - a.raw.length)
    .map(({ raw, shown, word }) => ({ shown, raw, word }));
  return (text) => ordered.reduce((current, { shown, raw, word }) => (
    word ? replaceWholeWord(current, raw, shown) : current.split(raw).join(shown)
  ), text);
}

/**
 * 整词替换：两侧是「词字符」时不动（`raw` 是更长单词的一部分）。
 *
 * fork:no-regex-lookbehind（2026-10-02）—— 上游这里写的是
 * `(?<![A-Za-z0-9_])${raw}(?![A-Za-z0-9_])`。**lookbehind 在 Safari 16.4 以下解析不了**，
 * 一个正则字面量解析失败就是整个 chunk 报错、老 Safari 首页白屏（AGENTS.md #753 与
 * `lib/no-regex-lookbehind.test.mjs` 守着的那条）。所以改成扫描式：自己判断两端的字符。
 */
function replaceWholeWord(text: string, raw: string, shown: string): string {
  if (raw === "") return text;
  let result = "";
  let copied = 0;
  let index = text.indexOf(raw);
  while (index !== -1) {
    const before = index > 0 ? text[index - 1] : "";
    const after = text[index + raw.length] ?? "";
    const isWordChar = (character: string) => character !== "" && /[A-Za-z0-9_]/.test(character);
    if (!isWordChar(before) && !isWordChar(after)) {
      result += text.slice(copied, index) + shown;
      copied = index + raw.length;
    }
    index = text.indexOf(raw, index + 1);
  }
  return copied === 0 ? text : result + text.slice(copied);
}
