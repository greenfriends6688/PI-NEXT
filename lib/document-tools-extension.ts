import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionToolContext,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import {
  DocumentFormatError as DocxFormatError,
  buildDocx,
  readDocxStructure,
  replaceDocxParagraph,
  replaceDocxTableCell,
  type DocxBlock,
} from "./document-docx";
import {
  DocumentCellAddressError,
  DocumentFormatError as XlsxFormatError,
  DocumentSheetError,
  buildWorkbook,
  columnIndexToLabel,
  parseRange,
  readSheetRange,
  summarizeWorkbook,
  writeSheetRange,
} from "./document-xlsx";
import {
  DocumentFormatError as PdfFormatError,
  buildPdf,
  readPdf,
} from "./document-pdf";
import {
  DocumentFormatError as PptxFormatError,
  buildPresentation,
  readPresentation,
  updateSlide,
} from "./document-pptx";
import {
  DocumentPathError,
  assertExpectedExtension,
  authorizeExistingDocument,
  authorizeNewDocument,
  readDocumentBytes,
  resolveDocumentTarget,
  writeDocumentBytesAtomic,
} from "./document-files";

/**
 * fork:proma-53 — 文档处理工具（docx / xlsx / pptx / pdf）。
 *
 * WHY 是工具而不是 skill（AGENTS.md「产品能力不许降级成 skill」）：这 11 个工具
 * **写文件、改状态**，所以必须有工具名 —— 可拦（`tool_call` 审批引擎拦的是工具）、
 * 可统计（进 token / session 侧证）、有 UI 入口（消息流里的 tool call +
 * 「本轮写入文件」chip，因为名字是 `write_*` / `edit_*`，`lib/turn-written-files.ts`
 * 已经认这两个前缀）。
 *
 * 工具名的形状对齐 pi 自带的 `read` / `write` / `edit`：`read_<格式>` / `write_<格式>`
 * / `edit_<格式>`。这样 `lib/tool-names.ts` 的前缀判定天然生效，不需要改任何既有代码。
 *
 * 格式处理全部是 `lib/document-*.ts` 里自己写的最小实现（ZIP + OOXML / PDF 直写），
 * **没有新增任何依赖**：仓库里没有 `docx` / `exceljs` / `pptxgenjs` / `pdf-lib`，
 * 也没有 OfficeCLI 那种随包分发的子进程二进制（Proma 靠它，本仓没有这条链路，
 * 引入它等于引入一个要下载、校验、随 electron 打包的第三方可执行文件）。
 *
 * 注册在 `lib/rpc-manager.ts` 的 `extensionFactories` 里（由集成方加一行），名字固定
 * 为 `pi-web-documents`。
 */

export const HOST_DOCUMENT_EXTENSION_NAME = "pi-web-documents";

/** 只读工具名：集成方可把它们加进 `lib/approval-policy.ts` 的 `READ_ONLY_TOOLS`。 */
export const DOCUMENT_READ_TOOL_NAMES = ["read_docx", "read_xlsx", "read_pptx", "read_pdf"] as const;

/** 会写文件的工具名。 */
export const DOCUMENT_WRITE_TOOL_NAMES = [
  "write_docx",
  "edit_docx",
  "write_xlsx",
  "edit_xlsx",
  "write_pptx",
  "edit_pptx",
  "write_pdf",
] as const;

export interface DocumentToolsOptions {
  /**
   * 授权用的允许目录集合。默认 `getAllowedFileRoots()` —— 与文件浏览器 / `/api/files`
   * 完全同一套 roots，文档工具因此**只能**碰用户在文件树里已经能看到的目录。
   * 注入点是为了让测试不依赖会话数据库。
   */
  getRoots?: () => Promise<Set<string>>;
}

const DEFAULT_READ_PARAGRAPHS = 300;
const DEFAULT_READ_TABLES = 10;
const DEFAULT_SHEET_ROWS = 200;
const DEFAULT_SHEET_COLUMNS = 40;

interface ToolSuccess {
  text: string;
  details: Record<string, unknown>;
}

type DocumentContext = Pick<ExtensionToolContext, "cwd">;

