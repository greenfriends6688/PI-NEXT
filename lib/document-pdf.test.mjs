import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildPdf, readPdf, extractTextFromContent, encodeWinAnsi, decodeWinAnsi, wrapLine, DocumentFormatError } =
  await jiti.import("./document-pdf.ts");

test("WinAnsi 编码：ASCII / Latin-1 直通，CJK 与私用区变 ? 并计数", () => {
  assert.deepEqual(encodeWinAnsi("Hi").bytes, Buffer.from("Hi"));
  assert.equal(encodeWinAnsi("café").bytes.toString("latin1"), "café");
  assert.equal(encodeWinAnsi("naïve").bytes.toString("latin1"), "naïve");
  const cjk = encodeWinAnsi("季度报告");
  assert.equal(cjk.bytes.toString("latin1"), "????");
  assert.equal(cjk.replaced, 4);
  assert.equal(decodeWinAnsi(Buffer.from("caf\xe9", "latin1")), "café");
  assert.equal(decodeWinAnsi(Buffer.from([0x93, 0x94], "latin1")), "“”", "CP1252 高位区还原");
});

test("折行：按 Helvetica 字宽断行，短行与空行不动", () => {
  assert.deepEqual(wrapLine("", 11, 500), [""]);
  assert.deepEqual(wrapLine("short line", 11, 500), ["short line"]);
  const wrapped = wrapLine("word ".repeat(60), 11, 200);
  assert.ok(wrapped.length > 1);
  for (const line of wrapped) assert.ok(line.length > 0);
  assert.ok(wrapped.join(" ").replace(/\s+/g, " ").trim().includes("word"));
});

test("生成 → 读回：页数与每页文本", () => {
  // PDF 这条链路是 WinAnsi：CJK 出不去，所以这里用拉丁文本（中文的限制见下一个用例）。
  const built = buildPdf([{ text: "page one\nsecond line" }, { text: "page two" }], { title: "Report" });
  assert.equal(built.pageCount, 2);
  assert.equal(built.replacedCharacters, 0);
  const result = readPdf(built.bytes);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.pages, [
    { page: 1, text: "page one\nsecond line" },
    { page: 2, text: "page two" },
  ]);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.truncated, false);
});

test("长文本自动分页，读回来的页数与写入时一致", () => {
  const built = buildPdf([{ text: Array.from({ length: 200 }, (_unused, index) => `line ${index}`).join("\n") }]);
  assert.ok(built.pageCount > 1, "一页放不下");
  const result = readPdf(built.bytes);
  assert.equal(result.pageCount, built.pageCount);
  assert.equal(result.pages.length, built.pageCount);
  assert.match(result.pages[0].text, /^line 0/);
});

test("中文进不了 WinAnsi：如实报出被替换的字符数", () => {
  const built = buildPdf([{ text: "季度报告" }]);
  assert.equal(built.replacedCharacters, 4);
  assert.equal(readPdf(built.bytes).pages[0].text, "????");
});

