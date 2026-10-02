import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const core = await jiti.import("./terminal-tools-core.ts");
const { SUBAGENT_CONTROL_TOOL_NAMES } = await jiti.import("./subagents.ts");

const {
  TERMINAL_TOOL_NAMES,
  TERMINAL_PROMPT_HEADING,
  TERMINAL_EXECUTE_DEFAULT_TIMEOUT_MS,
  TERMINAL_EXECUTE_MAX_TIMEOUT_MS,
  TERMINAL_EXECUTE_MIN_TIMEOUT_MS,
  TERMINAL_READ_DEFAULT_CHARS,
  TERMINAL_READ_MAX_CHARS,
  TERMINAL_MAX_PER_SESSION,
  TERMINAL_MAX_TOTAL,
  TERMINAL_RETAINED_CHARS,
  TERMINAL_INTERRUPT,
  appendTerminalGuidance,
  buildTerminalGuidancePrompt,
  classifyTerminalCommand,
  commandHead,
  formatTerminalExecute,
  formatTerminalList,
  formatTerminalOpen,
  formatTerminalRead,
  normalizeCommand,
  normalizeTitle,
  resolveExecuteTimeoutMs,
  resolveQuietMs,
  resolveReadLimit,
  terminalCommandNote,
} = core;

/* ── 工具名 ──────────────────────────────────────────────────────────────────── */

test("四个工具名固定，且不占用子代理保留名", () => {
  assert.deepEqual([...TERMINAL_TOOL_NAMES], [
    "terminal_open",
    "terminal_execute",
    "terminal_read",
    "terminal_list",
  ]);
  for (const name of TERMINAL_TOOL_NAMES) {
    assert.ok(!SUBAGENT_CONTROL_TOOL_NAMES.includes(name), `${name} 撞上保留名`);
  }
});

/* ── 必做的那条规则：别为了「展示」开终端 ─────────────────────────────────── */

test("系统提示词段落写死了「禁止为展示开终端」的品类清单", () => {
  const prompt = buildTerminalGuidancePrompt();
  for (const category of ["文档", "PDF", "Office", "转码", "OCR", "批处理"]) {
    assert.match(prompt, new RegExp(category), `提示词漏了「${category}」`);
  }
  // 禁令必须落在「展示」这个词上，而不是泛泛的「不要用终端」
  assert.match(prompt, /禁止为了「展示」而开终端/);
  // Git 常规操作默认进上下文（Proma 原规则）
  assert.match(prompt, /Git 常规操作默认直接进上下文/);
  assert.match(prompt, /git/i);
});

test("系统提示词段落提到全部四个工具名，改名不会漂移", () => {
  const prompt = buildTerminalGuidancePrompt();
  for (const name of TERMINAL_TOOL_NAMES) {
    assert.ok(prompt.includes(name), `提示词没提到 ${name}`);
  }
});

test("系统提示词段落可换名（工具改名时提示词跟着走）", () => {
  const prompt = buildTerminalGuidancePrompt({
    open: "T_open",
    execute: "T_execute",
    read: "T_read",
    list: "T_list",
  });
  assert.match(prompt, /T_execute/);
  assert.ok(!prompt.includes("terminal_execute"));
});

test("注入是幂等的：同一段规则不会因为多个扩展都追加而出现两遍", () => {
  const base = "You are pi.";
  const once = appendTerminalGuidance(base);
  const twice = appendTerminalGuidance(once);
  assert.equal(twice, once);
  assert.equal(once.split(TERMINAL_PROMPT_HEADING).length - 1, 1);
  assert.ok(once.startsWith(base));
});

test("空提示词时也能得到完整段落", () => {
  assert.equal(appendTerminalGuidance(""), buildTerminalGuidancePrompt());
  assert.equal(appendTerminalGuidance(undefined), buildTerminalGuidancePrompt());
});

/* ── 上限与超时档位 ─────────────────────────────────────────────────────────── */

test("等待上限：非法值回默认档，合法值夹进 [1s, 10min]", () => {
  assert.equal(resolveExecuteTimeoutMs(undefined), TERMINAL_EXECUTE_DEFAULT_TIMEOUT_MS);
  assert.equal(resolveExecuteTimeoutMs("60000"), TERMINAL_EXECUTE_DEFAULT_TIMEOUT_MS);
  assert.equal(resolveExecuteTimeoutMs(500), TERMINAL_EXECUTE_MIN_TIMEOUT_MS);
  assert.equal(resolveExecuteTimeoutMs(999_999_999), TERMINAL_EXECUTE_MAX_TIMEOUT_MS);
  assert.equal(resolveExecuteTimeoutMs(30_000), 30_000);
});

