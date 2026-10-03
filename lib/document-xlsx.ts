import { XmlParts, escapeXmlText, xmlAttr } from "./document-xml";
import { DocumentZipError, readZipEntries, withZipEntry, writeZipEntries, zipText, type ZipEntry } from "./document-zip";

/**
 * fork:proma-53 — SpreadsheetML（.xlsx）的最小实现：新建工作簿 / 读单元格区域 /
 * 写单元格区域。
 *
 * 关键取舍：
 *   - **字符串一律写成 inlineStr**，不去碰 `sharedStrings.xml`。写一个已有工作簿时，
 *     别的部件（包括 sharedStrings）原样保留；我们新写的单元是自包含的，所以不会
 *     让已有索引失效。读的时候三种表示（`s` / `inlineStr` / `str`）都认。
 *   - **单元格寻址是纯函数**（A1 ↔ 行/列），单独导出好单测，也是工具 description
 *     里唯一需要模型记住的语法。
 *   - 写单元格时保留行内其它单元的原始 XML（样式 `s=`、公式、类型都不动），只把
 *     命中的那个 `<c>` 换掉；缺失的行 / 列按坐标插到正确位置。
 */

/** 单元格地址非法时抛出（工具层直接把它翻译成给模型看的提示）。 */
export class DocumentCellAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentCellAddressError";
  }
}

export class DocumentSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentSheetError";
  }
}

export class DocumentFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentFormatError";
  }
}

export const COLUMN_INDEX_LIMIT = 16_384;
export const ROW_INDEX_LIMIT = 1_048_576;

// ─────────────────────── 单元格寻址（纯函数） ───────────────────────

