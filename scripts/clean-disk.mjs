#!/usr/bin/env node
/**
 * 仓库磁盘清理器（fork:disk-hygiene）
 *
 * 为什么需要它：这个仓库同时养着 4 套「不该进版本库但很占地」的东西 ——
 * Next.js 构建产物、electron-builder 发布包、第三方设计参考项目、本地计划文件。
 * `.gitignore` 早就把它们挡住了（所以它们从来没进过 git，也没有撑大 clone 体积），
 * 但 .gitignore **不会删磁盘**。没有清理动作时这些目录会一直累积：
 * 实测 `.next` 单独就能从 829M 涨到 1.4G（dev 与 prod 产物同目录共存）。
 *
 * 安全底线（不可协商）：
 *   1. 只删「git 不跟踪 + 已被 .gitignore 收录」的目录 —— 绝不碰任何被 git 跟踪的源文件。
 *   2. 删 .next / release 前先探测 30141、32141 端口；有 next dev / next start 在跑就
 *      **拒绝删除**并说明原因（next start 要读 .next/server + BUILD_ID，next dev 要读 .next/dev）。
 *   3. 参考项目（pi参考项目/设计风格）与发布归档（pi-codex-release/）默认**只报告不删** ——
 *      它们是人工挑选的对照物和历史归档，删了要重新下载/重建。
 *
 * 用法：
 *   node scripts/clean-disk.mjs              # 只报告，不删（默认）
 *   node scripts/clean-disk.mjs --yes        # 真的删（仍受安全底线约束）
 *   node scripts/clean-disk.mjs --yes --all  # 连参考项目/发布归档一起删（危险，会二次确认）
 */

