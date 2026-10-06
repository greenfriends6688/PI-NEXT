import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PwaRegistration } from "@/components/PwaRegistration";
import { PwIcons } from "@/components/PwIcons";
import { InstantTooltip } from "@/components/InstantTooltip";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "katex/dist/katex.min.css";
/* fork:design-components —— 设计文件夹的组件代码**原样进运行时**（不复制、不改一字）：
 *   assets/tokens.css  board.css 依赖的无前缀变量（--n-* / --s* / --radius-3/4/6 / --text-* / --space-chip…）
 *   assets/board.css   画板全部组件样式（pw-*）。产品 DOM 挂 pw 类后由它直接上样式，
 *                      视觉与 design/pi-web-design 的画板 1:1 同源。
 *   assets/icons.js    lucide 路径表 + hydrate（挂 window.Icons），由 PwIcons 客户端组件消费；
 *                      组件里直接写 <i data-ico="check" data-size="12"></i>，与画板 HTML 同一写法。
 * 引入顺序在 globals.css 之前：globals 里同名 :root 变量（--font-ui/--font-mono 等）按序覆盖，
 * 其余同名变量（--accent/--control-sm/--motion-*）两边值一致，无视觉差。 */
import "../design/pi-web-design/assets/tokens.css";
/* fork:design-system —— 设计系统 token 的产品副本（--ds-* 前缀），桥接层引用它。 */
import "./design/tokens.css";
import "./globals.css";
import "./settings.css";
import "./wallpaper.css";
/* fork:design-components —— 画板组件样式放在产品样式**之后**：
   组件挂上 pw-* 类后，board.css 的规则对同元素取得优先权（画板覆盖实现）。 */
import "../design/pi-web-design/assets/board.css";
/* fork:v5-landing —— V5 设计体系的形态收口（design/v5）：
 * 同一时刻只有一套形态在作用（@import 媒体条件，≥641 web / ≤640 pwa），
 * 这就是 LANDING 铁律四「只加载 base.css + 一套形态」的物理实现。
 * 契约见 design/v5/LANDING.md，执行编排见 docs/v5-landing-plan-2026-10-04.md。
 * 迁移期与旧皮肤并存：d-* 与 pw-* 类名不重叠、--nx-* 与 --n-* / --ds-* 令牌不重叠，
 * 没有覆盖冲突；旧件在收尾波统一删除。 */
import "./design/v5-forms.css";
import "../design/pi-web-design/assets/icons.js";
/* fork:pwa-* —— 手机档（≤640px）分区补丁，按区域各占一个文件，owner 互不重叠。
   放在 board.css 之后：画板是 1440px 静态稿，产品窄屏要在它的基础上收成单列。 */
import "./pwa-settings.css";
import "./pwa-models-skills.css";
import "./pwa-plugins-agents.css";
// fork:ui-css — must stay last of the upstream overrides: it overrides upstream styles on purpose.
import "./fork-ui.css";
// fork:mac-skeuo — 「Mac拟物风格」材质层，**必须在 fork-ui.css 之后**：
// 它靠 html[data-theme-skin-id] 挂载，与 fork-ui.css 的
// `html[data-theme-skin="true"] .xxx` 组选择器同权重，靠源码顺序取胜。
import "./fork-mac-skeuo.css";

// A previously installed production worker can cache Turbopack chunks under the
// same local origin. Run this before Next's client code in development so a
// preview always represents the files currently being edited.
const DEV_SERVICE_WORKER_CLEANUP_SCRIPT = `
(() => {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return;

  void (async () => {
    const [registrations, cacheNames] = await Promise.all([
      navigator.serviceWorker.getRegistrations(),
      caches.keys(),
    ]);
    const piWebCaches = cacheNames.filter((name) => name.startsWith('pi-web-'));

    await Promise.all([
      ...registrations.map((registration) => registration.unregister()),
      ...piWebCaches.map((name) => caches.delete(name)),
    ]);

    if (registrations.length > 0 || piWebCaches.length > 0 || navigator.serviceWorker.controller) {
      window.location.reload();
    }
  })().catch(() => {
    // A failed best-effort cleanup must not block the development preview.
  });
})();
`;

// fork:design-system PR-03 — 设计 §1.5：UI 字体 Geist，等宽 Geist Mono。
// 两者都不含中文，中文由 body 字体栈里的 PingFang SC / 微软雅黑兜底。
const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PI NEXT",
  description: "PI NEXT — local coding agent workbench",
  applicationName: "PI NEXT",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      // fork:brand-logo — 标签页用 PWA 同源的方形 PNG（由 pi-next-logo.png 生成，
      // 见 scripts/gen-icons.mjs）；矢量版换成位图后这里不再单列 SVG。
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PI NEXT",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#181818" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${geistSans.variable} ${geistMono.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <link rel="stylesheet" href="/location-highlight.css" />
        {process.env.NODE_ENV === "development" && (
          <script
            dangerouslySetInnerHTML={{
              __html: DEV_SERVICE_WORKER_CLEANUP_SCRIPT,
            }}
          />
        )}
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_INIT_SCRIPT,
          }}
        />
      </head>
      <body translate="no" className="notranslate" suppressHydrationWarning>
        {children}
        <PwIcons />
        {/* fork:instant-tip —— 悬浮提示改成本层自己画（原生 `title` 的延迟改不了），
            挂在 body 末尾与图标层同级：不进任何组件树，全页一个 delegated 监听。 */}
        <InstantTooltip />
        <PwaRegistration />
      </body>
    </html>
  );
}
