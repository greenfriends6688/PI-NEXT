# 移动端外壳方案（iOS + Android）—— 2026-10-05

> 目标：把本仓已有的 PWA 原样装进一个原生 App 壳，同时支持 iOS 与安卓。
> 参照项目：`pi参考项目/pi-移动端`（PiRemote）。**结论是不抄它的实现，只抄它的踩坑记录。**

---

## 0. 先回答「这事到底需不需要」

本仓的 PWA **今天在手机上已经能用**（`app/manifest.ts` 有 manifest、`public/sw.js` 有 SW、
`components/pwa/*` 有一整套手机形态、还有 6 位码配对与原生级推送）。所以外壳的增量价值只有四条：

| 外壳带来 | 现状 |
| --- | --- |
| 应用商店 presence / 独立图标 / 不再手输 `192.168.x.x:30141` | 手输 |
| **原生本地通知**（Web Push 在 WebView 里拿不到 subscription） | 只有 Web Push（浏览器里有效） |
| 系统返回键 / 更稳的输入法与安全区 | 自己做的手势，与系统返回无关联 |
| 一个不用记的固定入口（App 内可切换服务器地址） | 每次自己敲 |

**如果只要「在手机上用」，PR-1 + PR-2 就够了**（PWA 修两处 + 加到主屏）。
本方案剩下的 PR 只在这四条都仍然不够时才做。这条先钉死，免得后面把工程量投到不需要的地方。

---

## 1. 参照项目到底做了什么（以及我们为什么不做）

`pi-移动端` 是 **两件独立的东西**：

1. `app/` —— Kotlin Multiplatform + Compose Multiplatform 写的**原生客户端**，
   6.6k 行 Kotlin（`MessageView.kt` 单文件 1365 行），iOS 侧 38 行 Swift 只做 `@main` + 安全区。
2. `server/` —— **另一个独立的 Node 进程**（`pi-remote-bridge`，1.5k 行 TS，端口 30150），
   自己 `createAgentSession()` 起第二个 agent 实例，自己定义 `/api/v1/*` + WebSocket 协议 v2，
   再由 Kotlin 侧**手工镜像**一份 `Protocol.kt`（587 行）。

它为什么值得存在：手机流量下要把整个 session 压到能推送的量级 —— 8KB 文本截断、thinking 预览 200 字、
图片只发 `{ref,mime,bytes}` 占位、WS 断线用 `seq` + `touched: Map<itemId, seq>` 精确续传、
`hello` 作为唯一重同步路径、外加 Android 前台服务保活 + 本地通知。

**我们不需要这些**，因为：

| PiRemote 的做法 | 本仓已有的等价物 |
| --- | --- |
| 自建 `/api/v1/sessions/*` + 缩短 DTO | `app/api/sessions/*` + SSE，原样全量 |
| 手写 WebSocket 协议 v2 + `Protocol.kt` 镜像 | 现成的 `app/api/agent/[id]/events` SSE |
| 独立 bridge 进程 + 第二份 agent | `lib/rpc-manager.ts` 里已有的 wrapper |
| 6.6k 行 Kotlin 消息渲染（markdown/diff/图片缩放） | `components/MessageView.tsx` + `MarkdownBody.tsx` |
| 明文 token 存 DataStore | 现成的 `pi-web-lan` httpOnly cookie + `?t=` |

所以本方案的形态是 **WebView 壳 + 现有 PWA 原样加载**，socket 协议、消息渲染、状态管理、分页、
压缩、工具审批全部零改动。**唯一的新增代码是原生侧的几百行，以及 PWA 侧的三处小改动。**

### 从参照项目里明确要抄的（免费的踩坑清单）

全部来自 `pi参考项目/pi-移动端/app/ios-build.md` 与 `app/AGENTS.md`：

- iOS ATS 要开 `NSAllowsLocalNetworking`（**不要** `NSAllowsArbitraryLoads`）
- iOS 14+ 访问局域网必须写 `NSLocalNetworkUsageDescription`，否则 `http://192.168.x.x` 直接被拦
- Android manifest 要 `usesCleartextTraffic`
- `CADisableMinimumFrameDurationOnPhone: true`，否则 `PlistSanityCheck` 启动即崩
- 「离开 App 后 agent 跑完 → 点通知回到会话」这个能力，参照项目用
  `AgentForegroundService` + `startForeground` 写在 **`onCreate`** 而非 `onStartCommand`
  （OEM 后台启动延迟会吃掉 ~5s 窗口），且 `startForegroundSafely()` 失败时吞异常 + `stopSelf()`，
  绝不让 `ForegroundServiceDidNotStartInTimeException` 把进程带走

