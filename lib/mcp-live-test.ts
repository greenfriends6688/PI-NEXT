/**
 * fork:mcp-live-test —— 「测试连接」真连（上游 0.10 的 `lib/mcp-test.ts`，按本仓形态缩小）。
 *
 * 为什么要有：现在的 `action:"test"` 只做**结构校验**（`lib/mcp-validator.ts` 转发 pi 的
 * `validateMcpServerConfig`），不建连接。所以「配好了但服务起不来」在面板上看起来和
 * 「配置有效」一模一样 —— 用户只能等会话里报 `MCP failed to load`。
 *
 * ## 边界（这一段是本仓与上游最大的不同，必须先读）
 *
 * 上游**无条件真连**。本仓不行：MCP 的 stdio server 就是「在 Web 服务进程里 spawn 一条
 * 用户自己写的命令」，而本仓的 Web 服务可能被部署到远程机器上（`docs` 里的远程部署
 * 一节、`lib/lan-access.ts` 的局域网配对都指向这个形态）。在那台机器上，一个来自浏览器
 * 的「测试连接」等于替远程用户执行命令。
 *
 * 所以：**默认仍然只做结构校验**；只有运维显式打开（`PI_WEB_ALLOW_MCP_TEST=1`，桌面
 * 打包版默认打开）才真连。见 `mcpLiveTestAllowed()`。
 *
 * ## 上游那些「有界」的做法，这里都保留
 *
 *   · 每个请求（`initialize` / `tools/list` …）用 `min(条目 timeout, 15s)`，不是 SDK 默认的 60s；
 *   · 整个测试有 20s 死线，到点直接关 transport（`connection.close()` 只是置标志，
 *     会把 stdio 子进程留到它自己超时）；
 *   · 关闭最多等 2s：stdio 的 close 等子进程，进程组外的孙进程能一直吊着它；
 *   · `!command` 是同步执行（`execSync`，会阻塞事件循环，定时器都停），所以含 `!command`
 *     的条目**串行**跑（`globalThis` 队列），一串连点也不会堆起来；
 *   · 同一个条目在测试中重复点 → 并到同一次；
 *   · 结果里的 url / 命令 / stderr 全部先掩码（`lib/mcp-secrets`）再截断。
 */
import { execSync } from "node:child_process";
import type {
  McpExposure,
  McpOAuthCredentialStore,
  McpServerConfig,
  McpServerEntry,
  McpServerConnection,
  McpTool,
  McpTransport,
  PiSdkInternals,
} from "./pi-sdk-internals";
import { createPiNextMcpTransportFactory } from "./mcp-transport";
import {
  createTestRedactor,
  maskStatusError,
  maskStatusStderr,
  runsShellCommand,
} from "./mcp-test-redact";

/** 每个请求的超时上限；SDK 默认 60s，面板里等太久。 */
export const MCP_TEST_REQUEST_TIMEOUT_MS = 15_000;
/** 整个测试（连接 → 结果）的死线。 */
export const MCP_TEST_DEADLINE_MS = 20_000;
/** 答案等服务器关闭的最长时间，超了就撒手交给后台。 */
export const MCP_TEST_CLOSE_WAIT_MS = 2_000;
/** 结果里列出的工具数上限（`toolCount` 仍按全部计）。 */
export const MCP_TEST_MAX_TOOLS = 500;
/** `!command` 同步执行的上限，与上游一致。 */
const COMMAND_VALUE_TIMEOUT_MS = 10_000;

const SERIAL_KEY: symbol = Symbol.for("pi-web.mcp-test-serial");
const FLIGHT_KEY: symbol = Symbol.for("pi-web.mcp-test-flights");

export type McpTestState = "connected" | "needs-auth" | "failed" | "timedOut";

export interface McpTestTool {
  name: string;
  description: string;
  /** 服务器自己标的是只读（`annotations.readOnlyHint`）。 */
  readOnly: boolean;
  /** 这个工具的曝光档，与服务器档不同才值得报（`toolExposure`）。 */
  exposure?: McpExposure;
}