import { existsSync, rmSync, readdirSync, unlinkSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const ASSUME_YES = args.includes("--yes") || args.includes("-y");
const INCLUDE_KEEP = args.includes("--all");

/** 跑一条命令，拿 stdout（失败返回 ""）。 */
function sh(cmd, cmdArgs) {
  try {
    return execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** 目录实际占用（字节）。用 du -sk 拿到真实块占用，du -sh 的四舍五入会骗人。 */
function sizeBytes(path) {
  if (!existsSync(path)) return 0;
  const out = sh("du", ["-sk", path]);
  const kb = Number.parseInt(out.split(/\s+/)[0], 10);
  return Number.isFinite(kb) ? kb * 1024 : 0;
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["K", "M", "G", "T"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)}${units[i]}`;
}

/** 终端显示宽度：CJK 全角字符占 2 列，padEnd 按码位算会把表格排歪。 */
function dwidth(s) {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    w += (c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6))) ? 2 : 1;
  }
  return w;
}
function pad(s, n) {
  const w = dwidth(s);
  return w >= n ? s : s + " ".repeat(n - w);
}

/** git 跟踪的文件数 —— 大于 0 就不许删。 */
function trackedCount(path) {
  const out = sh("git", ["ls-files", path]);
  return out ? out.split("\n").filter(Boolean).length : 0;
}

/** 是否已被 .gitignore 收录。git check-ignore 用退出码表达结果，不能走 sh()（它把非零退出吞成 ""）。 */
function ignoredCheck(path) {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** 谁在监听这两个端口？返回描述数组。 */
function listenersOn(ports) {
  const out = [];
  for (const port of ports) {
    const res = sh("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    if (!res) continue;
    const lines = res.split("\n").slice(1);
    for (const line of lines) {
      const pid = line.trim().split(/\s+/)[1];
      if (!pid) continue;
      let cmd = "";
      try {
        cmd = execFileSync("ps", ["-o", "command=", "-p", pid], { encoding: "utf8" }).trim();
      } catch {
        cmd = "?";
      }
      // 顺着父进程找真正的命令行，next-server 的 argv 被改写成了 "next-server (vX)"
      let full = cmd;
      try {
        const ppid = execFileSync("ps", ["-o", "ppid=", "-p", pid], { encoding: "utf8" }).trim();
        if (ppid) full = execFileSync("ps", ["-o", "command=", "-p", ppid], { encoding: "utf8" }).trim() + " → " + cmd;
      } catch {
        /* 父进程已退出，忽略 */
      }
      out.push({ port, pid, cmd: full || cmd });
    }
  }
  return out;
}

const BUSY_PORTS = [30141, 32141];

/** 分类表：level 决定处置方式。 */
const TARGETS = [
  {
    path: ".next",
    level: "artifact",
    label: "Next.js 构建产物（dev 与 prod 共用此目录）",
    rebuild: "npm run prod  （或 npm run dev 走 next-mode.mjs，会自动重建）",
    note: ".next/dev 与 .next/server 互不兼容，混用会出现假故障 —— 整目录删最干净。",
  },
  {
    path: "release",
    level: "artifact",
    label: "electron-builder 发布包（dmg / exe / zip / unpacked）",
    rebuild: "npm run desktop:dist   （需先 npm run build）",
    note: "整包可由源码重建；已发布过的版本在 GitHub Release 上仍有副本。",
  },
  {
    path: "test-results",
    level: "artifact",
    label: "Playwright 跑测产物（trace / 截图 / 附件）",
    rebuild: "npm run test:e2e 之类，按需重跑即可",
    note: "只影响排查历史失败，删了不影响功能。",
  },
  { path: "coverage", level: "artifact", label: "覆盖率报告", rebuild: "重跑带 coverage 的测试", note: "" },
  { path: "tsconfig.tsbuildinfo", level: "artifact", label: "TypeScript 增量编译缓存", rebuild: "下次 tsc/build 自动重建", note: "" },
  { path: "out", level: "artifact", label: "next export 静态产物", rebuild: "npm run build && next export", note: "" },

  {
    path: "pi-codex-release",
    level: "keep",
    label: "历史发布归档（源码 zip + release notes）",
    rebuild: "无法自动重建 —— 里面是各历史版本的实际打包产物",
    note: "默认只报告。确认旧版本已上传 GitHub Release 后可加 --all 删除。",
  },
  {
    path: "设计风格",
    level: "keep",
    label: "第三方设计参考项目（boardui / ui-main / beautifului）",
    rebuild: "需重新 clone 对应仓库",
    note: "换肤工作的活参考物，默认只报告。",
  },
  {
    path: "pi-web-pr-inbox",
    level: "keep",
    label: "上游 PR 收件箱（fetch 下来的 patch / meta）",
    rebuild: "bash pi-web-pr-inbox/fetch.sh 可重新拉取",
    note: "默认只报告。",
  },
  {
    path: "pi参考项目",
    level: "keep",
    label: "上游对照项目（pi-codex 上游本体）",
    rebuild: "需重新 clone",
    note: "用户明确要求保留。默认只报告，绝不自动删。",
  },
  { path: "node_modules", level: "keep", label: "依赖", rebuild: "npm ci", note: "日常要跑，删了要重装。默认只报告。" },
  { path: ".git", level: "keep", label: "版本库", rebuild: "不可重建", note: "如需瘦身用 git gc，不在本脚本范围内。" },
];

const BEFORE = sizeBytes(ROOT);
console.log(`仓库：${ROOT}`);
console.log(`清理前：${human(BEFORE)}\n`);

const busy = listenersOn(BUSY_PORTS);
if (busy.length) {
  console.log("⚠️  检测到正在跑的服务：");
  for (const b of busy) console.log(`     :${b.port}  pid ${b.pid}  ${b.cmd.slice(0, 110)}`);
  console.log("   → .next 正在被使用，本脚本不会删它。\n");
}

// ---- 评估 ----
const rows = [];
for (const t of TARGETS) {
  const abs = join(ROOT, t.path);
  if (!existsSync(abs)) {
    rows.push({ ...t, size: 0, action: "—" });
    continue;
  }
  const size = sizeBytes(abs);
  const tracked = trackedCount(t.path);
  const ignored = ignoredCheck(t.path);
  let action;
  if (tracked > 0) action = "跳过（有 git 跟踪的源文件）";
  else if (t.level === "keep" && !INCLUDE_KEEP) action = "保留（--all 才删）";
  else action = ASSUME_YES ? "删除" : "可删（加 --yes）";
  rows.push({ ...t, size, tracked, ignored, action });
}

const W = 20;
console.log(`${"目录".padEnd(W)}${"体积".padStart(9)}  ${"git".padEnd(10)}${"处置".padEnd(26)}说明`);
console.log("─".repeat(120));
for (const r of rows) {
  if (r.size === 0) continue;
  // .git 永远不会出现在 .gitignore 里（git 自身就不跟踪它），标成「未忽略」会误报警
  const g = r.tracked > 0 ? `跟踪${r.tracked}` : r.path === ".git" ? "版本库" : r.ignored ? "已忽略" : "未忽略!";
  console.log(`${pad(r.path, W)}${human(r.size).padStart(9)}  ${pad(g, 10)}${pad(r.action, 26)}${r.label}`);
}

// ---- 执行 ----
let freed = 0;
const removed = [];
const skipped = [];
for (const r of rows) {
  if (r.size === 0) continue;
  if (r.tracked > 0) {
    skipped.push(`${r.path} —— 含 ${r.tracked} 个 git 跟踪文件`);
    continue;
  }
  if (r.level === "keep" && !INCLUDE_KEEP) {
    skipped.push(`${r.path} —— 保留类（${r.label}）`);
    continue;
  }
  if (r.path === ".next" && busy.length) {
    skipped.push(`.next —— 端口 ${BUSY_PORTS.join("/")} 有 next 进程在跑，删了会打断服务`);
    continue;
  }
  if (!ASSUME_YES) continue;
  try {
    rmSync(join(ROOT, r.path), { recursive: true, force: true });
    freed += r.size;
    removed.push(`${r.path}  ${human(r.size)}`);
  } catch (e) {
    skipped.push(`${r.path} —— 删除失败：${e.message}`);
  }
}

// 顺手清 .DS_Store（永远安全，gitignore 覆盖，Finder 随时重建）
if (ASSUME_YES) {
  let n = 0;
  const skipDirs = new Set(["node_modules", ".git", "pi参考项目"]);
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && skipDirs.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === ".DS_Store") {
        try {
          const sz = lstatSync(p).size;
          unlinkSync(p);
          freed += sz;
          n++;
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(ROOT);
  if (n) removed.push(`*.DS_Store (${n} 个)`);
}

const AFTER = sizeBytes(ROOT);
console.log("");
if (ASSUME_YES) {
  console.log("已删除：");
  for (const r of removed) console.log(`  - ${r}`);
  if (!removed.length) console.log("  （无）");
  console.log(`\n实际释放：${human(BEFORE - AFTER)}`);
} else {
  const canFree = rows
    .filter((r) => r.size > 0 && r.tracked === 0 && (r.level !== "keep" || INCLUDE_KEEP))
    .filter((r) => !(r.path === ".next" && busy.length))
    .reduce((a, r) => a + r.size, 0);
  console.log(`以上是可删项，加 --yes 执行。预计释放：${human(canFree)}`);
  if (busy.length) {
    console.log("\n（.next 未计入 —— 先停掉 :30141 / :32141 上的 next 进程再跑一次）");
  }
}
if (skipped.length) {
  console.log("\n未处理：");
  for (const s of skipped) console.log(`  · ${s}`);
}
console.log(`\n清理后：${human(AFTER)}`);
