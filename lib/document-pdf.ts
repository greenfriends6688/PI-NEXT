import { inflateSync } from "node:zlib";

/**
 * fork:proma-53 — PDF 的最小实现：从文本生成简单 PDF / 读页数与文本。
 *
 * 明确做不到的事（做不到就是做不到，不含糊）：
 *   - **生成**：只出「一页段文字」的文档 —— 标准 14 号字体 Helvetica、WinAnsi 编码、
 *     自动折行与分页。不做图片、表格线、链接、书签、加密。
 *   - **读取**：只解析页数与「用文本算子画出来」的文字。内容流未压缩或 FlateDecode
 *     都能读；**扫描件、转曲（字形变路径）、CID / 自定义编码子集字体抽不出可读
 *     文本**，这时如实返回空文本而不是编内容。加密 PDF 只报页数并给出警告。
 *
 * 本仓 PDF 预览走浏览器内置阅读器，所以这里也不引入 pdfjs 之类的库。
 */

export class DocumentFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentFormatError";
  }
}

// ─────────────────────────── WinAnsi 编码 ───────────────────────────

/** CP1252 里与 Latin-1 不同的 0x80–0x9F 区段；`0xfffd` 表示该码位无对应字符。 */
const CP1252_HIGH = [
  0x20ac, 0xfffd, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0xfffd,
  0x017d, 0xfffd, 0xfffd, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0xfffd, 0x017e, 0x0178,
];

export interface EncodedText {
  bytes: Buffer;
  /** 无法用 WinAnsi 表示、已被替换成 `?` 的字符数。 */
  replaced: number;
}

export function encodeWinAnsi(text: string): EncodedText {
  const bytes: number[] = [];
  let replaced = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    if (code === 0x0a) {
      bytes.push(0x0a);
      continue;
    }
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      bytes.push(code);
      continue;
    }
    if (code >= 0x80 && code <= 0x9f) {
      const mapped = CP1252_HIGH[code - 0x80];
      if (mapped !== 0xfffd) bytes.push(code);
      else {
        bytes.push(0x3f);
        replaced += 1;
      }
      continue;
    }
    bytes.push(0x3f);
    replaced += 1;
  }
  return { bytes: Buffer.from(bytes), replaced };
}

export function decodeWinAnsi(bytes: Buffer): string {
  let text = "";
  for (const byte of bytes) {
    const code = byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : byte;
    text += code === 0xfffd ? "�" : String.fromCharCode(code);
  }
  return text;
}

// ─────────────────────────── 字宽（折行用） ───────────────────────────

/** Helvetica 的 ASCII 字宽（1/1000 em）。非 ASCII 一律按 556（大多数重音字母就是这个值）。 */
const HELVETICA_ASCII_WIDTHS: Record<number, number> = {
  32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191, 40: 333, 41: 333, 42: 389, 43: 584,
  44: 278, 45: 333, 46: 278, 47: 278, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556, 64: 1015, 91: 278,
  92: 278, 93: 278, 94: 469, 95: 556, 96: 333, 97: 556, 98: 556, 99: 500, 100: 556, 101: 556, 102: 278, 103: 556,
  104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556, 111: 556, 112: 556, 113: 556, 114: 333,
  115: 500, 116: 278, 117: 556, 118: 500, 119: 722, 120: 500, 121: 500, 122: 500, 123: 334, 124: 260, 125: 334,
  126: 584,
};

function lineWidth(text: string, size: number): number {
  let total = 0;
  for (const byte of encodeWinAnsi(text).bytes) total += HELVETICA_ASCII_WIDTHS[byte] ?? 556;
  return (total * size) / 1000;
}

