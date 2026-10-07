# PI NEXT 手机壳（Capacitor）

独立子项目：与主仓的 package.json / 构建图**无关**。WebView 加载电脑上跑着的
PI NEXT Web 应用（局域网 / Tailscale 地址），配套的镜像同步、通知、安全区都在壳里。

形态与决策见 `docs/mobile-shell-plan-2026-10-05.md`（D1–D6）；远程地址设置见
`docs/mobile-remote-setup.md`。

## 构建

```bash
cd mobile
npm install

# Mode A（推荐）：把稳定地址打进包里（Tailscale IP，配对一次永久有效）
PINEXT_SERVER_URL=http://100.x.y.z:30141 npx cap sync android
./android/gradlew -p android assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
#      分发用的那一份另拷一份叫「PI NEXT.apk」（CI 也是这么出的）
#      → adb install -r "PI NEXT.apk"

# Mode B：不设 PINEXT_SERVER_URL，壳先开跳板页，首次输入/扫码确定地址
npx cap sync android
```

调试：`adb install -r` 装上后，电脑 Chrome 打开 `chrome://inspect` 直连壳内 WebView
（`webContentsDebuggingEnabled: true`，出正式包时在 capacitor.config.ts 关掉）。

## 结构

```
capacitor.config.ts   壳配置（appId sh.pinext.mobile，errorPath → webDir/error.html）
webDir/               壳本地资产：跳板页（index.html）、断网重试页（error.html）、vendor/jsQR.js
android/              cap add android 生成 + 手写定制（MainActivity/InsetsPlugin）
```

## 手写定制的安卓代码（都是 MusePi 实测过的坑）

- `MainActivity.java`：`registerPlugin(InsetsPlugin.class)` 必须在 `super.onCreate()`
  **之前**（bridge 在 super 里构建）；edge-to-edge 在 onCreate 与
  `onWindowFocusChanged` **两处**断言（Android 12+ SplashScreen 会恢复 decor-fit）。
- `InsetsPlugin.java`：Android WebView 不通过 `env(safe-area-inset-*)` 暴露系统栏
  insets（三份独立证据），由它读真实值换算 dp，JS 侧写进 `--safe-top/--safe-bottom`。
- `AndroidManifest.xml`：`usesCleartextTraffic`（目标是 http://100.x）、`CAMERA`（扫码）。

## iOS

见批次 8：`npx cap add ios`，免费 Apple ID 自签，7 天重签，
流程记在 `docs/ios-free-signing.md`。
