/**
 * fork:proma-41-terminal — Agent 可见终端的**四个工具**（pi 内联扩展）。
 *
 * `terminal_open` / `terminal_execute` / `terminal_read` / `terminal_list`。
 * 按 `AGENTS.md` 的「产品能力不许降级成 skill」：这是有状态的能力（会起进程、会在用户
 * 界面上多出标签页），所以它**必须**是注册给模型的真实工具，而不是一份 markdown。
 *
 * 分层：
 * · `terminal-tools-core.ts`     纯语义（上限、命令分类、结果文本、**系统提示词那一段**）
 * · `terminal-tools-output.ts`   纯输出缓冲（分页 / 截断 / 去控制序列）
 * · `terminal-tools-cwd.ts`      cwd 授权（复用 `/api/terminal` 的同一套 roots）
 * · `terminal-tools-runtime.ts`  PTY 机械层（复用 `lib/terminal-manager.ts`，不自己 require node-pty）
 *
 * 注册位在 `lib/rpc-manager.ts` 的 `extensionFactories` 里，**放在
 * `createPlanModeExtension(...)` 之后** —— `before_agent_start` 的 handlers 按注册顺序跑，
 * 排在 `exactSystemPromptExtension` 之后才能把自己的段落接到那份被替换过的提示词后面。
 */

import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionToolContext,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import {
  TERMINAL_EXECUTE_DEFAULT_TIMEOUT_MS,
  TERMINAL_EXECUTE_MAX_TIMEOUT_MS,
  TERMINAL_EXECUTE_MIN_TIMEOUT_MS,
  TERMINAL_PROMPT_HEADING,
  TERMINAL_READ_DEFAULT_CHARS,
  TERMINAL_READ_MAX_CHARS,
  TERMINAL_RETAINED_CHARS,
  appendTerminalGuidance,
  classifyTerminalCommand,
  formatTerminalExecute,
  formatTerminalList,
  formatTerminalOpen,
  formatTerminalRead,
  normalizeCommand,
  normalizeTitle,
  resolveReadLimit,
  type AgentTerminalSummary,
} from "./terminal-tools-core";
import { resolveAgentTerminalCwd } from "./terminal-tools-cwd";
import {
  claimAgentTerminalSession,
  listAgentTerminals,
  openAgentTerminal,
  readAgentTerminalOutput,
  runAgentTerminalCommand,
} from "./terminal-tools-runtime";

export const HOST_TERMINAL_TOOLS_EXTENSION_NAME = "pi-web-terminal-tools";

/** 写进 `details` 的载荷：让界面/统计能认出这是哪一类工具结果（不参与模型上下文）。 */
export interface TerminalToolDetails {
  kind: "pi-web-terminal";
  action: "open" | "execute" | "read" | "list";
  terminalId?: string;
  sessionId: string;
  title?: string;
  cwd?: string;
  status?: "running" | "exited";
  exitCode?: number | null;
  reused?: boolean;
  waitStatus?: string;
  timedOut?: boolean;
  aborted?: boolean;
  truncated?: boolean;
  availableStartOffset?: number;
  availableEndOffset?: number;
  offset?: number;
  nextOffset?: number;
  limit?: number;
  terminals?: AgentTerminalSummary[];
}

function textResult(text: string, details: TerminalToolDetails) {
  return { content: [{ type: "text" as const, text }], details };
}

/** 会话身份：工具 execute 时才拿得到 `ctx`，所以按需绑定（fork / 迟赋 id 都能自愈）。 */
function sessionIdOf(ctx: ExtensionContext | ExtensionToolContext, previous: string | undefined): string {
  const next = ctx.sessionManager.getSessionId();
  return claimAgentTerminalSession(previous, next);
}

function sessionCwdOf(ctx: ExtensionContext | ExtensionToolContext): string {
  return ctx.sessionManager.getCwd();
}

