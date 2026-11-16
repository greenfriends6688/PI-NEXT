# 原生视图（NativeScript 桥）

用 [nstudio/native-shell-with-ns](https://github.com/nstudio/native-shell-with-ns) 把 **NativeScript** 装进 NSH 的
JS VM：于是 TSX 里可以直接用 **AppKit / UIKit / Android** 的类，把**各平台自己的控件**放进 NSH 的布局。

```
TSX  ──nsh 布局/信号──▶  NativeView（ns.view 容器）  ──▶  平台自己的视图
                                                        macOS: NSSlider / NSSwitch / NSButton …
                                                        iOS:   UISlider / UISwitch …
                                                        Android: SeekBar / Switch …
```

同一个组件、同一份 TSX，长出来的是各平台**原生**的控件（不是 NSH 自绘的仿制品）。

## 两个运行器（重要）

| 运行器 | 命令 | 有桥吗 | 用途 |
|---|---|---|---|
| **nsh 自带 host** | `nsh run --target macos` | ❌ | 日常开发：快、热更新、`nsh test` 都能用 |
| **nsh-ns（本仓自编）** | `nsh-ns .nsh/out/bundle.js` | ✅ | 要看**原生视图**时用它 |

应用里有检测：`nativeAvailable()`（`src/screens/native/NativeView.tsx`）。桥不在时
设置 › Native 显示「此构建未包含（用 nsh-ns 运行）」，并退回 NSH 滑块/开关 —— 同一个数值、同一套交互，
所以两种运行器都能跑，不会出现白屏或崩。

## 怎么构建并运行（macOS，已在本机验证）

```bash
# 1) 取 NativeScript 的 macOS 框架（一次即可，约 8 MB）
mkdir -p /tmp/ns && cd /tmp/ns
npm pack @nativescript/macos-node-api@0.5.0-beta.0 --silent --ignore-scripts >/dev/null
tar xzf *.tgz && ls package/build/RelWithDebInfo/NativeScript.apple.node/macos-arm64/NativeScript.framework

# 2) 编带桥的运行器（本仓的 crates/nsh-ns，已打好三个钩子）
cd 重构/nsh-main
RUSTUP_TOOLCHAIN=stable cargo build -p nsh-ns --release      # 产物 target/release/nsh-ns

# 3) 打应用 bundle（用本仓的 nsh CLI）
cd ../../app-nsh && nsh build

# 4) 用桥运行
NSH_NS_FRAMEWORK=/tmp/ns/package/build/RelWithDebInfo/NativeScript.apple.node/macos-arm64/NativeScript.framework/Versions/A/NativeScript \
  ../重构/nsh-main/target/release/nsh-ns .nsh/out/bundle.js
```

打开 **设置 › Native**：滑块/开关就是 AppKit 的 `NSSlider`、`NSSwitch`。

## 对 NSH 的三个钩子（已打进 `重构/nsh-main`）

上游 NSH 需要三处小改动（对应对方仓库的 `patches/nsh-hooks.patch`）：

| 位置 | 钩子 | 作用 |
|---|---|---|
| `crates/nsh-engine/src/lib.rs` | `run_on_engine(Box<dyn FnOnce()+Send>) -> bool` + `Message::Run` | 把「必须在引擎线程/主线程跑的代码」排队进去 |
| `crates/nsh-js/src/lib.rs` | `set_context_hook(fn(*mut c_void))` | 每个新 VM 建好后、加固冻结全局前，把 NativeScript 装进去 |
| `crates/nsh-js/src/host.rs` | `Host::drop` 里 `mem::forget(runtime)`（有钩子时） | 钩子可能长期持有 VM 对象，否则 `JS_FreeRuntime` 会 abort |

外加 `crates/nsh-ns`（桥本体 + `c/` 里的 Node-API / baton C 源）作为 workspace 成员。
`crates/nsh-ns/Cargo.toml` 里的路径已从对方的 `../../vendor/nsh/...` 改成我们的 `../...`。

## 我们还额外修了 macOS 13

桥运行器用的是 NSH 的平台层，而 0.4.0/0.5.x 都用了 **macOS 14 才有的 API**：`NSApplication.activate()` 与
`NSView.displayLink(target:selector:)`。这台机器是 **macOS 13.7.8**，所以把同一套补丁也打进了桥用的那棵树
（`crates/nsh-platform-macos/src/{app,window,surface}.rs`，见 `重构/nsh-macos13-patch.md`）：
`activate()` 走 `respondsToSelector` 回退到 `activateIgnoringOtherApps:`，帧时钟回退到 60 Hz `NSTimer`。

## 验证记录（2026-11-15，macOS 13.7.8 / Apple Silicon）

| 检查 | 结果 |
|---|---|
| `nsh-ns` 跑对方 showcase | ✅ 窗口起来；`MKMapView` 报 “no native counterpart”（对方示例的 MapKit 类型，不影响滑杆/托盘） |
| 探针（TSX 里建 AppKit 控件） | ✅ `NSSlider=true value=42 os=Version 13.7.8 NSValue=function` |
| 我们的应用跑在 `nsh-ns` 下 | ✅ 无 JS 错误，到 pi-web 2 条连接 |
| 我们的应用跑在 `nsh run` 下 | ✅ 设置 › Native 显示“未包含桥”并退回 NSH 控件 |

## 为什么 iOS / Android 这里没跑

本机没有 Xcode（只有 Command Line Tools）、没有 Android SDK、没装移动端 Rust target，所以：

```bash
# 需要 Xcode 15+ / Android SDK + 模拟器
nsh package app-nsh --target ios --sign …       # 或用对方仓库的 scripts/ios-sim.sh / android-run.sh
nsh package app-nsh --target android --keystore …
```

代码侧已经按平台分好（`NativeView.tsx`）：

- **macOS**：`NSSlider` / `NSSwitch`，`target/action` 回调写回信号（已验证）
- **iOS**：`UISlider` / `UISwitch`，`addTarget:action:forControlEvents:`（`valueChanged`）
- **Android**：`android.widget.SeekBar` / `Switch`，`setOnSeekBarChangeListener` / `setOnCheckedChangeListener`

容器挂载也按平台分支（`attach()`）：macOS/iOS 用 `NSValue` 拿宿主的 `NSView`/`UIView` 指针并 `addSubview`；
Android 用桥的 `NsBridge.hostView(handle).addView(...)`。这一段直接取自对方仓库的 `apps/showcase/native-view.tsx`。

## 代价与限制

- **体积**：`nsh-ns` 运行器 46 MB（含 NativeScript framework 的加载器；框架自身 7.8 MB 单独分发）。
- **一个 VM 一个进程**：NativeScript 绑定进程里第一个 VM；从零重载（Cmd+R）会重启进程（对方实现如此）。
- **不要用于 `nsh test`**：测试跑在 nsh 自带 host 上，那里没有桥 —— 所以 `nativeAvailable()` 的分支必须两边都能画。
- 只有「调试点」适合桥：业务 UI 继续用 NSH 组件，原生视图只用在 NSH 没有封装的能力上（地图、系统托盘、
  平台独有控件）。
