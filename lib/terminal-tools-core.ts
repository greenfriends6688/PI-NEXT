/**
 * fork:proma-41-terminal — Agent 可见终端的**语义层**（纯函数，不碰 fs、不碰 node-pty）。
 *
 * 这里是 `lib/terminal-tools-extension.ts` 里四个工具的全部判定：
 * 工具名、等待/上限的档位、命令分类（"这条是不是又为了展示而开终端"）、以及**写给模型的
 * 结果文本**。全部无副作用、可单测；机械部分（PTY、订阅、缓冲）在 `terminal-tools-runtime.ts`，
 * 输出缓冲语义在 `terminal-tools-output.ts`。
 *
 * 参照实现（只读）：Proma `apps/electron/src/main/lib/adapters/pi-builtin-tools.ts`
 * 的 `buildAgentTerminalTools` + `main/lib/agent-prompt-builder.ts:137-142` 的可见终端段。
 * 与 Proma 的差异只有两处，都是本仓形态决定的：
 *   1. 工具名走本仓的 snake_case（`terminal_open` / `terminal_execute` / …），不叫
 *      `TerminalOpen`；因此提示词与工具描述里的名字由 {@link buildTerminalGuidancePrompt}
 *      统一生成，改名不会留下"提示词还在说旧名字"的静默漂移。
 *   2. `terminal_execute` 会**当场等输出静止**并把结果回传（Proma 只写入、由模型自己
 *      `TerminalRead`）；否则每条命令要多一轮工具调用，模型经常干脆不开终端。
 */

import type { TerminalOutputReadResult } from "./terminal-tools-output";
import { TERMINAL_READ_MAX_CHARS } from "./terminal-tools-output";

// 读取上限是跨模块的公共词汇（提示词、工具 description、结果文本都要引用同一处），
// 所以在这里转发一份，别的模块不必知道它住在 output 模块里。
export { TERMINAL_READ_DEFAULT_CHARS, TERMINAL_READ_MAX_CHARS } from "./terminal-tools-output";

/** 四个工具名。**不得**与 `Agent` / `get_subagent_result` / `steer_subagent` 撞名（子代理保留名）。 */
export const TERMINAL_TOOL_NAMES = [
  "terminal_open",
  "terminal_execute",
  "terminal_read",
  "terminal_list",
] as const;

export type TerminalToolName = (typeof TERMINAL_TOOL_NAMES)[number];

export const TERMINAL_TOOL_NAMES_SET: ReadonlySet<string> = new Set<string>(TERMINAL_TOOL_NAMES);

/* ── 上限与档位（全部写死并导出，测试与文档引用同一处） ────────────────────────── */

/** `terminal_execute` 默认等待上限：2 分钟。 */
export const TERMINAL_EXECUTE_DEFAULT_TIMEOUT_MS = 120_000;
export const TERMINAL_EXECUTE_MIN_TIMEOUT_MS = 1_000;
/** `terminal_execute` 等待上限的天花板：10 分钟。再长就该开后台任务而不是阻塞这一轮。 */
export const TERMINAL_EXECUTE_MAX_TIMEOUT_MS = 600_000;
/** 输出连续静默多久算"这一轮收敛了"（只在上过输出之后才算）。 */
export const TERMINAL_QUIET_MS_DEFAULT = 1_200;
export const TERMINAL_QUIET_MS_MIN = 250;
export const TERMINAL_QUIET_MS_MAX = 5_000;
/** 单条命令长度上限，与 `/api/terminal/[id]` 的输入上限同档。 */
export const TERMINAL_MAX_COMMAND_CHARS = 64 * 1024;
export const TERMINAL_MAX_TITLE_CHARS = 80;
/** Agent 开的终端初始尺寸（用户在界面里打开后会由 xterm 重新 resize 覆盖）。 */
export const TERMINAL_DEFAULT_COLS = 120;
export const TERMINAL_DEFAULT_ROWS = 30;
/** 每个 agent 终端在内存里保留的原始输出上限。 */
export const TERMINAL_RETAINED_CHARS = 256 * 1024;
/** 单个会话同时持有的 agent 终端数上限。 */
export const TERMINAL_MAX_PER_SESSION = 4;
/** 单个进程同时持有的 agent 终端数上限（`lib/terminal-manager.ts` 之外的那一份账）。 */
export const TERMINAL_MAX_TOTAL = 8;
/** 终端退出后仍保留输出缓冲的时长：命令跑完退出，模型还要能读尾巴。 */
export const TERMINAL_EXITED_RETENTION_MS = 120_000;

