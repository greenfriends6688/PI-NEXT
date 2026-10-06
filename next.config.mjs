// JavaScript, not TypeScript, on purpose: `next start` compiles this file with SWC
// when it is TypeScript, which forces `@next/swc-*` into the runtime package (~40 MB
// per platform, and the other platform's binary is never installed, so an Intel or
// Windows build would try to download it at startup). Keep this file .mjs.
import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import { resolveMaxBodySize } from "./bin/max-body-size.mjs";

const configDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8"));
let piVersion = "unknown";
try {
  const piPkgPath = join(configDir, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = JSON.parse(readFileSync(piPkgPath, "utf8")).version;
} catch { /* package not found, use default */ }

// fork:sw-cache-version —— `public/sw.js` 把 `CACHE_VERSION` 取自自身 URL 的 `?v=`，
// 而 `PwaRegistration` 传的是 `NEXT_PUBLIC_APP_VERSION`。**这里传的是 package.json
// 的版本号**（0.1.9-beta.1 那一串），它只在发版时才变 —— 于是一次开发构建里的
// 几十次改动，SW 看到的版本号全是同一个：static / shell 两个 cache 永不轮换，
// 已经装到主屏的 PWA 继续吃旧 chunk，继续看着旧界面（2026-10-06 用户反馈
// 「改的没效果」）。改成 **包版本 + 源码指纹**：
//   · 有 git 就用 `短 sha` + 工作区脏标记（脏也进指纹，所以未提交��改动同样生效）；
//   · 打包产物里没有 .git（electron-builder 只跟踪文件），回落到包版本 —— 那时
//     版本号本来就是唯一的；
//   · 两者都拿不到就退 "dev"，即保持旧行为。
// 这样“重新构建一次 = 客户端缓存必然轮换一次”。
let sourceStamp = "";
try {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: configDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: configDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (sha) sourceStamp = `${sha}${dirty ? "-dirty" : ""}`;
} catch { /* not a git checkout (packaged build) — package version alone */ }

/* fork:sw-cache-version —— 指纹必须**每次构建都不同**。
 * 第一版写成 `版本 + git短sha + [-dirty]`，看着对，实际是个死值：只要 HEAD 没动、
 * 工作区一直是脏的，几十次构建算出来是同一个串 → SW 的 `?v=` 不变 → static / shell
 * 两个缓存桶永不轮换 → 手机上永远吃旧 chunk（用户 2026-10-06 实测「改了没生效」，
 * 而服务端产物早就是新的）。
 * 所以再叠一个**构建时刻**：每次 `next build` 必然不同。它只用作 SW 的缓存键，
 * 不参与任何展示（底栏那个版本号印的是包版本，`+` 之后一律切掉）。 */
const buildStamp = Date.now().toString(36);
const appVersion = `${version}+${sourceStamp || "nogit"}.${buildStamp}`;

/* fork:isolated-dist-dir —— 默认仍是 `.next`（整仓只此一份）。但本机常有另一个
   进程在同一个 checkout 上跑构建（IDE / 另一个会话 / `npm run prod` 的监督器），
   两份构建抢同一个 `.next` 的结果是：构建期把对方的产物删掉、`next start` 起来后
   所有 `/_next/static/**` 返 500、页面空白 —— 这正是 2026-10-06 反复出现的
   “改的没效果”里最难查的一种（服务端明明是新构建）。
   给一个出口：`NEXT_DIST_DIR=.next-verify next build` 就能把验证那份产物放到别处，
   两边不再互相删。默认行为一个字节都不变。 */
const distDir = process.env.NEXT_DIST_DIR || ".next";

// mdast-util-gfm-autolink-literal (remark-gfm) ships a RegExp lookbehind that
// Safari parses only from 16.4, which blanked `/` on iOS 16.2 (#753). The loader
// swaps it for an equivalent built at runtime; both bundlers must run it.
const gfmAutolinkEmailLoader = join(configDir, "lib/gfm-autolink-email-loader.cjs");

/** @type {import("next").NextConfig} */
const nextConfig = {
  distDir,
  outputFileTracingRoot: configDir,
  // `next dev` runs Turbopack (see AGENTS.md: never `next dev --webpack` here)
  // and `npm run build` runs webpack, so the loader is registered for both.
  // Next 16 exits `next dev` when a `webpack` hook has no `turbopack` config.
  turbopack: {
    rules: {
      "**/mdast-util-gfm-autolink-literal/lib/index.js": { loaders: [gfmAutolinkEmailLoader] },
    },
  },
  webpack(config) {
    config.module.rules.push({
      test: /[\\/]mdast-util-gfm-autolink-literal[\\/]lib[\\/]index\.js$/,
      loader: gfmAutolinkEmailLoader,
    });
    return config;
  },
  // Node modules keep the syntax they ship unless listed here, and mermaid's
  // lazy diagram chunks are full of class `static {}` blocks (#753).
  transpilePackages: ["mermaid", "@mermaid-js/parser"],
  experimental: {
    // Next buffers the request body whenever a middleware/proxy is present and
    // caps that buffer at 10 MB by default. The upload route accepts up to
    // 100 MB, so raise the buffer above that. Override with PI_WEB_MAX_BODY_SIZE.
    proxyClientMaxBodySize: resolveMaxBodySize(),
  },
  serverExternalPackages: [
    "node-pty",
    "undici",
    "web-push",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  // Next 16 blocks cross-origin access to dev resources by default. Allow the
  // loopback and the RFC1918 LAN ranges so the dev server stays reachable
  // from other machines on the same LAN.
  allowedDevOrigins: [
    "127.0.0.1",
    "10.*.*.*",
    // 172.16.0.0/12
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.20.*.*",
    "172.21.*.*",
    "172.22.*.*",
    "172.23.*.*",
    "172.24.*.*",
    "172.25.*.*",
    "172.26.*.*",
    "172.27.*.*",
    "172.28.*.*",
    "172.29.*.*",
    "172.30.*.*",
    "172.31.*.*",
    "192.168.*.*",
  ],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
