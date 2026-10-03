/**
 * fork:mcp-native-exposure —— 看 MCP 日志（只读）。
 *
 * pi 的 mcp 扩展把**每个 server 的连接/工具事件**写进 `mcp.log`（agent 目录，
 * `join(getAgentDir(), "mcp.log")`，见 `dist/extensions/mcp/index.js:253`；超过
 * `MAX_LOG_BYTES` 自己轮转成 `.1`）。此前这个文件对用户**完全不可见**：server 连不上时
 * 浏览器只拿到一句 `MCP failed to load: …`，看不到是哪个 server、握手到哪一步断的。
 *
 * 这个路由只做「读文件尾巴」：
 *   · 只读 agent 目录里的这一个固定路径，不接受调用方传路径；
 *   · 只返回**末尾**若干行（默认 200，最多 2000），并截断超长行 —— 日志是诊断材料，
 *     整个文件塞进浏览器既慢又会把设置页撑爆；
 *   · 没有 `cwd` 参数、不碰 allow-list：这个路径在 agent 目录里，与会话工作区无关。
 */

import { NextResponse } from "next/server";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

const MAX_LINES = 2000;
const MAX_LINE_CHARS = 500;

function resolveLogPath(): string {
  return join(getAgentDir(), "mcp.log");
}

function tailLines(path: string, limit: number): { text: string; truncatedChars?: number }[] {
  // 一次读进内存再切尾：mcp.log 轮转阈值很小（SDK 侧 MAX_LOG_BYTES），整读比 seek 更简单，
  // 也不会读到半个 UTF-8 字符（切的是行边界）。
  const content = readFileSync(path, "utf8");
  const lines = content.split("\n");
  // 末尾通常是空串（文件以换行结尾），丢掉再取。
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(Math.max(0, lines.length - limit)).map((line) =>
    line.length > MAX_LINE_CHARS
      ? { text: line.slice(0, MAX_LINE_CHARS), truncatedChars: line.length - MAX_LINE_CHARS }
      : { text: line });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requested = Number(searchParams.get("lines") ?? "200");
  const limit = Number.isFinite(requested) ? Math.min(MAX_LINES, Math.max(1, Math.trunc(requested))) : 200;
  const path = resolveLogPath();

  try {
    if (!existsSync(path)) {
      // 没有日志不是错误：只有在 MCP server 真的握手失败后 pi 才会写。
      return NextResponse.json(
        { path, exists: false, size: 0, lines: [] as { text: string; truncatedChars?: number }[] },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const size = statSync(path).size;
    return NextResponse.json(
      { path, exists: true, size, lines: tailLines(path, limit) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}