/** Ctrl+C：写进 PTY 就是中断当前前台命令。 */
export const TERMINAL_INTERRUPT = "\u0003";

export function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** `timeoutMs` 参数归一：非法值退回默认档，合法值夹进 [1s, 10min]。 */
export function resolveExecuteTimeoutMs(value: unknown): number {
  return clampInteger(
    value,
    TERMINAL_EXECUTE_MIN_TIMEOUT_MS,
    TERMINAL_EXECUTE_MAX_TIMEOUT_MS,
    TERMINAL_EXECUTE_DEFAULT_TIMEOUT_MS,
  );
}

/**
 * 静默窗口 = 等待上限的 5%，夹进 [250ms, 5s]。
 * 短命令不至于等太久（1s 上限 → 250ms），长命令不会因为 shell 一口气刷日志而误判收敛。
 */
export function resolveQuietMs(timeoutMs: number): number {
  const settled = clampInteger(
    Math.round(timeoutMs / 20),
    TERMINAL_QUIET_MS_MIN,
    TERMINAL_QUIET_MS_MAX,
    TERMINAL_QUIET_MS_DEFAULT,
  );
  return settled;
}

/**
 * `limit` 参数归一：越界值**夹**进 [1, 48000] 而不是报错。
 *
 * 与 {@link resolveExecuteTimeoutMs} 的区别在这里是刻意的：模型写 `limit: 999999` 时，
 * 夹到上限再读一页是最有用的行为，直接抛错只会让它空转一轮；而 `offset` 传负数是
 * 语义错误（见 `readTerminalOutput`），必须报错。
 */
export function resolveReadLimit(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return clampInteger(value, 1, TERMINAL_READ_MAX_CHARS, TERMINAL_READ_MAX_CHARS);
}

export function normalizeTitle(value: unknown, fallback: string): string {
  const title = typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  return (title || fallback).slice(0, TERMINAL_MAX_TITLE_CHARS);
}

/** 命令归一：去首尾空白、压掉换行（PTY 里换行就是提交，不是命令内容）、长度封顶。 */
export function normalizeCommand(value: unknown): { ok: true; command: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "command 必须是字符串" };
  const command = value.replace(/[\r\n]+/g, " ").trim();
  if (!command) return { ok: false, error: "command 不能为空" };
  if (command.length > TERMINAL_MAX_COMMAND_CHARS) {
    return { ok: false, error: `command 过长（${command.length} 字符，上限 ${TERMINAL_MAX_COMMAND_CHARS}）` };
  }
  return { ok: true, command };
}

/* ── 命令分类：判断"是不是又为了展示而开终端" ─────────────────────────────────── */

export type TerminalCommandKind =
  /** Ctrl+C，中断前台命令。 */
  | "interrupt"
  /** 只是把文件内容打到终端里看。 */
  | "display-only"
  /** 文档 / 转码 / OCR / 批处理这类**后台任务**。 */
  | "background-work"
  /** 需要交互输入。 */
  | "interactive"
  /** 长驻服务。 */
  | "long-running"
  | "normal";

/** 只是"看"的命令头。 */
// 编辑器与分页器不在这一组里：给 `vim` 提示"用 read 读文件"是错的建议。
const DISPLAY_ONLY_HEADS = new Set([
  "cat", "head", "tail", "less", "more", "bat", "nl", "xxd", "od", "hexdump", "strings",
  "file", "open", "xdg-open", "start", "code", "qlmanage", "sips", "textutil",
  "antiword", "column", "pr",
]);

