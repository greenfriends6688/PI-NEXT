/**
 * mcp/android-emulator.mjs — Android 模拟器 / 实机 MCP server（零依赖）
 *
 * fork:android-emulator —— 对齐 ZCode 的官方 `android-emulator` 插件
 * （`official-plugin-definitions.ts:106-126`，同样是默认关闭的 MCP 插件，
 * 依赖只有 `@modelcontextprotocol/sdk` + `zod` ⇒ 纯 Node + `adb`）。
 *
 * 与 iOS 那份同构，只把 `xcrun simctl` 换成 `adb`。**跨平台**：Windows /
 * Linux 上 `adb` 一样能用，所以这里不做 macOS 那种「本工具不可用」的整段拒绝，
 * 而是逐条命令失败时把 `adb` 的原话回给模型（它会写「adb: no devices/emulators」，
 * 比我们转述有用）。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { objectSchema, startStdioMcpServer, stringArg, errorText } from "./stdio-server.mjs";

const run = promisify(execFile);
const ADB = process.env.ADB_PATH || "adb";
const TIMEOUT_MS = 60_000;

const DEFAULT_DEVICE = process.env.DEFAULT_DEVICE || "emulator-5554";

async function adb(args, serial) {
  const full = serial ? ["-s", serial, ...args] : args;
  const { stdout } = await run(ADB, full, { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

const tools = {
  list_devices: {
    description: "列出已连接的 Android 设备与模拟器（serial / 型号 / 状态）。",
    inputSchema: objectSchema({}),
  },
  list_avds: {
    description: "列出本机已定义的 AVD 名字（Android Studio 里的虚拟设备配置）。boot_avd 要用这个名字，且需要 emulator 二进制在 PATH 上。",
    inputSchema: objectSchema({}),
  },
  boot_avd: {
    description: "启动一个 AVD。需要 emulator 二进制在 PATH 上（ANDROID_HOME/emulator/emulator）。",
    inputSchema: objectSchema({ avd: stringArg("AVD 名字") }, ["avd"]),
  },
  shell: {
    description:
      "在设备上跑一条 adb shell 命令。返回 stdout。"
      + "这是点按 / 输入 / 启动 activity 的通用出口"
      + "（如 shell: input tap 100 200、input text hello、am start -n pkg/.Main）。",
    inputSchema: objectSchema({
      device: stringArg(`设备 serial，缺省 ${DEFAULT_DEVICE}`),
      command: stringArg("要在 shell 里跑的命令（不含 adb shell 前缀）"),
    }, ["command"]),
  },
  install_app: {
    description: "安装一个本地 .apk。",
    inputSchema: objectSchema({
      device: stringArg("设备 serial"),
      path: stringArg("本机 .apk 的绝对路径"),
    }, ["path"]),
  },
  uninstall_app: {
    description: "从设备上卸载一个应用（application id），并清掉它的数据目录。",
    inputSchema: objectSchema({
      device: stringArg("设备 serial"),
      package: stringArg("application id，如 com.example.App"),
    }, ["package"]),
  },
  launch_app: {
    description: "启动一个 Activity（等价于 shell: am start -n <package>/<activity>）。",
    inputSchema: objectSchema({
      device: stringArg("设备 serial"),
      package: stringArg("application id"),
      activity: stringArg("Activity 类名；缺省用 .MainActivity"),
    }, ["package"]),
  },
  current_activity: {
    description: "读当前前台 Activity 与包名（调试「点开了没有」用）。",
    inputSchema: objectSchema({ device: stringArg("设备 serial") }),
  },
  screenshot: {
    description: "截屏，存成 PNG 并返回路径。",
    inputSchema: objectSchema({
      device: stringArg("设备 serial"),
      path: stringArg("输出 PNG 的本机绝对路径"),
    }, ["path"]),
  },
  logcat_clear: {
    description: "清空设备上的 logcat 缓冲。抓崩溃日志前先调它，否则 logcat_dump 会把上一次的日志一起吐回来，混在里面分不清哪条是这次产生的。",
    inputSchema: objectSchema({ device: stringArg("设备 serial") }),
  },
  logcat_dump: {
    description: "导出当前 logcat。**始终带 -d**：不带的话 adb 会一直挂着等新日志。",
    inputSchema: objectSchema({
      device: stringArg("设备 serial"),
      lines: stringArg("只取最后 N 行（默认 300）"),
    }),
  },
};

startStdioMcpServer({
  name: "android-emulator",
  version: "0.1.0",
  tools,
  async call(name, args) {
    const device = args.device || DEFAULT_DEVICE;
    switch (name) {
      case "list_devices":
        return { text: await adb(["devices", "-l"]) };
      case "list_avds":
        return { text: await run("emulator", ["-list-avds"]).then((r) => r.stdout.trim()) };
      case "boot_avd":
        // 后台起：emulator 是不返回的，不 detach 会把这个 MCP 连接挂死。
        run("emulator", [`-avd`, args.avd, "-no-boot-anim"]).unref?.();
        return { text: `已在后台启动 AVD ${args.avd}。稍等几秒再用 list_devices 确认它已上线。` };
      case "shell":
        return { text: await adb(["shell", args.command], device) || "(无输出)" };
      case "install_app":
        return { text: (await adb(["install", "-r", args.path], device)) || `已安装到 ${device}` };
      case "uninstall_app":
        return { text: (await adb(["uninstall", args.package], device)) || `已卸载 ${args.package}` };
      case "launch_app": {
        const activity = args.activity || ".MainActivity";
        return { text: await adb(["shell", "am", "start", "-n", `${args.package}/${activity}`], device) };
      }
      case "current_activity": {
        // 单引号 + grep 的组合在 shell 里转义很脆，所以分两步：先 dumpsys 再自己筛。
        const dump = await adb(["shell", "dumpsys", "activity", "activities"], device);
        const focused = dump.split("\n").filter((l) => /mResumedActivity|mFocusedActivity|topResumedActivity/.test(l));
        return { text: focused.join("\n") || "(没找到前台 Activity)" };
      }
      case "screenshot": {
        // exec-out 走 stdout，不受 CRLF 转换影响 —— 比 `adb shell screencap >` 干净。
        const { stdout } = await run(ADB, ["-s", device, "exec-out", "screencap", "-p"], {
          timeout: TIMEOUT_MS,
          maxBuffer: 64 * 1024 * 1024,
          encoding: "buffer",
        });
        const { writeFileSync, mkdirSync } = await import("node:fs");
        const { dirname } = await import("node:path");
        mkdirSync(dirname(args.path), { recursive: true });
        writeFileSync(args.path, stdout);
        return { text: `已截图：${args.path}` };
      }
      case "logcat_clear":
        return { text: await adb(["logcat", "-c"], device) || "已清空 logcat" };
      case "logcat_dump": {
        const lines = String(args.lines || 300);
        return { text: await adb(["logcat", "-d", "-t", lines], device) };
      }
      default:
        return { text: `未实现：${name}` };
    }
  },
});