### 明确不抄的

KMP/Compose 工具链、Gradle 9.7 + AGP 9.3.1 + Kotlin 2.4.10 + CMP 1.11.1 的版本矩阵、
CMP 缺 `WindowInsets.imeAnimationTarget` 的 iOS actual、xcodegen + 4 级 JDK 探测、
免费 Personal Team 每周重签、Aliyun 镜像 `exclusiveContent` 配置、`qrcode`/`ws`/`tsx` 依赖、
payload 缩短层、`shorten.ts`/`refs.ts`/`items.ts`/`translate.ts` 整套。

---

## 2. 六条决策（先定，后面每个 PR 都从这来）

### D1. 手写壳，不用 Capacitor / Tauri / WebView 框架

- Capacitor 解决的是**插件生态**（相机、推送、文件系统）。我们从插件生态里只需要一个函数：**发本地通知**。
- 手写成本：Android 一个 `MainActivity.java`（~90 行）+ 一份 `build.gradle`；iOS 一个
  `ContentView.swift`（~50 行）+ 一份 `project.yml`。**没有一个第三方依赖。**
- 代价：以后要相机 / 文件选择器 / 生物识别，都得手写原生代码或后补依赖。
- 本仓已有手写 Electron 打包的先例（`electron/` + `scripts/`），风格一致。

### D2. LAN-only，不做隧道、不做 APNs/FCM 远端推送

- 参照项目就是 LAN-only，且本仓 `fork:lan-access` 的 6 位码 / 只读令牌本来就是 LAN 语义。
- **跨网络通知已经有免费的替代品**：`lib/im-bridge.ts` 的 `im_send`（飞书 / 钉钉 / 企业微信 / Slack / Telegram /
  自建 webhook）在会话跑完时就能推 —— 那是真· Anywhere 的通知，不需要 APNs、不需要证书、不需要后台模式。
- 天花板写清楚：**App 被系统杀掉 + 手机不在同一网络 = 收不到通知。** 需要真远端就接 IM 桥，不要给壳加 APNs。

### D3. 通知走**原生本地通知**，不走 Web Push

- Web Push（`lib/web-push.ts` VAPID + SW）在裸 WebView 里拿不到 subscription：
  iOS 只给「已添加到主屏的 PWA」授权，Android WebView 的 FCM 通道不成立。
- 但 `lib/browser-notifications.ts` 已经是三层链：`nativeNotify`（Electron）→ SW → `new Notification`。
  我们只要把 `window.piWebDesktop` 旁边加一个 `window.piWebMobile`，**复用现成的第一层**。
  改动量：一个 `typeof` 探测 + 两侧各 ~60 行原生。

### D4. 认证沿用现有 `pi-web-lan` cookie，不发明新方案

- `proxy.ts` 的 matcher 只覆盖 `/` 与 `/api/**`，`app/pair/page.tsx` **天然免鉴权**可打开。
- `WKWebsiteDataStore.default()` 与 Android `CookieManager` 都**持久化** cookie（前者是默认，非 `nonPersistent()`）。
- cookie 是 `secure: false`，明文 http 直接可用；SSE 走 cookie 天然成立（这也是 `?t=` 存在的根本原因 —— `EventSource` 不能带 header）。
- 因此壳的登录流程 = 打开 `/pair` → 输 6 位码 → 完事。**壳里没有登录页。**
- 已知天花板（写进文档，不修）：cookie 是 **host-only**，绑在配对时用的那个 IP 上；Mac 换了 DHCP 地址要重新配对。
  缓解：壳记住上次地址并允许一键改（PR-5）。
- **前置条件（必须写在首屏）**：`bin/pi-web-options.js` 只有在存在 LAN token 时才绑 `0.0.0.0`，
  否则只绑 `127.0.0.1`（手机根本连不上）。所以用户必须先在桌面
  「设置 → 手机与推送 → 启动」启动 LAN（该动作会现生成 `~/.pi/agent/lan-access.json`），
  然后 `bin/lan-supervisor.cjs` 自动重启子进程。壳的首次运行页要把这一步写清楚。

### D5. Android **不做** edge-to-edge；iOS 做

