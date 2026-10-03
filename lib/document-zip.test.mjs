import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { crc32, readZipEntries, writeZipEntries, zipEntryNames, zipText, withZipEntry, DocumentZipError } =
  await jiti.import("./document-zip.ts");

test("crc32 用标准向量", () => {
  assert.equal(crc32(Buffer.from("")), 0);
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.from("The quick brown fox jumps over the lazy dog")), 0x414fa339);
});

test("写出来的容器能被自己读回来（长内容走 deflate，短内容走 stored）", () => {
  const long = "x".repeat(5000);
  const entries = [
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "word/document.xml", data: `<w:document>${long}</w:document>` },
    { name: "empty.bin", data: Buffer.alloc(0) },
  ];
  const buffer = writeZipEntries(entries);
  assert.equal(buffer.readUInt32LE(0), 0x04034b50, "本地头签名");
  assert.equal(buffer.subarray(buffer.length - 22).readUInt32LE(0), 0x06054b50, "EOCD 签名");

  const read = readZipEntries(buffer);
  assert.deepEqual(read.map((entry) => entry.name), ["[Content_Types].xml", "word/document.xml", "empty.bin"]);
  assert.equal(zipText(read, "[Content_Types].xml"), "<Types/>");
  assert.equal(read[1].data.toString("utf8"), `<w:document>${long}</w:document>`);
  assert.equal(read[2].data.length, 0);
  assert.deepEqual(zipEntryNames(buffer), ["[Content_Types].xml", "word/document.xml", "empty.bin"]);
});

test("二进制部件按字节保真", () => {
  const binary = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const read = readZipEntries(writeZipEntries([{ name: "media/image1.png", data: binary }]));
  assert.deepEqual(read[0].data, binary);
});

test("withZipEntry 替换同名部件并保持顺序，未知部件追加到末尾", () => {
  const entries = [
    { name: "a.xml", data: "1" },
    { name: "b.xml", data: "2" },
  ];
  assert.deepEqual(withZipEntry(entries, "a.xml", "9").map((entry) => `${entry.name}:${entry.data}`), ["a.xml:9", "b.xml:2"]);
  assert.deepEqual(withZipEntry(entries, "c.xml", "3").map((entry) => entry.name), ["a.xml", "b.xml", "c.xml"]);
});

test("损坏与不支持的容器报明确原因，不静默返回半截数据", () => {
  assert.throws(() => readZipEntries(Buffer.from("not a zip at all")), DocumentZipError);
  assert.throws(() => readZipEntries(Buffer.alloc(4)), DocumentZipError);

  const buffer = writeZipEntries([{ name: "a.xml", data: "hello" }]);
  // 改本地头签名 → 条目定位失败。
  const broken = Buffer.from(buffer);
  broken.writeUInt32LE(0, 0);
  assert.throws(() => readZipEntries(broken), /本地头损坏/);
});

test("未知压缩方法被拒，而不是当作 stored 读出乱码", () => {
  const buffer = writeZipEntries([{ name: "a.xml", data: "hello world hello world" }]);
  const patched = Buffer.from(buffer);
  const central = patched.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(central > 0, "找得到中央目录");
  patched.writeUInt16LE(99, central + 10);
  assert.throws(() => readZipEntries(patched), /不支持的压缩方法/);
});