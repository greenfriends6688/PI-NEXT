# iOS 免费自签安装指南（fork:mobile-shell）

> 路线：**免费 Apple ID + Xcode 本机自签**。签名 7 天有效，过期后连 Mac 重签一次。
> 想要 1 年有效 / TestFlight，需要 $99/年 的付费开发者账号（Ad Hoc 路线，另行文档）。

## 前置（一次性）

1. **装完整 Xcode**（App Store 或 developer.apple.com，约 12GB）：
   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   xcodebuild -version   # 必须输出版本号；报 CommandLineTools 错 = 还没切过来
   ```
2. iPhone 用数据线连 Mac，iOS 上「设置 → 隐私与安全性 → 开发者模式」打开。
3. Xcode → Settings → Accounts → 登录你的 Apple ID（免费 Personal Team）。

## 打包安装

```bash
cd mobile
npm install
npx cap sync ios        # 把 webDir 与插件同步进 ios/ 工程
open ios/App/App.xcodeproj
```

在 Xcode 里：

1. 左侧选 **App** target → **Signing & Capabilities**：
   - Team 选你的 Personal Team；
   - Bundle Identifier 改成唯一值（如 `sh.pinext.<你的名字>`）——免费账号的
     `sh.pinext.mobile` 这类通用值会因别人用过而失败，改一个就好。
     ⚠️ 改的是**本地调试用** id；要与安卓端统一的话，直接改
     `capacitor.config.ts` 的 `appId` 后重新 `npx cap sync ios`。
2. 顶部选你的 iPhone 设备 → ▶ Run。
   首次真机运行：Xcode 会自动创建免费 profile；手机上若弹「不受信任的开发者」，
   到 设置 → VPN 与设备管理 → 信任你的证书。

## 7 天重签

签名 7 天后 App 打不开：**数据线连 Mac，Xcode 里再按一次 ▶**（约 1 分钟）。
App 数据（配对 cookie、镜像库、localStorage）在重签后保留——只要 bundle id 不变。

## 常见问题

- **冷启动白屏 / 连不上**：目标是 `http://100.x` 时依赖 `NSAllowsLocalNetworking` +
  `NSLocalNetworkUsageDescription`（Info.plist 已带）。改用 https 稳定域名后可删。
- **下拉刷新打架**：WKWebView 的 bounce 与 PWA 自绘下拉手势如果真机实测冲突，在
  `ios/App/App/AppDelegate.swift` 里把 WebView 的 `scrollView.bounces` 关掉
  （Capacitor 无此配置项，需要一行子类定制——留到真机验证时做）。
- **键盘弹出滞后**：Capacitor 的原生 resize 在键盘动画结束后才生效；本应用已用
  `hooks/useViewportHeight.ts`（visualViewport）自己跟高度，真机若发现双重位移，
  在 `capacitor.config.ts` 加 Keyboard 插件并设 `resize: "none"`（安卓侧同）。
- **证书 7 天过期 vs 数据**：只要不换 Bundle Identifier，重签不清数据。
