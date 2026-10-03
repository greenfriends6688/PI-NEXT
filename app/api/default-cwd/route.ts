import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { allowFileRoot } from "@/lib/file-access";
import { defaultCwdPath } from "@/lib/default-cwd";

// POST /api/default-cwd
// 「用默认工作目录」= 每天一个新文件夹：~/pi-cwd/<YYYYMMDD>。
//
// fork:default-cwd-local-date（用户 2026-10-02，对齐上游）—— 原来是
// `new Date().toISOString().slice(0,10)`（**UTC**，东八区在 08:00 前会算成昨天）
// 且平铺成 `~/pi-cwd-20261002`。改为上游口径：**本地日期 + 一个 `pi-cwd` 父目录**，
// 家目录里不再堆一排 `pi-cwd-*`。
export async function POST() {
  try {
    const dir = defaultCwdPath();
    mkdirSync(dir, { recursive: true });
    allowFileRoot(dir);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