/** `"A"` → 1，`"aa"` → 27。不接受空串、小写以外的怪字符。 */
export function columnLabelToIndex(label: string): number {
  if (!/^[A-Za-z]{1,3}$/.test(label)) throw new DocumentCellAddressError(`列名无效：${label}`);
  let index = 0;
  for (const char of label.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  if (index < 1 || index > COLUMN_INDEX_LIMIT) throw new DocumentCellAddressError(`列名超出范围：${label}`);
  return index;
}

/** 1 → `"A"`，27 → `"AA"`。 */
export function columnIndexToLabel(index: number): string {
  if (!Number.isInteger(index) || index < 1 || index > COLUMN_INDEX_LIMIT) {
    throw new DocumentCellAddressError(`列序号超出范围：${index}`);
  }
  let label = "";
  let remaining = index;
  while (remaining > 0) {
    const rest = (remaining - 1) % 26;
    label = String.fromCharCode(65 + rest) + label;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return label;
}

/** `"B3"` → `{ row: 3, column: 2 }`；`"$B$3"` 也接受。 */
export function parseCellReference(reference: string): { row: number; column: number } {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(reference.trim());
  if (!match) throw new DocumentCellAddressError(`单元格地址无效：${reference}（应形如 B3）`);
  const row = Number(match[2]);
  if (row < 1 || row > ROW_INDEX_LIMIT) throw new DocumentCellAddressError(`行号超出范围：${reference}`);
  return { row, column: columnLabelToIndex(match[1]) };
}

export function formatCellReference(row: number, column: number): string {
  if (!Number.isInteger(row) || row < 1 || row > ROW_INDEX_LIMIT) {
    throw new DocumentCellAddressError(`行号超出范围：${row}`);
  }
  return `${columnIndexToLabel(column)}${row}`;
}

/** `"B2:D5"` / `"B2"` → 起止坐标（闭区间）。 */
export function parseRange(range: string): { startRow: number; startColumn: number; endRow: number; endColumn: number } {
  const match = /^([A-Za-z]{1,3}\d{1,7})(?::([A-Za-z]{1,3}\d{1,7}))?$/.exec(range.trim());
  if (!match) throw new DocumentCellAddressError(`区域无效：${range}（应形如 B2 或 B2:D5）`);
  const first = parseCellReference(match[1]);
  const second = match[2] ? parseCellReference(match[2]) : first;
  return {
    startRow: Math.min(first.row, second.row),
    startColumn: Math.min(first.column, second.column),
    endRow: Math.max(first.row, second.row),
    endColumn: Math.max(first.column, second.column),
  };
}

export interface SheetSummary {
  name: string;
  rows: number;
  columns: number;
}

export interface SheetCell {
  reference: string;
  row: number;
  column: number;
  /** 单元格显示值；空单元是空串。 */
  value: string;
}

export interface SheetReadResult {
  sheet: string;
  range: string;
  rows: string[][];
  cells: SheetCell[];
}

// ─────────────────────────── 工作簿结构 ───────────────────────────

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const SHEET_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";

interface WorkbookParts {
  entries: ZipEntry[];
  sheets: { name: string; partName: string }[];
}

function workbookParts(buffer: Buffer): WorkbookParts {
  const entries = readZipEntries(buffer);
  const workbookXml = zipText(entries, "xl/workbook.xml");
  if (!workbookXml) throw new DocumentFormatError("不是 Excel 工作簿（缺少 xl/workbook.xml）");
  const relsXml = zipText(entries, "xl/_rels/workbook.xml.rels");
  if (!relsXml) throw new DocumentFormatError("Excel 工作簿缺少 xl/_rels/workbook.xml.rels");

  const rels = new XmlParts(relsXml);
  const targets = new Map<string, string>();
  for (const relationship of rels.elements("Relationship")) {
    const id = xmlAttr(relationship.attrs, "Id");
    const target = xmlAttr(relationship.attrs, "Target");
    if (id && target) targets.set(id, normalizePartTarget(target));
  }

  const workbook = new XmlParts(workbookXml);
  const sheetsElement = workbook.first("sheets");
  const sheets: { name: string; partName: string }[] = [];
  for (const sheet of sheetsElement ? workbook.children("sheet", sheetsElement) : []) {
    const name = xmlAttr(sheet.attrs, "name");
    const relationId = xmlAttr(sheet.attrs, "r:id") ?? xmlAttr(sheet.attrs, "id");
    if (!name || !relationId) continue;
    const partName = targets.get(relationId);
    if (!partName) continue;
    sheets.push({ name, partName });
  }
  if (sheets.length === 0) throw new DocumentFormatError("Excel 工作簿里没有可读的 sheet");
  return { entries, sheets };
}

/** rels 里的 Target 可能是 `worksheets/sheet1.xml` 或 `/xl/worksheets/sheet1.xml`。 */
function normalizePartTarget(target: string): string {
  const trimmed = target.replace(/^\//, "");
  return trimmed.startsWith("xl/") ? trimmed : `xl/${trimmed}`;
}

function sheetNames(buffer: Buffer): string[] {
  return workbookParts(buffer).sheets.map((sheet) => sheet.name);
}

function sheetPartOf(buffer: Buffer, sheetName: string): { entries: ZipEntry[]; partName: string; sheets: { name: string; partName: string }[] } {
  const parts = workbookParts(buffer);
  const wanted = sheetName.trim().toLowerCase();
  const found = parts.sheets.find((sheet) => sheet.name.toLowerCase() === wanted);
  if (!found) {
    throw new DocumentSheetError(
      `工作簿里没有名为「${sheetName}」的 sheet。现有 sheet：${parts.sheets.map((sheet) => sheet.name).join("、")}`,
    );
  }
  return { entries: parts.entries, partName: found.partName, sheets: parts.sheets };
}

// ─────────────────────────── 读单元格 ───────────────────────────

function sharedStrings(entries: ZipEntry[]): string[] {
  const xml = zipText(entries, "xl/sharedStrings.xml");
  if (!xml) return [];
  const parts = new XmlParts(xml);
  return parts.elements("si").map((span) => {
    let text = "";
    for (const node of parts.all(span.innerStart, span.innerEnd)) {
      if (node.name === "t") text += parts.inner(node);
    }
    return text;
  });
}

interface ParsedCell {
  reference: string | null;
  row: number;
  column: number;
  xml: string;
  value: string;
}

function cellValue(parts: XmlParts, cell: { innerStart: number; innerEnd: number; attrs: string }, shared: string[]): string {
  const type = xmlAttr(cell.attrs, "t") ?? "n";
  if (type === "s") {
    const index = Number(parts.text("v", cell.innerStart, cell.innerEnd));
    return Number.isInteger(index) ? shared[index] ?? "" : "";
  }
  if (type === "inlineStr") {
    let text = "";
    for (const node of parts.all(cell.innerStart, cell.innerEnd)) if (node.name === "t") text += parts.inner(node);
    return text;
  }
  if (type === "b") return parts.text("v", cell.innerStart, cell.innerEnd) === "1" ? "TRUE" : "FALSE";
  // `str`（公式结果）、`e`（错误值）以及默认的数字都取 v 节点的原文。
  return parts.text("v", cell.innerStart, cell.innerEnd);
}

function parseSheetCells(sheetXml: string, shared: string[]): Map<number, Map<number, ParsedCell>> {
  const parts = new XmlParts(sheetXml);
  const rows = new Map<number, Map<number, ParsedCell>>();
  const data = parts.first("sheetData");
  if (!data) return rows;

  let implicitRow = 0;
  for (const row of parts.children("row", data)) {
    const declared = Number(xmlAttr(row.attrs, "r"));
    implicitRow = Number.isInteger(declared) && declared > 0 ? declared : implicitRow + 1;
    const rowNumber = implicitRow;
    const cells = new Map<number, ParsedCell>();
    let implicitColumn = 0;
    for (const cell of parts.children("c", row)) {
      const reference = xmlAttr(cell.attrs, "r");
      let column: number;
      if (reference) {
        try {
          column = parseCellReference(reference).column;
        } catch {
          implicitColumn += 1;
          column = implicitColumn;
        }
      } else {
        implicitColumn += 1;
        column = implicitColumn;
      }
      implicitColumn = column;
      cells.set(column, {
        reference: reference ?? null,
        row: rowNumber,
        column,
        xml: parts.outer(cell),
        value: cellValue(parts, cell, shared),
      });
    }
    rows.set(rowNumber, cells);
  }
  return rows;
}

export function readSheetRange(buffer: Buffer, sheetName: string, range: string): SheetReadResult {
  const bounds = parseRange(range);
  const { entries, partName } = sheetPartOf(buffer, sheetName);
  const sheetXml = zipText(entries, partName);
  if (!sheetXml) throw new DocumentFormatError(`Excel 工作簿缺少部件 ${partName}`);
  const rows = parseSheetCells(sheetXml, sharedStrings(entries));

  const cells: SheetCell[] = [];
  const grid: string[][] = [];
  for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
    const line: string[] = [];
    const sheetRow = rows.get(row);
    for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
      const cell = sheetRow?.get(column);
      line.push(cell?.value ?? "");
      cells.push({
        reference: formatCellReference(row, column),
        row,
        column,
        value: cell?.value ?? "",
      });
    }
    grid.push(line);
  }
  return { sheet: sheetName, range, rows: grid, cells };
}

export function summarizeWorkbook(buffer: Buffer): SheetSummary[] {
  const { entries, sheets } = workbookParts(buffer);
  const shared = sharedStrings(entries);
  return sheets.map((sheet) => {
    const xml = zipText(entries, sheet.partName);
    const rows = xml ? parseSheetCells(xml, shared) : new Map<number, Map<number, ParsedCell>>();
    let maxRow = 0;
    let maxColumn = 0;
    for (const [rowNumber, cells] of rows) {
      maxRow = Math.max(maxRow, rowNumber);
      for (const column of cells.keys()) maxColumn = Math.max(maxColumn, column);
    }
    return { name: sheet.name, rows: maxRow, columns: maxColumn };
  });
}

// ─────────────────────────── 新建工作簿 ───────────────────────────

/**
 * Excel 只把「看起来像数字」的文本当数字：15 位有效数字以内、没有前导零（`007` 是
 * 文本不是 7）、不含指数写法（`1e5` 在不同阅读器里表现不一致）。
 */
const NUMERIC_LITERAL = /^-?(0|[1-9]\d{0,14})(\.\d{1,10})?$/;

function cellXml(reference: string, value: unknown): string {
  // 工具层已经约束成字符串，但纯逻辑层自己再挡一道：模型偶尔会传数字。
  const text = value === null || value === undefined ? "" : String(value);
  const trimmed = text.trim();
  if (NUMERIC_LITERAL.test(trimmed)) return `<c r="${reference}"><v>${trimmed}</v></c>`;
  if (text === "") return `<c r="${reference}"/>`;
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(text)}</t></is></c>`;
}

function sheetXml(rows: string[][]): string {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => cellXml(formatCellReference(rowIndex + 1, columnIndex + 1), value))
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `${XML_DECLARATION}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>${body}</sheetData></worksheet>`;
}

/** sheet 名在 Excel 里的硬限制：`[]:*?/\` 与 31 字符。 */
export function normalizeSheetName(name: string, taken: string[]): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, "_").trim() || "Sheet";
  const truncated = cleaned.slice(0, 31);
  if (!taken.includes(truncated)) return truncated;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${truncated.slice(0, 31 - String(suffix).length - 1)}_${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
  throw new DocumentSheetError("无法为 sheet 生成唯一名字");
}

export interface NewSheet {
  name: string;
  rows?: string[][];
}

export function buildWorkbook(sheets: NewSheet[]): Buffer {
  const taken: string[] = [];
  const normalized = sheets.map((sheet) => {
    const name = normalizeSheetName(sheet.name, taken);
    taken.push(name);
    return { name, rows: sheet.rows ?? [] };
  });
  if (normalized.length === 0) normalized.push({ name: "Sheet1", rows: [] });

  const sheetEntries: ZipEntry[] = normalized.map((sheet, index) => ({
    name: `xl/worksheets/sheet${index + 1}.xml`,
    data: sheetXml(sheet.rows),
  }));

  const entries: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${normalized
        .map((_sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="${SHEET_CONTENT_TYPE}"/>`)
        .join("")}</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `${XML_DECLARATION}<Relationships ${REL_NS}><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `${XML_DECLARATION}<Relationships ${REL_NS}>${normalized
        .map((_sheet, index) => `<Relationship Id="rId${index + 1}" Type="${OFFICE_REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
        .join("")}<Relationship Id="rIdStyles" Type="${OFFICE_REL}/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `${XML_DECLARATION}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${OFFICE_REL}"><sheets>${normalized
        .map((sheet, index) => `<sheet name="${escapeXmlText(sheet.name).replace(/"/g, "&quot;")}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
        .join("")}</sheets></workbook>`,
    },
    { name: "xl/styles.xml", data: stylesXml() },
    ...sheetEntries,
  ];
  return writeZipEntries(entries);
}