- `env(safe-area-inset-*)` 在 Android WebView 上要 Chromium 128+ 且应用走 edge-to-edge 才生效，
  老版本恒为 0。本仓约 20 处 CSS 依赖 `env(safe-area-inset-*, 0px)`（`fork-ui.css:1765` 的 `fork:pwa-safe-area` 块、
  `globals.css:1020/1861/1901/...`、`settings.css:669`、`pwa-*.css` 等），且**都带 0px 兜底**。
- 所以：Android 让系统正常 inset，`env()` 取 0，现有 CSS 一行不改就是对的。**这就是最省的做法。**
- iOS 侧 `layout.tsx` 已经是 `viewportFit: "cover"` + `appleWebApp.statusBarStyle: "black-translucent"`，
  只需 `ContentView` 全屏铺开（参照项目 `ContentView.swift` 里的 `.ignoresSafeArea()`，不加会 letterbox）。

### D6. 壳内**关掉 Service Worker**

- `components/PwaRegistration.tsx` 只在 prod 注册；`public/sw.js` 的 `install` 会 `primeShellCache()` 抓 `/` 并缓存，
  导航是 network-first（8s 超时）→ **回落到缓存的旧壳**。原生 App 里这没有离线需求，只会造成「改了 bug 但 App 里还是旧的」。
- 同一个 SW 还让 `navigator.serviceWorker.ready` 可能挂住，影响推送注册。
- 改动：`if (window.piWebMobile) return;` —— 外加把已存在的 SW 反注册掉。**一行守卫，本方案性价比最高的一行。**
- 顺带：`app/manifest.ts` 的 `theme_color: "#1a1a1a"` 与 `layout.tsx` viewport 的 `#ffffff`/`#181818` 是两个不一致的源，顺手统一。

---

## 3. 壳的技术规格（两侧共同）

| 方面 | 取值 | 理由 |
| --- | --- | --- |
| 起始 URL | `http://<host>:<port>/pair`（首次）→ `/` | `/pair` 免鉴权（D4） |
| 端口 | 默认 30141 | 与 `bin/pi-web-options.js` 的 `DEFAULT_PORT` 一致 |
| JS / DOM storage / cookie | 全开；`localStorage` 走默认持久化存储 | 记住服务器地址 |
| 文件选择 | `input type=file` 走系统选择器；**不加** `capture`（保持与 `ChatInput.tsx:4254` 一致） | 现有桌面行为 |
| 外链 | 站外 URL 用系统浏览器打开，不在壳内导航 | 防导航逃逸 |
| 新窗口 | `target=_blank` → `createWindow` 拒绝或转系统浏览器 | 同上 |
| 允许的 scheme | `http/https` | 其余（`mailto:`/`tel:`）转系统 |
| overscroll | 关（Android `OVER_SCROLL_NEVER`，iOS `bounces=false`） | 与 `PwaPullToRefresh`（24/64px 阈值）抢同一个手势 |
| 左缘返回 | Android 关系统手势；iOS `allowsBackForwardNavigationGestures = false` | 与 `components/pwa/MobileGestures.tsx` 自绘的左缘滑动返回（56px 触发）重复 |
| 软键盘 | Android `adjustResize` + `windowSoftInputMode` | 已有 `hooks/useViewportHeight.ts` 处理 `visualViewport`，需实测 |

---

## 4. 改动清单（Web 侧，只有三处 + 一份新文件）

```
新增  lib/mobile-shell.ts                 isMobileShell() —— 探测 window.piWebMobile（结构化类型，不 import 原生代码）
改    components/PwaRegistration.tsx      壳内不注册 SW（并反注册已存在的）
改    app/pair/page.tsx                   加「服务器地址」输入 + 记住上次地址 + 失效原因回显
改    app/api/agent/[id]/route.ts（?）     不改。见下
复用  lib/browser-notifications.ts        把 window.piWebMobile 接进已有 nativeNotify 层（3 行探测 + 类型）
新增  hooks/useNativeBack.ts              系统返回键注册表（面板栈未实现，见 PR-7）
```

`proxy.ts` / `lib/lan-access.ts` / `lib/lan-pair.ts` / 所有 SSE 路由**一行不改**。

---

## 5. PR 拆分

每个 PR 都可独立验证、独立回滚。粗估不含 review 的净工时。

### PR-1 · 壳的骨架：Android 可安装可加载

**目标**：`./gradlew assembleDebug` 出 APK，装到安卓机上，能打开并显示 `/pair` 页面。

