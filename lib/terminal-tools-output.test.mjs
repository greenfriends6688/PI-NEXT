import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  TERMINAL_READ_DEFAULT_CHARS,
  TERMINAL_READ_MAX_CHARS,
  appendTerminalOutput,
  emptyTerminalOutputBuffer,
  normalizeTerminalText,
  readTerminalOutput,
} = await jiti.import("./terminal-tools-output.ts");

const ESC = "\u001B";
const BEL = "\u0007";

test("追加只保留末尾，偏移按完整流计算", () => {
  let buffer = emptyTerminalOutputBuffer();
  buffer = appendTerminalOutput(buffer, "hello", 8);
  assert.equal(buffer.output, "hello");
  assert.equal(buffer.startOffset, 0);
  assert.equal(buffer.endOffset, 5);

  buffer = appendTerminalOutput(buffer, " world", 8);
  assert.equal(buffer.output, "lo world");
  assert.equal(buffer.endOffset, 11);
  assert.equal(buffer.startOffset, 3);
});

test("默认读取末尾一段，并如实报告前文被滚掉", () => {
  let buffer = emptyTerminalOutputBuffer();
  buffer = appendTerminalOutput(buffer, "a".repeat(30_000), 30_000);
  const read = readTerminalOutput(buffer);
  assert.equal(read.output.length, TERMINAL_READ_DEFAULT_CHARS);
  assert.equal(read.offset, 30_000 - TERMINAL_READ_DEFAULT_CHARS);
  assert.equal(read.nextOffset, 30_000);
  assert.equal(read.truncatedBefore, true);
  assert.equal(read.truncatedAfter, false);
  assert.equal(read.availableStartOffset, 0);
  assert.equal(read.availableEndOffset, 30_000);
});

test("缓冲滚动后可用区间收缩，模型能算出还能读多少", () => {
  let buffer = emptyTerminalOutputBuffer();
  buffer = appendTerminalOutput(buffer, "a".repeat(1_000), 100);
  const read = readTerminalOutput(buffer);
  assert.equal(read.availableStartOffset, 900);
  assert.equal(read.availableEndOffset, 1_000);
  assert.equal(read.truncatedBefore, true);
  assert.equal(read.offset, 900);
  assert.equal(read.output.length, 100);
});

test("offset 可以翻页，nextOffset 就是下一页的游标", () => {
  let buffer = emptyTerminalOutputBuffer();
  buffer = appendTerminalOutput(buffer, "0123456789", 100);
  const first = readTerminalOutput(buffer, { offset: 0, limit: 4 });
  assert.equal(first.output, "0123");
  assert.equal(first.nextOffset, 4);
  const second = readTerminalOutput(buffer, { offset: first.nextOffset, limit: 4 });
  assert.equal(second.output, "4567");
  assert.equal(second.nextOffset, 8);
  const last = readTerminalOutput(buffer, { offset: second.nextOffset, limit: 4 });
  assert.equal(last.output, "89");
  assert.equal(last.truncatedAfter, false);
});

test("还有未读的后续输出时 truncatedAfter 为真", () => {
  let buffer = emptyTerminalOutputBuffer();
  buffer = appendTerminalOutput(buffer, "0123456789", 100);
  const read = readTerminalOutput(buffer, { offset: 0, limit: 4 });
  assert.equal(read.truncatedAfter, true);
  assert.equal(read.availableEndOffset - read.nextOffset, 6);
});

test("limit 越界与非整数直接报错，offset 非负", () => {
  const buffer = appendTerminalOutput(emptyTerminalOutputBuffer(), "abc", 100);
  assert.throws(() => readTerminalOutput(buffer, { limit: 0 }), /1 到 48000/);
  assert.throws(() => readTerminalOutput(buffer, { limit: TERMINAL_READ_MAX_CHARS + 1 }), /1 到 48000/);
  assert.throws(() => readTerminalOutput(buffer, { offset: -1 }), /非负整数/);
  assert.throws(() => readTerminalOutput(buffer, { limit: 1.5 }), /1 到 48000/);
});

test("控制序列被剥掉，但真实换行保留（交互行重绘不会变成多行）", () => {
  const raw = `${ESC}[32mhello${ESC}[0m\r\n${ESC}]0;title${BEL}\rnext\r\n`;
  assert.equal(normalizeTerminalText(raw), "hello\nnext\n");
});

test("去掉零宽与不可见控制字符", () => {
  assert.equal(normalizeTerminalText("a\u0000b\u0007c\u007F"), "abc");
  assert.equal(normalizeTerminalText(`${ESC}P1$r${ESC}\\x`), "x");
});