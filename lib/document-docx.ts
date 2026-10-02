import {
  XmlParts,
  type XmlElementSpan,
  escapeXmlAttribute,
  wordprocessingRuns,
  xmlAttr,
} from "./document-xml";
import { DocumentZipError, readZipEntries, withZipEntry, writeZipEntries, zipText, type ZipEntry } from "./document-zip";

/**
 * fork:proma-53 — WordprocessingML（.docx）的最小实现：新建 / 读结构 / 改段落与表格单元。
 *
 * 设计取舍：
 *   - **只碰要改的字节**。读回一个 .docx 时，除 `word/document.xml` 外所有部件逐字
 *     原样写回；文档内部也只把被改的那一个 `w:p` / `w:tc` 换掉。所以修订标记、书签、
 *     批注、超链接、样式表都不会因为「过一遍我们的工具」而丢。
 *   - **段落编辑是降格式的**：新文本写进段落里的第一个 run，其余 run 丢掉（保留
 *     `w:pPr` 段落属性与第一个 run 的 `w:rPr`）。这一点在工具 description 里明说，
 *     需要保留复杂排版的场景应该新建文档而不是改。
 *   - `document.xml` 是 XML 1.0，控制字符会让 Word 拒绝打开整个文件，所以写入前
 *     一律过滤（`escapeXmlText`）。
 */

export class DocumentFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentFormatError";
  }
}

const WORD_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

export type DocxBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullet"; text: string }
  | { type: "numbered"; text: string }
  | { type: "table"; rows: string[][] };

export interface DocxParagraph {
  /** 0 起；只数 body 的顶层段落（表格里的段落归表格）。 */
  index: number;
  /** `Heading1` / `Title` / `ListParagraph` 之类的样式 id；正文段落为 null。 */
  style: string | null;
  text: string;
}

export interface DocxTableCell {
  row: number;
  column: number;
  text: string;
}

export interface DocxTable {
  index: number;
  rows: number;
  columns: number;
  cells: DocxTableCell[];
}

export interface DocxStructure {
  paragraphs: DocxParagraph[];
  tables: DocxTable[];
}

// ─────────────────────────── 读取 ───────────────────────────

function documentXmlOf(buffer: Buffer): { parts: XmlParts; xml: string } {
  const entries = readZipEntries(buffer);
  const xml = zipText(entries, "word/document.xml");
  if (!xml) throw new DocumentFormatError("不是 Word 文档（缺少 word/document.xml）");
  return { parts: new XmlParts(xml), xml };
}

function paragraphText(parts: XmlParts, paragraph: XmlElementSpan): string {
  let text = "";
  // 按文档顺序扫段落内的元素，`w:t` / `w:tab` / `w:br` 的先后关系不能乱。
  for (const span of parts.all(paragraph.innerStart, paragraph.innerEnd)) {
    if (span.name === "w:t") text += parts.inner(span);
    else if (span.name === "w:tab") text += "\t";
    else if (span.name === "w:br" || span.name === "w:cr") text += "\n";
  }
  return text;
}

function paragraphStyle(parts: XmlParts, paragraph: XmlElementSpan): string | null {
  const properties = parts.first("w:pPr", paragraph.innerStart, paragraph.innerEnd);
  if (!properties) return null;
  const style = parts.first("w:pStyle", properties.innerStart, properties.innerEnd);
  return style ? xmlAttr(style.attrs, "w:val") ?? null : null;
}

export function readDocxStructure(buffer: Buffer): DocxStructure {
  const { parts } = documentXmlOf(buffer);
  const body = parts.first("w:body");
  if (!body) throw new DocumentFormatError("Word 文档缺少 w:body");

  const paragraphs: DocxParagraph[] = [];
  let paragraphIndex = 0;
  for (const span of parts.children("w:p", body)) {
    paragraphs.push({
      index: paragraphIndex,
      style: paragraphStyle(parts, span),
      text: paragraphText(parts, span),
    });
    paragraphIndex += 1;
  }

  const tables: DocxTable[] = [];
  let tableIndex = 0;
  for (const table of parts.children("w:tbl", body)) {
    const cells: DocxTableCell[] = [];
    let rowIndex = 0;
    for (const row of parts.children("w:tr", table)) {
      let columnIndex = 0;
      for (const cell of parts.children("w:tc", row)) {
        const cellParagraphs = parts.children("w:p", cell);
        cells.push({
          row: rowIndex,
          column: columnIndex,
          text: cellParagraphs.map((span) => paragraphText(parts, span)).join("\n"),
        });
        columnIndex += 1;
      }
      rowIndex += 1;
    }
    tables.push({ index: tableIndex, rows: rowIndex, columns: cells.reduce((max, cell) => Math.max(max, cell.column + 1), 0), cells });
    tableIndex += 1;
  }

  return { paragraphs, tables };
}