新增（全部新目录，不碰既有源码）：
```
mobile/android/settings.gradle.kts
mobile/android/build.gradle.kts
mobile/android/gradle.properties
mobile/android/app/build.gradle.kts        AGP + 一个 java library，compileSdk 35 / minSdk 24 / targetSdk 35
mobile/android/app/src/main/AndroidManifest.xml   usesCleartextTraffic、POST_NOTIFICATIONS、piweb:// 深度链接
mobile/android/app/src/main/java/pi/web/mobile/MainActivity.java   ~90 行，见下
mobile/android/app/src/main/res/…         strings / themes / mipmap（图标先用 build/icon.png 缩放）
```

`MainActivity.java` 承担：建 WebView（`setJavaScriptEnabled`、`setDomStorageEnabled`、`setDatabaseEnabled`、
`setMediaPlaybackRequiresUserGesture`）、`CookieManager.setAcceptCookie(true)` + 启动时 `flush()`、
`setOverScrollMode(OVER_SCROLL_NEVER)`、`WebViewClient` 的 URL 白名单 + 站外转系统浏览器、
`onBackPressed` 先问 JS 再退出、`WebChromeClient.onPermissionRequest`（相机/麦克风给 `RESOURCE_VIDEO_CAPTURE`）。

**DoD**
- [ ] `npm run mobile:android:debug` 出 APK，`adb install` 后能看到 `/pair`
- [ ] 手动在桌面 `npm run prod` + 开 LAN，壳内 6 位码换 cookie 后能进 `/`
- [ ] SSE 实时流在壳里能出字（证明 cookie 走通，因为 `EventSource` 只能带 cookie）
- [ ] 连按返回键不崩、不误退出

**验证**：真机一台安卓（无则用模拟器，但 `Cleartext` 与通知权限要在真机确认）。

---

### PR-2 · 壳的骨架：iOS 可编译可加载

新增：
```
mobile/ios/project.yml                    xcodegen（与参照项目一致，pbxproj 生成物不入库）
mobile/ios/PINextMobile/Info.plist        ATS NSAllowsLocalNetworking、NSLocalNetworkUsageDescription、
                                          CADisableMinimumFrameDurationOnPhone、UIRequiresFullScreen、
                                          CFBundleURLTypes = piweb://、UIViewControllerBasedStatusBarAppearance
mobile/ios/PINextMobile/ContentView.swift ~50 行：UIViewRepresentable 包 WKWebView
mobile/ios/PINextMobile/PINextMobileApp.swift  @main
```

`ContentView.swift` 关键点（全部来自参照项目踩坑）：
```swift
webView.scrollView.bounces = false                        // 别和 PwaPullToRefresh 抢
webView.allowsBackForwardNavigationGestures = false       // 左缘返回交给 App 自己
webView.configuration.websiteDataStore = .default()      // cookie 持久化（D4）
// 全屏铺开，否则 SwiftUI 会把 representable 内缩到安全区里、Compose 看着像 letterbox
```
`Info.plist` 用 `NSAllowsLocalNetworking` 而不是 `NSAllowsArbitraryLoads`。

**DoD**
- [ ] `xcodegen generate && xcodebuild -sdk iphonesimulator` 通过（先不签名）
- [ ] 模拟器/真机能加载 `/pair`，cookie 在**杀进程重启后仍在**
- [ ] 刘海屏下顶栏不被状态栏压住，`env(safe-area-inset-top)` 生效

**先定的事（PR-1 就要问用户）**：Apple 开发者账号。
免费 Personal Team = **每 7 天重签**，装一次要手动 `devicectl` 装（参照项目 `ios-build.md` 记了整套流程）；
$99/年 = 一年有效、可 TestFlight。**这决定 iOS 的发版故事，不决定能不能做。**

---

### PR-3 · 壳内禁用 Service Worker（**可先于壳落地，纯 Web 改动**）

改：
```
components/PwaRegistration.tsx     加守卫 + 反注册
lib/mobile-shell.ts                新增
app/manifest.ts                    theme_color 与 layout.tsx viewport 对齐；补 maskable 图标与 apple-touch 条目
```

`PwaRegistration` 的守卫形状：
```ts
if (isMobileShell()) { void unregisterAllServiceWorkers(); return; }   // 壳里没有离线需求
```

