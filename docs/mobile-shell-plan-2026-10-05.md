# 移动端方案（iOS + Android，自己装，不上架）—— 2026-10-05

> 目标：把 PI NEXT 装进手机里的一个 App 壳，**自己用、自己装、不上架**，能在家庭网络外访问。
> 参照：`pi参考项目/MusePi-main`（Capacitor + cloudflared + APK）、`paseo-main`（daemon + 多客户端）、`pi-移动端`（KMP 原生，反面教材）。

---

## 0. 目标与非目标

**要**
- 安卓一个 APK，iOS 一个可安装的包，都装在自己手机上
- 手机能连到家/公司的电脑，**不在同一局域网时也能用**（你明确要的）
- 跑完有通知，点通知回到那个会话

**不要**
- 不上架（App Store / 应用商店），所以**不需要过 4.2 审核**
- 不做隧道自研、不做 E2E 中继、不做离线缓存
- 不重写 UI（这是 `pi-移动端` 的 6.6k 行 Kotlin 和 MusePi 的 52k 行 guest-client 的教训）

---

## 1. 最终形态

```
Mac
 └─ pi-web（Next.js）绑 127.0.0.1:30141，永不公开绑网卡
     └─ 稳定远程地址（Tailscale / cloudflared 命名隧道）
         └─ 令牌闸门 ON（~/.pi/agent/lan-access.json 必须存在）

手机
 └─ Capacitor 壳（Android + iOS）
     ├─ WebView 加载 https://<稳定域名>/        ← 就是你的 PWA，一行 UI 都不改
     ├─ 鉴权：现有 6 位码 → 现有 pi-web-lan cookie
     ├─ 原生：安全区 insets / 键盘 / 返回键 / 断网重试页
     └─ 插件：本地通知 / 角标 / 深链 / 安全存储
```

**唯一的新增 UI 代码是"手机上不存在"的东西**（insets、键盘、返回栈、通知），页面本身原样加载。

---

## 2. 关键决策与依据

### D1. 用 Capacitor，**不用**手写原生壳

我前一版说"手写 140 行、零依赖"——**那条是错的**，我只数了壳自己的行数，没数它必须重造的东西。

MusePi 的事实（`packages/mobile`）：约 **230 行配置 + Java**，换来 **6 个插件**：

| 文件 | 行数 |
|---|---|
| `capacitor.config.ts` | 37 |
| `MainActivity.java` | 40 |
| `InsetsPlugin.java` | 40 |
| `app/build.gradle` + `AndroidManifest.xml` | ≈110 |

手写要自己实现：通知渠道 + `PendingIntent` + Android 13 运行时权限、键盘 inset、返回栈、角标、深链、insets。**手写 = 更多代码 + 更少能力。**

Capacitor 8.4.1（MusePi 用的版本）/ Gradle 8.14.3 / AGP 8.13.0 / Java 21 / compileSdk 36 / minSdk 24。**用 Capacitor 8 不用 9**（9 要求 Xcode 27+）。

### D2. 客户端**打包**这条路走不通（所以必须 `server.url`）

两个参照项目都收敛到「**客户端能独立于服务器打包**」：

- MusePi：`packages/guest-client`，**52,000 行**独立 React SPA，`webDir: "dist"` 打进 APK，运行时只连数据通道
- Paseo：620 个 `.tsx` 的 RN app，同样打包，只连 WS

**PI NEXT 做不到**：UI 和 Next server 是一体的（SSR、40 组 API 路由、cookie 鉴权、SSE）。所以只能 `server.url` 指向远程地址。

Capacitor 官方对 `server.url` 的标注是「不用于生产」、维护者说过「加载外部网站可能被 App Store 拒」。**这两条对你都不适用**——你不上架，App 装在自己手机上。这条决策的代价只有一个：**断网时是远程页面加载失败**（见 §3.2）。

### D3. 地址必须**稳定**（不能用 quick tunnel 的随机域名）

MusePi 用 `cloudflared` quick tunnel（`https://abc123.trycloudflare.com`，重启就变）能work，是因为它的凭证在**链接 fragment** 里（`room key`，浏览器不发给服务器），链接自带 URL。

