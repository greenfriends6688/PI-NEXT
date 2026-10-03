import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { readZipEntries, zipText } from "./document-zip.ts";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  buildWorkbook,
  readSheetRange,
  summarizeWorkbook,
  writeSheetRange,
  parseCellReference,
  parseRange,
  columnIndexToLabel,
  columnLabelToIndex,
  formatCellReference,
  normalizeSheetName,
  DocumentCellAddressError,
  DocumentSheetError,
} = await jiti.import("./document-xlsx.ts");

test("单元格寻址：列名 / 行号双向转换", () => {
  assert.equal(columnLabelToIndex("A"), 1);
  assert.equal(columnLabelToIndex("Z"), 26);
  assert.equal(columnLabelToIndex("AA"), 27);
  assert.equal(columnLabelToIndex("az"), 52);
  assert.equal(columnIndexToLabel(1), "A");
  assert.equal(columnIndexToLabel(26), "Z");
  assert.equal(columnIndexToLabel(27), "AA");
  assert.equal(columnIndexToLabel(52), "AZ");
  assert.equal(columnIndexToLabel(16_384), "XFD");
  assert.deepEqual(parseCellReference("B3"), { row: 3, column: 2 });
  assert.deepEqual(parseCellReference("$b$3"), { row: 3, column: 2 });
  assert.equal(formatCellReference(3, 2), "B3");
});

test("非法地址报错，并说清格式", () => {
  for (const bad of ["", "3B", "B", "B0", "1", "AAAAA1"]) {
    assert.throws(() => parseCellReference(bad), DocumentCellAddressError, bad);
  }
  assert.throws(() => columnLabelToIndex("A1"), /列名无效/);
  assert.throws(() => parseRange("B2:"), /区域无效/);
  assert.throws(() => formatCellReference(0, 1), /行号超出范围/);
});

test("区域解析：单格与矩形，起点永远在左上", () => {
  assert.deepEqual(parseRange("B2"), { startRow: 2, startColumn: 2, endRow: 2, endColumn: 2 });
  assert.deepEqual(parseRange("C3:B2"), { startRow: 2, startColumn: 2, endRow: 3, endColumn: 3 });
  assert.deepEqual(parseRange("A1:C10"), { startRow: 1, startColumn: 1, endRow: 10, endColumn: 3 });
});

test("sheet 名去非法字符、去重、按 Excel 的 31 字符上限截断", () => {
  assert.equal(normalizeSheetName("报表", []), "报表");
  assert.equal(normalizeSheetName("a[b]c:d/e\\f?g*h", []), "a_b_c_d_e_f_g_h");
  assert.equal(normalizeSheetName("x".repeat(40), []), "x".repeat(31));
  assert.equal(normalizeSheetName("Sheet1", ["Sheet1"]), "Sheet1_2");
  assert.equal(normalizeSheetName("Sheet1", ["Sheet1", "Sheet1_2"]), "Sheet1_3");
});

const WORKBOOK = buildWorkbook([
  { name: "数据", rows: [["指标", "本周", "上周"], ["收入", "120", "100"], ["留存", "0.42", "0.4"]] },
  { name: "空表" },
]);

test("新建 → 读回：sheet 清单与单元格值", () => {
  assert.deepEqual(summarizeWorkbook(WORKBOOK), [
    { name: "数据", rows: 3, columns: 3 },
    { name: "空表", rows: 0, columns: 0 },
  ]);
  const sheet = readSheetRange(WORKBOOK, "数据", "A1:C3");
  assert.deepEqual(sheet.rows, [
    ["指标", "本周", "上周"],
    ["收入", "120", "100"],
    ["留存", "0.42", "0.4"],
  ]);
  assert.deepEqual(sheet.cells[4], { reference: "B2", row: 2, column: 2, value: "120" });
});

test("区域可以只取一块，区域外的格子读成空串", () => {
  const sheet = readSheetRange(WORKBOOK, "数据", "B2:C3");
  assert.deepEqual(sheet.rows, [["120", "100"], ["0.42", "0.4"]]);
  assert.equal(readSheetRange(WORKBOOK, "数据", "A9:B10").rows.length, 2);
  assert.deepEqual(readSheetRange(WORKBOOK, "数据", "A9").rows, [[""] ]);
});

