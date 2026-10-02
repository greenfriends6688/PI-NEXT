/**
 * fork:proma-34-mention — 引用触发符的防误触发边界（纯函数，无 lookbehind）。
 *
 * `@` / `/` / `#` / `&` / `~` 既是引用菜单的触发符，也是普通文本里的常见字符：
 * URL（`https://…`）、邮箱（`foo@bar.com`）、绝对路径（`/usr/bin`）、色值
 * （`#fff` / `#a1b2c3`）、HTML 实体（`&#39;` / `&amp;`）、Markdown 标题行
 * （`# 标题`）都不该弹菜单。Proma 是踩了坑（v0.16.9）才补的这层判断。
 *
 * Safari 16.4 以下解析不了 lookbehind，而一个解析不了的正则字面量会让整个 chunk
 * 抛 SyntaxError（#753）。所以这里不用 lookbehind：先在触发符处定位 token 的边界，
 * 再用普通正则整段判断（与 `lib/markdown.ts` 的 `replaceNotPrecededBy` 同一思路）。
 */

export interface MentionTriggerInput {
  /** 触发符所在的那段文本（输入框里就是光标前的全部文本）。 */
  text: string;
  /** 触发符在 `text` 中的下标。 */
  triggerOffset: number;
  /** 触发符本身：`@` / `/` / `#` / `&` / `~`（全角 `～` 视作 `~`）。 */
  trigger: string;
  /** 代码块 / 行内代码里一律不弹菜单。 */
  isCodeContext?: boolean;
}

interface MentionTokenBounds {
  start: number;
  end: number;
  text: string;
}

/** 触发符所在 token 的边界：以空白为界，token 含触发符本身。 */
function getMentionToken(text: string, triggerOffset: number): MentionTokenBounds | null {
  if (triggerOffset < 0 || triggerOffset >= text.length) return null;

  const before = text.slice(0, triggerOffset);
  const start = Math.max(
    before.lastIndexOf(" "),
    before.lastIndexOf("\n"),
    before.lastIndexOf("\r"),
    before.lastIndexOf("\t"),
  ) + 1;
  const after = text.slice(triggerOffset);
  const whitespaceOffset = after.search(/\s/);
  const end = whitespaceOffset === -1 ? text.length : triggerOffset + whitespaceOffset;

  return { start, end, text: text.slice(start, end) };
}

/**
 * URL 里的 `/`、`#`、`@`、`&` 都是合法字符，不能当成引用菜单的触发符。
 * 覆盖带 scheme 的 URL（http/https/ssh/git/file…）与 Git 常见的 SCP 风格地址。
 */
export function isMentionTriggerInsideUrl(text: string, triggerOffset: number): boolean {
  const token = getMentionToken(text, triggerOffset);
  if (!token) return false;

  const urlStart = token.text.search(/[A-Za-z][A-Za-z\d+.-]*:\/\//);
  if (urlStart !== -1) {
    return urlStart === 0 || !/[\p{L}\p{N}_-]/u.test(token.text[urlStart - 1] ?? "");
  }
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+:[^\s]*$/.test(token.text);
}

/**
 * 是否允许在这个位置弹出引用菜单。
 *
 * 只过滤有明确语义的文本语法；中文后直接输入 `/skill`、`#mcp` 这类快捷方式照常可用
 * （Proma 的 `shouldAllowMentionTrigger` 同款取舍）。
 */
export function shouldAllowMentionTrigger({
  text,
  triggerOffset,
  trigger,
  isCodeContext = false,
}: MentionTriggerInput): boolean {
  if (isCodeContext || isMentionTriggerInsideUrl(text, triggerOffset)) return false;

  const token = getMentionToken(text, triggerOffset);
  if (!token) return false;

  switch (trigger) {
    case "@":
      // 邮箱不应触发文件搜索；以 @ 开头的普通文件查询仍保持可用。
      // （刻意不照抄 Proma 的 npm scope 规则 `@scope/pkg`：本仓 `@src/chat.tsx`
      // 这类相对路径正是文件引用，套上就会把最常见的一条命中吞掉。）
      return !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*$/.test(token.text);
    case "/":
      // 单段 `/compact`、`/skill` 保持可用；仅抑制明确的相对、home、驱动器、UNC 或多段绝对路径。
      return !(
        /^[~～][\\/]/.test(token.text)
        || /^\.\.?\//.test(token.text)
        || /^[A-Za-z]:[\\/]/.test(token.text)
        || /^\/\//.test(token.text)
        || /^\/(?:Applications|Library|System|Users|Volumes|bin|boot|data|dev|etc|home|media|mnt|opt|private|proc|root|run|srv|sys|tmp|usr|var)(?:\/|$)/.test(token.text)
        || /^\/[^/\s]+\//.test(token.text)
      );
    case "#":
      // Markdown 标题（`# 标题`）、Issue 号（`#123`）、色值（`#fff` / `#a1b2c3`）
      // 与 HTML 实体（`&#39;`）直接抑制。
      return !(
        /^#\s/.test(text.slice(triggerOffset))
        || /^#\d+$/.test(token.text)
        || /^#[0-9a-f]{3,8}$/i.test(token.text)
        || /^&#(?:\d+|x[\da-f]+);$/i.test(token.text)
      );
    case "&":
      // HTML 实体（`&#39;` / `&amp;`）与逻辑与（`&&`）不是会话引用。
      return !(
        token.text.includes("&&")
        || /^&(?:amp|apos|gt|lt|nbsp|quot|#\d+|#x[\da-f]+);$/i.test(token.text)
      );
    case "~":
    case "～":
      return !/^[~～][\\/]/.test(token.text);
    default:
      return true;
  }
}
