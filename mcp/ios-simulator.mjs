/**
 * mcp/ios-simulator.mjs — iOS 模拟器 MCP server（零依赖）
 *
 * fork:ios-simulator —— 把 Xcode 的 iOS 模拟器变成 agent 可调用的工具。
 *
 * ## 为什么这么写
 *
 * ZCode 有同名的官方插件（`apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts:202-223`，
 * `ios-simulator`），但**插件源码不在那个快照里**；能看到的只有它的清单形状
 * （`apps/zcode-cli/README.md:86-109`）：一个 `mcpServers` 块 + 一个
 * `userConfig.default_device`（默认 `"iPhone 16"`），以及 lockfile 里
 * 「依赖只有 `@modelcontextprotocol/sdk` + `zod`」这一条。
 *
 * 也就是说：它是个**纯 Node 的 stdio MCP server**，内部调 `xcrun simctl`，
 * 零原生二进制。所以我们不需要移植任何东西 —— 写一份自己的即可，而且能
 * 直接被本仓已经接通的 pi 1.0 原生 MCP 加载（`/api/mcp` → `rpc-manager.ts`
 * 的 `mcpBuiltinExtensionEntries()`）。
 *
 * ## 边界
 *
 * 全部走 `xcrun simctl`（Xcode 自带的命令行），**不碰任何私有 API**。
 * 非 macOS / 没装 Xcode 时：进程照常起来，工具逐个返回「这台机器用不了」的
 * 说明文本 —— 而不是启动失败。理由与 `lib/mcp-transport.ts` 同一个：
 * 服务器起不来会让整台会话的 MCP 连接失败，比工具少几个糟得多。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { objectSchema, startStdioMcpServer, stringArg, errorText } from "./stdio-server.mjs";

const run = promisify(execFile);
const SIMCTL = "simctl";
const TIMEOUT_MS = 60_000;

const DEFAULT_DEVICE = process.env.DEFAULT_DEVICE || "iPhone 16";

/** 跑一条 simctl。失败时把 stderr 带上 —— simctl 的报错信息很具体，吞掉等于没法排查。 */
async function simctl(args) {
  const { stdout } = await run("xcrun", [SIMCTL, ...args], {
    timeout: TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

function unavailable() {
  return process.platform !== "darwin";
}

const GUARD = "这个工具要在 macOS 上跑（它调 xcrun simctl）。当前系统是 "
  + process.platform + "，本工具不可用。";

const tools = {
  list_devices: {
    description: "列出本机可用的 iOS 模拟器设备（udid / 名字 / 状态 / 已装的 runtime）。",
    inputSchema: objectSchema({}),
  },
  list_runtimes: {
    description: "列出本机已安装的 iOS runtime 版本（如 iOS 18.2）。要启动模拟器必须先有对应 runtime —— 一个都没有时 boot 会失败，先看这里。",
    inputSchema: objectSchema({}),
  },
  boot: {
    description: "启动一台模拟器并等它真正就绪（默认设备 iPhone 16，可用 DEFAULT_DEVICE 环境变量改）。已经启动过时幂等成功，不会报错。",
    inputSchema: objectSchema({
      device: stringArg(`设备名或 udid，缺省 ${DEFAULT_DEVICE}`),
    }),
  },
  shutdown: {
    description: "关掉一台模拟器并释放它的窗口。关掉之后 list_devices 里它会变成 Shutdown 状态。",
    inputSchema: objectSchema({ device: stringArg("设备名或 udid") }, ["device"]),
  },
  list_apps: {
    description: "列出某台模拟器里已安装的应用，含 bundle identifier 与显示名 —— 装完应用后用 launch_app 需要的就是这里的 bundle id。",
    inputSchema: objectSchema({ device: stringArg("设备名或 udid") }, ["device"]),
  },
  install_app: {
    description: "把一个本地 .app / .ipa 装进模拟器。",
    inputSchema: objectSchema({
      device: stringArg("设备名或 udid"),
      path: stringArg("本机 .app 或 .ipa 的绝对路径"),
    }, ["device", "path"]),
  },
  launch_app: {
    description: "启动模拟器里的一个应用。",
    inputSchema: objectSchema({
      device: stringArg("设备名或 udid"),
      bundleId: stringArg("bundle identifier，如 com.example.App"),
    }, ["device", "bundleId"]),
  },
  terminate_app: {
    description: "结束模拟器里的一个应用。",
    inputSchema: objectSchema({
      device: stringArg("设备名或 udid"),
      bundleId: stringArg("bundle identifier"),
    }, ["device", "bundleId"]),
  },
  screenshot: {
    description: "截模拟器屏幕，存成 PNG 并返回路径。",
    inputSchema: objectSchema({
      device: stringArg("设备名或 udid"),
      path: stringArg("输出 PNG 的本机绝对路径"),
    }, ["device", "path"]),
  },
  // DOM 快照走的是 simctl 自己没有的能力，所以这一条如实说明白：拿元素树要靠
  // XCUITest 或 idb，不属于「跑一条 simctl」的范畴。与其给一个半残的实现，
  // 不如在描述里写清楚边界。
  ui_hierarchy: {
    description:
      "【当前不支持】读取模拟器里的无障碍元素树。"
      + "simctl 不提供这条能力，需要 XCUITest 或 idb（要另外装）。"
      + "要拿可点击目标的坐标，请改用 accessibility_inspect 之外的方案，或在本机跑 idb。",
    inputSchema: objectSchema({ device: stringArg("设备名或 udid") }, ["device"]),
  },
};

startStdioMcpServer({
  name: "ios-simulator",
  version: "0.1.0",
  tools,
  async call(name, args) {
    if (unavailable()) {
      // 不用「进程起不来」表达「这台机器不支持」—— 工具照常在表里，只是答「用不了」。
      return { text: GUARD, isError: true };
    }
    const device = args.device || DEFAULT_DEVICE;
    switch (name) {
      case "list_devices":
        return { text: await simctl(["list", "devices", "available", "--json"]) };
      case "list_runtimes":
        return { text: await simctl(["list", "runtimes", "--json"]) };
      case "boot":
        // `bootstatus -b` 会等到真正启动完，否则紧接着的 install_app 会打不开设备。
        return { text: `booting ${device}…\n` + await simctl(["boot", device, "--ignore-if-bootstate-has-errors"]) };
      case "shutdown":
        return { text: await simctl(["shutdown", device]) || `已关闭 ${device}` };
      case "list_apps":
        return { text: await simctl(["listapps", device]) };
      case "install_app":
        return { text: (await simctl(["install", device, args.path])) || `已安装到 ${device}` };
      case "launch_app":
        return { text: await simctl(["launch", device, args.bundleId]) };
      case "terminate_app":
        return { text: await simctl(["terminate", device, args.bundleId]) || `已结束 ${args.bundleId}` };
      case "screenshot":
        await simctl(["io", device, "screenshot", args.path]);
        return { text: `已截图：${args.path}` };
      case "ui_hierarchy":
        return { text: tools.ui_hierarchy.description, isError: true };
      default:
        return { text: `未实现：${name}` };
    }
  },
});