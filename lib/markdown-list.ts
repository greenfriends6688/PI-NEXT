/**
 * fork:pr13-composer —— 编辑器换行时的 Markdown 结构续行。
 *
 * 把当前行开头的结构前缀原样带到新行：无序列表（`-` / `*` / `+`）、有序列表
 * `1.` / `1)`（序号递增，`01.` 补零）、中文顿号 `1、`、task 复选框（重置为
 * `[ ]`）、引用 `>`（支持嵌套 `>>`），以及「缩进 + 引用 + 列表 + 复选框」的组合。
 * 当前行没有结构前缀时返回 `null`，让调用方走原生换行。
 *
 * 三条「不续行」的规则（从上游 `lib/markdown-list-continuation.ts` 移植，
 * fork:markdown-continuation · G10 #884）：
 *   · **thematic break**：`---` / `***` / `___` 与 `* * *` 不是列表（分隔线不续行）；
 *   · **代码围栏**：光标在 ``` / ~~~ 围栏里时整段都不续（那是代码，不是 Markdown）；
 *   · **分隔符宽度与缩进原样保留**：`-   项目` 的下一项还是三个空格，`  - 项目`
 *     下一项还是两格缩进。
 *
 * 绑定在哪个键上由 ChatInput 决定（默认 Shift+Enter；把发送键改成 Ctrl+Enter
 * 之后，纯 Enter 也走这里）。纯函数，方便单测。
 */

export interface MarkdownContinuation {
  value: string;
  caret: number;
}

interface ListItemPrefix {
  /** 行首缩进，原样带到下一行。 */
  indent: string;
  /** 无序列表的 `-` / `*` / `+`；有序列表为空串（序号走 number + delimiter）。 */
  marker: string;
  /** 有序列表的序号（含中文顿号写法）；无序列表为 null。 */
  number: string | null;
  /** 序号后面的分隔符：`.` / `)` / `、`；无序列表为空串。 */
  delimiter: string;
  /** 标记与内容之间的空白（可能是空串，`1、` 后直接跟文字），原样保留。 */
  spacing: string;
  /** 是 task 复选框项。 */
  task: boolean;
  /** 结构前缀的总长度。 */
  length: number;
}

const BULLET_ITEM = /^([ \t]*)([-*+])([ \t]+)(\[[ xX]\](?:[ \t]+|$))?/;
const ORDERED_ITEM = /^([ \t]*)(\d{1,9})([.)])([ \t]+)(\[[ xX]\](?:[ \t]+|$))?/;
/** `1、` 是中文里最常见的编号写法，且常常不带空格。位数限制在 3 以内，
 *  这样「2020、2021年」不会被当成列表。 */
const CJK_ORDERED_ITEM = /^([ \t]*)(\d{1,3})(、)([ \t]*)/;
const THEMATIC_BREAK = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const CODE_FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const QUOTE_MARKER = /^(?:>\s*)+/;

function parseListItemPrefix(text: string): ListItemPrefix | null {
  if (THEMATIC_BREAK.test(text)) return null;
  const bullet = BULLET_ITEM.exec(text);
  if (bullet) {
    return {
      indent: bullet[1],
      marker: bullet[2],
      number: null,
      delimiter: "",
      spacing: bullet[3],
      task: bullet[4] !== undefined,
      length: bullet[0].length,
    };
  }
  const ordered = ORDERED_ITEM.exec(text) ?? CJK_ORDERED_ITEM.exec(text);
  if (!ordered) return null;
  return {
    indent: ordered[1],
    marker: "",
    number: ordered[2],
    delimiter: ordered[3],
    spacing: ordered[4],
    task: ordered[5] !== undefined,
    length: ordered[0].length,
  };
}

/** 光标所在行之前有没有没关掉的代码围栏（``` 或 ~~~，同类且不短于开围栏的才算关）。 */
function isInsideFencedCode(textBeforeLine: string): boolean {
  let openFence: string | null = null;
  for (const line of textBeforeLine.split("\n")) {
    const fence = CODE_FENCE.exec(line)?.[1];
    if (!fence) continue;
    if (openFence === null) {
      openFence = fence;
    } else if (
      fence[0] === openFence[0] &&
      fence.length >= openFence.length &&
      line.trim() === fence
    ) {
      openFence = null;
    }
  }
  return openFence !== null;
}

function nextListItemPrefix(item: ListItemPrefix): string {
  const marker = item.number === null
    ? item.marker
    : `${String(Number(item.number) + 1).padStart(item.number.length, "0")}${item.delimiter}`;
  return `${item.indent}${marker}${item.spacing}${item.task ? "[ ] " : ""}`;
}

export function continueMarkdownList(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownContinuation | null {
  // 重发换行时先按「选区被替换」处理，光标基点是选区起点。
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const effective = end > start
    ? value.slice(0, start) + value.slice(end)
    : value;

  const lineStart = effective.lastIndexOf("\n", start - 1) + 1;
  const line = effective.slice(lineStart, start);

  const indent = line.match(/^\s*/)?.[0] ?? "";
  let rest = line.slice(indent.length);
  const quotes = rest.match(QUOTE_MARKER)?.[0] ?? "";
  rest = rest.slice(quotes.length);

  // 围栏判定放在最前：代码块里的 `- ` 不是列表。
  if (isInsideFencedCode(effective.slice(0, lineStart))) return null;

  const list = parseListItemPrefix(rest);

  if (!quotes && !list) return null;

  // 空列表项 = 结束结构：整段前缀删掉，光标回到行首（VS Code / Typora 行为）。
  // `prefix` 是这一行**原样**的前缀文本（缩进 + 引用 + 列表标记），内容从它之后算起。
  const prefix = indent + quotes + (list ? rest.slice(0, list.length) : "");
  if (line.slice(prefix.length).trim() === "") {
    return {
      value: effective.slice(0, lineStart) + effective.slice(lineStart + prefix.length),
      caret: lineStart,
    };
  }

  // 非空项：在新行重发前缀 —— 有序序号 +1（补零对齐），task 复选框重置为未勾选。
  const insert = `\n${indent}${quotes}${list ? nextListItemPrefix(list) : ""}`;
  return {
    value: effective.slice(0, start) + insert + effective.slice(start),
    caret: start + insert.length,
  };
}