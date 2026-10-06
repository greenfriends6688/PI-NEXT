/**
 * fork:mobile-shell —— 会话镜像同步的游标核心。
 *
 * 会话 `.jsonl` 是 append-only（AGENTS.md：「Session files can be fully rewritten」
 * —— 级联改父、pi 迁移时会整文件重写），所以增量协议是**字节偏移游标**：
 *
 * - 客户端带着上次的 offset 来，服务端返回 offset 之后的**完整行**与新游标；
 * - `offset > 当前大小` = 文件被整写/截断 → `reset: true` + 全量重发；
 * - 读取窗口有上限（maxBytes）：大会话分页拉，手机端不一次吞几十 MB；
 * - 游标只落在 `\n` 之后。UTF-8 的多字节序列里不会出现 0x0A（后续字节都是
 *   0x80-0xBF），所以按 0x0A 扫描天然不会把多字节字符劈成脏字节。
 *
 * 本模块**只依赖 node:fs**：协议纯函数，测试不需要 pi SDK。
 */

import { fstatSync, openSync, readSync, closeSync } from "node:fs";

export interface SyncSlice {
  /** true = offset 已超过当前文件（整写/截断），客户端必须丢弃旧镜像全量重拉。 */
  reset: boolean;
  /** 本段新增的完整行（不含行尾换行）。reset 时是全量。 */
  lines: string[];
  /** 新游标：读完最后一条完整行之后的字节偏移。 */
  nextOffset: number;
  /** 当前文件总字节数。 */
  sizeBytes: number;
}

/** 单次增量的读取窗口上限。手机蜂窝网络下一次 4MB 是礼貌值。 */
export const SYNC_CHUNK_BYTES = 4 * 1024 * 1024;

export function readEntriesSince(
  filePath: string,
  offset: number,
  maxBytes: number = SYNC_CHUNK_BYTES,
): SyncSlice {
  let fd: number;
  let size: number;
  try {
    fd = openSync(filePath, "r");
    size = fstatSync(fd).size;
  } catch {
    // 文件消失（被删/已归档）按整写处理：客户端丢旧镜像；全量也读不到 → 空。
    return { reset: true, lines: [], nextOffset: 0, sizeBytes: 0 };
  }

  try {
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
    if (safeOffset > size) {
      const whole = readWindow(fd, 0, size);
      return { reset: true, ...whole, sizeBytes: size };
    }
    const window = readWindow(fd, safeOffset, Math.min(size - safeOffset, maxBytes));
    return { reset: false, ...window, sizeBytes: size };
  } finally {
    closeSync(fd);
  }
}

/** 从 from 读 length 字节，只保留到最后一个完整 \n 为止；返回行与新游标。 */
function readWindow(fd: number, from: number, length: number): { lines: string[]; nextOffset: number } {
  if (length <= 0) return { lines: [], nextOffset: from };
  const buffer = Buffer.alloc(length);
  const bytesRead = readSync(fd, buffer, 0, length, from);
  const view = buffer.subarray(0, bytesRead);

  const lastNewline = view.lastIndexOf(0x0a);
  if (lastNewline < 0) {
    // 窗口内没有一条完整行（可能就卡在多字节字符中间）——宁可不发，游标原样退回。
    return { lines: [], nextOffset: from };
  }
  const text = view.subarray(0, lastNewline + 1).toString("utf8");
  const lines = text.split("\n");
  // subarray 以 \n 结尾，split 的最后一个元素必是空串，去掉。
  lines.pop();
  return { lines, nextOffset: from + lastNewline + 1 };
}