**DoD**
- [ ] 壳里 `navigator.serviceWorker.getRegistrations()` 返回空
- [ ] 桌面上 prod 行为**完全不变**（现有 `public/sw.test.mjs` 仍绿）
- [ ] 新增一条测试：注入 `window.piWebMobile` 后 `PwaRegistration` 不注册

**为什么单独一个 PR**：它一行不依赖原生代码、桌面端零行为变化、却挡掉了壳化后最难查的一类 bug
（改了代码 App 里没变）。先合，早受益。

---

### PR-4 · 壳内连接流程：服务器地址 + 失效回显

改 `app/pair/page.tsx`（已是免鉴权页，逻辑很短，只加不重写）：
- 「服务器地址」输入（scheme + host + port），存 `localStorage`（壳的默认数据存储会持久化）
- 进页时若已有地址 + 已配对（`GET /api/lan/access` 返回 `enabled:true` 且请求不带 401）→ 直接 `location.replace("/")`
- 桌面「生成 6 位码」旁给一个 `piweb://pair/<code>` 深链（PR-7 的深度链接格式在此定稿）
- cookie 失效（Mac 换 IP）时的原因回显：壳首屏 `GET /` 得 401 → 拼 `?reason=lan` 跳 `/pair`
- **不要**新增任何鉴权代码：现有 `POST /api/lan/pair/redeem` 已是唯一免 token 写路径，且自带 30 次/5 分钟节流

**DoD**
- [ ] 首次：填地址 → 输码 → 进 `/`
- [ ] 二次启动：不重新输入，自动进 `/`
- [ ] 模拟 cookie 失效：提示「服务器地址可能已变，请重新配对」而不是白屏 401
- [ ] LAN 没开（`redeem` 409）时，提示用户去桌面「手机与推送 → 启动」

---

### PR-5 · 原生本地通知（桥 + 三层链的第一层）

新增：
```
mobile/android/.../NotifyModule.java         NotificationChannel + POST_NOTIFICATIONS 请求 + PendingIntent 回会话
mobile/ios/PINextMobile/Notify.swift        UNUserNotificationCenter + 点击回会话
lib/mobile-shell.ts                          探测 window.piWebMobile.notify / .onOpenSession
```
改：
```
lib/browser-notifications.ts   getBrowserEnvironment() 里加一支 nativeNotify（现有 Electron 那支的同构复制，~5 行）
electron/preload.js 不动
public/sw.js 不动（壳里没有 SW）
```

要点：
- 通知**只在 App 进程活着时**发（D2 的天花板）。参照项目的 `AgentForegroundService` 是为了延长这个窗口；
  我们先不做前台服务，把「App 在后台但没被系统回收」当作可接受场景，**并在通知文案里不承诺更多**。
- Android 13+ 要运行时请求 `POST_NOTIFICATIONS`，壳首启问一次；拒绝后设置里还能再开。
- iOS 首次 `UNUserNotificationCenter.requestAuthorization`。
- 点击通知 → `piweb://session/<id>` → 壳 `evaluateJavascript` 调 `window.piWebMobile.onOpenSession(id)` → AppShell 切到该会话。
- 渠道分两个：LOW「正在运行」、DEFAULT「已完成」，与参照项目一致。

**DoD**
- [ ] 会话跑完且 App 在后台 → 出现本 App 名下的通知（不是 Chrome 品牌）
- [ ] 点通知 → 直接落到那个会话的转录底部
- [ ] 桌面端通知行为不变（`lib/browser-notifications.test.mjs` 仍绿）
- [ ] 新增测试：桥存在时 `showBrowserNotification` 走 `native` 且**不**碰 `Notification` 构造器

---

### PR-6 · 系统返回键（Android Back / iOS 无）

新增 `hooks/useNativeBack.ts`：`push(handler) → unregister` 的注册表 + `popNativeBackStack()`。
改 `components/AppShell.tsx`：面板/弹层打开时注册处理器，`popstate` 也接到同一个栈
（当前仓库 `popstate` 处理为零，`docs/pi-mobile-layout-plan-2026-10-03.md` §5 已把它记为「未做」）。

行为约定（三态）：
1. 有面板可关 → 关面板
2. 在 `/pair` → 不处理（交系统）
3. 都没得做 → 退到后台（第二次按才退出，参照常见 App 行为）

交互冲突处理：`components/pwa/MobileGestures.tsx` 的左缘滑动返回与 Android 系统手势重叠，
Android 侧关掉系统手势（由壳负责，见 PR-1）；Web 侧保留自绘手势。