**PI NEXT 的凭证是 host-only cookie**（`proxy.ts` 的 `cookies.set` 没有 `domain` 字段）→ 域名一变 cookie 失配 → 每次重启都得重新配对。

所以：**稳定域名是硬要求。**

| 方案 | 域名 | 顺带给 HTTPS | 代价 |
|---|---|---|---|
| **Tailscale**（推荐） | `100.x.y.z`（稳定 IP） | ❌（http，但走 WireGuard 加密） | 手机装 Tailscale，免费 |
| `tailscale serve` / `funnel` | `<机器>.<tailnet>.ts.net`（稳定） | ✅ 证书装在你机器上 | 免费 |
| cloudflared **命名**隧道 | 你自己的域名 | ✅ | 要一个域名 + Cloudflare 账号 |
| cloudflared quick 隧道 | **随机，重启就变** | ✅ | 只能用来验证，不能长期用 |

**默认选 Tailscale**：零代码、免费、稳定、不用域名。手机和电脑都在同一个 tailnet 里，等于给手机一个"到哪都能用的局域网"。

### D4. 令牌闸门**必须**开

MusePi 的 `tunnel.ts` 文件头写着：

> The public URL is NOT a secret by itself — collab security is carried by the room key in the link fragment … so exposing the tunnel URL is no worse than sharing through the default relay.

**这个论证对 PI NEXT 不成立。** 你的信任边界是 token，不是 fragment。而 `checkLanAccess()` 在**没有令牌时恒放行**（`lib/lan-access.ts`）。

> 走任何远程地址之前，先在桌面「设置 → 手机与推送」把 LAN 打开（生成 `~/.pi/agent/lan-access.json`）。

不需要新造：`lib/lan-access.ts`（48-hex token + 只读令牌 `HMAC-SHA256(full, "pi-web-lan-readonly:v1")`）+ `lib/lan-pair.ts`（6 位码、10 分钟、单次使用、30 次/5 分钟节流）已经**比 MusePi 更完整**——他们的 `pair.resolve` 端口（硬编码 8301）没有速率限制。

### D5. 通知走**原生本地通知**，不走 Web Push

WebView 里拿不到 Push subscription（iOS 只给"已加主屏的 PWA"授权，Android WebView 的 FCM 通道不成立）。

MusePi 的做法（`src/app.tsx:298`）值得照抄：**在 `document.hidden` 且新条目落定时**，用 `@capacitor/local-notifications` 发一条本地通知，点它走深链回会话，同时 `@capawesome/capacitor-badge` 加角标、回到前台清掉。**这是"无云推送"**，不碰 APNs/FCM 证书。

### D6. Android 安全区**必须**自己注入（第三次确认）

`env(safe-area-inset-*)` 在 Android WebView **不生效**，即使在 edge-to-edge 模式下。三份独立证据：

1. Capacitor 官方 `SystemBars` 插件文档：WebView < 140 时 `env()` 的值**是错的**（不是 0），插件注入 `--safe-area-inset-*` 兜底
2. Chromium bug 40699457
3. MusePi 自己写了 `InsetsPlugin.java`（40 行），注释原文：*"Android WebView does not surface these via env(safe-area-inset-*) even in edge-to-edge mode"*

本仓约 20 处 CSS 依赖 `env(safe-area-inset-*)`（`app/fork-ui.css:1765` 的 `fork:pwa-safe-area` 块、`globals.css`、`settings.css:669`、`pwa-*.css`）。**这些在安卓壳里全部失效。** 修法见 PR-3。

---

## 3. 两个必须先解决的坑

### 3.1 键盘：原生 resize 有肉眼可见的滞后

MusePi 的 `capacitor.config.ts` 注释原文：

> `'none'` leaves the WebView at full height; the UI follows the keyboard itself via the `--mp-keyboard-inset` CSS variable. The built-in `'native'` resize **lands only after the keyboard animation finishes (visible lag)**.

所以：`Keyboard.resize: "none"` + 在 `keyboardWillShow` 里把高度写进 CSS 变量。本仓已有 `hooks/useViewportHeight.ts` 在监听 `visualViewport`，PR-3 要把两者接起来（不能互相打架）。

### 3.2 断网：远程页面加载失败 = 白屏