/** 文档 / PDF / Office / 转码 / OCR / 批处理的命令头（Proma 那条禁令的对象）。 */
const BACKGROUND_WORK_HEADS = new Set([
  "pandoc", "soffice", "libreoffice", "unoconv", "ffmpeg", "ffprobe", "tesseract",
  "ocrmypdf", "qpdf", "pdftotext", "pdftoppm", "gs", "magick", "convert", "rsync",
  "7z", "unzip", "zip", "tar", "gzip", "gunzip", "xlsx2csv", "in2csv", "iconv",
]);

/** 去掉 env 前缀赋值与常见包装器，取第一段命令的可执行名。 */
const COMMAND_WRAPPERS = new Set([
  "command", "env", "nohup", "setsid", "stdbuf", "time", "nice", "ionice",
  "sudo", "doas", "runas", "exec", "builtin", "eval",
]);

const INTERACTIVE_HEADS = new Set([
  "vi", "vim", "nvim", "nano", "emacs", "top", "htop", "btop",
  "watch", "man", "psql", "mysql", "sqlite3", "mongo", "redis-cli", "gdb", "lldb",
  "tmux", "screen", "su", "login", "passwd", "ssh", "sftp", "telnet", "ftp",
]);

const LONG_RUNNING_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|watch|preview)\b/i,
  /\bnext\s+dev\b/i,
  /\b(?:python3?|node)\s+-m\s+http\.server\b/i,
  /\btail\s+(?:-[a-z]*f|--follow)\b/i,
  /\b(?:journalctl|docker\s+compose\s+up|docker\s+run)\b/i,
  /\bwebpack\s+(?:serve|dev-server)\b/i,
  /\b(?:vite|nuxt|ng\s+serve|astro\s+dev)\b/i,
];

function basename(token: string): string {
  const cut = token.split("/").pop() ?? token;
  return cut.toLowerCase().replace(/\.exe$/, "");
}

/** 取第一段命令的可执行名（跳过 `FOO=bar`、`sudo`、`nohup` 等）。 */
export function commandHead(command: string): string {
  const first = command.split(/\|\||&&|[;\n|]/)[0].trim();
  const tokens = first.split(/\s+/).filter(Boolean);
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1;
  while (index < tokens.length && COMMAND_WRAPPERS.has(basename(tokens[index]))) index += 1;
  return basename(tokens[index] ?? "");
}

/**
 * 这条命令属于哪一类。
 *
 * 分类只用于**软提醒**（结果里加一句提示），绝不拦：同一台机器上用户明确要求"把这个 PDF 打开
 * 给我看"时，拦下来比多开一个 tab 更糟。硬约束在系统提示词里（{@link buildTerminalGuidancePrompt}）。
 */
export function classifyTerminalCommand(command: string): TerminalCommandKind {
  const trimmed = command.trim();
  if (trimmed.includes(TERMINAL_INTERRUPT)) return "interrupt";
  const head = commandHead(trimmed);
  // 顺序即语义，各组给的是不同的处置：
  // · interactive / long-running → 跑完把这个终端标成**不可复用**（Proma 同款纪律）；
  // · display-only → 提醒改用 read / grep；
  // · background-work → 提醒这类任务不该开终端，哪怕很慢。
  // 所以 `tail -f` 必须先于 `tail` 判成 long-running，`vim` 必须先于任何查看类判成 interactive。
  if (INTERACTIVE_HEADS.has(head)) return "interactive";
  if (LONG_RUNNING_PATTERNS.some((pattern) => pattern.test(trimmed))) return "long-running";
  if (DISPLAY_ONLY_HEADS.has(head)) return "display-only";
  if (BACKGROUND_WORK_HEADS.has(head)) return "background-work";
  return "normal";
}

const KIND_NOTES: Partial<Record<TerminalCommandKind, string>> = {
  "display-only": [
    "提示：这条命令只是把内容打到终端里**看**。读文件内容请直接用 read / grep / ls ——",
    "不要为了「展示」开终端，用户会多出一个终端标签页。",
  ].join(""),
  "background-work": [
    "提示：文档 / PDF / Office / 转码 / OCR / 格式转换 / 压缩解压 / 批处理这类任务**不要**用可见终端，",
    "即使很慢也应该在后台跑完，只向用户汇报阶段与结果；需要完整日志就把输出重定向到文件，再用文件工具读。",
  ].join(""),
};

