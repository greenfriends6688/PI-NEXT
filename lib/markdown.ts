import type { Content, Link, Parent, Root } from "mdast";
import { defaultUrlTransform, type Options as ReactMarkdownOptions } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
// fork:pi-1.1（上游 6d4d6b5b8 / #1072）—— 中文标点旁的 **粗体** / *斜体*。
// CommonMark 在「中文句末标点后直接接下一句」时会把星号原样露出，这个 parse-only 扩展修它。
// 已确认依赖内无 lookbehind（#753 旧 Safari 不受影响）。
import remarkCjkFriendly from "remark-cjk-friendly/parseOnly";
import remarkMath from "remark-math";
import type { Extension } from "micromark-util-types";
import type { Plugin } from "unified";

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
  },
  strip: [...(defaultSchema.strip || []), "iframe", "object", "style", "form"],
};

export function markdownUrlTransform(value: string): string {
  return /^file:/i.test(value) ? value : defaultUrlTransform(value);
}

/**
 * `value.replace(pattern, replace)` —— 等价于 `pattern` 前面带一个
 * `(?<![notAfter])` 的 lookbehind：匹配必须以 `opener` 开头，且前一个字符不属于
 * `notAfter`。Safari 16.4 以下解析不了 lookbehind，而一个解析不了的正则字面量会让
 * **整个 chunk** 抛 SyntaxError（首页直接白屏，#753）。所以改成：按 lookbehind 版本
 * 尝试起点的顺序，在每个 `opener` 处用 sticky(`y`) 模式试一次，前一个字符命中排除集
 * 就跳过。
 */
function replaceNotPrecededBy(
  value: string,
  opener: string,
  notAfter: string,
  pattern: RegExp,
  replace: (match: RegExpExecArray) => string,
): string {
  let result = "";
  let copied = 0;
  for (let index = value.indexOf(opener); index !== -1; index = value.indexOf(opener, index + 1)) {
    if (index > 0 && notAfter.includes(value[index - 1])) continue;
    pattern.lastIndex = index;
    const match = pattern.exec(value);
    if (!match) continue;
    result += value.slice(copied, index) + replace(match);
    copied = pattern.lastIndex;
    index = copied - 1;
  }
  return result + value.slice(copied);
}

// 收尾反引号前不能是 `\` 或另一个反引号，所以内容以「两者都不是」的字符收尾。
const escapedInlineCodePattern = /`((?:[^`\n]|\\`)*?[^\\`\n])`(?!`)/y;