Paseo 有个 issue（#8302）就是这个：**iOS 冷启动没网时 WKWebView 白屏挂住**，而且 `server.errorPath` 对 DNS/TLS 失败不可靠。

解法（v1）：Capacitor 的 `server.errorPath` 指向**打包在 webDir 里的 `error.html`**，页面里一个「重试」按钮 `location.href = <远程地址>`。便宜、够用。iOS 上如果实测不可靠，再退到原生 `WKNavigationDelegate.didFailProvisionalNavigation` / `onReceivedError`。

---

## 4. PR 拆分

每个 PR 独立可验证。**PR-1 完成就解决了"不在局域网也能用"。**

---

### PR-1 · 稳定远程地址 + 令牌闸门（**0 行代码**）

**目标**：手机在**关掉 WiFi、只用蜂窝数据**的情况下打开 PI NEXT 并正常使用。

**做什么**

1. 手机和电脑都装 Tailscale 并登录同一账号；`tailscale ip -4` 拿到电脑的 `100.x.y.z`
2. 桌面：设置 → 手机与推送 → **启动**（生成 `~/.pi/agent/lan-access.json`，`bin/lan-supervisor.cjs` 会自动重启子进程让绑定生效）
3. 如果用的是**域名**（tailscale serve / cloudflared 命名隧道），加一个环境变量：
   ```bash
   PI_WEB_ALLOWED_HOSTS=<你的域名>
   ```
   ⚠️ **不要用 `PI_WEB_HOSTNAME`** —— 那个变量在 `bin/pi-web-options.js` 里是**绑定地址**，写域名会直接启动失败。`lib/request-security.ts:68` 两个都读，但只有 `PI_WEB_ALLOWED_HOSTS` 是纯放行语义。
   纯 IP（Tailscale 的 `100.x.y.z`）本来就被允许（`isApiRequestHostAllowed` 放行任意 IP 字面量），不用配。

**DoD**
- [ ] 手机关 WiFi，蜂窝下打开 `http://100.x.y.z:30141/pair`，输 6 位码，进到会话列表
- [ ] 手机浏览器**杀掉重开**，仍然是已配对状态（cookie 持久）
- [ ] 电脑上跑一个 agent，手机能看到实时输出（SSE 通）
- [ ] **反向验证**：把 LAN token 关掉/删掉 `lan-access.json`，手机应该被拒（证明闸门真的在工作，不是裸奔）

**验证**：真机。**这一步不需要任何代码，但它是后面所有 PR 的前提。**

---

### PR-2 · Android 壳：能装、能连（最小可用 APK）

**目标**：`adb install` 后，App 打开就是 PI NEXT，能配对、能聊天。

**新增**
```
mobile/                       ← 新目录，不碰既有源码
  package.json                @capacitor/core|cli|android ^8.4.1
  capacitor.config.ts         见下
  webDir/error.html           断网兜底页（PR-3 用，先建着）
  android/                    cap add android 生成
```

`capacitor.config.ts`（照 MusePi 的形状）：

```ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "sh.pinext.mobile",        // ⚠️ 定了就不能改，改了等于换一个 App
  appName: "PI NEXT",
  webDir: "webDir",
  server: {
    url: process.env.PINEXT_SERVER_URL ?? "http://100.x.y.z:30141",
    androidScheme: "https",
    // Android WebView 从 https:// origin 出发，连 http://100.x.x.x 会被当混合内容拦掉
    allowMixedContent: true,
    cleartext: true,
    errorPath: "error.html",
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: true,   // 调试期开，发版关
  },
  plugins: {
    Keyboard: { resize: "none", resizeOnFullScreen: true, autoBackdropColor: "dom" },
    StatusBar: { overlaysWebView: true, style: "DARK" },
  },
};
export default config;
```

**改（Web 侧，最小）**
```
lib/mobile-shell.ts              新增，isMobileShell()
components/PwaRegistration.tsx   壳内不注册 SW
```

`PwaRegistration.tsx` 的守卫（**本方案性价比最高的几行**）：

```ts
if (isMobileShell()) { void unregisterAllServiceWorkers(); return; }
```

理由：`public/sw.js` 的 `install` 会抓 `/` 并缓存，导航是 network-first（8s 超时）后**回落到缓存的旧壳**。在原生 App 里这没有离线价值，只会造成「改了代码 App 里还是旧的」——这类 bug 极难查。