// ─────────────────────────── 新建 ───────────────────────────

function paragraphXml(styleId: string | null, text: string, numberingId?: number): string {
  const properties = [
    styleId ? `<w:pStyle w:val="${escapeXmlAttribute(styleId)}"/>` : "",
    numberingId ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numberingId}"/></w:numPr>` : "",
  ].join("");
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}<w:r>${wordprocessingRuns(text)}</w:r></w:p>`;
}

function tableXml(rows: string[][], columnCount: number): string {
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`)
    .join("");
  const width = Math.floor(9360 / Math.max(1, columnCount));
  const grid = Array.from({ length: columnCount }, () => `<w:gridCol w:w="${width}"/>`).join("");
  const body = rows
    .map((row) => {
      const cells = Array.from({ length: columnCount }, (_unused, column) => {
        return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paragraphXml(null, row[column] ?? "")}</w:tc>`;
      }).join("");
      return `<w:tr>${cells}</w:tr>`;
    })
    .join("");
  // 表格后面必须跟一个空段落，否则两个相邻表格会被 Word 合并成一个。
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl><w:p/>`;
}

function numberingXml(listCount: number): string {
  if (listCount === 0) return "";
  const items = Array.from({ length: listCount }, (_unused, index) => {
    const id = index + 1;
    return `<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`;
  }).join("");
  const abstractItems = Array.from({ length: listCount }, (_unused, index) => {
    const id = index + 1;
    return `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl></w:abstractNum>`;
  }).join("");
  return `${XML_DECLARATION}<w:numbering ${W_NS}>${abstractItems}${items}</w:numbering>`;
}

function stylesXml(): string {
  const heading = (level: number, size: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="0"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:b/><w:color w:val="2F5496"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return `${XML_DECLARATION}<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0"/><w:contextualSpacing/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:color w:val="2F5496"/><w:spacing w:val="-10"/><w:kern w:val="28"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>${heading(1, 32)}${heading(2, 26)}${heading(3, 24)}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style></w:styles>`;
}

function corePropertiesXml(title: string): string {
  return `${XML_DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXmlAttribute(title)}</dc:title><dc:creator>pi-web</dc:creator><cp:lastModifiedBy>pi-web</cp:lastModifiedBy></cp:coreProperties>`;
}

/** 新建一个 .docx：blocks 是有序内容块，渲染顺序即数组顺序。 */
export function buildDocx(blocks: DocxBlock[], options: { title?: string } = {}): Buffer {
  const rendered: string[] = [];
  const listIds: number[] = [];
  let listCount = 0;
  let currentListId: number | null = null;

  for (const block of blocks) {
    if (block.type === "heading") {
      currentListId = null;
      rendered.push(paragraphXml(`Heading${clampHeadingLevel(block.level)}`, block.text));
    } else if (block.type === "paragraph") {
      currentListId = null;
      rendered.push(paragraphXml(null, block.text));
    } else if (block.type === "bullet" || block.type === "numbered") {
      if (currentListId === null) {
        listCount += 1;
        currentListId = listCount;
        listIds.push(currentListId);
      }
      rendered.push(paragraphXml("ListParagraph", block.text, currentListId));
    } else {
      currentListId = null;
      rendered.push(block.rows.length === 0 ? paragraphXml(null, "") : tableXml(block.rows, block.rows.reduce((max, row) => Math.max(max, row.length), 0)));
    }
  }

  const document = `${XML_DECLARATION}<w:document ${W_NS}><w:body>${rendered.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const entries: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${WORD_CONTENT_TYPE}"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `${XML_DECLARATION}<Relationships ${REL_NS}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      data: `${XML_DECLARATION}<Relationships ${REL_NS}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`,
    },
    { name: "word/document.xml", data: document },
    { name: "word/styles.xml", data: stylesXml() },
    { name: "word/numbering.xml", data: numberingXml(listCount) },
    { name: "docProps/core.xml", data: corePropertiesXml(options.title ?? "") },
  ];
  return writeZipEntries(entries);
}

function clampHeadingLevel(level: number): number {
  return Math.min(3, Math.max(1, Math.trunc(level) || 1));
}

// ─────────────────────────── 编辑 ───────────────────────────

/** 用单个 run 重建一个段落：保留 `w:pPr` 与第一个 run 的 `w:rPr`，其余 run 丢弃。 */
function rebuildParagraph(parts: XmlParts, paragraph: XmlElementSpan, text: string): string {
  const outer = parts.outer(paragraph);
  const startTag = outer.slice(0, paragraph.innerStart - paragraph.start);
  const properties = parts.first("w:pPr", paragraph.innerStart, paragraph.innerEnd);
  const run = parts.first("w:r", paragraph.innerStart, paragraph.innerEnd);
  const runProperties = run ? parts.first("w:rPr", run.innerStart, run.innerEnd) : undefined;
  return (
    startTag +
    (properties ? parts.outer(properties) : "") +
    "<w:r>" +
    (runProperties ? parts.outer(runProperties) : "") +
    wordprocessingRuns(text) +
    "</w:r></w:p>"
  );
}

export class DocxIndexError extends DocumentFormatError {}

/** 改写第 `index` 个 body 顶层段落的文本（0 起）。 */
export function replaceDocxParagraph(buffer: Buffer, index: number, text: string): Buffer {
  const { xml } = documentXmlOf(buffer);
  const parts = new XmlParts(xml);
  const body = parts.first("w:body");
  if (!body) throw new DocumentFormatError("Word 文档缺少 w:body");
  const paragraphs = parts.children("w:p", body);
  const target = paragraphs[index];
  if (!target) {
    throw new DocxIndexError(
      `文档里没有第 ${index} 个顶层段落（共 ${paragraphs.length} 个）。表格里的段落不算顶层段落，请用 docx_edit 的表格单元模式。`,
    );
  }
  const rebuilt = rebuildParagraph(parts, target, text);
  const document = xml.slice(0, target.start) + rebuilt + xml.slice(target.end);
  return writeZipEntries(withZipEntry(readZipEntries(buffer), "word/document.xml", document));
}

/** 改写第 `tableIndex` 张表格的 (row, column) 单元文本（均 0 起）。 */
export function replaceDocxTableCell(
  buffer: Buffer,
  tableIndex: number,
  rowIndex: number,
  columnIndex: number,
  text: string,
): Buffer {
  const { xml } = documentXmlOf(buffer);
  const parts = new XmlParts(xml);
  const body = parts.first("w:body");
  if (!body) throw new DocumentFormatError("Word 文档缺少 w:body");
  const tables = parts.children("w:tbl", body);
  const table = tables[tableIndex];
  if (!table) throw new DocxIndexError(`文档里没有第 ${tableIndex} 张表格（共 ${tables.length} 张）。`);

  const rows = parts.children("w:tr", table);
  const row = rows[rowIndex];
  if (!row) throw new DocxIndexError(`第 ${tableIndex} 张表格没有第 ${rowIndex} 行（共 ${rows.length} 行）。`);

  const cells = parts.children("w:tc", row);
  const cell = cells[columnIndex];
  if (!cell) throw new DocxIndexError(`第 ${tableIndex} 张表格第 ${rowIndex} 行没有第 ${columnIndex} 列（共 ${cells.length} 列）。`);

  const cellParagraphs = parts.children("w:p", cell);
  const rebuilt = cellParagraphs.length > 0
    ? xml.slice(0, cellParagraphs[0].start) +
      rebuildParagraph(parts, cellParagraphs[0], text) +
      xml.slice(cellParagraphs[0].end)
    : xml.slice(0, cell.innerStart) + paragraphXml(null, text) + xml.slice(cell.innerStart);

  return writeZipEntries(withZipEntry(readZipEntries(buffer), "word/document.xml", rebuilt));
}

/** 包一层：把 ZIP 层异常翻译成格式错误，工具层只要 catch 一种。 */
export function readDocx(buffer: Buffer): DocxStructure {
  try {
    return readDocxStructure(buffer);
  } catch (error) {
    if (error instanceof DocumentFormatError) throw error;
    if (error instanceof DocumentZipError) throw new DocumentFormatError(`无法读取 .docx：${error.message}`);
    throw error;
  }
}