export interface McpTestResult {
  state: McpTestState;
  toolCount: number;
  tools: McpTestTool[];
  /** 服务器在 `initialize` 里报的说明。 */
  serverInfo?: string;
  resourceCount?: number;
  resourceTemplateCount?: number;
  /** stdio server 实际跑在哪个目录。 */
  cwd?: string;
  /** 在测试队列里等了多久（`!command` 串行时非零）。 */
  queuedMs?: number;
  durationMs: number;
  /** 已掩码的错误 / stderr 尾部。 */
  error?: string;
  stderr?: string;
  /** 这一档只在本机/桌面形态下可能出现（本仓与上游的差异）。 */
  liveOnly?: boolean;
}

/**
 * 是否允许真连。默认否 —— 见文件头的「边界」。
 *
 * `PI_WEB_ALLOW_MCP_TEST` 取 `1` / `true` / `yes` 为真；取 `0` / `false` / 空为假；
 * 其它值当作假并打一行警告（宁可关掉，别猜）。桌面打包版由 `electron/` 注入 `=1`。
 */
export function mcpLiveTestAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.PI_WEB_ALLOW_MCP_TEST ?? "").trim().toLowerCase();
  if (raw === "") return false;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false") return false;
  console.warn(`[mcp] PI_WEB_ALLOW_MCP_TEST="${raw}" 不是 1/true/yes/0/false，按「不允许真连」处理`);
  return false;
}

/** 队列（`!command` 串行用）与在飞合并表，都挂在 globalThis：路由各自打包、热重载会重跑模块。 */
function serialQueue(): Promise<unknown> {
  const store = globalThis as Record<symbol, Promise<unknown> | undefined>;
  return (store[SERIAL_KEY] ??= Promise.resolve());
}