test("静默窗口随等待上限缩放，并夹在 [250ms, 5s]", () => {
  assert.equal(resolveQuietMs(1_000), 250);
  assert.equal(resolveQuietMs(120_000), 5_000);
  assert.equal(resolveQuietMs(5_000), 250);
});

test("读取上限：越界夹回上限而不是报错（模型常写 999999）", () => {
  assert.equal(resolveReadLimit(undefined), undefined);
  assert.equal(resolveReadLimit("x"), undefined);
  assert.equal(resolveReadLimit(0), 1);
  assert.equal(resolveReadLimit(999_999), TERMINAL_READ_MAX_CHARS);
  assert.equal(resolveReadLimit(500), 500);
});

test("内存上界是写死的常量之和（终端输出唯一能无限增长）", () => {
  assert.equal(TERMINAL_READ_DEFAULT_CHARS, 12_000);
  assert.equal(TERMINAL_READ_MAX_CHARS, 48_000);
  assert.equal(TERMINAL_RETAINED_CHARS, 256 * 1024);
  assert.equal(TERMINAL_MAX_PER_SESSION, 4);
  assert.equal(TERMINAL_MAX_TOTAL, 8);
  assert.ok(TERMINAL_MAX_TOTAL * TERMINAL_RETAINED_CHARS <= 4 * 1024 * 1024);
});

test("命令归一：压掉换行、拒空、长度封顶", () => {
  assert.equal(normalizeCommand("  npm run build\n").command, "npm run build");
  assert.equal(normalizeCommand("a\nb").command, "a b");
  assert.equal(normalizeCommand("   ").ok, false);
  assert.equal(normalizeCommand(123).ok, false);
  const long = normalizeCommand("x".repeat(64 * 1024 + 1));
  assert.equal(long.ok, false);
  assert.match(long.error, /过长/);
});

test("标题归一：空白压成单空格、封顶 80 字", () => {
  assert.equal(normalizeTitle("  a   b  ", "fallback"), "a b");
  assert.equal(normalizeTitle("", "Agent 终端"), "Agent 终端");
  assert.equal(normalizeTitle("y".repeat(200), "x").length, 80);
});

/* ── 命令分类 ───────────────────────────────────────────────────────────────── */

test("命令头跳过 env 赋值与包装器", () => {
  assert.equal(commandHead("npm run build"), "npm");
  assert.equal(commandHead("FOO=1 BAR=2 npm test"), "npm");
  assert.equal(commandHead("sudo /usr/bin/pandoc a.md"), "pandoc");
  assert.equal(commandHead("nohup node server.js"), "node");
  assert.equal(commandHead("/bin/cat notes.txt"), "cat");
  assert.equal(commandHead("git status && echo done"), "git");
  assert.equal(commandHead("cat a.txt | grep b"), "cat");
});

test("「展示类」命令被认出来（软提醒写给模型看）", () => {
  assert.equal(classifyTerminalCommand("cat notes.md"), "display-only");
  assert.equal(classifyTerminalCommand("head -n 20 out.txt"), "display-only");
  assert.equal(classifyTerminalCommand("open report.pdf"), "display-only");
  assert.match(terminalCommandNote(classifyTerminalCommand("cat notes.md")), /不要为了「展示」开终端/);
});

test("文档 / 转码 / OCR / 批处理被认成后台任务", () => {
  for (const command of [
    "pandoc a.md b.docx",
    "soffice --headless --convert-to pdf a.docx",
    "ffmpeg -i in.mov out.mp4",
    "tesseract page.png out",
    "pdftotext a.pdf a.txt",
    "zip -r out.zip dist",
    "tar xzf bundle.tgz",
    "rsync -a src/ dst/",
  ]) {
    assert.equal(classifyTerminalCommand(command), "background-work", command);
    assert.match(terminalCommandNote(classifyTerminalCommand(command)), /不要.*用可见终端/);
  }
});

test("交互式 / 长驻命令被认出来（跑完把终端标成不可复用）", () => {
  assert.equal(classifyTerminalCommand("vim src/a.ts"), "interactive");
  assert.equal(classifyTerminalCommand("ssh build-1"), "interactive");
  assert.equal(classifyTerminalCommand("npm run dev"), "long-running");
  assert.equal(classifyTerminalCommand("next dev"), "long-running");
  assert.equal(classifyTerminalCommand("tail -f app.log"), "long-running");
  assert.equal(classifyTerminalCommand("docker compose up"), "long-running");
});

