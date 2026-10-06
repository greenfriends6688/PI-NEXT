// fork:mobile-shell —— 会话同步游标：推进 / 重写回退 / UTF-8 边界 / 分页窗口
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  return jiti.import("./session-sync.ts");
}

const { readEntriesSince, SYNC_CHUNK_BYTES } = await loadSubject();

const dir = mkdtempSync(join(tmpdir(), "pi-session-sync-"));
const file = join(dir, "session.jsonl");
test.after(() => rmSync(dir, { recursive: true, force: true }));

test("空文件：无行、游标 0", () => {
  writeFileSync(file, "");
  const slice = readEntriesSince(file, 0);
  assert.deepEqual(slice, { reset: false, lines: [], nextOffset: 0, sizeBytes: 0 });
});

test("全量读 + 增量推进：第二次只拿新行", () => {
  writeFileSync(file, '{"type":"session"}\n{"type":"message"}\n');
  const first = readEntriesSince(file, 0);
  assert.equal(first.reset, false);
  assert.deepEqual(first.lines, ['{"type":"session"}', '{"type":"message"}']);
  assert.equal(first.nextOffset, first.sizeBytes);

  writeFileSync(file, '{"type":"session"}\n{"type":"message"}\n{"type":"message"}\n');
  const second = readEntriesSince(file, first.nextOffset);
  assert.equal(second.reset, false);
  assert.deepEqual(second.lines, ['{"type":"message"}']);
  assert.equal(second.nextOffset, second.sizeBytes);
});

test("offset 超过文件大小（整写/截断）→ reset + 全量重发", () => {
  writeFileSync(file, "a\nb\n");
  const slice = readEntriesSince(file, 9999);
  assert.equal(slice.reset, true);
  assert.deepEqual(slice.lines, ["a", "b"]);
  assert.equal(slice.nextOffset, 4);
});

test("offset 劈在行中间：整窗只发完整行，游标不越过最后一个换行", () => {
  writeFileSync(file, "line-1\nline-2\n");
  const slice = readEntriesSince(file, 3); // "e-1\n..." 的中段
  assert.equal(slice.reset, false);
  assert.deepEqual(slice.lines, ["e-1", "line-2"]); // 窗口内所有完整行
  assert.equal(slice.nextOffset, slice.sizeBytes);   // 游标落在最后一个 \n 之后
});

test("窗口内没有任何完整行 → 一行不发、游标原样退回", () => {
  writeFileSync(file, "partial-line-without-newline");
  const slice = readEntriesSince(file, 0);
  assert.deepEqual(slice.lines, []);
  assert.equal(slice.nextOffset, 0);
});

test("UTF-8 多字节：中文行不被劈坏，游标按字节算", () => {
  writeFileSync(file, '{"text":"你好世界"}\n{"text":"第二行"}\n');
  const first = readEntriesSince(file, 0);
  assert.deepEqual(first.lines, ['{"text":"你好世界"}', '{"text":"第二行"}']);
  const second = readEntriesSince(file, first.nextOffset);
  assert.deepEqual(second.lines, []);
  assert.equal(second.nextOffset, first.sizeBytes);
});

test("maxBytes 分页：窗口截在最后一个完整行，循环拉到 EOF", () => {
  const lines = [];
  for (let i = 0; i < 100; i += 1) lines.push(`{"n":${i},"pad":"${"x".repeat(50)}"}`);
  writeFileSync(file, lines.map((l) => `${l}\n`).join(""));
  let offset = 0;
  const collected = [];
  let rounds = 0;
  while (true) {
    rounds += 1;
    const slice = readEntriesSince(file, offset, 512);
    assert.equal(slice.reset, false);
    collected.push(...slice.lines);
    if (slice.nextOffset === offset) break; // 窗口里一条完整行都没有了（不该发生在本数据集）
    offset = slice.nextOffset;
    if (offset === slice.sizeBytes) break;
    assert.ok(rounds < 200, "分页没有收敛");
  }
  assert.deepEqual(collected, lines);
});

test("文件消失（被删）→ reset 空全量，不抛", () => {
  const slice = readEntriesSince(join(dir, "gone.jsonl"), 128);
  assert.equal(slice.reset, true);
  assert.deepEqual(slice.lines, []);
  assert.equal(slice.nextOffset, 0);
});

test("默认窗口是 4MB，负数/非法 offset 按 0 处理", () => {
  assert.equal(SYNC_CHUNK_BYTES, 4 * 1024 * 1024);
  writeFileSync(file, "x\n");
  const slice = readEntriesSince(file, -5);
  assert.deepEqual(slice.lines, ["x"]);
  assert.equal(slice.nextOffset, 2);
});