**DoD**
- [ ] `npx cap sync android && ./android/gradlew -p android assembleDebug` 出 APK
- [ ] `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` 装上，打开是 PI NEXT
- [ ] 壳内完成 6 位码配对，能发消息、能看到流式输出
- [ ] 壳内 `navigator.serviceWorker.getRegistrations()` 返回空
- [ ] 桌面端行为**零变化**（`public/sw.test.mjs` 仍绿 + 新增一条「注入 `window.piNextMobile` 后不注册」的测试）

**风险**：`server.url` 是 Capacitor 标注"不用于生产"的路径。对你无所谓（自己装），但要接受**它是把同一条地址写死在配置里**——地址变了要重新打包，除非在 PR-3 里做成可配置（见 §5 的开放问题）。

---

### PR-3 · 壳内体验：安全区 / 键盘 / 返回键 / 断网重试

**目标**：用起来不像"一个网页塞进盒子"。

#### 3a. 安全区（D6）——本轮最实的一块

MusePi 的 `InsetsPlugin.java` 原样可抄（40 行）：

```java
@CapacitorPlugin(name = "Insets")
public class InsetsPlugin extends Plugin {
  @PluginMethod public void getSystemBars(PluginCall call) {
    WindowInsets insets = getActivity().getWindow().getDecorView().getRootWindowInsets();
    float density = getActivity().getResources().getDisplayMetrics().density;
    int top = 0, bottom = 0;
    if (insets != null) {
      top = insets.getInsets(WindowInsets.Type.statusBars()).top;
      bottom = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
    }
    ret.put("top", Math.round(top / density));       // 换成 dp
    ret.put("bottom", Math.round(bottom / density));
  }
}
```

`MainActivity.java` 里三个必抄的坑（MusePi 的注释都写了原因）：
```java
registerPlugin(InsetsPlugin.class);   // 必须在 super.onCreate() 【之前】——bridge 在 super 里构建
super.onCreate(savedInstanceState);
WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (v, i) -> WindowInsetsCompat.CONSUMED);

@Override public void onWindowFocusChanged(boolean hasFocus) {
  super.onWindowFocusChanged(hasFocus);
  if (hasFocus) WindowCompat.setDecorFitsSystemWindows(getWindow(), false);   // Android 12+ SplashScreen 会在 onCreate 后恢复 decor-fit
}
```

**Web 侧**：把散落的 `env()` 收成单一真值。`app/globals.css` 的 `:root` 里定义：

```css
:root {
  --safe-top:    env(safe-area-inset-top, 0px);
  --safe-right:  env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left:   env(safe-area-inset-left, 0px);
}
```

然后把约 20 处 `env(safe-area-inset-top, 0px)` 等**机械替换**为 `var(--safe-top)`（桌面值一字不变，因为定义就是那个表达式），壳里则由 JS 覆盖：

```ts
document.documentElement.style.setProperty("--safe-top", `${Number(bars.top)}px`);
```

**DoD**
- [ ] 安卓真机刘海屏下，顶栏不被状态栏压住、底部输入框不被手势条压住
- [ ] `grep -rn "env(safe-area-inset" app/` 只在 `globals.css` 的定义处出现
- [ ] 桌面端在 `env()` 为 0 的情况下视觉零变化（跑一次 `npm run verify:boards`）
- [ ] 新增一条测试：替换后所有 `--safe-*` 都有定义（`npm run check:styles` 通过）

#### 3b. 键盘（§3.1）

`@capacitor/keyboard`，`resize: "none"`；`keyboardWillShow` → 写 CSS 变量；与现有 `hooks/useViewportHeight.ts` 的 `visualViewport` 逻辑明确分工（壳里用原生值，浏览器里用 visualViewport），不要两个同时改同一个变量。

**DoD**：安卓真机上点输入框，键盘弹出后输入框贴键盘上沿、没有可见滞后；收起后高度复原；iOS 侧同（PR-6 验证）。

#### 3c. 返回键

新增 `hooks/useNativeBack.ts`：`push(handler) → unregister` 的注册表 + `pop()`。
`components/AppShell.tsx`：面板/弹层打开时注册处理器。