/** 分类对应的软提醒；没有就返回 undefined（结果文本里不出现多余的话）。 */
export function terminalCommandNote(kind: TerminalCommandKind): string | undefined {
  return KIND_NOTES[kind];
}

/* ── 系统提示词：那条"别为展示开终端"的规则 ─────────────────────────────────── */

export const TERMINAL_PROMPT_HEADING = "## 可见终端";

export interface TerminalPromptToolNames {
  open: string;
  execute: string;
  read: string;
  list: string;
}

export const DEFAULT_TERMINAL_PROMPT_TOOL_NAMES: TerminalPromptToolNames = {
  open: "terminal_open",
  execute: "terminal_execute",
  read: "terminal_read",
  list: "terminal_list",
};

/**
 * 「可见终端」段落的**唯一生成处**（纯函数，可单测）。
 *
 * 这一段是 PR-41 必做的那条规则，Proma 的原话是「文档/PDF/Office/转码/OCR/批处理禁止为『展示』
 * 打开终端」。不做它，agent 会为了看一眼文件内容就疯狂开终端，界面上全是终端标签页。
 * 所以它必须进系统提示词，而不是只写在某个工具的 description 里（description 会随上下文
 * 长度被裁掉，提示词不会）。
 *
 * 注入点在 `lib/terminal-tools-extension.ts` 的 `before_agent_start`（与
 * `lib/plan-mode-extension.ts` 同一个 seam）。
 */
export function buildTerminalGuidancePrompt(
  names: TerminalPromptToolNames = DEFAULT_TERMINAL_PROMPT_TOOL_NAMES,
): string {
  return [
    TERMINAL_PROMPT_HEADING,
    "",
    `- \`${names.execute}\` 会开一个**用户可见**的终端：界面右侧多一个标签页，输出实时刷屏，用户随时能看见、能打断、能自己接手。`,
    "- **是否耗时不是使用它的理由。** 只在用户明确要求观看，或命令运行期间确实需要用户观察日志、输入、确认、调试或随时中断时使用：",
    "  开发服务、交互式安装/迁移/部署，或用户明确要求观看的构建与测试。其余命令一律用 bash 或专用工具在内部执行。",
    "- **文档 / PDF / Office（Word/Excel/PPT）/ 图片与音视频转码 / OCR / 格式转换 / 压缩解压 / 批处理与批量导入导出 / 数据清洗生成 / 文件校验索引，一律禁止为了「展示」而开终端。**",
    "  即使预计耗时很长也不开：这类任务在后台做完，只向用户汇报阶段与结果。",
    "- 同样不要为了展示普通的读取/搜索、脚本运行、依赖探测、单元测试、类型检查、格式化、构建日志、网络下载或 CLI 输出而开终端。",
    "  需要可视化结果时交付文件、摘要或进度项，不要把技术日志当作进度。",
    "- **Git 常规操作默认直接进上下文**（`status` / `diff` / `log` / `show` / 分支与远端列表、常规 `add` / `commit` / `push`），不要为此开终端。",
    "  只有冲突处理、`reset --hard` / `clean`、force-push、删除分支或 Worktree、长时 LFS / 子模块传输、或用户要求观看时，才用可见终端。",
    "- 可见终端不替代权限确认与安全规则；重要命令照旧走审批。",
    `- 确定要用时**优先复用而不是新开标签页**：先 \`${names.list}\` 看本会话的终端，选 cwd 一致、仍在运行、且你已确认上一条命令结束的终端，`,
    `  把它的 id 传给 \`${names.execute}\`。只有没有安全候选、cwd 必须改变、或用户要独立观察并行会话时才新开。`,
    `  交互式、长驻或状态不明的终端不可复用；用 \`${names.read}\` 确认上一条命令是否结束，不要假设输出会自动回传。`,
    `- 输出有上限，被截断时结果里会明确写「输出被截断」——不要把它当成完整结果；需要完整输出就把命令重定向到文件，再用文件工具读。`,
    `- 中断正在运行的命令：\`${names.execute}\` 的 \`command\` 传 \`"\\u0003"\`（Ctrl+C）。`,
    `- \`${names.open}\` 只开终端、不执行命令；仅在需要让用户自己接手交互输入时使用。`,
  ].join("\n");
}

