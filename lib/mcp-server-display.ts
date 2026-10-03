/**
 * fork:mcp-paste —— 粘贴预览要用的两个纯函数（取自上游 `lib/mcp-server-display.ts`：
 * 不可见字符要转义显示、命令行要按需加引号），因为它们只吃字符串、不碰上游的响应形状。
 *
 * 上游那个文件里其余的函数（`mcpServerTarget` / `mcpServerHasHiddenCharacters` /
 * `mcpVariableReferencesKey` / `mcpFieldLabel` / `mcpFileProblemDetail`）是给它**列表页**
 * 用的，依赖它的 `McpServerInfo` 里 `transport` / `headerNames` / `cwd` 那几个字段 —— 本仓
 * 的条目形状没有，搬进来只能改签名、改完也没人调，所以不搬。
 */
import { SECRET_MASK } from "./mcp-secrets";

/** 不可见字符、控制字符与怪空格：用户贴进来的原文可能带这些，显示时要转义。 */
const HIDDEN_CHARACTERS: Record<string, string> = {
  "\u0000": "\\0", "\b": "\\b", "\t": "\\t", "\n": "\\n",
  "\r": "\\r", "\f": "\\f", "\v": "\\v",
};
const HIDDEN_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f\u00a0\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff]/;

export function hasHiddenCharacters(text: string): boolean {
  return HIDDEN_CHARACTER_PATTERN.test(text);
}

/** 把不可见字符显示成 `\u{XXXX}`，其余原样。 */
export function revealHiddenCharacters(text: string): string {
  return text.replace(HIDDEN_CHARACTER_PATTERN, (character) => {
    const named = HIDDEN_CHARACTERS[character];
    if (named) return named;
    const code = character.codePointAt(0);
    return code === undefined ? character : `\\u{${code.toString(16).toUpperCase().padStart(4, "0")}}`;
  });
}

function needsQuotes(argument: string): boolean {
  return argument === "" || /[\s"'`$\\]/.test(argument) || hasHiddenCharacters(argument);
}

/** 逐个参数按需加引号，拼成一条用户能核对、也确实是这么跑的命令行。 */
export function formatMcpCommandLine(command: string, args: readonly string[] = []): string {
  const show = (argument: string) => (needsQuotes(argument) ? `"${argument.replace(/"/g, '\\"')}"` : argument);
  return [command, ...args].map(show).join(" ");
}
