import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { readZipEntries } from "./document-zip.ts";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildDocx, readDocxStructure, replaceDocxParagraph, replaceDocxTableCell, DocumentFormatError, DocxIndexError } =
  await jiti.import("./document-docx.ts");

const BLOCKS = [
  { type: "heading", level: 1, text: "项目周报" },
  { type: "paragraph", text: "本周完成 A、B 两件事。" },
  { type: "bullet", text: "A：接口联调" },
  { type: "bullet", text: "B：文档补充" },
  { type: "numbered", text: "第一步" },
  { type: "table", rows: [["指标", "本周", "上周"], ["收入", "120", "100"]] },
];

test("新建 → 读回：段落索引、样式、表格单元都能对上", () => {
  const structure = readDocxStructure(buildDocx(BLOCKS, { title: "周报" }));
  assert.deepEqual(
    structure.paragraphs.map((paragraph) => paragraph.text),
    // 表格块自带一个结尾空段落（两个相邻表格会被 Word 合并），所以末尾多一个空段。
    ["项目周报", "本周完成 A、B 两件事。", "A：接口联调", "B：文档补充", "第一步", ""],
  );
  assert.equal(structure.paragraphs[0].style, "Heading1");
  assert.equal(structure.paragraphs[1].style, null);
  assert.deepEqual(structure.paragraphs.map((paragraph) => paragraph.index), [0, 1, 2, 3, 4, 5]);
  // 表格块自带一个结尾空段落，所以段落总数是 5 + 1。
  assert.equal(structure.paragraphs.length, 6);
  assert.equal(structure.paragraphs[5].text, "");

  assert.equal(structure.tables.length, 1);
  assert.deepEqual(
    { rows: structure.tables[0].rows, columns: structure.tables[0].columns },
    { rows: 2, columns: 3 },
  );
  assert.deepEqual(
    structure.tables[0].cells.map((cell) => [cell.row, cell.column, cell.text]),
    [
      [0, 0, "指标"], [0, 1, "本周"], [0, 2, "上周"],
      [1, 0, "收入"], [1, 1, "120"], [1, 2, "100"],
    ],
  );
});

test("XML 里的非法控制字符被过滤（否则 Word 会拒绝打开整个文件）", () => {
  const structure = readDocxStructure(buildDocx([{ type: "paragraph", text: "a\u0000b\u0007c" }]));
  assert.equal(structure.paragraphs[0].text, "abc");
});

test("换行与制表符写成 OOXML 的 br / tab 元素，读回来还是原样", () => {
  const structure = readDocxStructure(buildDocx([{ type: "paragraph", text: "第一行\n第二行\t尾" }]));
  assert.equal(structure.paragraphs[0].text, "第一行\n第二行\t尾");
});

test("往返：改段落 → 再读回新文本，别的段落不动", () => {
  const original = buildDocx(BLOCKS);
  const edited = replaceDocxParagraph(original, 1, "本周完成 A、B、C 三件事。");
  const structure = readDocxStructure(edited);
  assert.equal(structure.paragraphs[1].text, "本周完成 A、B、C 三件事。");
  assert.equal(structure.paragraphs[1].style, null);
  assert.deepEqual(
    structure.paragraphs.map((paragraph) => paragraph.text),
    ["项目周报", "本周完成 A、B、C 三件事。", "A：接口联调", "B：文档补充", "第一步", ""],
  );
  assert.equal(structure.tables[0].cells.length, 6, "表格没被动过");
});

test("往返：改表格单元 → 再读回新文本，表头不动", () => {
  const original = buildDocx(BLOCKS);
  const edited = replaceDocxTableCell(original, 0, 1, 1, "180");
  const structure = readDocxStructure(edited);
  assert.equal(structure.tables[0].cells.find((cell) => cell.row === 1 && cell.column === 1).text, "180");
  assert.equal(structure.tables[0].cells.find((cell) => cell.row === 0 && cell.column === 1).text, "本周");
  assert.equal(structure.tables[0].cells.find((cell) => cell.row === 1 && cell.column === 2).text, "100");
});

test("段落编辑保留段落样式，未被编辑的部件逐字不变", () => {
  const original = buildDocx(BLOCKS, { title: "周报" });
  const before = readZipEntries(original);
  const after = readZipEntries(replaceDocxParagraph(original, 0, "月度总结"));
  assert.deepEqual(after.map((entry) => entry.name), before.map((entry) => entry.name), "部件清单不变");
  for (const name of ["[Content_Types].xml", "word/styles.xml", "word/numbering.xml", "docProps/core.xml"]) {
    assert.deepEqual(after.find((entry) => entry.name === name).data, before.find((entry) => entry.name === name).data, name);
  }
  const structure = readDocxStructure(replaceDocxParagraph(original, 0, "月度总结"));
  assert.equal(structure.paragraphs[0].style, "Heading1", "标题样式保留");
});

test("越界索引报错时带上文档的真实尺寸", () => {
  const original = buildDocx(BLOCKS);
  assert.throws(() => replaceDocxParagraph(original, 99, "x"), (error) => {
    assert.ok(error instanceof DocxIndexError);
    assert.match(error.message, /共 6 个/);
    return true;
  });
  assert.throws(() => replaceDocxTableCell(original, 3, 0, 0, "x"), /没有第 3 张表格/);
  assert.throws(() => replaceDocxTableCell(original, 0, 5, 0, "x"), /没有第 5 行/);
  assert.throws(() => replaceDocxTableCell(original, 0, 0, 9, "x"), /没有第 9 列/);
});

test("不是 Word 文档时明确报错", () => {
  assert.throws(() => readDocxStructure(Buffer.from("hello")), /不是 Word 文档|不是 ZIP 容器/);
});