/**
 * 把「可见终端」段落并到已有 system prompt 后面；已经注入过就原样返回。
 *
 * 幂等是为了和 `lib/plan-mode-extension.ts` 共存：两个扩展都往同一处追加，
 * 谁先谁后都不能让同一段规则出现两遍。
 */
export function appendTerminalGuidance(
  systemPrompt: string | undefined,
  names: TerminalPromptToolNames = DEFAULT_TERMINAL_PROMPT_TOOL_NAMES,
): string {
  const section = buildTerminalGuidancePrompt(names);
  const base = systemPrompt ?? "";
  if (!base.trim()) return section;
  if (base.includes(TERMINAL_PROMPT_HEADING)) return base;
  return `${base}\n\n${section}`;
}

/* ── 写给模型的文本 ──────────────────────────────────────────────────────────── */

export type AgentTerminalStatus = "running" | "exited";

export interface AgentTerminalSummary {
  terminalId: string;
  title: string;
  cwd: string;
  status: AgentTerminalStatus;
  exitCode: number | null;
  createdAt: string;
  lastUsedAt: string;
  /** 内存里仍可读的输出区间（原始 PTY 字符偏移）。 */
  availableStartOffset: number;
  availableEndOffset: number;
  /** 上一条命令是否还在等收敛。 */
  busy: boolean;
}

function terminalLine(terminal: AgentTerminalSummary): string {
  const state = terminal.status === "exited"
    ? `已退出（退出码 ${terminal.exitCode ?? 0}）`
    : terminal.busy ? "运行中（上一条命令尚未观察到结束）" : "运行中";
  return `- \`${terminal.terminalId}\` · ${terminal.title} · ${state} · cwd=${terminal.cwd}`;
}

export function formatTerminalOpen(terminal: AgentTerminalSummary): string {
  return [
    `已打开可见终端 \`${terminal.terminalId}\`（${terminal.title}）。`,
    `cwd：${terminal.cwd}`,
    "这个终端对用户可见：用户能实时看到输出、随时中断、也能自己接手输入。",
    "没有可复用的安全终端时才开新的；命令请用 terminal_execute 执行（可传 terminalId 复用它）。",
  ].join("\n");
}

export function formatTerminalList(terminals: readonly AgentTerminalSummary[]): string {
  if (terminals.length === 0) {
    return [
      "本会话还没有可见终端。",
      "复用前先确认：只有 cwd 一致、仍在运行、且你已确认上一条命令结束的终端才可复用；",
      "没有这样的候选时，terminal_execute 会开一个新的可见终端。",
    ].join("\n");
  }
  return [
    `本会话的可见终端（${terminals.length} 个）：`,
    ...terminals.map(terminalLine),
    "复用方式：把 terminalId 传给 terminal_execute；用 terminal_read 确认上一条命令是否结束。",
  ].join("\n");
}

export type TerminalWaitStatus = "exited" | "settled" | "timeout" | "aborted";

export interface TerminalExecuteOutcome {
  terminal: AgentTerminalSummary;
  command: string;
  reused: boolean;
  waitStatus: TerminalWaitStatus;
  waitMs: number;
  timeoutMs: number;
  read: TerminalOutputReadResult;
  kind: TerminalCommandKind;
}

/**
 * `terminal_execute` 的结果文本。
 *
 * 两条纪律：① **不假装完整**——输出被上限或缓冲滚动裁掉时必须显式写「输出被截断」，
 * 并给出还能用的续读游标；② **不假装命令结束**——"输出静止"只说明 shell 这一刻没在吐字，
 * 措辞必须让模型知道它可能还在跑。
 */
