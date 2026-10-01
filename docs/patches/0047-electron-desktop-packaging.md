# 0047 · Electron 桌面打包（DMG / NSIS + 原生桥 + 打包硬门禁）

| 项 | 值 |
| --- | --- |
| 意图 | 把 fork 打成可双击的桌面应用：稳定端口、窗口隐藏时也能响的原生通知、Dock 角标、防息屏、可拖拽标题栏；并给打包过程加一道「产物里必须真的有运行时依赖」的门禁 |
| 参照实现 | 上游 v0.9.1 自带的 Electron 目标（`aeffa53`），本 fork 剔除后按自己的产品定位重建 |
| fork 标记 | `fork:desktop-shell`、`fork:desktop-stable-port`、`fork:desktop-win`、`fork:close-to-tray`、`fork:fix-desktop-blocked-nav` |
| 新增文件 | `electron/preload.js`、`electron/legacy-user-data.js`(+`.test.mjs`)、`lib/desktop-shell.ts` |
| 重建文件 | `electron/main.js`、`scripts/after-pack.mjs`、`scripts/gen-icons.mjs` |
| 上游文件接触面 | `package.json`（6 条 `desktop*` 脚本 + `productName` + `main` + 整块 `build` 配置 + 3 个依赖）、`.gitignore`（`!/build/` 取反规则）、`eslint.config.mjs`、`components/AppShell.tsx`（4 处）、`lib/browser-notifications.ts`、`components/SessionSidebar.tsx`、`components/SettingsPanel.tsx`、`components/ChatInput.tsx`、`lib/push-client.ts`、`app/layout.tsx`、`app/manifest.ts`、三个 i18n |
| `.patch` | 无（`.patch` 只在能拿到「改前基线」时产出；本条的改前是**上游自己的 electron/**，与 0001–0019 的 staged-baseline 体系不兼容，重打时以 `fork:` 标记 + 本文件为准） |

## 核实（不是照抄审计报告）

```
$ git log --oneline -- electron/
6bd923f chore: drop upstream Electron desktop target      ← 本 fork 剔除上游的
fd8b5d8 build(desktop): DMG packaging config with size pruning   ← 重建
d4f3f78 feat(desktop): macOS 原生适配 …                     ← preload + desktop-shell
186116d build(desktop): 打包硬门禁 + dmg/zip target + 冒烟脚本
22fa16a release: Pinkslab v0.1.4                          ← legacy-user-data
$ git log --diff-filter=A --format=%h -- electron/preload.js lib/desktop-shell.ts
d4f3f78   （两者同为 d4f3f78 首次落盘）
$ git cat-file -e agegr/main:electron/main.js   → absent
$ git show agegr/main:package.json | grep desktop  → 0 命中
```

**上游 `agegr/main`（`e17d2cc`，2026-10-01）当前完全没有 electron/ 目录，也没有任何 `desktop*` 脚本。**
所以本条是「上游从来没有过的东西」，不是「我们改过的上游东西」——但冲突面恰恰在于它落在
`package.json` / `.gitignore` / 构建脚本这三个**上游一定会动**的文件上。

## 三个必须记住的历史坑

1. **剔除再重建，不是一次性搬进来。** 上游 v0.9.1 给了 `electron/main.js` + `scripts/after-pack.mjs`
   + `build/` 图标；`6bd923f` 把它们连同 `package.json` 的 `productName`/`main`/`build` 块、
   `electron`/`electron-builder`/`@resvg/resvg-js` 依赖全删了（delta.md:349 有流水记录）。
   `fd8b5d8` 才按 DMG 目标重新放回来。**审计报告说「当前形态没有可 revert 的条目」是对的**：
   delta.md 只记了「删掉」和「§30 macOS 原生适配」两段流水，没有一条能整体回退的条目。
2. **`after-pack.mjs` 的存在理由是 Turbopack 的符号链接。** `next build` 把
   `serverExternalPackages`（undici / pi SDK / node-pty）外部化成 `.next/node_modules/<pkg>-<hash>`
   符号链接，electron-builder 既不跟符号链接、也默认过滤嵌套 `node_modules`。该脚本把它们
   **解引用成真实副本**再注入产物，并且**必须同时处理 darwin 与 win32/linux 两种布局**
   （早期只写了 macOS 的 `Contents/Resources` 路径，Windows 上文件被拷进一个没人用的目录 ——
   `cpSync` 会自建目录所以不报错，表现是打包后 `/api/terminal`、SSE、会话接口半残）。
3. **`.gitignore` 里 `/build` 与 `!/build/` 是一对。** `.gitignore:22` 忽略 `/build`，
   `:64-65` 用 `!/build/` + `!/build/*.png` 取反，因为 `build` 是 electron-builder 的
   `buildResources` + `extraResources` 引用目录，图标必须进仓库。
   **直接覆盖 `.gitignore` 会让别人的机器上 `npm run desktop:dist` 缺图标。**

## 门禁（`186116d` 加的）

| 脚本 | 作用 |
| --- | --- |
| `scripts/verify-desktop-bundle.mjs` | `desktop:dist` 里的硬门禁：打包前静态校验产物布局与 `.next/node_modules` 那一层是否齐 |
| `scripts/desktop-smoke.mjs` | 起打包产物做冒烟（端口、接口、静态资源） |
| `scripts/gen-icons.mjs` | `desktop:icons`：由 `docs/pi-web-icon.png` 生成 icns/png/trayTemplate |

`desktop:dist` 的顺序是 `build → desktop:verify → electron-builder`，**verify 不过就不进 electron-builder**。

## 能否独立 revert

**能，但要连带三处配置，不能只删文件。** `electron/` + `lib/desktop-shell.ts` 是纯新增，删掉后
Web 端照常跑（`lib/desktop-shell.ts` 里所有桥调用都做了存在性守卫，「桥不存在」就是可靠的
「不在桌面壳里」判定）。但 revert 必须同时：

1. 删 `package.json` 的 6 条 `desktop*` 脚本 + `productName` + `main` + 整块 `build` 配置
   + `electron` / `electron-builder` 两个 devDep；
2. 删 `.gitignore:64-65` 的两条 `!/build/` 取反（否则图标会重新被忽略）；
3. 删 `eslint.config.mjs:25` 的 `files: ["electron/**/*.js"]` 与 `package.json` `test` 脚本里的
   `"electron/**/*.test.mjs"`（留着会 lint 报错 / 匹配不到文件）。