test("普通命令与中断不会被误判", () => {
  assert.equal(classifyTerminalCommand("git status"), "normal");
  assert.equal(classifyTerminalCommand("npm test"), "normal");
  assert.equal(classifyTerminalCommand("ls -la"), "normal");
  assert.equal(classifyTerminalCommand("node scripts/build.mjs"), "normal");
  assert.equal(classifyTerminalCommand(TERMINAL_INTERRUPT), "interrupt");
  assert.equal(classifyTerminalCommand("git commit -m \"x\""), "normal");
  assert.equal(terminalCommandNote("normal"), undefined);
});

/* ── 写给模型的文本 ─────────────────────────────────────────────────────────── */

function terminal(overrides = {}) {
  return {
    terminalId: "0123456789abcdef0123456789abcdef",
    title: "Agent 终端",
    cwd: "/repo",
    status: "running",
    exitCode: null,
    createdAt: "2026-10-02T00:00:00.000Z",
    lastUsedAt: "2026-10-02T00:00:01.000Z",
    availableStartOffset: 0,
    availableEndOffset: 42,
    busy: false,
    ...overrides,
  };
}

function readResult(overrides = {}) {
  return {
    output: "hello",
    availableStartOffset: 0,
    availableEndOffset: 5,
    offset: 0,
    nextOffset: 5,
    truncatedBefore: false,
    truncatedAfter: false,
    ...overrides,
  };
}

test("execute 结果绝不把「输出静止」说成「命令结束」", () => {
  const text = formatTerminalExecute({
    terminal: terminal(),
    command: "npm run build",
    reused: false,
    waitStatus: "settled",
    waitMs: 1_200,
    timeoutMs: 120_000,
    read: readResult(),
    kind: "normal",
  });
  assert.match(text, /输出已静止/);
  assert.match(text, /可能仍在运行/);
  assert.ok(!/已完成|执行成功|命令结束/.test(text));
});

test("等待到上限时明确说「可能仍在运行」并给出中断方法", () => {
  const text = formatTerminalExecute({
    terminal: terminal(),
    command: "npm run dev",
    reused: true,
    waitStatus: "timeout",
    waitMs: 120_000,
    timeoutMs: 120_000,
    read: readResult(),
    kind: "long-running",
  });
  assert.match(text, /可能仍在运行/);
  assert.match(text, /\\u0003/);
  assert.match(text, /120000 ms/);
});

test("输出被截断时必须写明「输出被截断」，并给出续读游标", () => {
  const text = formatTerminalExecute({
    terminal: terminal(),
    command: "npm test",
    reused: true,
    waitStatus: "settled",
    waitMs: 900,
    timeoutMs: 120_000,
    read: readResult({ truncatedAfter: true, nextOffset: 100, availableEndOffset: 400 }),
    kind: "normal",
  });
  assert.match(text, /输出被截断/);
  assert.match(text, /offset: 100/);
});

test("缓冲滚动导致的前文丢失必须如实告知（不是本次读取上限的问题）", () => {
  const text = formatTerminalRead(
    terminal(),
    readResult({ availableStartOffset: 900, truncatedBefore: true, offset: 900, nextOffset: 1_000 }),
  );
  assert.match(text, /输出被截断/);
  assert.match(text, /滚出内存缓冲/);
});

test("展示类命令的结果里带软提醒", () => {
  const text = formatTerminalExecute({
    terminal: terminal(),
    command: "cat report.pdf",
    reused: false,
    waitStatus: "settled",
    waitMs: 300,
    timeoutMs: 120_000,
    read: readResult(),
    kind: "display-only",
  });
  assert.match(text, /不要为了「展示」开终端/);
});

test("list 在没有终端时告诉模型该怎么做，而不是只回一个空数组", () => {
  const text = formatTerminalList([]);
  assert.match(text, /还没有可见终端/);
  assert.match(text, /复用/);
  const some = formatTerminalList([
    terminal({ busy: true }),
    terminal({ terminalId: "f".repeat(32), status: "exited", exitCode: 1 }),
  ]);
  assert.match(some, /上一条命令尚未观察到结束/);
  assert.match(some, /已退出（退出码 1）/);
  assert.match(some, /terminal_execute/);
});

test("open 的结果说明这个终端用户看得见、也能接手", () => {
  const text = formatTerminalOpen(terminal());
  assert.match(text, /可见/);
  assert.match(text, /terminal_execute/);
});