export function formatTerminalExecute(outcome: TerminalExecuteOutcome): string {
  const { terminal, command, reused, waitStatus, read } = outcome;
  const head = [
    reused
      ? `已在可见终端 \`${terminal.terminalId}\`（${terminal.title}）执行：\`${command}\``
      : `已打开可见终端 \`${terminal.terminalId}\`（${terminal.title}，cwd=${terminal.cwd}）并执行：\`${command}\``,
  ];

  const state: string[] = [];
  if (waitStatus === "exited") {
    state.push(`终端已退出（退出码 ${terminal.exitCode ?? 0}），等待 ${outcome.waitMs} ms。`);
  } else if (waitStatus === "settled") {
    state.push(`输出已静止 ${outcome.waitMs} ms（命令可能仍在运行，不是结束确认）。`);
  } else if (waitStatus === "timeout") {
    state.push(
      `已到等待上限 ${outcome.timeoutMs} ms，命令**可能仍在运行**；未读完的部分不会自动回来。` +
      `需要继续看就用 terminal_read，需要停下来就再执行一次并把 command 传 "\\u0003"（Ctrl+C）。`,
    );
  } else {
    state.push("等待被中止（用户停止或会话中断），命令可能仍在终端里运行。");
  }
  if (terminal.status === "exited" && waitStatus !== "exited") {
    state.push(`终端当前状态：已退出（退出码 ${terminal.exitCode ?? 0}）。`);
  }

  const truncation: string[] = [];
  if (read.truncatedAfter) {
    truncation.push(`缓冲区里还有更新的输出，用 terminal_read(terminalId: "${terminal.terminalId}", offset: ${read.nextOffset}) 继续读。`);
  }
  if (read.truncatedBefore) {
    truncation.push(
      read.availableStartOffset > 0
        ? `更早的 ${read.availableStartOffset} 字符已滚出内存缓冲（每个终端只留最后 ${TERMINAL_RETAINED_CHARS} 字符），取不回来了。`
        : "本次只返回了末尾一段，前文被本次读取上限截断。",
    );
  }
  if (truncation.length > 0) truncation.unshift("**输出被截断，这不是完整结果。**");

  const note = terminalCommandNote(outcome.kind);
  return [
    ...head,
    ...state,
    ...(note ? [note] : []),
    ...truncation,
    "",
    "输出：",
    read.output.trim() ? read.output : "（本次没有新输出；命令可能仍在运行，可用 terminal_read 继续读或用 \"\\u0003\" 中断）",
  ].join("\n");
}

export function formatTerminalRead(
  terminal: AgentTerminalSummary,
  read: TerminalOutputReadResult,
): string {
  const truncation: string[] = [];
  if (read.truncatedAfter) {
    truncation.push(`还有 ${read.availableEndOffset - read.nextOffset} 字符未读，用 terminal_read(offset: ${read.nextOffset}) 继续。`);
  }
  if (read.truncatedBefore && read.availableStartOffset > 0) {
    truncation.push(`更早的 ${read.availableStartOffset} 字符已滚出内存缓冲，取不回来。`);
  }
  if (read.truncatedBefore && read.availableStartOffset === 0) {
    truncation.push(`本次只返回了末尾一段（前文被 limit 截断），用 terminal_read(offset: ${read.offset}) 往前翻。`);
  }
  // 截断必须自报家门：模型看到「输出被截断」才不会把它当成完整结果继续推理。
  if (truncation.length > 0) truncation.unshift("**输出被截断，这不是完整结果。**");
  return [
    `终端 \`${terminal.terminalId}\`（${terminal.title}，${terminal.status === "exited" ? `已退出，退出码 ${terminal.exitCode ?? 0}` : "运行中"}）`,
    `输出区间 ${read.offset} ~ ${read.nextOffset} / 可读区间 ${read.availableStartOffset} ~ ${read.availableEndOffset}`,
    ...truncation,
    "",
    read.output.trim() ? read.output : "（这个区间没有输出）",
  ].join("\n");
}