const OUTPUT_LIMIT_NOTE =
  `输出有硬上限：单次读取 ${TERMINAL_READ_DEFAULT_CHARS} 字符（最多 ${TERMINAL_READ_MAX_CHARS}），` +
  `每个终端在内存里只留最后 ${TERMINAL_RETAINED_CHARS} 字符。被截断时结果里会写明「输出被截断」，那不是完整结果。`;

/**
 * 可注册的工厂函数（`rpc-manager.ts` 的 `extensionFactories` 收这个）。
 *
 * 无条件注册（与 `todo` 扩展同款判断）：一套没接线的终端工具比多一行系统提示词更糟，
 * 而「模型看不到工具」的错误方式（悄悄不用）比「模型看到但被提示词约束着不用」安全得多。
 * 子代理同样加载它（`load_extensions` 为真时），受**同一套**约束：同一段系统提示词
 * 规则、同样的输出上限、同样的忙终端不可复用，以及同样的归属隔离（子会话看不到父会话的终端）。
 *
 * 会话删除时的清理不在这里：`session_shutdown` 对**空闲回收**也会触发，那时用户可能
 * 正看着某个终端标签页（`npm run dev`），杀掉它不符合直觉。集成方在删除会话的路由里
 * 调 `disposeAgentTerminalsForSession(sessionId)` 即可。
 */