/** 按可用宽度折行；超长单词不硬拆，免得把 URL / 标识符拆坏。 */
export function wrapLine(line: string, size: number, maxWidth: number): string[] {
  if (line === "") return [""];
  if (lineWidth(line, size) <= maxWidth) return [line];
  const lines: string[] = [];
  let current = "";
  for (const word of line.split(/(\s+)/)) {
    if (word === "") continue;
    const candidate = current + word;
    if (current.trim() !== "" && lineWidth(candidate.trimEnd(), size) > maxWidth) {
      lines.push(current.trimEnd());
      current = word.trimStart();
    } else {
      current = candidate;
    }
  }
  if (current.trim() !== "" || lines.length === 0) lines.push(current.trimEnd());
  return lines;
}

// ─────────────────────────── 生成 ───────────────────────────

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const BODY_SIZE = 11;

function escapePdfString(bytes: Buffer): string {
  let out = "";
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return out;
}

export interface PdfPageInput {
  /** 页内文本；`\n` 分行，空行保留。 */
  text: string;
}

export interface BuildPdfOptions {
  title?: string;
  fontSize?: number;
}

export interface BuiltPdf {
  bytes: Buffer;
  pageCount: number;
  /** 因编码能力不足被替换成 `?` 的字符数。 */
  replacedCharacters: number;
}