```ts
const { App } = await import("@capacitor/app");
void App.addListener("backButton", ({ canGoBack }) => {
  if (popNativeBackStack()) return;        // 关最上层面板
  if (canGoBack) window.history.back();
  else void App.exitApp();
});
```

本仓 `popstate` 处理目前为零（`docs/pi-mobile-layout-plan-2026-10-03.md` §5 记着「未做」），所以这是新逻辑。同时 Android 侧关掉系统左缘手势，避免和 `components/pwa/MobileGestures.tsx` 自绘的左缘返回（56px 触发）打架。

**DoD**：开设置弹层 → 返回关弹层；右侧面板 → 返回关面板；都没开 → 退出到后台。桌面键盘快捷键与浏览器 `popstate` 不受影响。

#### 3d. 断网重试（§3.2）

`webDir/error.html`：极简页面 + 「重试」按钮（`location.href = <远程地址>`）+ 「检查电脑是否开机」文案。
`server.errorPath: "error.html"`。iOS 若实测覆盖不到 DNS/TLS 失败，再加原生 `didFailProvisionalNavigation`。

**DoD**：关掉电脑 / 断掉 Tailscale，App 显示重试页而不是白屏；恢复后点重试能进。

---

### PR-4 · 通知：本地通知 + 角标 + 深链

**新增插件**（照 MusePi 的清单）
```
@capacitor/local-notifications  8.x
@capacitor/app                  8.x   （深链 appUrlOpen / getLaunchUrl）
@capawesome/capacitor-badge     8.x
@aparajita/capacitor-secure-storage  8.x   （可选，见 §5）
```

**改**
```
lib/mobile-notify.ts           新增，桥接层
hooks/useAgentSession.ts       prompt_done / agent_settled 处挂钩
components/AppShell.tsx        深链 → 切到会话；回前台清角标
```

触发条件（MusePi 的做法，照抄）：**`document.hidden` 且一个 run 落定**。

```ts
if (document.hidden) {
  await LocalNotifications.schedule({ notifications: [{
    id: Date.now() % 2147483647,
    title: "PI NEXT", body: text.slice(0, 140),
    smallIcon: "ic_stat_pinext",
    extra: { sessionId },
  }]});
  void incrementBadge();
}
```

Apple/Google 的深链走 `pinext://session/<id>`；Android 用 `intent-filter` + `singleTop` + `onNewIntent`；iOS 用 `CFBundleURLTypes`。点击 → `evaluateJavascript` 调 AppShell 现成的切会话逻辑。

> 天花板写清楚：**只在 App 进程活着时发**（切后台被系统回收就没了）。这是 D5 的取舍——换真远端推送要 APNs/FCM + 付费 Apple 账号。真要"App 被杀也能收到"，走已有的 `lib/im-bridge.ts`（飞书/钉钉/企微/Telegram），那是真 Anywhere。

**DoD**
- [ ] 手机上发一条消息 → 切到别的 App → 跑完出现本 App 名下的通知（不是浏览器品牌）
- [ ] 点通知 → 直接落到那个会话
- [ ] 角标 +1，回到前台清零
- [ ] 前台看着的时候**不**发通知
- [ ] 桌面端通知行为不变（`lib/browser-notifications.test.mjs` 仍绿）

---

### PR-5 · 在场裁决：通知不吵（**纯 Web，独立可合**）

**为什么**：现在 `lib/rpc-manager.ts:2651` 的 `notifySessionComplete(sessionId)` 是**无脑推给所有订阅设备**。有了手机壳之后会变成：你在电脑前盯着跑，手机也响；或者你在手机上看，电脑也响。

**抄 Paseo 的 `agent-attention-policy.ts`**（约 30 行纯函数）：