function errorMessage(error: unknown): string {
  if (error instanceof DocumentPathError) return `${error.message}`;
  if (
    error instanceof DocxFormatError ||
    error instanceof XlsxFormatError ||
    error instanceof PptxFormatError ||
    error instanceof PdfFormatError ||
    error instanceof DocumentCellAddressError ||
    error instanceof DocumentSheetError
  ) {
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** 统一的错误出口：错误文本进 `content`，`details` 留给 UI（`isError` 不会被丢掉）。 */
function failure(error: unknown, tool: string, path?: string) {
  return {
    content: [{ type: "text" as const, text: `${tool} 失败：${errorMessage(error)}` }],
    details: { tool, ok: false, path: path ?? null, error: errorMessage(error) },
    isError: true,
  };
}

function success(result: ToolSuccess, tool: string) {
  return {
    content: [{ type: "text" as const, text: result.text }],
    details: { tool, ok: true, ...result.details },
  };
}

/** 读路径：解析 → 扩展名校验 → 授权 → 读字节。 */
async function loadDocument(requested: string, extension: string, context: DocumentContext, getRoots: () => Promise<Set<string>>): Promise<{ target: string; bytes: Buffer }> {
  const target = resolveDocumentTarget(requested, context.cwd);
  assertExpectedExtension(target, extension);
  authorizeExistingDocument(target, await getRoots());
  return { target, bytes: readDocumentBytes(target) };
}

/** 新建路径：解析 → 扩展名校验 → 授权（含是否允许覆盖）→ 原子落盘。 */
async function saveDocument(
  requested: string,
  extension: string,
  bytes: Buffer,
  overwrite: boolean,
  context: DocumentContext,
  getRoots: () => Promise<Set<string>>,
): Promise<string> {
  const target = resolveDocumentTarget(requested, context.cwd);
  assertExpectedExtension(target, extension);
  authorizeNewDocument(target, await getRoots(), overwrite);
  writeDocumentBytesAtomic(target, bytes);
  return target;
}

function truncateNote(shown: number, total: number, unit: string): string {
  return shown < total ? `（只显示前 ${shown} ${unit}，共 ${total} ${unit}）` : "";
}

// ─────────────────────────── 结果渲染 ───────────────────────────

function renderDocxStructure(structure: ReturnType<typeof readDocxStructure>): string {
  const lines: string[] = [];
  const shown = structure.paragraphs.slice(0, DEFAULT_READ_PARAGRAPHS);
  lines.push(`顶层段落 ${structure.paragraphs.length} 个${truncateNote(shown.length, structure.paragraphs.length, "段落")}，表格 ${structure.tables.length} 张`);
  for (const paragraph of shown) {
    lines.push(`[${paragraph.index}]${paragraph.style ? `(${paragraph.style})` : ""} ${paragraph.text}`);
  }
  for (const table of structure.tables.slice(0, DEFAULT_READ_TABLES)) {
    lines.push(`表格 ${table.index}：${table.rows} 行 × ${table.columns} 列`);
    for (const cell of table.cells) lines.push(`  (${cell.row},${cell.column}) ${cell.text.replace(/\n/g, " ⏎ ")}`);
  }
  const hidden = structure.tables.length - Math.min(structure.tables.length, DEFAULT_READ_TABLES);
  if (hidden > 0) lines.push(`（另有 ${hidden} 张表未展开）`);
  return lines.join("\n");
}

function renderSheetGrid(rows: string[][], startRow: number, columnLabels: string[]): string {
  const lines = [`     ${columnLabels.map((label) => label.padEnd(12)).join(" ").trimEnd()}`];
  rows.forEach((line, rowOffset) => {
    const prefix = String(startRow + rowOffset).padStart(4, " ");
    lines.push(
      `${prefix}  ${line.map((value) => (value.length > 12 ? `${value.slice(0, 11)}…` : value).padEnd(12)).join(" ").trimEnd()}`.trimEnd(),
    );
  });
  return lines.join("\n");
}

export function createDocumentToolsExtension(options: DocumentToolsOptions = {}): InlineExtension {
  const getRoots = options.getRoots ?? defaultRoots;
  return {
    name: HOST_DOCUMENT_EXTENSION_NAME,
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      pi.registerTool(defineTool({
        name: "read_docx",
        label: "Read Word document",
        description: [
          "Read the structure of a Word (.docx) file: every top-level paragraph (with its index and style) and every table cell.",
          "Use this before edit_docx — the paragraph and cell indexes printed here are the only addresses edit_docx accepts.",
          "Paragraph indexes are 0-based and count only body-level paragraphs; paragraphs inside table cells are addressed through the table cell list, not the paragraph list.",
          "Fails if the file is not a .docx or is outside the directories you may write to.",
        ].join("\n"),
        promptSnippet: "Read paragraphs and table cells out of a Word .docx",
        parameters: Type.Object({
          path: Type.String({ description: "Path to the .docx file (relative to the working directory, or absolute)" }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, context) {
          const tool = "read_docx";
          try {
            const { target, bytes } = await loadDocument(params.path, ".docx", context, getRoots);
            const structure = readDocxStructure(bytes);
            return success(
              {
                text: `文件：${target}\n${renderDocxStructure(structure)}`,
                details: { format: "docx", path: target, structure },
              },
              tool,
            );
          } catch (error) {
            return failure(error, tool, params.path);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "write_docx",
        label: "Write Word document",
        description: [
          "Create a new Word (.docx) document from an ordered list of blocks.",
          "Blocks, in the order given:",
          '  {"type":"heading","level":1,"text":"..."}  level 1-3',
          '  {"type":"paragraph","text":"..."}',
          '  {"type":"bullet","text":"..."} / {"type":"numbered","text":"..."}  consecutive items of one kind become one list',
          '  {"type":"table","rows":[["a","b"],["1","2"]]}  every row should have the same number of columns',
          "The path must end in .docx and must be inside a directory you may write to. Refuses to overwrite an existing file unless overwrite is true.",
          "This generates a fresh document — it cannot copy formatting from another file. To change an existing document, use edit_docx instead.",
        ].join("\n"),
        promptSnippet: "Create a new Word .docx from structured blocks",
        parameters: Type.Object({
          path: Type.String({ description: "Path of the .docx to create (relative to the working directory, or absolute)" }),
          title: Type.Optional(Type.String({ description: "Document title, stored in the file properties" })),
          blocks: Type.Array(Type.Object({
            type: Type.Union([Type.Literal("heading"), Type.Literal("paragraph"), Type.Literal("bullet"), Type.Literal("numbered"), Type.Literal("table")]),
            text: Type.Optional(Type.String({ description: "Text, for heading / paragraph / bullet / numbered" })),
            level: Type.Optional(Type.Number({ description: "Heading level 1-3 (heading only)" })),
            rows: Type.Optional(Type.Array(Type.Array(Type.String(), { description: "One table row" }), { description: "Table rows, each row an array of cell strings (table only)" })),
          }), { description: "Content blocks in document order" }),
          overwrite: Type.Optional(Type.Boolean({ description: "Allow replacing an existing file (default false)" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, context) {
          const tool = "write_docx";
          try {
            const blocks: DocxBlock[] = params.blocks.map((block) => {
              if (block.type === "table") {
                const rows = block.rows ?? [];
                if (rows.length === 0) throw new Error("table 块缺少 rows");
                return { type: "table", rows };
              }
              return {
                type: block.type,
                text: block.text ?? "",
                ...(block.type === "heading" ? { level: block.level ?? 1 } : {}),
              } as DocxBlock;
            });
            if (blocks.length === 0) throw new Error("blocks 是空的，文档里什么都没有");
            const target = await saveDocument(params.path, ".docx", buildDocx(blocks, { title: params.title }), params.overwrite ?? false, context, getRoots);
            return success(
              { text: `已写入 ${target}（${blocks.length} 个内容块）`, details: { format: "docx", path: target, blocks: blocks.length } },
              tool,
            );
          } catch (error) {
            return failure(error, tool, params.path);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "edit_docx",
        label: "Edit Word document",
        description: [
          "Replace the text of one paragraph or one table cell in an existing Word (.docx) file.",
          'Call with target "paragraph" plus paragraph_index, or target "table_cell" plus table_index / row / column. All indexes are 0-based.',
          "The paragraph keeps its style and its first run's character formatting; the paragraph's other runs are dropped, so this replaces the text rather than merging into it.",
          "Every other part of the file is written back byte for byte. The file is replaced atomically — a failed call leaves the original untouched.",
        ].join("\n"),
        promptSnippet: "Replace one paragraph or table cell in a Word .docx",
        parameters: Type.Object({
          path: Type.String({ description: "Path to the .docx file" }),
          target: Type.Union([Type.Literal("paragraph"), Type.Literal("table_cell")]),
          text: Type.String({ description: "Replacement text (\n becomes a line break inside the paragraph)" }),
          paragraph_index: Type.Optional(Type.Number({ description: "0-based body paragraph index (target=paragraph)" })),
          table_index: Type.Optional(Type.Number({ description: "0-based table index (target=table_cell)" })),
          row: Type.Optional(Type.Number({ description: "0-based row index (target=table_cell)" })),
          column: Type.Optional(Type.Number({ description: "0-based column index (target=table_cell)" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, context) {
          const tool = "edit_docx";
          try {
            const { target, bytes } = await loadDocument(params.path, ".docx", context, getRoots);
            let updated: Buffer;
            let what: string;
            if (params.target === "paragraph") {
              if (typeof params.paragraph_index !== "number") throw new Error("target=paragraph 时必须给 paragraph_index");
              updated = replaceDocxParagraph(bytes, params.paragraph_index, params.text);
              what = `段落 ${params.paragraph_index}`;
            } else {
              for (const key of ["table_index", "row", "column"] as const) {
                if (typeof params[key] !== "number") throw new Error(`target=table_cell 时必须给 ${key}`);
              }
              updated = replaceDocxTableCell(bytes, params.table_index as number, params.row as number, params.column as number, params.text);
              what = `表格 ${params.table_index} 的 (${params.row},${params.column}) 单元`;
            }
            authorizeNewDocument(target, await getRoots(), true);
            writeDocumentBytesAtomic(target, updated);
            return success({ text: `已改写 ${target} 的${what}`, details: { format: "docx", path: target, target: params.target } }, tool);
          } catch (error) {
            return failure(error, tool, params.path);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "read_xlsx",
        label: "Read Excel workbook",
        description: [
          "Read a cell range out of an Excel (.xlsx) workbook.",
          "With no sheet, lists every sheet with its used range (rows x columns).",
          "With a sheet and no range, returns the first 200 rows x 40 columns of that sheet.",
          'A range is one cell ("B2") or a rectangle ("B2:D10"), A1 style, 1-based.',
          "Cells come back as display values: shared strings, inline strings, numbers and booleans are all resolved.",
        ].join("\n"),
        promptSnippet: "Read sheets and cell ranges out of an Excel .xlsx",
        parameters: Type.Object({
          path: Type.String({ description: "Path to the .xlsx file" }),
          sheet: Type.Optional(Type.String({ description: "Sheet name (case-insensitive). Omit to list the sheets" })),
          range: Type.Optional(Type.String({ description: 'Cell or range, e.g. "B2" or "B2:D10"' })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, context) {
          const tool = "read_xlsx";
          try {
            const { target, bytes } = await loadDocument(params.path, ".xlsx", context, getRoots);
            if (!params.sheet) {
              const sheets = summarizeWorkbook(bytes);
              const text = [
                `文件：${target}`,
                `sheet ${sheets.length} 个：`,
                ...sheets.map((sheet) => `  ${sheet.name}：${sheet.rows} 行 × ${sheet.columns} 列`),
              ].join("\n");
              return success({ text, details: { format: "xlsx", path: target, sheets } }, tool);
            }
            const range = params.range ?? `A1:${columnIndexToLabel(DEFAULT_SHEET_COLUMNS)}${DEFAULT_SHEET_ROWS}`;
            const result = readSheetRange(bytes, params.sheet, range);
            const bounds = parseRange(result.range);
            const labels = Array.from({ length: bounds.endColumn - bounds.startColumn + 1 }, (_unused, offset) =>
              columnIndexToLabel(bounds.startColumn + offset),
            );
            return success(
              {
                text: `文件：${target}　sheet「${result.sheet}」　区域 ${result.range}\n${renderSheetGrid(result.rows, bounds.startRow, labels)}`,
                details: { format: "xlsx", path: target, sheet: result.sheet, range: result.range, rows: result.rows },
              },
              tool,
            );
          } catch (error) {
            return failure(error, tool, params.path);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "write_xlsx",
        label: "Write Excel workbook",
        description: [
          "Create a new Excel (.xlsx) workbook, one or more sheets, each starting from a rectangular block of values.",
          'sheets: [{"name":"Sheet1","rows":[["item","count"],["apples",3]]}]  rows is optional (an empty sheet)',
          'Values that look like plain numbers are stored as numbers; everything else is stored as text.',
          "The path must end in .xlsx and be inside a directory you may write to. Refuses to overwrite an existing file unless overwrite is true. To change an existing workbook, use edit_xlsx.",
        ].join("\n"),
        promptSnippet: "Create a new Excel .xlsx workbook with sheets",
        parameters: Type.Object({
          path: Type.String({ description: "Path of the .xlsx to create" }),
          sheets: Type.Array(Type.Object({
            name: Type.String({ description: "Sheet name (max 31 characters)" }),
            rows: Type.Optional(Type.Array(Type.Array(Type.String(), { description: "One row of cell values as strings" }))),
          }), { description: "Sheets in workbook order" }),
          overwrite: Type.Optional(Type.Boolean({ description: "Allow replacing an existing file (default false)" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, context) {
          const tool = "write_xlsx";
          try {
            if (params.sheets.length === 0) throw new Error("sheets 是空的，至少要一个 sheet");
            const target = await saveDocument(params.path, ".xlsx", buildWorkbook(params.sheets), params.overwrite ?? false, context, getRoots);
            return success(
              { text: `已写入 ${target}（${params.sheets.length} 个 sheet）`, details: { format: "xlsx", path: target, sheets: params.sheets.map((sheet) => sheet.name) } },
              tool,
            );
          } catch (error) {
            return failure(error, tool, params.path);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "edit_xlsx",
        label: "Edit Excel cells",
        description: [
          "Write a rectangular block of values into one sheet of an existing Excel (.xlsx) workbook.",
          'start_cell is the top-left address of the block ("B2"); values is a rectangular array of strings, row by row.',
          'Example: start_cell "B2" with values [["a","b"],["c","d"]] fills B2:C3.',
          "Cells outside the block — including their styling and formulas — are left exactly as they were. Missing rows and columns are created. The file is replaced atomically.",
          "This cannot add a new sheet: create the sheet with write_xlsx first.",
        ].join("\n"),
        promptSnippet: "Write a cell range into an existing Excel .xlsx",
        parameters: Type.Object({
          path: Type.String({ description: "Path to the .xlsx file" }),
          sheet: Type.String({ description: "Sheet name (case-insensitive)" }),
          start_cell: Type.String({ description: 'Top-left cell of the block, e.g. "B2"' }),
          values: Type.Array(Type.Array(Type.String(), { description: "One row of cell values" }), { description: "Rectangular block, row by row" }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, context) {
          const tool = "edit_xlsx";
          try {
            const { target, bytes } = await loadDocument(params.path, ".xlsx", context, getRoots);
            const result = writeSheetRange(bytes, params.sheet, params.start_cell, params.values);
            authorizeNewDocument(target, await getRoots(), true);
            writeDocumentBytesAtomic(target, result.buffer);
            return success(
              { text: `已写入 ${target} 的 sheet「${params.sheet}」：${result.written.length} 个单元格（${result.written[0]} … ${result.written[result.written.length - 1]}）`, details: { format: "xlsx", path: target, sheet: params.sheet, cells: result.written } },
              tool,
            );
          } catch (error) {
            return failure(error, tool, params.path);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "read_pptx",
        label: "Read PowerPoint slides",
        description: [
          "Read a PowerPoint (.pptx) deck: one entry per slide with its 0-based index, title and bullet points, in presentation order.",
          "The title comes from a title placeholder when the deck has one, otherwise from the first shape with text; bullets come from the body placeholder, otherwise from the next shape with text.",
          "This reads text only — images, charts and SmartArt are not described.",
        ].join("\n"),
        promptSnippet: "Read slide titles and bullets out of a PowerPoint .pptx",
        parameters: Type.Object({
          path: Type.String({ description: "Path to the .pptx file" }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, context) {
          const tool = "read_pptx";
          try {
            const { target, bytes } = await loadDocument(params.path, ".pptx", context, getRoots);
            const deck = readPresentation(bytes);
            const lines = [`文件：${target}`, `共 ${deck.slides.length} 页`];
            for (const slide of deck.slides) {
              lines.push(`[${slide.index}] ${slide.title || "(无标题)"}`);
              for (const bullet of slide.bullets) lines.push(`    · ${bullet}`);
            }
            return success({ text: lines.join("\n"), details: { format: "pptx", path: target, slides: deck.slides, title: deck.title } }, tool);
          } catch (error) {
            return failure(error, tool, params.path);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "write_pptx",
        label: "Write PowerPoint deck",
        description: [
          "Create a new PowerPoint (.pptx) deck, one slide per entry, each with a title and bullet points.",
          'slides: [{"title":"Q3","bullets":["revenue up","churn down"]}]  bullets is optional',
          "16:9 slides; the title and body are absolutely positioned text boxes on a blank layout, so there is no per-slide master styling to pick.",
          "The path must end in .pptx and be inside a directory you may write to. Refuses to overwrite an existing file unless overwrite is true. To change an existing deck, use edit_pptx.",
        ].join("\n"),
        promptSnippet: "Create a new PowerPoint .pptx from slides",
        parameters: Type.Object({
          path: Type.String({ description: "Path of the .pptx to create" }),
          slides: Type.Array(Type.Object({
            title: Type.String({ description: "Slide title" }),
            bullets: Type.Optional(Type.Array(Type.String(), { description: "Bullet points" })),
          }), { description: "Slides in presentation order" }),
          title: Type.Optional(Type.String({ description: "Deck title, stored in the file properties" })),
          overwrite: Type.Optional(Type.Boolean({ description: "Allow replacing an existing file (default false)" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, context) {
          const tool = "write_pptx";
          try {
            const target = await saveDocument(params.path, ".pptx", buildPresentation(params.slides, { title: params.title }), params.overwrite ?? false, context, getRoots);
            return success(
              { text: `已写入 ${target}（${params.slides.length} 页）`, details: { format: "pptx", path: target, slides: params.slides.length } },
              tool,
            );
          } catch (error) {
            return failure(error, tool, params.path);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "edit_pptx",
        label: "Edit PowerPoint slide",
        description: [
          "Replace the title and/or the bullet points of one slide in an existing PowerPoint (.pptx) deck.",
          "Give a 0-based slide index as reported by read_pptx, and at least one of title / bullets. Setting bullets replaces all of them.",
          "The slide's shapes, positions and every other part of the file are preserved; only the text bodies of the title and body boxes are rewritten. The file is replaced atomically.",
        ].join("\n"),
        promptSnippet: "Replace the title or bullets of one slide in a .pptx",
        parameters: Type.Object({
          path: Type.String({ description: "Path to the .pptx file" }),
          slide: Type.Number({ description: "0-based slide index, as reported by read_pptx" }),
          title: Type.Optional(Type.String({ description: "New slide title" })),
          bullets: Type.Optional(Type.Array(Type.String(), { description: "New bullet points (replaces all existing ones)" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, context) {
          const tool = "edit_pptx";
          try {
            const { target, bytes } = await loadDocument(params.path, ".pptx", context, getRoots);
            const updated = updateSlide(bytes, params.slide, { title: params.title, bullets: params.bullets });
            authorizeNewDocument(target, await getRoots(), true);
            writeDocumentBytesAtomic(target, updated);
            return success({ text: `已改写 ${target} 的第 ${params.slide} 页`, details: { format: "pptx", path: target, slide: params.slide } }, tool);
          } catch (error) {
            return failure(error, tool, params.path);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "read_pdf",
        label: "Read PDF",
        description: [
          "Read a PDF: its page count and, for the pages that have a text layer, the text of each page.",
          "By default the first 10 pages are read; raise max_pages to go further (hard cap 50 pages / 40000 characters).",
          "This extracts text drawn with text operators. Scanned pages, pages whose text was converted to outlines, and fonts with custom encodings can come back empty — an empty page means \"no extractable text\", not \"blank page\".",
          "Encrypted PDFs return the page count only.",
        ].join("\n"),
        promptSnippet: "Read the page count and text of a PDF",
        parameters: Type.Object({
          path: Type.String({ description: "Path to the .pdf file" }),
          max_pages: Type.Optional(Type.Number({ description: "How many pages to extract (default 10, max 50)" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, context) {
          const tool = "read_pdf";
          try {
            const { target, bytes } = await loadDocument(params.path, ".pdf", context, getRoots);
            const maxPages = Math.min(50, Math.max(1, Math.trunc(params.max_pages ?? 10)));
            const result = readPdf(bytes, { maxPages });
            const lines = [`文件：${target}`, `共 ${result.pageCount} 页`];
            for (const page of result.pages) lines.push(`--- 第 ${page.page} 页 ---\n${page.text}`);
            if (result.pages.length === 0) lines.push("（没有抽出任何文本：可能是扫描件或文字已转曲）");
            if (result.truncated) lines.push(`（结果已截断，只返回了部分页 / 部分字符）`);
            for (const warning of result.warnings) lines.push(`注意：${warning}`);
            return success({ text: lines.join("\n"), details: { format: "pdf", path: target, pageCount: result.pageCount, pages: result.pages, truncated: result.truncated, warnings: result.warnings } }, tool);
          } catch (error) {
            return failure(error, tool, params.path);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "write_pdf",
        label: "Write PDF",
        description: [
          "Generate a simple text PDF: one entry per page, laid out with Helvetica in WinAnsi encoding.",
          'pages: [{"text":"first page\\nsecond line"}]',
          "Long lines are wrapped and pages break automatically; there is no way to control margins, images, tables or fonts. Non-Latin-1 characters (CJK included) become \"?\", and the result says how many were replaced — for Chinese documents write a .docx and let the user export it, instead.",
          "The path must end in .pdf and be inside a directory you may write to. Refuses to overwrite an existing file unless overwrite is true.",
        ].join("\n"),
        promptSnippet: "Generate a simple text PDF",
        parameters: Type.Object({
          path: Type.String({ description: "Path of the .pdf to create" }),
          pages: Type.Array(Type.Object({
            text: Type.String({ description: "Page text; \\n starts a new line" }),
          }), { description: "Pages in order" }),
          title: Type.Optional(Type.String({ description: "Document title, stored in the file properties" })),
          font_size: Type.Optional(Type.Number({ description: "Font size 6-24 (default 11)" })),
          overwrite: Type.Optional(Type.Boolean({ description: "Allow replacing an existing file (default false)" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, context) {
          const tool = "write_pdf";
          try {
            const built = buildPdf(params.pages, { title: params.title, fontSize: params.font_size });
            const target = await saveDocument(params.path, ".pdf", built.bytes, params.overwrite ?? false, context, getRoots);
            const note = built.replacedCharacters > 0
              ? `（${built.replacedCharacters} 个非 WinAnsi 字符被替换成了 ?）`
              : "";
            return success(
              { text: `已写入 ${target}（${built.pageCount} 页）${note}`, details: { format: "pdf", path: target, pageCount: built.pageCount, replacedCharacters: built.replacedCharacters } },
              tool,
            );
          } catch (error) {
            return failure(error, tool, params.path);
          }
        },
      }));
    },
  };
}

/** 默认的 roots：与文件浏览器同一套（`/api/files` 也用它）。 */
async function defaultRoots(): Promise<Set<string>> {
  const { getAllowedFileRoots } = await import("./file-access");
  return getAllowedFileRoots();
}