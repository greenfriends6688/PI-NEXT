/**
 * mcp/stdio-server.mjs — 共享的 MCP stdio 骨架（零依赖）
 *
 * MCP over stdio 就是 **newline-delimited JSON-RPC 2.0**：请求与响应各占一行，
 * 跑在子进程的标准输入输出上。没有握手、没有分帧协议、没有 SDK 必需 ——
 * 所以这里手写而不是引入 `@modelcontextprotocol/sdk`（一个只为 7 个工具引入的
 * 依赖，是本仓 `ponytail` 规矩里明令要避免的）。
 *
 * 两个模拟器插件（ios-simulator / android-emulator）共用这一份，只把工具表换掉。
 *
 * 输出的**唯一**通道是 stdout：任何日志都必须走 stderr，否则会把 JSON-RPC
 * 流污染掉，症状是「客户端连上了但一个工具都调不通」。
 */

import { createInterface } from "node:readline";

export const JSONRPC_VERSION = "2.0";

/**
 * 起一个 stdio MCP server。
 *
 * @param {object} options
 * @param {string} options.name
 * @param {string} options.version
 * @param {Record<string, {title?: string, description: string, inputSchema: object}>} options.tools
 * @param {(name: string, args: object, ctx: {signal?: AbortSignal}) => Promise<{text: string, isError?: boolean}>} options.call
 */
export function startStdioMcpServer({ name, version, tools, call }) {
  // 握手失败不要打 stdout（下面这行是唯一的 stdout 出口）。
  process.stderr.write(`[${name}] ready · ${Object.keys(tools).length} tools\n`);

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

  /**
   * 在途请求计数。
   *
   * `rl` 的 `close` 会在 stdin 关闭时立刻触发，而每条 `line` 的处理是 **async**
   * 的 —— 早退就会把已经在跑的 `xcrun` / `adb` 结果连同它的应答一起丢掉。
   * 症状是「客户端偶发地收不到某个工具的答复」，且只在最后一条请求上出现，
   * 极难复现。所以这里数着在途数，等它们排干再退。
   */
  let inFlight = 0;

  rl.on("line", async (line) => {
    inFlight += 1;
    try {
      await handle(line);
    } finally {
      inFlight -= 1;
    }
  });

  async function handle(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      // 协议错误：回 -32700，但**不带 id**（无法知道回给谁）。
      send({ jsonrpc: JSONRPC_VERSION, id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }

    const { id, method, params } = request ?? {};
    // 通知（无 id）不回响应 —— 这是 JSON-RPC 的硬约定。
    const isNotification = id === undefined || id === null;

    try {
      if (method === "initialize") {
        respond(id, {
          protocolVersion: params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name, version },
        });
        return;
      }
      if (method === "notifications/initialized" || method === "initialized") return;
      if (method === "ping") {
        respond(id, {});
        return;
      }
      if (method === "tools/list") {
        respond(id, {
          tools: Object.entries(tools).map(([toolName, tool]) => ({
            name: toolName,
            ...(tool.title ? { title: tool.title } : {}),
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });
        return;
      }
      if (method === "tools/call") {
        const toolName = params?.name;
        const handler = tools[toolName];
        if (!handler) {
          // 协议层的「未知工具」不是崩溃：用 isError 把话术回给模型。
          respond(id, { content: [{ type: "text", text: `未知工具：${toolName}` }], isError: true });
          return;
        }
        const args = params?.arguments ?? {};
        const result = await call(toolName, args);
        respond(id, {
          content: [{ type: "text", text: result.text }],
          ...(result.isError ? { isError: true } : {}),
        });
        return;
      }
      if (!isNotification) {
        send({ jsonrpc: JSONRPC_VERSION, id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
    } catch (error) {
      // 工具内部抛错也**不**回 JSON-RPC error：那样客户端会把整轮对话判失败。
      // 回成 isError 的文本，模型还能看到发生了什么。
      if (!isNotification) {
        respond(id, {
          content: [{ type: "text", text: `${name} 执行 ${method} 失败：${errorText(error)}` }],
          isError: true,
        });
      }
    }
  }

  // stdin 关了：等在途请求排干再退，别把应答吞掉。
  rl.on("close", () => {
    if (inFlight <= 0) {
      process.exit(0);
      return;
    }
    const drain = setInterval(() => {
      if (inFlight > 0) return;
      clearInterval(drain);
      process.exit(0);
    }, 20);
  });

  // 意外崩溃要走 stderr（stdout 是协议流，写进去就等于把流污染了）。
  process.on("uncaughtException", (error) => {
    process.stderr.write(`[${name}] uncaught: ${errorText(error)}\n`);
    process.exit(1);
  });

  return rl;

  function respond(id, result) {
    if (id === undefined || id === null) return;
    send({ jsonrpc: JSONRPC_VERSION, id, result });
  }
}

export function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 一个必填字符串参数的 JSON Schema 片段。三个模拟器插件的工具表全由它拼出来 ——
 * 模板化，免得十几份 `{type:"object",…}` 手抄到某一份漏一个字段。
 */
export function stringArg(description, extra = {}) {
  return { type: "string", description, ...extra };
}

export function objectSchema(properties, required = []) {
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}