```ts
const PRESENCE_THRESHOLD_MS = 180_000;

export function computeNotificationPlan({ clients, focusTarget, nowMs }) {
  let mostRecentPresent = null, mostRecentAt = -Infinity;
  for (const c of clients) {
    const at = c.lastActivityAtMs === null ? null : Math.min(c.lastActivityAtMs, nowMs);
    if (at === null || nowMs - at > PRESENCE_THRESHOLD_MS) continue;      // 这个客户端不在场
    if (c.appVisible && isFocusedOn(c, focusTarget)) {
      return { inAppRecipient: null, shouldPush: false };                 // 正盯着它 → 谁都不通知
    }
    if (at > mostRecentAt) { mostRecentPresent = c; mostRecentAt = at; }
  }
  if (mostRecentPresent) return { inAppRecipient: mostRecentPresent, shouldPush: false };  // 有人在 → 只给他站内
  return { inAppRecipient: null, shouldPush: true };                       // 没人 → 才推
}
```

配套：客户端 10 秒一次心跳上报 `{appVisible, lastActivityAtMs, focusedSessionId}`（Paseo 的 `client_heartbeat` 形状）。

**你的输入全都已经有了**：`hooks/useNotificationPrefs.ts`、`document.visibilityState`、SSE 连接、`/api/agent/running`。改动是：一个纯函数 + 一个心跳路由 + 一处调用点替换。**零新依赖。**

**DoD**
- [ ] 三态测试：`focused` / `present-but-not-focused` / `absent`，各断言 `shouldPush`
- [ ] 你在电脑前看某个会话跑完 → 手机不响
- [ ] 你不在任何设备前 → 手机响
- [ ] 桌面端 Web Push 行为在"只有桌面在线"时不回归

---

### PR-6 · iOS 壳 + 安装

**先定这件事：怎么装。** 你提到的 TestFlight 可以，但**不是最优**：

| 方式 | 要付费账号 | 有效期 | 要定期重传 | 要审核 |
|---|---|---|---|---|
| 免费 Apple ID 自签（Xcode / Sideloadly） | ❌ | **7 天** | 每周重签 | ❌ |
| AltStore / SideStore（自动重签） | ❌（免费 7 天）/ ✅（付费 1 年） | 7 天 / 1 年 | 免费账号仍要 | ❌ |
| **Ad Hoc 分发**（推荐） | ✅ $99/年 | **1 年** | ❌ | ❌ |
| TestFlight | ✅ $99/年 | **构建 90 天过期** | 每 90 天 | 内部测试员免审核；外部公开链接要 Beta 审核 |

**对你（自己装、不上架）最优的是 Ad Hoc**：1 年有效、不用审核、不用每 90 天重传。只需要在 App Store Connect 里登记你手机的 UDID（每年 100 台额度）。

**没有付费账号也不是不能做**：免费 Apple ID 能签，代价是**每 7 天连一次 Mac 重签**（或用 SideStore 半自动）。参照项目 `pi-移动端` 走的就是这条路，`app/ios-build.md` 记了全套（`Xcode 26.6`、`xcodegen`、手动 `codesign`、`devicectl` 安装）。

**做什么**
```bash
cd mobile && npx cap add ios
```
- `Info.plist`：`NSAppTransportSecurity`（用 `NSAllowsLocalNetworking`，**不要** `NSAllowsArbitraryLoads`）；如果目标是 **http **（Tailscale IP），需要 `NSAllowsLocalNetworking` + `NSLocalNetworkUsageDescription`（iOS 14+ 访问局域网必须写，缺了直接被拦）；如果目标是 https 域名，两个都不需要
- `ITSAppUsesNonExemptEncryption: false`（省掉每次上传的出口合规问询）
- `WKWebView`：`allowsBackForwardNavigationGestures = false`（左缘返回交给 App 自己，否则和 `MobileGestures.tsx` 打架）、`scrollView.bounces = false`（否则和 `PwaPullToRefresh` 的 24/64px 阈值抢手势）、`websiteDataStore = .default()`（cookie 持久化）

**DoD**
- [ ] 模拟器能跑起来、能配对、能聊天
- [ ] 真机装上一个（Ad Hoc 或免费自签）
- [ ] 刘海屏安全区正确（iOS 的 `env()` 是好的，不需要 InsetsPlugin）
- [ ] 杀进程重启后仍是已配对状态
- [ ] 键盘弹出/收起正确（重点验 PR-3b 在 iOS 上不打架）

---

### PR-7 · 打包与发版