export function createTerminalToolsExtension(): InlineExtension {
  return {
    name: HOST_TERMINAL_TOOLS_EXTENSION_NAME,
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      let sessionId: string | undefined;

      // fork:proma-41-terminal-guardrail — 「别为展示而开终端」这条规则**进系统提示词**。
      // 放工具 description 里是不够的：description 会随上下文长度被裁掉，而提示词不会。
      pi.on("before_agent_start", async (event) => {
        const base = event?.systemPrompt ?? "";
        if (base.includes(TERMINAL_PROMPT_HEADING)) return undefined;
        return { systemPrompt: appendTerminalGuidance(base) };
      });

      pi.registerTool(defineTool({
        name: "terminal_open",
        label: "Terminal",
        description: [
          "Open a visible terminal tab in the right workspace, owned by this session.",
          "It does NOT run any command: use terminal_execute for that.",
          "cwd is resolved against this session's authorized directories (not an OS sandbox).",
          "Only open one when the user should watch or drive the shell themselves.",
          "Prefer reusing a terminal: see terminal_list for this session's terminals.",
        ].join(" "),
        promptSnippet: "Open a visible, user-watchable terminal tab owned by this session (runs nothing).",
        promptGuidelines: [
          "terminal_open only opens a tab; run commands with terminal_execute, and prefer reusing an existing terminal over opening another tab.",
        ],
        parameters: Type.Object({
          cwd: Type.Optional(Type.String({
            description: "Initial directory: absolute, or relative to this session's cwd. Must resolve inside the session's authorized roots.",
          })),
          title: Type.Optional(Type.String({ description: "Short visible tab title." })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const currentSession = sessionIdOf(ctx, sessionId);
          sessionId = currentSession;
          const cwd = await resolveAgentTerminalCwd({
            sessionCwd: sessionCwdOf(ctx),
            requested: params.cwd,
          });
          const title = normalizeTitle(params.title, "Agent 终端");
          const terminal = openAgentTerminal({ sessionId: currentSession, cwd, title });
          return textResult(formatTerminalOpen(terminal), {
            kind: "pi-web-terminal",
            action: "open",
            sessionId: currentSession,
            terminalId: terminal.terminalId,
            title: terminal.title,
            cwd: terminal.cwd,
            status: terminal.status,
          });
        },
      }));

      pi.registerTool(defineTool({
        name: "terminal_execute",
        label: "Terminal",
        description: [
          "Run one command in a visible terminal tab the user can watch and interrupt.",
          "Pass terminalId to reuse a terminal from terminal_list; omit it to open a new tab (only when no safe reuse exists).",
          `Waits for the output to go quiet, up to timeoutMs (${TERMINAL_EXECUTE_MIN_TIMEOUT_MS}-${TERMINAL_EXECUTE_MAX_TIMEOUT_MS}, default ${TERMINAL_EXECUTE_DEFAULT_TIMEOUT_MS}), and returns the output produced by this command.`,
          "Quiet is not completion: the command may still be running. Interrupt it with command: \"\\u0003\" (Ctrl+C).",
          `Do NOT open a terminal just to show file contents: document/PDF/Office/transcode/OCR/batch work and ordinary reads, tests, builds and Git must run in the background or via bash. ${OUTPUT_LIMIT_NOTE}`,
        ].join(" "),
        promptSnippet: "Run one command in a visible terminal the user can watch and interrupt.",
        promptGuidelines: [
          "Never open a terminal to display file contents, document/PDF/Office work, transcoding, OCR, conversions or batch jobs — run them in the background and report the stages; run ordinary reads, searches, tests, type checks and git directly instead.",
          "Before every terminal command, call terminal_list and reuse a running terminal with a matching cwd whose previous command you observed finish; only open a new tab when no safe candidate exists.",
          "A quiet terminal is not a finished command: read the output or interrupt it before assuming it completed.",
        ],
        // 同一个 PTY 里并发写两行命令会交错，所以这一类调用串行执行。
        executionMode: "sequential",
        parameters: Type.Object({
          command: Type.String({
            description: "Complete command to run. Send \"\\u0003\" (Ctrl+C) to interrupt the running command.",
          }),
          terminalId: Type.Optional(Type.String({
            description: "Reuse this terminal (from terminal_list). Interactive, long-running or busy terminals are refused.",
          })),
          cwd: Type.Optional(Type.String({
            description: "Initial directory when opening a new terminal. Ignored when terminalId is given.",
          })),
          title: Type.Optional(Type.String({ description: "Short visible tab title for a new terminal." })),
          timeoutMs: Type.Optional(Type.Number({
            description: `How long to wait for the output to settle, ${TERMINAL_EXECUTE_MIN_TIMEOUT_MS}-${TERMINAL_EXECUTE_MAX_TIMEOUT_MS}. Default ${TERMINAL_EXECUTE_DEFAULT_TIMEOUT_MS}.`,
          })),
        }),
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
          const currentSession = sessionIdOf(ctx, sessionId);
          sessionId = currentSession;
          const normalized = normalizeCommand(params.command);
          if (!normalized.ok) throw new Error(normalized.error);

          const reuse = typeof params.terminalId === "string" && params.terminalId.trim()
            ? params.terminalId.trim()
            : undefined;
          const kind = classifyTerminalCommand(normalized.command);
          const title = normalizeTitle(params.title, `Agent · ${normalized.command.slice(0, 48)}`);
          // 复用现有终端时忽略 cwd/title：那个终端已经在跑了，改 cwd 只会让人以为生效了。
          const cwd = reuse
            ? undefined
            : await resolveAgentTerminalCwd({ sessionCwd: sessionCwdOf(ctx), requested: params.cwd });

          const result = await runAgentTerminalCommand({
            sessionId: currentSession,
            command: normalized.command,
            terminalId: reuse,
            cwd,
            title,
            keepBusy: kind === "interactive" || kind === "long-running",
            signal,
            timeoutMs: params.timeoutMs,
          });

          return textResult(
            formatTerminalExecute({
              terminal: result.terminal,
              command: normalized.command,
              reused: result.reused,
              waitStatus: result.waitStatus,
              waitMs: result.waitMs,
              timeoutMs: result.timeoutMs,
              read: result.read,
              kind,
            }),
            {
              kind: "pi-web-terminal",
              action: "execute",
              sessionId: currentSession,
              terminalId: result.terminal.terminalId,
              title: result.terminal.title,
              cwd: result.terminal.cwd,
              status: result.terminal.status,
              exitCode: result.terminal.exitCode,
              reused: result.reused,
              waitStatus: result.waitStatus,
              timedOut: result.waitStatus === "timeout",
              aborted: result.waitStatus === "aborted",
              truncated: result.read.truncatedBefore || result.read.truncatedAfter,
              availableStartOffset: result.read.availableStartOffset,
              availableEndOffset: result.read.availableEndOffset,
              offset: result.read.offset,
              nextOffset: result.read.nextOffset,
            },
          );
        },
      }));

      pi.registerTool(defineTool({
        name: "terminal_read",
        label: "Terminal",
        description: [
          "Read buffered output from a terminal owned by this session.",
          "Defaults to the tail of the most recently used running terminal and the last",
          `${TERMINAL_READ_DEFAULT_CHARS} characters (limit accepts 1-${TERMINAL_READ_MAX_CHARS}).`,
          "Page forward with the returned nextOffset, or back with an earlier offset.",
          "Works after the terminal exited, until it is reclaimed. terminal_list shows which ids exist.",
          OUTPUT_LIMIT_NOTE,
        ].join(" "),
        promptSnippet: "Read buffered output of a terminal owned by this session.",
        promptGuidelines: [
          "terminal output is never pushed into your context on its own: read it when you need the result or to confirm a command finished.",
        ],
        parameters: Type.Object({
          terminalId: Type.Optional(Type.String({
            description: "Terminal id. Omit to read the most recently used running terminal of this session.",
          })),
          offset: Type.Optional(Type.Number({
            description: "Character offset in the terminal output stream. Omit to read the latest output.",
          })),
          limit: Type.Optional(Type.Number({
            description: `Maximum characters to return, 1-${TERMINAL_READ_MAX_CHARS}. Default ${TERMINAL_READ_DEFAULT_CHARS}.`,
          })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const currentSession = sessionIdOf(ctx, sessionId);
          sessionId = currentSession;
          const limit = resolveReadLimit(params.limit);
          const { terminal, read } = readAgentTerminalOutput(currentSession, params.terminalId, {
            offset: params.offset,
            limit,
          });
          return textResult(formatTerminalRead(terminal, read), {
            kind: "pi-web-terminal",
            action: "read",
            sessionId: currentSession,
            terminalId: terminal.terminalId,
            title: terminal.title,
            cwd: terminal.cwd,
            status: terminal.status,
            exitCode: terminal.exitCode,
            truncated: read.truncatedBefore || read.truncatedAfter,
            availableStartOffset: read.availableStartOffset,
            availableEndOffset: read.availableEndOffset,
            offset: read.offset,
            nextOffset: read.nextOffset,
            limit,
          });
        },
      }));

      pi.registerTool(defineTool({
        name: "terminal_list",
        label: "Terminal",
        description: [
          "List the terminals owned by THIS session with their cwd and running/exited state.",
          "It never exposes terminal output and never lists another session's terminals.",
          "Call it before every terminal command to find a safe one to reuse.",
        ].join(" "),
        promptSnippet: "List this session's visible terminals (no output) to find one to reuse.",
        promptGuidelines: [
          "Call terminal_list before opening a new terminal: reusing a running terminal with a matching cwd avoids piling up tabs in the user's workspace.",
        ],
        parameters: Type.Object({
          includeExited: Type.Optional(Type.Boolean({
            description: "Include terminals that already exited (default true).",
          })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const currentSession = sessionIdOf(ctx, sessionId);
          sessionId = currentSession;
          const includeExited = params.includeExited !== false;
          const terminals = listAgentTerminals(currentSession, { includeExited });
          return textResult(formatTerminalList(terminals), {
            kind: "pi-web-terminal",
            action: "list",
            sessionId: currentSession,
            terminals,
          });
        },
      }));
    },
  };
}