function stylesXml(): string {
  return `${XML_DECLARATION}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;
}

// ─────────────────────────── 写单元格 ───────────────────────────

/**
 * 把一个矩形区域的值写进 sheet（0 起偏移由 `startCell` 决定）。
 * 只替换命中的 `<c>`，行内其它单元（含样式与公式）与其它部件原样保留。
 */
export function writeSheetRange(
  buffer: Buffer,
  sheetName: string,
  startCell: string,
  values: string[][],
): { buffer: Buffer; written: string[] } {
  if (values.length === 0) throw new DocumentCellAddressError("没有要写入的值（values 是空数组）");
  const start = parseCellReference(startCell);
  const columnCount = values.reduce((max, row) => Math.max(max, row.length), 0);
  if (start.column + columnCount - 1 > COLUMN_INDEX_LIMIT) throw new DocumentCellAddressError("写入区域超出工作表列上限");
  if (start.row + values.length - 1 > ROW_INDEX_LIMIT) throw new DocumentCellAddressError("写入区域超出工作表行上限");

  const { entries, partName } = sheetPartOf(buffer, sheetName);
  const sheetXml = zipText(entries, partName);
  if (!sheetXml) throw new DocumentFormatError(`Excel 工作簿缺少部件 ${partName}`);

  const parts = new XmlParts(sheetXml);
  const data = parts.first("sheetData");
  if (!data) throw new DocumentFormatError(`工作表 ${sheetName} 缺少 sheetData`);

  const rows: { number: number; xml: string }[] = [];
  let implicitRow = 0;
  for (const row of parts.children("row", data)) {
    const declared = Number(xmlAttr(row.attrs, "r"));
    implicitRow = Number.isInteger(declared) && declared > 0 ? declared : implicitRow + 1;
    rows.push({ number: implicitRow, xml: parts.outer(row) });
  }

  const written: string[] = [];
  values.forEach((line, rowOffset) => {
    const rowNumber = start.row + rowOffset;
    line.forEach((value, columnOffset) => {
      const column = start.column + columnOffset;
      written.push(formatCellReference(rowNumber, column));
      const existing = rows.find((row) => row.number === rowNumber);
      if (!existing) {
        rows.push({ number: rowNumber, xml: `<row r="${rowNumber}">${cellXml(formatCellReference(rowNumber, column), value)}</row>` });
        return;
      }
      existing.xml = upsertCell(new XmlParts(existing.xml), existing.xml, rowNumber, column, value);
    });
  });

  rows.sort((left, right) => left.number - right.number);
  const rendered = rows.map((row) => row.xml).join("");
  let document = sheetXml.slice(0, data.innerStart) + rendered + sheetXml.slice(data.innerEnd);
  document = refreshDimension(document);

  const updated = withZipEntry(entries, partName, document);
  return { buffer: writeZipEntries(updated), written };
}

/** 用新的 `<c>` 顶掉同一坐标的旧单元，其余单元按列序插入到正确位置。 */
function upsertCell(parts: XmlParts, rowXml: string, rowNumber: number, column: number, value: string): string {
  const reference = formatCellReference(rowNumber, column);
  const replacement = cellXml(reference, value);
  const cells = parts.elements("c");
  let insertAt = rowXml.length;
  let replaced = false;
  for (const cell of cells) {
    const cellReference = xmlAttr(cell.attrs, "r");
    let cellColumn = 0;
    if (cellReference) {
      try {
        cellColumn = parseCellReference(cellReference).column;
      } catch {
        cellColumn = 0;
      }
    }
    if (cellReference === reference) {
      rowXml = rowXml.slice(0, cell.start) + replacement + rowXml.slice(cell.end);
      replaced = true;
      break;
    }
    if (cellColumn > column) {
      insertAt = cell.start;
      break;
    }
  }
  if (replaced) return rowXml;
  return rowXml.slice(0, insertAt) + replacement + rowXml.slice(insertAt);
}

/** `<dimension>` 过期会让部分阅读器少报数据，按现有行重算一次。 */
function refreshDimension(sheetXml: string): string {
  const parts = new XmlParts(sheetXml);
  const data = parts.first("sheetData");
  const dimension = parts.first("dimension");
  if (!data || !dimension) return sheetXml;
  let maxRow = 0;
  let maxColumn = 0;
  for (const row of parts.children("row", data)) {
    const declared = Number(xmlAttr(row.attrs, "r"));
    if (Number.isInteger(declared) && declared > 0) maxRow = Math.max(maxRow, declared);
    for (const cell of parts.children("c", row)) {
      const reference = xmlAttr(cell.attrs, "r");
      if (!reference) continue;
      try {
        const position = parseCellReference(reference);
        maxRow = Math.max(maxRow, position.row);
        maxColumn = Math.max(maxColumn, position.column);
      } catch {
        // 地址损坏的行不影响 dimension 的一致性，跳过即可。
      }
    }
  }
  const ref = maxRow === 0 || maxColumn === 0 ? "A1" : `A1:${formatCellReference(maxRow, maxColumn)}`;
  return sheetXml.slice(0, dimension.start) + `<dimension ref="${ref}"/>` + sheetXml.slice(dimension.end);
}

/** 包一层：ZIP 异常翻译成格式错误。 */
export function readWorkbook(buffer: Buffer): SheetSummary[] {
  try {
    return summarizeWorkbook(buffer);
  } catch (error) {
    if (error instanceof DocumentFormatError || error instanceof DocumentSheetError) throw error;
    if (error instanceof DocumentZipError) throw new DocumentFormatError(`无法读取 .xlsx：${error.message}`);
    throw error;
  }
}