`components/AppShell.tsx` 等上游文件上的改动都是带 `fork:desktop-shell` 标记的**加法**，
按标记整段删即可，不与上游逻辑互斥。

## 验证手段

- 单测 `electron/legacy-user-data.test.mjs`（4 例）：改名后 `userData` 目录要挑最新的仍存在的
  旧目录（`Pinkslab` → `PI NEXT` 的迁移），当前目录已存在则不迁。
- 门禁脚本 `npm run desktop:verify` / `desktop:smoke`（**本条不改脚本，只要求它在**）。
- 真机验收：`npm run desktop`（固定端口 `fork:desktop-stable-port`）、窗口隐藏时原生通知、
  Dock 角标、agent 跑动时防息屏、红绿灯让位后拖拽区可拖。

## 合并上游后怎么重打

```bash
git grep -n "fork:desktop" -- electron lib/desktop-shell.ts components lib
# 三条不变式：
#   1) package.json 的 build 块、.gitignore 的 !/build/ 取反、test 脚本的 electron glob 必须同时在；
#   2) after-pack.mjs 必须覆盖 darwin 与 win32/linux 两种产物布局（只写 macOS 路径在 Windows 上静默半残）；
#   3) lib/desktop-shell.ts 的桥调用必须继续做存在性守卫 —— Web 端不装 electron。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```

> 相关记录：`docs/codex-skin/delta.md:349`（剔除 Electron）与 `:1237`（§30 macOS 原生适配）
> 是**皮肤台账里的流水**，不是本条的可 revert 条目；本文件才是。