/** 把若干页文本排成 PDF：按可用宽度折行，超出一页自动分页。 */
export function buildPdf(pages: PdfPageInput[], options: BuildPdfOptions = {}): BuiltPdf {
  const size = options.fontSize ?? BODY_SIZE;
  if (!(size >= 6 && size <= 24)) throw new DocumentFormatError(`字号必须在 6–24 之间，收到 ${size}`);
  const leading = Math.round(size * 1.35);
  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  const linesPerPage = Math.max(1, Math.floor((PAGE_HEIGHT - MARGIN * 2) / leading));

  let replacedCharacters = 0;
  const laidOut: string[][] = [];
  for (const page of pages.length > 0 ? pages : [{ text: "" }]) {
    let current: string[] = [];
    for (const line of page.text.split(/\r\n|\r|\n/)) {
      for (const wrapped of wrapLine(line, size, maxWidth)) {
        if (current.length >= linesPerPage) {
          laidOut.push(current);
          current = [];
        }
        current.push(wrapped);
      }
    }
    if (current.length > 0) laidOut.push(current);
  }
  if (laidOut.length === 0) laidOut.push([""]);

  // 对象号：1 = Catalog，2 = Pages，然后每页 page+content，最后是字体。
  const bodies: (Buffer | null)[] = [];
  const offsets: number[] = [];
  const add = (body: Buffer | string | null): number => {
    bodies.push(typeof body === "string" ? Buffer.from(body, "latin1") : body);
    return bodies.length;
  };
  const catalogId = add(null);
  const pagesId = add(null);

  const pageIds: number[] = [];
  for (const lines of laidOut) {
    let content = "";
    lines.forEach((line, index) => {
      const { bytes, replaced } = encodeWinAnsi(line);
      replacedCharacters += replaced;
      const y = PAGE_HEIGHT - MARGIN - leading * (index + 1);
      content += `BT /F1 ${size} Tf 1 0 0 1 ${MARGIN} ${y} Tm (${escapePdfString(bytes)}) Tj ET\n`;
    });
    const contentId = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`);
    const fontId = bodies.length + 1;
    pageIds.push(
      add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`),
    );
  }
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const infoId = options.title
    ? add(`<< /Title (${escapePdfString(encodeWinAnsi(options.title).bytes)}) /Producer (pi-web) >>`)
    : null;
  bodies[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, "latin1");
  bodies[pagesId - 1] = Buffer.from(
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
    "latin1",
  );

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  let offset = chunks[0].length;
  bodies.forEach((body, index) => {
    const piece = body ?? Buffer.alloc(0);
    const head = Buffer.from(`${index + 1} 0 obj\n`, "latin1");
    const tail = Buffer.from("\nendobj\n", "latin1");
    offsets.push(offset);
    chunks.push(head, piece, tail);
    offset += head.length + piece.length + tail.length;
  });

  const startXref = offset;
  let xref = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const entry of offsets) xref += `${String(entry).padStart(10, "0")} 00000 n \n`;
  const trailer =
    `trailer\n<< /Size ${bodies.length + 1} /Root ${catalogId} 0 R${infoId ? ` /Info ${infoId} 0 R` : ""} >>\n` +
    `startxref\n${startXref}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"), Buffer.from(trailer, "latin1"));
  return { bytes: Buffer.concat(chunks), pageCount: laidOut.length, replacedCharacters };
}

// ─────────────────────────── 读取 ───────────────────────────

export interface PdfReadResult {
  pageCount: number;
  /** 抽出文本的页（可能少于 `pageCount`，例如扫描件没有文本层）。 */
  pages: { page: number; text: string }[];
  /** 文本是否被 `maxPages` / `maxCharacters` 截断。 */
  truncated: boolean;
  warnings: string[];
}

export interface ReadPdfOptions {
  maxPages?: number;
  maxCharacters?: number;
}

interface PdfObject {
  id: number;
  dict: string;
  stream: Buffer | null;
}

function scanObjects(buffer: Buffer, text: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const id = Number(match[1]);
    const bodyStart = match.index + match[0].length;
    const end = text.indexOf("endobj", bodyStart);
    const bodyEnd = end < 0 ? text.length : end;
    const body = text.slice(bodyStart, bodyEnd);
    const streamAt = body.indexOf("stream");
    if (streamAt < 0) {
      objects.set(id, { id, dict: body, stream: null });
      continue;
    }
    let dataStart = bodyStart + streamAt + "stream".length;
    if (text[dataStart] === "\r") dataStart += 1;
    if (text[dataStart] === "\n") dataStart += 1;
    let dataEnd = text.indexOf("endstream", dataStart);
    if (dataEnd < 0 || dataEnd > bodyEnd) dataEnd = bodyEnd;
    objects.set(id, { id, dict: body.slice(0, streamAt), stream: buffer.subarray(dataStart, Math.max(dataStart, dataEnd)) });
  }
  return objects;
}

/** PDF 1.5 起对象可以塞进 `/Type /ObjStm`；页树常常就在里面，不展开就数不出页数。 */
function expandObjectStreams(objects: Map<number, PdfObject>): void {
  for (const object of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(object.dict) || !object.stream) continue;
    let data: Buffer;
    try {
      data = inflateSync(object.stream);
    } catch {
      continue;
    }
    const count = Number(/\/N\s+(\d+)/.exec(object.dict)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)/.exec(object.dict)?.[1] ?? 0);
    if (count <= 0 || first <= 0) continue;
    const header = data.toString("latin1", 0, first).trim().split(/\s+/).map(Number);
    const payload = data.toString("latin1", first);
    for (let index = 0; index < count; index += 1) {
      const id = header[index * 2];
      const start = header[index * 2 + 1];
      if (!Number.isInteger(id) || !Number.isInteger(start) || objects.has(id)) continue;
      const next = index + 1 < count ? header[(index + 1) * 2 + 1] : undefined;
      objects.set(id, { id, dict: next === undefined ? payload.slice(start) : payload.slice(start, next), stream: null });
    }
  }
}

function decodeStream(object: PdfObject, warnings: string[]): string {
  if (!object.stream) return "";
  // 未压缩的内容流（自己生成的就是这种）与 FlateDecode 都能直接读。
  if (!/\/Filter/.test(object.dict)) return object.stream.toString("latin1");
  if (!/\/FlateDecode/.test(object.dict)) {
    warnings.push("内容流使用了别的过滤器，该页文本未读取");
    return "";
  }
  try {
    return inflateSync(object.stream).toString("latin1");
  } catch {
    warnings.push("内容流解压失败，该页文本未读取");
    return "";
  }
}

/**
 * 从内容流抽文本。策略：字符串（含 `TJ` 数组里的）直接拼接；`Td` / `TD` / `T*` / `'` /
 * `"` 视作换行；`TJ` 里 ≤ -120 的字距修正视作一个空格（Word 用来分词的那个）。
 * 字体编码不做映射 —— 子集字体的自定义编码抽出来可能是乱码，这种情况宁可原样返回。
 */