**Android**（照 MusePi 的 CI，`.github/workflows/gui-release.yml` 的 `package_mobile` job）
- 仓库里**没有任何 `.jks`/`.keystore`**，AGP 自动生成 debug keystore，`assembleDebug`，asset 名就是 `app-debug.apk`，装法 `adb install -r`。**诚实、够用**——自己用不需要 release 签名
- CI：JDK 21 + Android SDK 36 → `cd mobile && npx cap sync android && ./android/gradlew -p android assembleDebug --no-daemon` → `actions/upload-artifact` + 挂到 GitHub Release

**iOS**
- 本机 `xcodebuild archive` → Ad Hoc 导出 `.ipa` → 用 Apple Configurator / Xcode Devices 装到手机
- 或 EAS（免费额度够，但要 Expo 账号；`eas build -p ios --profile ad-hoc`）

**改**
```
package.json       mobile:android:debug / mobile:ios:run / mobile:android:release
AGENTS.md          新增「移动端」一节，写清 D1–D6 六条决策
DIVERGENCE.md      记一条：App 图标用品牌 PNG（与现有渠道 logo 那条例外同级）
docs/              本文件的链接
```

**DoD**：`npm run mobile:android:debug` 一条命令出可安装 APK；iOS 有可复现的 archive 命令；README 有一段手机使用说明（含 D4 的前提：先在桌面开 LAN）。

---

## 5. 开放问题（做 PR-2 之前要定）

1. **地址写死还是可配置？**
   `server.url` 是编译期配置。两个选择：
   - **写死**（最简单）：换地址要重新打包。你只有一个常用地址的话够用
   - **可配置**：不设 `server.url`，让壳加载一个打包的首页做「输入地址 → 跳转」。代价是每个地址要**各配一次对**（cookie 是 host-only）。MusePi 的 `lib/connections.ts`（73 行，secure store 存最近 8 个地址）是现成参考

   建议：**v1 写死**（Tailscale IP，永远不变），等真的需要多地址再上可配置。

2. **cookie 会不会被 WebView 清掉？**
   Android `CookieManager` 和 iOS `WKWebsiteDataStore.default()` 都是持久的，理论上没问题。但如果不稳，退路是：token 存 `@aparajita/capacitor-secure-storage`，壳在每次加载前用 `CookieManager.setCookie` / `WKHTTPCookieStore.setCookie` 注回去。**先别做**——PR-1 的验证里已经包含"杀进程重开仍在已配对状态"，有问题再加。

3. **`appId` 定什么？** 定了就不能改（改了等于换 App）。暂用 `sh.pinext.mobile`。

---

## 6. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| `server.url` 依赖远程可用 | 断网白屏 | PR-3d 的 `errorPath` + 重试页；iOS 兜底原生 delegate |
| 随机域名 + host-only cookie | 每次重启要重新配对 | D3：用稳定地址（Tailscale / 命名隧道） |
| Android WebView 的 `env()` 失效 | 刘海屏顶栏被压 | PR-3a 的 InsetsPlugin + `--safe-*` 收拢 |
| 壳内 SW 缓存旧壳 | 「改了没生效」 | PR-2 的一行守卫 |
| 系统返回键 vs 自绘左缘手势 | 手势错乱 | PR-3c + Android 关系统左缘手势 |
| App 被杀后收不到通知 | 预期落差 | 通知文案不承诺；跨网络通知推 IM 桥 |
| iOS 免费账号 7 天过期 | 每周重签 | Ad Hoc（$99/年，1 年有效）或 SideStore |
| `appId` 反悔 | 要重装、重配对 | 定之前想清楚 |
| Capacitor 9 要求 Xcode 27+ | 构建失败 | 锁 Capacitor **8**.4.1（MusePi 同版本） |

---

## 7. 落地顺序与依赖

```
PR-1（0 代码，今天就完成，验证整条远程链路）
  └─ PR-2（Android 最小壳，能装能连）
      ├─ PR-3（安全区/键盘/返回键/断网）  ← 让它不像盒子
      │   └─ PR-4（通知 + 角标 + 深链）
      └─ PR-6（iOS，可与 PR-3/4 并行）
          └─ PR-7（打包发版）

PR-5（在场裁决，纯 Web）—— 随时可合，不依赖任何其他 PR
```

**PR-1 现在就能做，20 分钟，不需要写任何代码。** 后面每一步都是把已经验证过的地址装进包。
