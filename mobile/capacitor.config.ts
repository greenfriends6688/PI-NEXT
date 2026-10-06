import type { CapacitorConfig } from "@capacitor/cli";

/**
 * fork:mobile-shell —— PI NEXT 手机壳配置。
 *
 * 两种模式（docs/mobile-shell-plan-2026-10-05.md §5.1，v1 默认「写死」）：
 * - **Mode A（默认）**：打包时设 `PINEXT_SERVER_URL`（如 http://100.x.y.z:30141，
 *   Tailscale 稳定地址）。壳直接加载远程 PWA，Capacitor 桥对远程页面可用
 *   （镜像同步/通知都靠它）；地址变化要重打包。
 * - **Mode B**：不设 `PINEXT_SERVER_URL` 打包 → 壳先开 webDir/index.html 跳板页，
 *   首次输入/扫码确定地址后存 localStorage 再跳。换地址不用重打包。
 *
 * 不用 quick tunnel 的随机域名：凭证是 host-only cookie，域名一变就得重新配对（D3）。
 */
const serverUrl = process.env.PINEXT_SERVER_URL?.trim() ?? "";

const config: CapacitorConfig = {
  appId: "sh.pinext.mobile",
  appName: "PI NEXT",
  webDir: "webDir",
  server: {
    // errorPath 必须是 webDir 里的相对路径：远程页加载失败（电脑关机/断网）时的兜底。
    errorPath: "error.html",
    // Mode B 的跳板页把 WebView 导到用户运行时才确定的地址（局域网 IP / Tailscale IP /
    // 自有域名）。Capacitor 默认把「不在放行名单的外部地址」丢给系统浏览器——
    // 体现为「App 一打开就跳浏览器」。地址任意 → 放行所有主机；真正的安全边界
    // 在 LAN 令牌闸门（lib/lan-access.ts），不在壳这层。
    allowNavigation: ["*"],
    ...(serverUrl ? { url: serverUrl } : {}),
  },
  android: {
    // 目标常是 http://100.x（Tailscale 明文）：WebView 从 https://localhost 出发会被当
    // 混合内容拦掉，所以放行明文。整体安全由 LAN 令牌闸门 + WireGuard 隧道承担。
    allowMixedContent: true,
    // 调试期开（chrome://inspect 直连壳里那个 WebView）；出正式包时关。
    webContentsDebuggingEnabled: true,
  },
  ios: {
    contentInset: "never",
  },
};

export default config;