function flights(): Map<string, Promise<McpTestResult>> {
  const store = globalThis as Record<symbol, Map<string, Promise<McpTestResult>> | undefined>;
  return (store[FLIGHT_KEY] ??= new Map());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 同步执行 `!command` 取值（上游同款：只能串行，因为 execSync 阻塞事件循环）。 */
function runShellCommand(command: string): string {
  return execSync(command, { timeout: COMMAND_VALUE_TIMEOUT_MS, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** 这个条目里有没有会被同步执行的 `!command` 值（上游 `runsShellCommand`）。 */
function hasCommandValue(config: McpServerConfig, internals: Pick<PiSdkInternals, "isCommandConfigValue">): boolean {
  return runsShellCommand(config, internals);
}

/** 这个工具的曝光档（`toolExposure` 可按工具覆盖），与服务器档不同时才报。 */
function toolExposure(
  config: McpServerConfig,
  name: string,
  internals: Pick<PiSdkInternals, "getMcpToolExposure">,
): McpExposure | undefined {
  // `Object.create(null)`：SDK 用普通下标查表，叫 `constructor` / `toString` 的工具
  // 会从 `Object.prototype` 上捡到函数（上游同一个坑）。
  const overrides = Object.assign(Object.create(null), config.toolExposure) as Record<string, McpExposure>;
  const value = internals.getMcpToolExposure({ ...config, toolExposure: overrides } as McpServerConfig, name);
  return typeof value === "string" ? (value as McpExposure) : undefined;
}

function describeTool(tool: McpTool, exposure: McpExposure | undefined): McpTestTool {
  const annotations = isRecord(tool.annotations) ? tool.annotations : {};
  return {
    name: tool.name,
    description: typeof tool.description === "string" ? tool.description : "",
    readOnly: annotations.readOnlyHint === true,
    ...(exposure ? { exposure } : {}),
  };
}

/** 一次测试的稳定键：同一个条目的重复点击并到同一次。 */
function flightKey(entry: McpServerEntry, cwd: string): string {
  return `${entry.source}\0${entry.name}\0${cwd}\0${JSON.stringify(entry.config)}`;
}

export interface McpLiveTestOptions {
  internals: PiSdkInternals;
  /** `McpOAuthCredentialStore` 的构造器（pi 内部件，已由本仓加载）。 */
  credentials: new () => McpOAuthCredentialStore;
  cwd: string;
  /** 测试时的目录（默认条目所在的工作区）。 */
  testCwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * 真连一次：连上、列出工具、报状态与工具清单，然后关掉。
 *
 * 复用**会话用的那套 transport**（`createPiNextMcpTransportFactory`：清洗后的环境、
 * `inheritEnv:false`、拒绝引用 `PI_WEB_PASSWORD`、绝不回退 SDK 默认 transport），所以
 * 「测出来能连」与「会话里能用」是同一口径。
 */
export async function testMcpServerLive(
  entry: McpServerEntry,
  options: McpLiveTestOptions,
): Promise<McpTestResult> {
  const startedAt = Date.now();
  const cwd = options.testCwd ?? options.cwd;
  const { internals } = options;
  // 上游同款：按条目 timeout 收紧**每个请求**，不吃 SDK 默认的 60s。
  // `McpServerConnection.timeoutMs` 是 readonly，所以收紧靠传进条目的 config 副本。
  const requestTimeoutMs = Math.min(
    typeof entry.config.timeout === "number" && entry.config.timeout > 0 ? entry.config.timeout * 1000 : 60_000,
    MCP_TEST_REQUEST_TIMEOUT_MS,
  );
  const scoped: McpServerEntry = {
    ...entry,
    config: { ...entry.config, timeout: requestTimeoutMs / 1000 } as McpServerConfig,
  };

  let connection: McpServerConnection | undefined;
  const transports = new Set<unknown>();
  let redact: (text: string) => string = (text) => text;
  try {
    redact = createTestRedactor(scoped.config, [...transports] as McpTransport[], internals);
    const credentials = new options.credentials();
    connection = new internals.McpServerConnection({
      entry: scoped,
      cwd,
      // 会话用的那套 transport（清洗后的环境、`inheritEnv:false`、拒绝 PI_WEB_PASSWORD、
      // 绝不回退 SDK 默认实现），所以「测得出能连」与「会话里能用」同口径。
      createTransport: (target, transportCwd, authProvider) => {
        const transport = createPiNextMcpTransportFactory(internals, {
          baseEnvironment: options.env ?? process.env,
        })(target, transportCwd, authProvider);
        transports.add(transport);
        return transport;
      },
      credentials,
      onTools: () => {},
      onChange: () => {},
    });
    // 构造即开始连接；`getClient()` 在连不上时抛，连上时返回已握手的 client，
    // 连接类自己会在这之后刷新 tools / resources 列表。
    await connection.getClient();

    const tools = connection.tools ?? [];
    const result: McpTestResult = {
      state: connection.state === "connected" ? "connected" : connection.challenge ? "needs-auth" : "failed",
      toolCount: tools.length,
      tools: tools.slice(0, MCP_TEST_MAX_TOOLS).map((tool) => describeTool(tool, toolExposure(scoped.config, tool.name, internals))),
      durationMs: Date.now() - startedAt,
      liveOnly: true,
      ...(typeof connection.instructions === "string" && connection.instructions ? { serverInfo: connection.instructions } : {}),
      ...(Array.isArray(connection.resources) ? { resourceCount: connection.resources.length } : {}),
      ...(Array.isArray(connection.resourceTemplates) ? { resourceTemplateCount: connection.resourceTemplates.length } : {}),
      ...("command" in entry.config ? { cwd } : {}),
      ...(connection.error ? { error: maskStatusError(connection.error, redact) } : {}),
      // stderr 尾巴是「为什么起不来」的第一手材料（上面那条 example 就靠它），但它是
      // 服务器原样写的：先掩码、再截尾（上游同款）。
      ...(connection.stderrTail ? { stderr: maskStatusStderr(connection.stderrTail, redact) } : {}),
    };
    return result;
  } catch (error) {
    return {
      state: "failed",
      toolCount: 0,
      tools: [],
      durationMs: Date.now() - startedAt,
      liveOnly: true,
      error: maskStatusError(error instanceof Error ? error.message : String(error), redact),
    };
  } finally {
    await closeTestConnection(connection, transports);
  }
}

/**
 * 收尾。到死线或调用方都撒手时**直接关 transport**（让挂着的握手立刻失败），
 * `connection.close()` 只置标志，stdio 子进程会留到它自己超时。关闭本身最多等 2s ——
 * stdio 的 close 等子进程，进程组外的孙进程能一直吊着它；超时就撒手。
 */
async function closeTestConnection(
  connection: McpServerConnection | undefined,
  transports: Set<unknown>,
): Promise<void> {
  const closeAll = async () => {
    for (const transport of transports) {
      try {
        await (transport as { close?: () => Promise<void> | void }).close?.();
      } catch {
        /* 已经关了 */
      }
    }
  };
  if (!connection) {
    await closeAll();
    return;
  }
  try {
    await connection.close();
  } catch {
    /* 同上 */
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, MCP_TEST_CLOSE_WAIT_MS);
    timer.unref?.();
  });
  await Promise.race([closeAll(), waited]);
  if (timer) clearTimeout(timer);
}

/**
 * 面板入口：同一个条目重复点并到同一次；含 `!command` 的条目串行；整体有死线。
 */
export async function testMcpServer(entry: McpServerEntry, options: McpLiveTestOptions): Promise<McpTestResult> {
  const key = flightKey(entry, options.testCwd ?? options.cwd);
  const running = flights();
  const existing = running.get(key);
  if (existing) return existing;

  const serial = hasCommandValue(entry.config, options.internals);
  const task = (async () => {
    const queuedAt = Date.now();
    let waited = 0;
    if (serial) {
      const turn = Date.now();
      const previous = serialQueue();
      const gate = previous.catch(() => {});
      // 上游同款：等前一个跑完；等太久就放弃排队（结果说明原因，不写状态）。
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        gate,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), MCP_TEST_DEADLINE_MS);
          timer.unref?.();
        }),
      ]);
      if (timer) clearTimeout(timer);
      waited = Date.now() - turn;
      if (Date.now() - turn >= MCP_TEST_DEADLINE_MS && waited > 0) {
        return {
          state: "failed" as const,
          toolCount: 0,
          tools: [],
          durationMs: Date.now() - queuedAt,
          queuedMs: waited,
          error: "Another test holding the !command slot was still running; this one was dropped",
          liveOnly: true,
        };
      }
    }
    const result = await withDeadline(
      testMcpServerLive(entry, options),
      MCP_TEST_DEADLINE_MS,
    );
    return waited > 0 ? { ...result, queuedMs: waited } : result;
  })().finally(() => running.delete(key));

  running.set(key, task);
  return task;
}

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`MCP test timed out after ${Math.round(ms / 1000)}s`)), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 面板的「测试」动作：不在允许形态下就退回结构校验（行为与今天一致）。 */
export async function testMcpServerWithinPolicy(
  entry: McpServerEntry,
  options: Omit<McpLiveTestOptions, "internals"> & { internals: PiSdkInternals | null },
): Promise<McpTestResult> {
  if (!mcpLiveTestAllowed(options.env ?? process.env) || !options.internals) {
    return {
      state: "failed",
      toolCount: 0,
      tools: [],
      durationMs: 0,
      error: `Live connection tests are off on this deployment. Set PI_WEB_ALLOW_MCP_TEST=1 to allow them `
        + `(they run the server's own command in the web server's process).`,
    };
  }
  return testMcpServer(entry, { ...options, internals: options.internals });
}

