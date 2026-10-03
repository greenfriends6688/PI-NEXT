/**
 * fork:proma-53 — 极小的 OOXML 扫描层。
 *
 * WHY 不是 DOM：仓库里没有 `xmldom` / `jsdom`，而这些工具需要的东西很窄 ——
 * 「body 的第 N 个顶层 `w:p` 在哪」「一个 `w:tc` 里第一个 `w:p` 的文本是什么」
 * 「这个 `w:t` 的属性是什么」。一次线性分词 + 一次栈配对就够，而且它返回
 * **原始片段的偏移**，编辑时能把改动做成纯字符串拼接：文档里没被碰过的字节
 * 逐字保留（修订标记、书签、域、批注、超链接全部不受影响）。
 *
 * 纯函数 / 无文件系统依赖，可单测。
 */

/** XML 1.0 不允许的控制字符；直接塞进 OOXML 会让 Word 拒绝打开整个文件。 */
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF]/g;

export function escapeXmlText(text: string): string {
  return text
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

/**
 * 把一段文本拆成 WordprocessingML 的 run 序列：换行与制表符在 Word 里不是字符，
 * 而是 `w:br` / `w:tab` 元素（放进 `w:t` 里会让 Word 拒绝打开）。
 */
export function wordprocessingRuns(text: string, attributes = ' xml:space="preserve"'): string {
  const pieces = escapeXmlText(text).split(/(\r\n|\r|\n|\t)/);
  let xml = "";
  for (const piece of pieces) {
    if (piece === "\r\n" || piece === "\r" || piece === "\n") xml += "<w:br/>";
    else if (piece === "\t") xml += "<w:tab/>";
    else if (piece !== "") xml += `<w:t${attributes}>${piece}</w:t>`;
  }
  return xml;
}

/** 同上，DrawingML 版本：换行是 `<a:br/>`，它与 `a:r` 同级，所以 run 也要拆开。 */
export function drawingRuns(text: string): string {
  const pieces = escapeXmlText(text).split(/(\r\n|\r|\n|\t)/);
  let xml = "";
  for (const piece of pieces) {
    if (piece === "\r\n" || piece === "\r" || piece === "\n") xml += "<a:br/>";
    else if (piece === "\t") xml += "<a:tab/>";
    else if (piece !== "") xml += `<a:r><a:rPr lang="en-US" dirty="0"/><a:t>${piece}</a:t></a:r>`;
  }
  return xml;
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => safeFromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export interface XmlElementSpan {
  /** 标签名（带前缀，如 `w:p`）。 */
  name: string;
  /** `<tag …>` 的起始偏移。 */
  start: number;
  /** 闭合标签 `</tag>` 之后的偏移（自闭合时等于起始标签末尾）。 */
  end: number;
  /** 起始标签 `>` 之后的偏移（自闭合时等于 `end`）。 */
  innerStart: number;
  /** 闭合标签 `<` 之前的偏移。 */
  innerEnd: number;
  selfClosing: boolean;
  attrs: string;
}

interface Token {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  start: number;
  /** 标签 `>` 之后（闭合标签是它自己 `>` 之后）。 */
  openEnd: number;
  /** 闭合标签 `<` 之前（自闭合时等于 `openEnd`）。 */
  innerEnd: number;
  end: number;
  attrs: string;
  parent: number;
}

const NAME_CHAR = /[A-Za-z0-9_:.\-]/;

function findTagEnd(xml: string, from: number): number {
  let quote: string | null = null;
  for (let index = from; index < xml.length; index += 1) {
    const char = xml[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index + 1;
  }
  return -1;
}

/**
 * 一次线性分词 + 栈配对的结果。OOXML 允许表格套表格，靠 `parent` 判定「最外层」
 * 才不会把内层表格当成兄弟。
 */
export class XmlParts {
  private readonly xml: string;
  private readonly tokens: Token[];

  constructor(xml: string) {
    this.xml = xml;
    this.tokens = [];
    const stack: number[] = [];
    let index = 0;
    while (index < xml.length) {
      const open = xml.indexOf("<", index);
      if (open < 0) break;
      if (xml.startsWith("<!--", open)) {
        const end = xml.indexOf("-->", open + 4);
        index = end < 0 ? xml.length : end + 3;
        continue;
      }
      if (xml.startsWith("<![CDATA[", open)) {
        const end = xml.indexOf("]]>", open + 9);
        index = end < 0 ? xml.length : end + 3;
        continue;
      }
      if (xml.startsWith("<?", open) || xml.startsWith("<!", open)) {
        const end = xml.indexOf(">", open + 2);
        index = end < 0 ? xml.length : end + 1;
        continue;
      }

      const closing = xml[open + 1] === "/";
      let nameEnd = open + (closing ? 2 : 1);
      while (nameEnd < xml.length && NAME_CHAR.test(xml[nameEnd])) nameEnd += 1;
      const name = xml.slice(open + (closing ? 2 : 1), nameEnd);
      const openEnd = findTagEnd(xml, nameEnd);
      if (!name || openEnd < 0) {
        index = open + 1;
        continue;
      }
      const selfClosing = !closing && xml[openEnd - 2] === "/";
      const token: Token = {
        name,
        closing,
        selfClosing,
        start: open,
        openEnd,
        innerEnd: openEnd,
        end: openEnd,
        attrs: closing ? "" : xml.slice(nameEnd, selfClosing ? openEnd - 2 : openEnd - 1),
        parent: stack.length > 0 ? stack[stack.length - 1] : -1,
      };
      const tokenIndex = this.tokens.push(token) - 1;
      if (closing) {
        let match = -1;
        for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
          if (this.tokens[stack[depth]].name === name) {
            match = depth;
            break;
          }
        }
        if (match < 0) {
          // 孤立闭合标签：丢弃，不让它污染栈。
          this.tokens.pop();
        } else {
          const openingIndex = stack[match];
          stack.length = match;
          const opening = this.tokens[openingIndex];
          opening.end = token.openEnd;
          opening.innerEnd = token.start;
        }
      } else if (!selfClosing) {
        stack.push(tokenIndex);
      }
      index = openEnd;
    }
  }

  /**
   * 区间 `[from, to)` 内的 `tagName` 元素，**跳过同名嵌套的内层**。
   *
   * 「同名嵌套」才是要处理的情况：OOXML 允许表格套表格（内层 `w:tbl` 在单元格里），
   * 按正则 `<w:tbl[\s>]` 会把内层表格当成兄弟表格。祖先链里任何一层同名且落在区间内，
   * 这个元素就算内层。
   */
  elements(tagName: string, from = 0, to = this.xml.length): XmlElementSpan[] {
    const spans: XmlElementSpan[] = [];
    for (const token of this.tokens) {
      if (token.name !== tagName || token.closing) continue;
      if (token.start < from || token.end > to) continue;
      if (this.hasSameNameAncestor(token, tagName, from, to)) continue;
      spans.push(this.spanOf(token));
    }
    return spans;
  }

  first(tagName: string, from = 0, to = this.xml.length): XmlElementSpan | undefined {
    return this.elements(tagName, from, to)[0];
  }

  /**
   * 容器的**直接子元素**。
   *
   * “body 的顶层段落”“表格的行”“单元里的段落”要的都是这一种：容器的直接子元素。
   * 区间版 `elements()` 会把表格里套着的段落一起收进来，因为它们不与任何同名元素
   * 嵌套；而这些索引是要交给模型当地址用的，必须稳定且不含嵌套内容。
   */
  children(tagName: string, container: { start: number; end: number }): XmlElementSpan[] {
    const spans: XmlElementSpan[] = [];
    for (const token of this.tokens) {
      if (token.name !== tagName || token.closing) continue;
      if (token.parent < 0) continue;
      const parent = this.tokens[token.parent];
      if (parent.start !== container.start || parent.end !== container.end) continue;
      spans.push(this.spanOf(token));
    }
    return spans;
  }

  /** 区间内的**全部**元素（含同名嵌套），按出现顺序返回（保持 w:t / w:tab / w:br 的先后）。 */
  all(from = 0, to = this.xml.length): XmlElementSpan[] {
    const spans: XmlElementSpan[] = [];
    for (const token of this.tokens) {
      if (token.closing || token.start < from || token.end > to) continue;
      spans.push(this.spanOf(token));
    }
    return spans.sort((left, right) => left.start - right.start);
  }

  private spanOf(token: Token): XmlElementSpan {
    return {
      name: token.name,
      start: token.start,
      end: token.end,
      innerStart: token.openEnd,
      innerEnd: token.innerEnd,
      selfClosing: token.selfClosing,
      attrs: token.attrs,
    };
  }

  private hasSameNameAncestor(token: Token, tagName: string, from: number, to: number): boolean {
    let cursor = token.parent;
    while (cursor >= 0) {
      const ancestor = this.tokens[cursor];
      if (ancestor.name === tagName && ancestor.start >= from && ancestor.end <= to) return true;
      cursor = ancestor.parent;
    }
    return false;
  }

  inner(span: XmlElementSpan): string {
    return this.xml.slice(span.innerStart, span.innerEnd);
  }

  outer(span: XmlElementSpan): string {
    return this.xml.slice(span.start, span.end);
  }

  /** 区间内所有 `tagName` 元素（不限层级）的拼接文本。 */
  text(tagName: string, from = 0, to = this.xml.length): string {
    let text = "";
    for (const span of this.elements(tagName, from, to)) text += decodeXmlEntities(this.inner(span));
    return text;
  }
}

/** 读取属性值；属性缺失返回 undefined。 */
export function xmlAttr(attrs: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return match ? decodeXmlEntities(match[1]) : undefined;
}