export function extractTextFromContent(content: string): string {
  const lines: string[] = [];
  let current = "";
  const flush = () => {
    lines.push(current.replace(/[ \t]+$/g, ""));
    current = "";
  };

  let index = 0;
  let arrayDepth = 0;
  while (index < content.length) {
    const char = content[index];
    if (char === "%") {
      const end = content.indexOf("\n", index);
      index = end < 0 ? content.length : end + 1;
      continue;
    }
    if (char === "(") {
      const literal = readLiteralString(content, index);
      current += decodeWinAnsi(literal.bytes);
      index = literal.next;
      continue;
    }
    if (char === "<" && content[index + 1] !== "<") {
      const end = content.indexOf(">", index);
      if (end < 0) break;
      const hex = content.slice(index + 1, end).replace(/[^0-9a-fA-F]/g, "");
      current += decodeWinAnsi(Buffer.from(hex.length % 2 === 0 ? hex : hex.slice(0, -1), "hex"));
      index = end + 1;
      continue;
    }
    if (char === "<") {
      // `<<` 是字典开始（跳两个字符）；`<48656C6C6F>` 是十六进制串，上面已经处理过。
      index += content.startsWith("<<", index) ? 2 : 1;
      continue;
    }
    if (char === "[") {
      arrayDepth += 1;
      index += 1;
      continue;
    }
    if (char === ">") {
      index += content.startsWith(">>", index) ? 2 : 1;
      continue;
    }
    if (char === "]") {
      arrayDepth = Math.max(0, arrayDepth - 1);
      index += 1;
      continue;
    }
    if (char === "{") {
      // PostScript 过程定义：整体跳过，否则里面的字符串会被当成正文。
      const end = content.indexOf("}", index);
      index = end < 0 ? content.length : end + 1;
      continue;
    }
    if (/[-+0-9.]/.test(char)) {
      const match = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(content.slice(index, index + 32));
      if (match) {
        if (arrayDepth > 0 && Number(match[0]) <= -120 && current !== "" && !current.endsWith(" ")) current += " ";
        index += match[0].length;
        continue;
      }
    }
    const operator = readOperator(content, index);
    if (operator.name === "") {
      index += 1;
      continue;
    }
    index = operator.next;
    if (operator.name === "BT") {
      if (current !== "") flush();
    } else if (operator.name === "ET") {
      flush();
    } else if (operator.name === "'" || operator.name === '"') {
      flush();
    } else if (operator.name === "Td" || operator.name === "TD" || operator.name === "T*") {
      if (current !== "") flush();
    }
  }
  if (current !== "") flush();

  // 折叠连续空行，并去掉首尾空行。
  const out: string[] = [];
  for (const line of lines) {
    if (line === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

function readLiteralString(content: string, start: number): { bytes: Buffer; next: number } {
  const bytes: number[] = [];
  let index = start + 1;
  let depth = 1;
  while (index < content.length) {
    const char = content[index];
    if (char === "\\") {
      const escape = content[index + 1];
      index += 2;
      if (escape === "n") bytes.push(10);
      else if (escape === "r") bytes.push(13);
      else if (escape === "t") bytes.push(9);
      else if (escape === "b") bytes.push(8);
      else if (escape === "f") bytes.push(12);
      else if (escape === "\n") continue;
      else if (escape === "\r") {
        if (content[index] === "\n") index += 1;
        continue;
      } else if (escape && /[0-7]/.test(escape)) {
        const octal = /^[0-7]{1,3}/.exec(content.slice(index - 1))?.[0] ?? "0";
        bytes.push(parseInt(octal, 8) & 0xff);
        index += octal.length - 1;
      } else if (escape) bytes.push(escape.charCodeAt(0) & 0xff);
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return { bytes: Buffer.from(bytes), next: index + 1 };
    }
    bytes.push(char.charCodeAt(0) & 0xff);
    index += 1;
  }
  return { bytes: Buffer.from(bytes), next: index };
}

const OPERATOR_PATTERN = /[A-Za-z'"*][A-Za-z0-9*'"]*/y;

function readOperator(content: string, index: number): { name: string; next: number } {
  OPERATOR_PATTERN.lastIndex = index;
  const match = OPERATOR_PATTERN.exec(content);
  return match ? { name: match[0], next: index + match[0].length } : { name: "", next: index + 1 };
}

function contentStreamsOf(pageDict: string, objects: Map<number, PdfObject>): PdfObject[] {
  const single = /\/Contents\s+(\d+)\s+0\s+R/.exec(pageDict)?.[1];
  if (single) {
    const object = objects.get(Number(single));
    return object ? [object] : [];
  }
  const array = /\/Contents\s*\[([^\]]*)\]/.exec(pageDict)?.[1] ?? "";
  return [...array.matchAll(/(\d+)\s+0\s+R/g)]
    .map((match) => objects.get(Number(match[1])))
    .filter((object): object is PdfObject => object !== undefined);
}

/** 按页树 `/Kids` 的顺序取页对象；页树读不出来时退回扫描顺序。 */
function pagesInOrder(objects: Map<number, PdfObject>, roots: number[]): PdfObject[] {
  const ordered: PdfObject[] = [];
  const visited = new Set<number>();
  const walk = (id: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    const object = objects.get(id);
    if (!object) return;
    if (/\/Type\s*\/Page\b/.test(object.dict)) {
      ordered.push(object);
      return;
    }
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(object.dict)?.[1] ?? "";
    for (const match of kids.matchAll(/(\d+)\s+0\s+R/g)) walk(Number(match[1]));
  };
  for (const root of roots) walk(root);
  if (ordered.length === 0) {
    return [...objects.values()].filter((object) => /\/Type\s*\/Page\b/.test(object.dict));
  }
  return ordered;
}

export function readPdf(buffer: Buffer, options: ReadPdfOptions = {}): PdfReadResult {
  const maxPages = options.maxPages ?? 50;
  const maxCharacters = options.maxCharacters ?? 40_000;
  const text = buffer.toString("latin1");
  if (!text.startsWith("%PDF-")) throw new DocumentFormatError("不是 PDF 文件（缺少 %PDF- 头）");

  const warnings: string[] = [];
  if (text.includes("/Encrypt")) warnings.push("PDF 已加密，只返回页数");

  const objects = scanObjects(buffer, text);
  expandObjectStreams(objects);

  const catalog = [...objects.values()].find((object) => /\/Type\s*\/Catalog/.test(object.dict));
  const pagesRef = catalog ? Number(/\/Pages\s+(\d+)\s+0\s+R/.exec(catalog.dict)?.[1] ?? NaN) : NaN;
  const pagesObject = Number.isInteger(pagesRef) ? objects.get(pagesRef) : undefined;
  const declaredCount = pagesObject ? Number(/\/Count\s+(\d+)/.exec(pagesObject.dict)?.[1] ?? 0) : 0;
  const roots: number[] = Number.isInteger(pagesRef) ? [pagesRef] : [];
  const pageObjects = pagesInOrder(objects, roots);
  const pageCount = Number.isInteger(declaredCount) && declaredCount > 0 ? declaredCount : pageObjects.length;

  const pages: { page: number; text: string }[] = [];
  let characters = 0;
  let truncated = false;
  for (const [index, page] of pageObjects.slice(0, maxPages).entries()) {
    const body = contentStreamsOf(page.dict, objects)
      .map((stream) => extractTextFromContent(decodeStream(stream, warnings)))
      .join("\n")
      .trim();
    if (body === "") continue;
    const remaining = maxCharacters - characters;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const clipped = body.length > remaining;
    const kept = clipped ? body.slice(0, remaining) : body;
    characters += kept.length;
    pages.push({ page: index + 1, text: kept });
    if (clipped) truncated = true;
  }
  if (pageObjects.length > maxPages) truncated = true;
  return { pageCount, pages, truncated, warnings: [...new Set(warnings)] };
}