function rewriteEscapedInlineCodeBackticks(line: string): string {
  return replaceNotPrecededBy(line, "`", "\\`", escapedInlineCodePattern, ([match, content]) => {
    const code = content.replace(/\\`/g, "`");
    if (code === content) return match;
    const marker = "`".repeat(Math.max(...(code.match(/`+/g)?.map((run) => run.length) ?? [0])) + 1);
    return `${marker}${code}${marker}`;
  });
}

export function normalizeDisplayMath(markdown: string): string {
  const lineBreak = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const normalized: string[] = [];
  let fence: { marker: string; size: number } | null = null;
  let inlineCodeMarkerSize = 0;
  let rawCodeTag: string | null = null;
  const unmatchedDisplayMathUntil = new Map<string, number>();

  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];

    if (rawCodeTag) {
      normalized.push(line);
      if (new RegExp(`</${rawCodeTag}\\s*>`, "i").test(line)) rawCodeTag = null;
      continue;
    }

    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const size = fenceMatch[1].length;
      if (!fence) fence = { marker, size };
      else if (marker === fence.marker && size >= fence.size) fence = null;
      inlineCodeMarkerSize = 0;
      normalized.push(line);
      continue;
    }

    if (fence) {
      normalized.push(line);
      continue;
    }

    const rawCodeOpen = line.match(/<(code|pre|script|style)\b/i);
    if (rawCodeOpen) {
      const tag = rawCodeOpen[1].toLowerCase();
      const remainder = line.slice((rawCodeOpen.index ?? 0) + rawCodeOpen[0].length);
      if (!new RegExp(`</${tag}\\s*>`, "i").test(remainder)) rawCodeTag = tag;
      inlineCodeMarkerSize = 0;
      normalized.push(line);
      continue;
    }

    if (/^(?: {4}|\t)/.test(line) || line.trim() === "") {
      inlineCodeMarkerSize = 0;
      normalized.push(line);
      continue;
    }

    if (!inlineCodeMarkerSize) line = rewriteEscapedInlineCodeBackticks(line);

    if (inlineCodeMarkerSize || line.includes("`")) {
      inlineCodeMarkerSize = updateInlineCodeMarker(line, inlineCodeMarkerSize);
      normalized.push(line);
      continue;
    }

    const bracketDisplayOneLine = line.match(/^([ ]{0,3})\\\[[ \t]*(.+?)[ \t]*\\\][ \t]*$/);
    if (bracketDisplayOneLine) {
      const math = bracketDisplayOneLine[2].trim();
      if (math) {
        // Keep the content line indented together with the `$$` fence. When the
        // formula is nested inside a GFM list item (indented `$$`), a content line
        // at column 0 becomes a "lazy continuation" line, which makes remark-math
        // mis-parse the fence pair: the opening `$$` turns into an empty math node
        // and the closing one swallows the rest of the document as math content.
        normalized.push(
          `${bracketDisplayOneLine[1]}$$`,
          `${bracketDisplayOneLine[1]}${math}`,
          `${bracketDisplayOneLine[1]}$$`,
        );
        continue;
      }
    }

    const looseBracketDisplayOneLine = line.match(/^([ ]{0,3})\[[ \t]*(.+?)[ \t]*\][ \t]*$/);
    if (looseBracketDisplayOneLine) {
      const math = looseBracketDisplayOneLine[2].trim();
      if (isLikelyMathExpression(math)) {
        normalized.push(
          `${looseBracketDisplayOneLine[1]}$$`,
          `${looseBracketDisplayOneLine[1]}${math}`,
          `${looseBracketDisplayOneLine[1]}$$`,
        );
        continue;
      }
    }

    const bracketDisplayStart = line.match(/^([ ]{0,3})\\\[[ \t]*$/);
    if (bracketDisplayStart) {
      const closingIndex = findBracketDisplayClose(lines, index + 1);
      if (closingIndex !== -1) {
        // Same lazy-continuation guard as above: indent content lines that sit at
        // column 0 so the block stays parseable when nested inside a list item.
        normalized.push(
          `${bracketDisplayStart[1]}$$`,
          ...lines.slice(index + 1, closingIndex).map((mathLine) =>
            indentDisplayMathContent(mathLine, bracketDisplayStart[1]),
          ),
          `${bracketDisplayStart[1]}$$`,
        );
        index = closingIndex;
        continue;
      }
    }

    const displayMathMatch = line.match(/^([ \t]{0,3})\$\$(.+)\$\$[ \t]*$/);
    if (displayMathMatch) {
      const math = displayMathMatch[2].trim();
      if (math) {
        // See the comment on bracketDisplayOneLine: without matching indentation,
        // a formula nested in a GFM list item is mis-parsed by remark-math and the
        // text after the formula renders as a garbled KaTeX error block.
        normalized.push(
          `${displayMathMatch[1]}$$`,
          `${displayMathMatch[1]}${math}`,
          `${displayMathMatch[1]}$$`,
        );
        continue;
      }
    }

    // remark-math requires both `$$` delimiters to sit on their own lines, but
    // models also emit display math as a multi-line block where the opening `$$`
    // is glued to the first formula line and/or the closing `$$` is glued to the
    // end of the last one (`$$x = 1` + `y = 2$$`). Without normalization such a
    // block swallows the following text as math content and renders as garbage.
    const displayMathMultiLine = line.match(/^([ \t]{0,3})\$\$(.+)$/);
    if (displayMathMultiLine) {
      const indent = displayMathMultiLine[1];
      const firstLine = displayMathMultiLine[2].trimEnd();
      // Only treat this as a block opener if no other `$$` is embedded mid-line
      // (e.g. `$$x$$ and text` stays untouched and is rendered as inline math).
      if (firstLine && !firstLine.includes("$$")) {
        const closing = findDisplayMathClose(
          lines,
          index + 1,
          indent,
          unmatchedDisplayMathUntil,
        );
        if (closing) {
          normalized.push(`${indent}$$`, `${indent}${firstLine}`);
          for (let j = index + 1; j < closing.index; j++) {
            normalized.push(indentDisplayMathContent(lines[j], indent));
          }
          if (closing.content) normalized.push(`${indent}${closing.content}`);
          normalized.push(`${indent}$$`);
          index = closing.index;
          continue;
        }
      }
    }

    // Bare `$$` opener (possibly indented inside a GFM list item). Two problems
    // need fixing: (1) when the closing `$$` is glued to the last content line
    // (e.g. `z = w$$`) remark-math never finds a valid closing fence and swallows
    // the rest of the document; (2) inside a list item, content lines at column 0
    // are lazy continuations that break the math flow. Both are fixed by moving
    // the closing `$$` to its own line and re-indenting lazy content lines.
    // A column-0 block with a properly detached closing `$$` is left untouched
    // (remark-math already parses it correctly).
    const displayMathBareOpen = line.match(/^([ \t]{0,3})\$\$\s*$/);
    if (displayMathBareOpen) {
      const indent = displayMathBareOpen[1];
      const closing = findDisplayMathClose(
        lines,
        index + 1,
        indent,
        unmatchedDisplayMathUntil,
      );
      if (closing && (closing.glued || indent !== "")) {
        normalized.push(`${indent}$$`);
        for (let j = index + 1; j < closing.index; j++) {
          normalized.push(indentDisplayMathContent(lines[j], indent));
        }
        if (closing.content) normalized.push(`${indent}${closing.content}`);
        normalized.push(`${indent}$$`);
        index = closing.index;
        continue;
      }
    }

    normalized.push(normalizeInlineLatexMath(line));
  }

  return normalized.join(lineBreak);
}

interface DisplayMathClose {
  index: number;
  content: string;
  glued: boolean;
}

function findDisplayMathClose(
  lines: string[],
  startIndex: number,
  indent: string,
  unmatchedUntil: Map<string, number>,
): DisplayMathClose | null {
  const knownUnmatchedUntil = unmatchedUntil.get(indent);
  if (knownUnmatchedUntil !== undefined && startIndex < knownUnmatchedUntil) return null;

  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index];
    if (isDisplayMathFence(line, indent)) return { index, content: "", glued: false };

    // A new Markdown block cannot belong to the preceding formula. In particular,
    // do not let a later sibling list item provide a closing `$$` for this block.
    if (isDisplayMathBlockBoundary(line) || isDisplayMathOpeningLine(line)) {
      unmatchedUntil.set(indent, index);
      return null;
    }

    const content = getDisplayMathGluedCloseContent(line, indent);
    if (content !== null) return { index, content, glued: true };
  }

  // Multiple unmatched glued openers with the same indentation previously each
  // scanned to EOF. Cache this range so the overall search remains linear.
  unmatchedUntil.set(indent, lines.length);
  return null;
}

function isDisplayMathFence(line: string, indent: string): boolean {
  if (indent === "") return /^ {0,3}\$\$\s*$/.test(line);
  return line.startsWith(indent) && /^\$\$\s*$/.test(line.slice(indent.length));
}

function getDisplayMathGluedCloseContent(line: string, indent: string): string | null {
  if (!line.startsWith(indent)) return null;

  const match = line.slice(indent.length).match(/^(.+?)\$\$\s*$/);
  if (!match) return null;

  const content = match[1].trimEnd();
  return content && !content.includes("$$") ? content : null;
}

function isDisplayMathOpeningLine(line: string): boolean {
  return /^ {0,3}\$\$(?:\S|[ \t]+\S)/.test(line);
}

function isDisplayMathBlockBoundary(line: string): boolean {
  return (
    /^ {0,3}(`{3,}|~{3,})/.test(line) ||
    /^[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/.test(line) ||
    /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line) ||
    /^ {0,3}>/.test(line) ||
    /<(code|pre|script|style)\b/i.test(line)
  );
}

function indentDisplayMathContent(line: string, indent: string): string {
  if (!indent || !line || line.startsWith("\t")) return line;

  const leadingSpaces = line.match(/^ */)?.[0].length ?? 0;
  if (leadingSpaces >= indent.length) return line;
  return `${indent.slice(leadingSpaces)}${line}`;
}

function findBracketDisplayClose(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index];
    if (/^ {0,3}\\\][ \t]*$/.test(line)) return index;

    // Do not pair delimiters across another Markdown block boundary.
    if (
      /^ {0,3}(`{3,}|~{3,})/.test(line) ||
      /^ {0,3}\\\[[ \t]*$/.test(line) ||
      /<(code|pre|script|style)\b/i.test(line)
    ) {
      return -1;
    }
  }

  return -1;
}

function updateInlineCodeMarker(line: string, initialMarkerSize: number): number {
  let markerSize = initialMarkerSize;
  for (let cursor = 0; cursor < line.length;) {
    if (line[cursor] !== "`") {
      cursor++;
      continue;
    }

    let end = cursor + 1;
    while (line[end] === "`") end++;
    const runSize = end - cursor;
    if (markerSize === 0) markerSize = runSize;
    else if (runSize === markerSize) markerSize = 0;
    cursor = end;
  }
  return markerSize;
}

// `\(` … `\)`，且收尾的反斜杠本身未被转义。
const inlineLatexMathPattern = /\\\(([^`\r\n$]*?[^`\r\n$\\])\\\)/y;

function normalizeInlineLatexMath(line: string): string {
  if (
    /^\s{0,3}\[[^\]]+\]:/.test(line) ||
    /]\s*\(/.test(line) ||
    /<(?:!--|\/?[A-Za-z][^>]*>)/.test(line) ||
    /\b(?:https?|file|mailto):/i.test(line) ||
    /\b[A-Za-z]:\\/.test(line)
  ) {
    return line;
  }

  // `\(` … `\)` → `$…$`。
  return replaceNotPrecededBy(line, "\\(", "\\", inlineLatexMathPattern, ([match, math]) =>
    math.trim() ? `$${math}$` : match,
  );
}

function isLikelyMathExpression(value: string): boolean {
  return /\\[A-Za-z]+/.test(value) && !/\b(?:https?|file|mailto):|\b[A-Za-z]:\\|^\\\\/i.test(value);
}

// Parse YAML frontmatter into a `yaml` node before the math/GFM plugins run, so
// the raw metadata never leaks into the rendered output (without it, the opening
// `---` becomes an <hr> and the closing `---` turns the YAML into a setext heading).
// singleTilde:false requires ~~double~~ tildes for strikethrough. A single `~`
// is the standard CJK numeric-range separator (e.g. "5~7U", "100~200倍"), and
// GFM's default single-tilde strikethrough silently mangled such ranges (#385).
const remarkGfmOptions = { singleTilde: false } as const;

// GFM autolink literal（`https://…` / `www.…`）只在空白处收尾，行尾标点的裁剪也只认
// ASCII 标点，所以紧跟中文的 URL 会把后面的散文一起吞进去：`见 https://a.com/docs。`
// 变成一个 href 为 `https://a.com/docs%E3%80%82` 的链接，点进去哪儿也不是。
//
// 这是上游行为而不是 remark-gfm 的 bug：它跟 GitHub 走，GitHub 同样只在 ASCII 标点处
// 终止 autolink（remarkjs/remark-gfm#83 就以「非 ASCII 终止符」未计划结案，指向
// github/cmark-gfm#377 这个还没落地的规范请求）。在那之前在这里把 literal 切开：中日文里
// CJK 标点就是句子边界，所以 URL 仍可点、后面的字仍是正文。表意文字**刻意不**当边界，
// 这样 `https://zh.wikipedia.org/wiki/中文条目` 这种真 CJK 路径照常可用。
const cjkPunctuationPattern =
  /[\u3001\u3002\u3008-\u3011\u3014-\u301B\uFF01\uFF08\uFF09\uFF0C\uFF1A\uFF1B\uFF1F\u2018\u2019\u201C\u201D\u2013\u2014\u2026\u00B7\uFF5E\u301C]/;

/**
 * 把每个 GFM autolink literal 在**第一个** CJK 标点处切开，后半段还原成普通文本节点。
 *
 * `source` 必须是这棵树解析自的 markdown 原文。autolink literal 的 raw 源码**就是**它的
 * 文字，而手写的 `[text](url)` 的 raw 源码是 `[text](url)` —— 比对两者才能让显式链接原样
 * 保留，哪怕它的文字恰好等于它的 url。
 */
export function splitAutolinkLiteralsAtCjkPunctuation(tree: Root, source: string): void {
  const walk = (node: Root | Parent): void => {
    const children = node.children as Content[];
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      if (child.type === "link") splitAutolinkLiteral(children, index, child, source);
      const current = children[index];
      if ("children" in current && Array.isArray(current.children)) walk(current as Parent);
    }
  };
  walk(tree);
}

function splitAutolinkLiteral(siblings: Content[], index: number, node: Link, source: string): void {
  if (node.title != null || node.children.length !== 1) return;
  const textNode = node.children[0];
  if (textNode.type !== "text") return;

  const start = node.position?.start;
  const end = node.position?.end;
  if (start?.offset == null || end?.offset == null) return;
  if (source.slice(start.offset, end.offset) !== textNode.value) return;

  const text = textNode.value;
  const cut = text.search(cjkPunctuationPattern);
  // `cut === 0` 说明 literal 自己就是以标点开头的 —— 那不是 URL。
  if (cut <= 0 || !node.url.endsWith(text)) return;

  const head = text.slice(0, cut);
  const boundary = { line: start.line, column: start.column + cut, offset: start.offset + cut };
  // url 带的是 `http://`（www. 时）或 `mailto:` 前缀，文字里没有。
  node.url = node.url.slice(0, node.url.length - text.length) + head;
  textNode.value = head;
  node.position = { start, end: boundary };
  siblings.splice(index + 1, 0, {
    type: "text",
    value: text.slice(cut),
    position: { start: boundary, end },
  });
}

function remarkSplitAutolinkLiterals() {
  return (tree: Root, file: { value?: unknown }): void => {
    splitAutolinkLiteralsAtCjkPunctuation(tree, typeof file.value === "string" ? file.value : "");
  };
}

/**
 * 在**分词阶段**就拒掉有歧义的单美元对，让数学不要把 Markdown 的强调或链接一起吞掉：
 * 价格后面那一个 `$`（`$20 … $6`）不能闭合公式，后面空格后的公式（`$20 and $x$`）也不是。
 * 真正的公式、代码、转义与 `$$` 一律交给 remark-math 自己的 tokenizer / resolver。
 *
 * 与上游写死的下标 `text[36]` 不同，这里按名字在**本次 remark-math 新加**的扩展里找
 * `mathText` construct（`36` 是 micromark 代码点表里的位置，跟着版本漂）。
 */
const remarkCurrencySafeMath: Plugin = function () {
  const data = this.data() as { micromarkExtensions?: Extension[] };
  const addedFrom = (data.micromarkExtensions ?? []).length;
  remarkMath.call(this);
  const extensions = (data.micromarkExtensions ?? []).slice(addedFrom);
  for (const extension of extensions) {
    const constructs = Object.values(extension.text ?? {}).flat();
    for (const construct of constructs) {
      if (!construct || construct.name !== "mathText") continue;
      const tokenize = construct.tokenize;
      construct.tokenize = function (effects, ok, nok) {
        const start = this.now();
        return tokenize.call(this, effects, (code) => {
          const source = this.sliceSerialize({ start, end: this.now() });
          if (source.startsWith("$") && !source.startsWith("$$")) {
            const content = source.slice(1, -1);
            const startsWithAmount = /^\s*[+-]?(?:\d|\.\d)/.test(content);
            const closesBeforeNumber = code !== null && code >= 48 && code <= 57;
            // 前后都有空格的写法（`$ x + y $`）继续支持，多行公式也是；
            // 只有单边空格才是散文，不是行内公式的边界。
            const mismatchedPadding = /^\s/.test(content) !== /\s$/.test(content);
            if (startsWithAmount && (closesBeforeNumber || mismatchedPadding)) return nok(code);
          }
          return ok(code);
        }, nok);
      };
    }
  }
};

export const markdownRemarkPlugins: ReactMarkdownOptions["remarkPlugins"] = [
  [remarkFrontmatter, ["yaml"]],
  [remarkGfm, remarkGfmOptions],
  remarkCjkFriendly,
  remarkSplitAutolinkLiterals,
  remarkCurrencySafeMath,
];
/**
 * fork:fix-user-line-breaks —— 用户消息里每一个换行都保留（#680 / #1015）。
 *
 * `.markdown-user-message p { white-space: pre-wrap }`（app/globals.css）只能救**段落**
 * 内部的软换行；紧列表项（`1. 题目\nA. 选项`）、setext 标题的文本不在 `<p>` 里，浏览器
 * 直接把换行折成空格；Chrome 在 pre-wrap 下也把落单的 `\r` 渲染成空格（粘贴的老式
 * Mac 换行就是这么粘成一段的）；硬换行（行尾两空格或 `\`）则是 remark-rehype 输出
 * `<br>` + 一个 "\n"，pre-wrap 再渲染一次 → 多出一整行空白。
 *
 * 所以正文里每个行尾都换成**裸 `<br>`**：这是一个自定义 mdast 节点，靠 `data.hName`
 * 让 remark-rehype 直接吐 `<br>`，而不是 mdast 的 `break`（后者会带一个 "\n" 尾巴）。
 * 硬换行也一并换成它。代码 / 行内代码 / 公式 / raw HTML 是别的节点类型，文本原样保留。
 * 助手消息不受影响（只有用户消息传 keepLineBreaks）。
 */
interface MarkdownTreeNode {
  type: string;
  value?: string;
  children?: MarkdownTreeNode[];
  data?: { hName?: string };
}

const LINE_ENDING = /[ \t]*(?:\r\n|\r|\n)[ \t]*/;
const PHRASING_BLOCK_TYPES = new Set(["paragraph", "heading", "tableCell"]);
// raw-text 元素会把内容一路吃到闭合标签为止，而 rehype-raw 在下一个元素处就退出该状态；
// 跟在未闭合的 `<textarea>` / `<script>` 后面的 `<br>` 会把整块内容搅乱或吞掉。
const RAW_TEXT_OPEN_TAG = /^<(?:iframe|noembed|noframes|noscript|plaintext|script|style|textarea|title|xmp)(?=[\s/>]|$)/i;

function opensRawTextElement(node: MarkdownTreeNode): boolean {
  if (node.type === "html") return RAW_TEXT_OPEN_TAG.test(node.value ?? "");
  return node.children?.some(opensRawTextElement) ?? false;
}

function lineBreakNode(): MarkdownTreeNode {
  return { type: "lineBreak", data: { hName: "br" } };
}

function keepLineBreaks(parent: MarkdownTreeNode): void {
  if (!parent.children) return;
  // 这类块保持默认渲染：段落里的换行仍由 pre-wrap 规则显示。
  if (PHRASING_BLOCK_TYPES.has(parent.type) && opensRawTextElement(parent)) return;
  parent.children = parent.children.flatMap((node) => {
    if (node.type === "break") return [lineBreakNode()];
    if (node.type !== "text" || !node.value) {
      keepLineBreaks(node);
      return [node];
    }
    return node.value.split(LINE_ENDING).flatMap((line, index) => [
      ...(index > 0 ? [lineBreakNode()] : []),
      ...(line ? [{ type: "text", value: line }] : []),
    ]);
  });
}

function remarkKeepLineBreaks() {
  return (tree: MarkdownTreeNode) => keepLineBreaks(tree);
}

/** 用户消息用的 remark 链：与通用链一致，末尾追加换行保留插件。 */
export const markdownUserRemarkPlugins: ReactMarkdownOptions["remarkPlugins"] = [
  ...(markdownRemarkPlugins ?? []),
  remarkKeepLineBreaks,
];

export const markdownPreviewRemarkPlugins: ReactMarkdownOptions["remarkPlugins"] = [
  [remarkFrontmatter, ["yaml"]],
  [remarkGfm, remarkGfmOptions],
  remarkCjkFriendly,
  remarkSplitAutolinkLiterals,
  remarkCurrencySafeMath,
];

export const markdownRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: false }],
];

/**
 * fork:fix-markdown-stream — 流式期间使用的轻量 rehype 插件组。
 *
 * 与完整组的唯一差别是 **不含 `rehypeKatex`**：KaTeX 是同步排版，
 * 且每次 delta 都要对整篇重新排一次，是长公式/多公式回答卡顿的主要来源之一。
 * 流式期间公式暂时以纯文本呈现，流式结束（`isStreaming` 转 false）后
 * `MarkdownBody` 会切回 `markdownRehypePlugins` 完成正式排版。
 *
 * 参考：Proma 的聊天正文只用 `remarkGfm + remarkMath + rehypeKatex`，
 * 且刻意不在聊天热路径引入 `rehype-raw`；本仓库还需要 sanitize，因此保留 raw+sanitize。
 */
export const markdownStreamingRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
];

/**
 * fork:fix-markdown-stream — 按流式状态挑选 rehype 插件组。
 * 两个数组都是模块常量，引用稳定，不会因为每帧调用而重建插件管线。
 */
export function markdownRehypePluginsFor(streaming: boolean): ReactMarkdownOptions["rehypePlugins"] {
  return streaming ? markdownStreamingRehypePlugins : markdownRehypePlugins;
}

export const markdownPreviewRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: false }],
];