**DoD**
- [ ] 开设置弹层 → 返回关弹层；会话里开右侧面板 → 返回关面板；都不开 → 退出到后台
- [ ] 桌面 `useKeyboardShortcuts` 与浏览器 `popstate` 不受影响

---

### PR-7 · 深度链接（桌面发码 / 通知点击 → 壳内跳会话）

- `piweb://pair?code=123456` 与 `piweb://session/<id>`
- Android：`AndroidManifest` 的 `intent-filter` + `onNewIntent`（`singleTop`）
- iOS：`CFBundleURLTypes` + `scene(_:openURLContexts:)` / `onOpenURL`
- 两侧都已有 `postMessage` 通道可用，`evaluateJavascript` 调 AppShell 的现成切会话逻辑

**DoD**：桌面点「复制配对链接」得到 `piweb://…`，粘贴到手机壳能直接进配对；
通知点击落到对应会话。

---

### PR-8 · 打包与发版

- 图标：复用 `build/icon.png`（256 起）→ Android mipmap 全密度 + iOS AppIcon 全尺寸（含 maskable）
- `package.json` 加 `mobile:android:debug|release`、`mobile:ios:run`、`mobile:ios:ipa`
- CI（`.github/workflows/mobile-android.yml`）：JDK 17 → `assembleDebug` → 上传 APK
  （iOS 只能本机构建，参照项目也没有 iOS CI，照此办）
- `AGENTS.md` 加一节「移动端壳」，写清 D1–D6 六条决策与「不抄 PiRemote 的清单」
- `DIVERGENCE.md` 记一条：图标不用 lucide 而用品牌 PNG（与现有渠道 logo 那条例外同级）

**DoD**：`npm run mobile:android:release` 出可安装包；iOS 模拟器可 `xcodebuild` 归档；
README 有一段手机使用说明（含 D4 的前置条件：先在桌面启动 LAN）。

---

### 可选 PR-9 · 后台保活（只在真的需要时做）

参照项目 Android 侧的 `AgentForegroundService`（163 行，`onCreate` 里就 `startForeground`、
失败吞掉并 `stopSelf`）+ iOS 侧的 `ON_START` 重连补齐。**只在真的收到「App 切后台就收不到完成通知」的反馈时做**，
且只在 Android 做；iOS 无解（除非接 APNs，即 D2 明确排除）。

### 可选 PR-10 · 真·远端访问（只在需要时做）

不要自己发明隧道。本仓已有三条现成的路：
① `lib/im-bridge.ts` 的 `im_send`（任意外网通知，**推荐先试这个**）
② 部署到公网 + 反向代理 + TLS（本仓的 `docs/zcode-port` 一类做法）
③ Tailscale / WireGuard（零代码）

---

## 6. 风险登记

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 免费 Apple ID 7 天过期 | iOS 每周重签 | 先确认账号；或先只发 Android |
| iOS 需要现代 Xcode + 真机 | 无法在 CI 验证 | 模拟器先过，真机后补；照抄参照项目 `ios-build.md` 的 JDK/Xcode 探测链 |
| Android WebView 的 `env(safe-area-inset-*)` 老版本为 0 | 刘海屏下顶栏被压 | D5 已选「不 edge-to-edge」，现有 CSS 全带 0px 兜底 → 无需改动 |
| 壳内 SW 缓存旧壳 | 「改了没生效」 | PR-3 守卫 |
| cookie host-only 绑 IP | Mac 换地址要重配对 | PR-4 的地址记忆 + 失效回显 |
| 系统返回键与自绘手势打架 | 手势错乱 | PR-6 + PR-1 关掉系统左缘手势 |
| App 被杀后无通知 | 用户预期落差 | 通知文案不承诺；推 IM 桥（可选 PR-10 ①） |
| WebView 版本差异（各家 ROM） | 渲染差异 | 只用 Android System WebView；不注入任何实验特性 |

---

## 7. 建议的落地顺序

```
PR-3（Web，零风险，先合）
  → PR-1（Android，能用就算成功一半）
    → PR-4（连接流程，两端共用）
      → PR-5（通知，最大的体验增量）
        → PR-2（iOS）
          → PR-6 / PR-7 / PR-8
```
理由：**Android 跑通就能验证全部 Web 侧决策**（cookie、SSE、SW 守卫、手势）。iOS 侧除了编译与安全区，
没有新的未知量，所以把它排在能验证之后而不是之前。