test("数字与文本分别落到数字格与字符串格", () => {
  const xml = zipText(readZipEntries(WORKBOOK), "xl/worksheets/sheet1.xml");
  assert.match(xml, /<c r="B2"><v>120<\/v><\/c>/, "120 是数字");
  assert.match(xml, /<c r="A2" t="inlineStr">/, "指标 是文本");
});

test("往返：写单元格区域 → 再读回新值，其余单元格不变", () => {
  const written = writeSheetRange(WORKBOOK, "数据", "B2", [["180", "160"], ["0.45", "0.43"]]);
  assert.deepEqual(written.written, ["B2", "C2", "B3", "C3"]);
  const sheet = readSheetRange(written.buffer, "数据", "A1:C3");
  assert.deepEqual(sheet.rows, [
    ["指标", "本周", "上周"],
    ["收入", "180", "160"],
    ["留存", "0.45", "0.43"],
  ]);
  assert.deepEqual(summarizeWorkbook(written.buffer), [
    { name: "数据", rows: 3, columns: 3 },
    { name: "空表", rows: 0, columns: 0 },
  ]);
});

test("往返：写入区域超出原表范围时按坐标插入新行", () => {
  const written = writeSheetRange(WORKBOOK, "数据", "A5", [["新行"]]);
  const sheet = readSheetRange(written.buffer, "数据", "A1:C6");
  assert.deepEqual(sheet.rows, [
    ["指标", "本周", "上周"],
    ["收入", "120", "100"],
    ["留存", "0.42", "0.4"],
    ["", "", ""],
    ["新行", "", ""],
    ["", "", ""],
  ]);
  assert.equal(summarizeWorkbook(written.buffer)[0].rows, 5, "dimension 被刷新");
});

test("往返：写入区域盖住已有列时按列序插入，不打乱顺序", () => {
  const written = writeSheetRange(WORKBOOK, "数据", "A1", [["新表头", "新本周", "新上周"]]);
  const sheet = readSheetRange(written.buffer, "数据", "A1:C3");
  assert.equal(sheet.rows[0][1], "新本周");
  assert.equal(sheet.rows[1][1], "120", "同一行里其它列没被动");
});

test("只写已有工作簿的一个 sheet：别的 sheet 与 sharedStrings 部件原样保留", () => {
  const before = readZipEntries(WORKBOOK);
  const written = writeSheetRange(WORKBOOK, "空表", "A1", [["只有一行"]]);
  const after = readZipEntries(written.buffer);
  assert.deepEqual(after.map((entry) => entry.name), before.map((entry) => entry.name));
  assert.deepEqual(
    zipText(after, "xl/worksheets/sheet1.xml"),
    zipText(before, "xl/worksheets/sheet1.xml"),
    "没被写的 sheet 逐字不变",
  );
  assert.deepEqual(readSheetRange(written.buffer, "空表", "A1").rows, [["只有一行"]]);
});

test("sheet 不存在时把现有名字列出来", () => {
  assert.throws(() => readSheetRange(WORKBOOK, "不存在", "A1"), (error) => {
    assert.ok(error instanceof DocumentSheetError);
    assert.match(error.message, /数据、空表/);
    return true;
  });
  assert.throws(() => writeSheetRange(WORKBOOK, "不存在", "A1", [["x"]]), DocumentSheetError);
  // sheet 名大小写不敏感。
  assert.equal(readSheetRange(WORKBOOK, "数据", "A1").rows[0][0], "指标");
  assert.equal(readSheetRange(WORKBOOK, "数据".toUpperCase(), "A1").rows[0][0], "指标");
});

test("空值与前导零按文本处理", () => {
  const written = writeSheetRange(WORKBOOK, "空表", "A1", [["007", "", "-3.5"]]);
  const xml = zipText(readZipEntries(written.buffer), "xl/worksheets/sheet2.xml");
  assert.match(xml, /<c r="A1" t="inlineStr"><is><t xml:space="preserve">007<\/t>/, "007 是文本");
  assert.match(xml, /<c r="B1"\/>/, "空串是空单元");
  assert.match(xml, /<c r="C1"><v>-3.5<\/v>/, "-3.5 是数字");
});

test("不是 Excel 工作簿时报错", () => {
  assert.throws(() => summarizeWorkbook(Buffer.from("nope")), /不是 ZIP 容器|不是 Excel/);
});