test("xref 表的每个偏移都指向对应的对象头", () => {
  const built = buildPdf([{ text: "one" }, { text: "two" }, { text: "three" }], { title: "t" });
  const text = built.bytes.toString("latin1");
  const startxref = Number(/startxref\n(\d+)/.exec(text)[1]);
  const xref = text.slice(startxref);
  const rows = [...xref.matchAll(/^(\d{10}) (\d{5}) n $/gm)].map((match) => Number(match[1]));
  assert.ok(rows.length >= 5);
  rows.forEach((offset, index) => {
    assert.equal(text.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`, `对象 ${index + 1}`);
  });
});

test("括号、反斜杠与非 ASCII 字节在内容流里被正确转义", () => {
  const built = buildPdf([{ text: "a(b)c\\d café" }]);
  const text = built.bytes.toString("latin1");
  assert.ok(text.includes(String.raw`(a\(b\)c\\d caf\351)`), "括号与反斜杠被转义，非 ASCII 字节用八进制");
  assert.equal(readPdf(built.bytes).pages[0].text, "a(b)c\\d café");
});

test("读回我们自己压缩过的内容流：FlateDecode 走 inflate", () => {
  const content = zlib.deflateSync(Buffer.from("BT /F1 12 Tf 10 700 Td (compressed text) Tj ET", "latin1"));
  const pdf = [
    "%PDF-1.4",
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n${content.toString("latin1")}\nendstream\nendobj\n`,
    "trailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF\n",
  ].join("");
  const result = readPdf(Buffer.from(pdf, "latin1"));
  assert.equal(result.pageCount, 1);
  assert.equal(result.pages[0].text, "compressed text");
});

test("页树在对象流（PDF 1.5 的 /ObjStm）里也能数出页数", () => {
  const header = "2 0";
  const body = "<< /Type /Pages /Count 1 /Kids [3 0 R] >>";
  const payload = `${header} ${body.length} `.replace(/\s+$/, " ") + body;
  const packed = zlib.deflateSync(Buffer.from(payload, "latin1"));
  const pdf = [
    "%PDF-1.4",
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    `5 0 obj\n<< /Type /ObjStm /N 1 /First ${header.length + 1} /Length ${packed.length} /Filter /FlateDecode >>\nstream\n${packed.toString("latin1")}\nendstream\nendobj\n`,
    "trailer\n<< /Size 6 /Root 1 0 R >>\n%%EOF\n",
  ].join("");
  const result = readPdf(Buffer.from(pdf, "latin1"));
  assert.equal(result.pageCount, 1);
});

test("文本算子：Tj / TJ / 换行算子 / 转义序列", () => {
  // 两次 Tj 之间没有位置算子时，真PDF 里是画在同一处 —— 抽出来就是紧挨着。
  assert.equal(extractTextFromContent("BT (a) Tj (b) Tj ET"), "ab");
  assert.equal(extractTextFromContent("BT (a) Tj ET BT (b) Tj ET"), "a\nb");
  assert.equal(extractTextFromContent("BT 1 0 0 1 0 0 Tm (line1) Tj ET BT (line2) Tj ET"), "line1\nline2");
  assert.equal(extractTextFromContent("BT [(Hel) -300 (lo)] TJ ET"), "Hel lo");
  assert.equal(extractTextFromContent("BT (a\\(b\\)) Tj ET"), "a(b)");
  assert.equal(extractTextFromContent("BT (caf\\351) Tj ET"), "café");
  assert.equal(extractTextFromContent("BT <48656C6C6F> Tj ET"), "Hello");
  assert.equal(extractTextFromContent("BT (x) Tj % 注释 (y)\n ET"), "x");
});

test("加密 PDF：仍返回页数，并给出警告，不编内容", () => {
  const pdf = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Filter /Standard /V 2 >>\nendobj\ntrailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R >>\n%%EOF\n";
  const result = readPdf(Buffer.from(pdf, "latin1"));
  assert.equal(result.pageCount, 1);
  assert.deepEqual(result.pages, []);
  assert.ok(result.warnings.some((warning) => /加密/.test(warning)));
});

test("max_pages / maxCharacters 会截断并置位", () => {
  const built = buildPdf(Array.from({ length: 6 }, (_unused, index) => ({ text: `page ${index + 1}` })));
  const limited = readPdf(built.bytes, { maxPages: 2 });
  assert.equal(limited.pageCount, 6);
  assert.equal(limited.pages.length, 2);
  assert.equal(limited.truncated, true);
  const short = readPdf(built.bytes, { maxCharacters: 4 });
  assert.equal(short.truncated, true);
  assert.ok(short.pages[0].text.length <= 4);
});

test("字号越界与非 PDF 文件都报错", () => {
  assert.throws(() => buildPdf([{ text: "x" }], { fontSize: 99 }), DocumentFormatError);
  assert.throws(() => readPdf(Buffer.from("not a pdf")), /不是 PDF 文件/);
});