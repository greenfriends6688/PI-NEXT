# app-nsh — PI NEXT（独立 app，agent 在它自己里面）

这里就是 **PI NEXT 本体**：界面用 TSX 写、Rust 运行时渲染（macOS / iOS / Android / Windows /
Linux / Web / Terminal），而 **agent 是它自己的进程** —— 不带地址、不开端口、不连任何本地服务。
双击、打开、用；不装 Node、不装 `@agegr/pi-web`、首次运行不联网。

```
PI NEXT.app/
└── Contents/Resources/nsh/
    ├── bundle.nshc              界面（本目录编译产物）
    ├── node/bin/node            app 自带的 Node 运行时（22.19+）
    └── pi-web/
        ├── host/main.mjs        agent 本体：把 pi 服务跑成 app 的进程
        ├── .next/ public/ bin/  同一份服务端构建（等价于 pi-web）
        └── node_modules/
```

```
界面 (QuickJS)  ──stdin/stdout 一行一条 JSON──▶  host/main.mjs (包内 Node)
                                                      │ 同一进程内的 Next handler
                                                      └── 只监听一个 unix socket（0600，在 app 数据目录）
```

- **没有端口、没有地址**：`127.0.0.1:30142` 在打包 app 里不存在。窗口到 agent 只有一根管道，
  socket 只是 host 内部把它自己的 handler 接起来的接口，别的进程/别的机器都访问不到。
- **应用自己的进程**：`src/api/link.ts` 用包里的 Node 起 `host/main.mjs`，退出时一起收掉。
  `src/api/client.ts` 的 `req()` 和 `sse.ts` 的 `openStream()` 只换了底下的 `fetch`，
  所有 `src/api/*` 与 ~40 个界面都没改。
- **唯一还会用到地址的情况**是开发：`npm run dev` 连本机 `next dev`（那时包里没有 host，
  或者你正在改服务端）。

> **过渡中**：包里的 `node/` + `pi-web/` 是要删掉的。窗口正在学会自己回答 `/api/*`
> （`src/local/`）并直接驱动这台机器的 `pi --mode rpc`，见 [docs/attached.md](docs/attached.md)。
> 搬完一条路由就把 `nsh/node`、`nsh/pi-web` 拿掉，dmg 从 103M 回到 20M 级。

> **为什么不是同一个进程**：pi 的 Agent 是 Node SDK（`@earendil-works/pi-*`、`node-pty`、
> `isomorphic-git`、MCP/OAuth），界面跑在 QuickJS 里，装不进 Node 包。所以"独立 app"是
> **一个安装包 + 一个图标 + 零外部依赖 + agent 由 app 托管**；字面意义上的单进程只能把后端
> 整体重写成 Rust（计划 §1.2 已列为非目标）。

## 通信协议（`host/main.mjs` ⇄ `src/api/link.ts`）

一条 JSON 一行，两个方向都是：

```
→ {"id":1,"path":"/api/sessions","method":"GET","headers":{}}
← {"id":1,"status":200,"headers":{},"body":"…","bodyEncoding":"utf8"|"base64"}
← {"id":2,"stream":"open","status":200} / {"id":2,"chunk":"…"} / {"id":2,"stream":"end"}
→ {"id":2,"cancel":true}
← {"event":"ready"} / {"event":"log","text":"…"} / {"event":"failed","message":"…"}
```

上传（`FormData`）在窗口侧编成 multipart 再 base64，host 原样转发；下载按 `content-type`
决定是否 base64。SSE 的解析与重连仍在 `sse.ts`（纯模块，可单独测），host 只转发字节。

## 怎么跑

```bash
cd app-nsh

npm run dev                  # 开发：起仓库的 next dev（已在跑就复用），再 nsh run
nsh check                    # 类型检查（.nsh/types 由 nsh 自己生成）
nsh run --target macos       # 只跑界面（有 host 负载时同样走管道）
nsh test                     # headless 冒烟

npm run package:macos        # 打包 .app（内含 node + host + 服务），并自检产物
npm run dist:mac             # 打成 dmg（= package:macos + hdiutil）
```

`npm run package:macos` 做四件事：`nsh package` → `scripts/bundle-server.mjs` 放服务与 host →
`scripts/embed-node.mjs` 放 Node → `scripts/bundle-app.mjs` 自检：文件齐不齐，**并且真的用包里的
Node 把 host 起起来、问一次 `/api/sessions`**（少一个模块就会像 500 那样只在窗口里炸，文件检查看不出来）。
服务端源码来自本仓库根目录，打包前先在那里 `npm run build`。

本地想验证整条链路又不想打包时：把产物里的 `node/`、`pi-web/` 克隆到本目录（`.gitignore` 已忽略），
`nsh run` 就会走和安装包完全一样的路径。

`.nsh/`（生成的 `types/`、`tsconfig.json`、bundle）和 `target/` 不入库。

## 机器上的 pi（版本 / 更新）

设置 › 通用 最下面那张卡是**这台机器装的 `pi` CLI 本身**（`src/pi/install.ts`、
`src/pi/updates.ts`），跟包里的 pi-web 不是一件事：

- **找法**与 pi-gpui 一样：`PI_EXECUTABLE`，否则问登录 shell 的 `command -v pi`。Finder
  启动的窗口拿不到 `~/.local/bin`、nvm、fnm 那些 PATH，只有 shell 的 rc 文件知道；
- **版本**读 `pi --version`，判 `1.4.0 ≤ pi < 2.0`：更新的次要版本照跑，标一句“未测试”；
- **更新**先 `curl` npm registry 的 `latest` 比一下，点「更新 pi」才真的跑 `pi update`
  （pi 自己的更新命令），最后一行输出留在卡里。

因此 `nsh.json` 的 `capabilities.process` 多了 `pi`、`/bin/zsh`、`/bin/bash` 与 `SHELL`、
`PI_EXECUTABLE`：一条 shell 授权就等价于任意命令，和已经授过的 `node` 同级。子进程的 cwd
只能是 `${dataDir}`（`capabilities.fs.write` 唯一根），所以第一次运行先把它建出来。

Windows 还没接：那边 `pi` 是 `pi.cmd`，要找 `where pi` 并用 `cmd /c` 起（`loginShell()` 的注释）。

第一次 `nsh check` 之前，编辑器里 `nsh` / `nsh/base` 的导入会报找不到模块：
`.nsh/types` 由 `nsh init` / `nsh check` / `nsh run` 生成，`tsconfig.json` 只是 extends 它。

## 目录

```
app-nsh/
├── nsh.json                 # 应用清单：id/appearance/theme/locales/schemes + capabilities（§11）
├── theme.json               # pi token → shadcn/NSH token（§6.1），light + dark
├── tsconfig.json            # extends ./.nsh/tsconfig.json
├── App.tsx                  # mount(App)：根 View + Shell
├── host/main.mjs            # agent 入口：Next handler + unix socket + stdio 协议
├── scripts/
│   ├── dev.mjs              # npm run dev：仓库 dev server + nsh run
│   ├── bundle-server.mjs    # 把根目录的 .next 与 host/ 放进 nsh/pi-web（含裁剪）
│   ├── embed-node.mjs       # 把 Node 运行时放进 nsh/node（含版本校验）
│   ├── bundle-app.mjs       # 上面两步 + 管道冒烟（package:macos 调用它）
│   └── verify-lib.mjs       # 搬迁过来的纯 TS 模块验证
└── src/
    ├── api/
    │   ├── link.ts          # 到 agent 的管道：起进程、JSON-RPC、fetch/流适配
    │   └── …                # 线格式客户端：sessions.ts / client.ts / sse.ts …
    ├── lib/app-bundle.ts    # 负载在哪、用哪个 node 起
    ├── pi/
    │   ├── install.ts       # 这台机器的 pi：登录 shell 找可执行文件、版本、兼容区间
    │   └── updates.ts       # npm registry 的 latest、`pi update` 的流式输出
    ├── state/               # 全局信号与 store；server-process.ts 是 agent 生命周期
    ├── ui/
    │   ├── colors.ts        # 语义颜色（canvas 取色，走 token()）
    │   └── icons/
    │       ├── lucide.ts    # 生成的 Lucide 表（从 nsh gallery 原样复制，勿手改）
    │       └── drawer.tsx   # Canvas 绘制器：Icon({ name, size, tint? })
    └── screens/
        ├── Shell.tsx        # 三栏外壳
        ├── Connection.tsx   # 服务还没应答时的卡片（失败原因 + 日志 + 重试）
        └── sidebar/
            └── SessionsPanel.tsx   # listSessions() → <Scroll> + <Each>
```

`src/api/`、`src/lib/`、`src/state/` 由其他模块负责；本目录按
`src/api/sessions.ts` 的契约 import，不创建它们。

## NSH 心智 6 条（计划 §9，团队必读）

1. **组件体只跑一次**。任何“随状态变化”的东西必须写成 JSX 绑定：`<Text>{count()}</Text>`，
   而不是 `if (state) …` 放在体内。
2. 条件渲染用 `<If when={...} else={...}>`，列表用 `<Each of={...} key={...}>`（`If`/`Each` 是全局，不用 import）。
3. 每次读信号都要在**渲染期**（绑定 / `If` / `Each` / `effect` 内），否则不追踪。
4. `effect` 里创建的定时器 / 订阅必须 `cleanup()` 回收。
5. 大列表：`List each` + `estimatedItemSize`；不要一次 `Each` 上万行。
6. 字符串大对象（会话 JSON）解析后只保留 `List` 需要的投影，避免 200k 节点配额。

## P0 尚未包含（后续阶段补）

- `assets/`（`icon.png`、`fonts/*.ttf`、`qr-*.png`）：所以 `nsh.json` 里
  **没有** `icon` 键（计划 §11 草案里有；没有文件时写它会让 `nsh build` 报缺资源）。
  `sounds/ready.wav`、`sounds/attention.wav` 已有（gallery 的 cuelume 提示音，MIT），
  `App.tsx` 用 `loadSounds()` 载入：一轮跑完的提示音由此而来。
- `nsh.json` 的 `tailwind` 块（§6.1 末尾要从 `app/globals.css` 迁 color/radius/字号）：
  P0 只用 `theme.json` 的 token，先不写 `tailwind`。
- `src/i18n/` 与 `locales/`：`nsh.json` 已声明 `locales`，翻译文件 P1 搬。
- `App.test.tsx`（`nsh test` 冒烟，计划 §3）、`src/api/*`、`src/state/*`、聊天窗口（P2）。

## 本目录的约束

- **每个 NSH API 都必须能从 `../重构/nsh-main` 的示例或文档里抄到**。不确定的地方写
  `// TODO(nsh): verify`，并记进 `SPIKES.md`。
- 样式只用 `nsh-main/docs/dev/styles.md` 明确支持的 class / token。禁止 `peer-*`、`order-*`、
  伪元素、`transform-3d`、`snap-*`；不确定就写内联 `style={{}}`。
- 颜色只能是 `theme.json` 的 token：class（`bg-card`、`text-muted-foreground`）或 `token("card")`，
  不写裸 `#hex` / `bg-[#…]` / `bg-blue-500`。

## 出处（每个 NSH API 的来处）

| 用法 | 出处 |
| --- | --- |
| `mount(App)`，`View` 作根，`class="flex-1 bg-background"` | `examples/tasks/App.tsx:1-25` |
| `tsconfig.json` 只 extends `.nsh/tsconfig.json` | `examples/tasks/tsconfig.json:1-4` |
| `nsh.json` 的 `name`/`id`/`theme`/`appearance`/`schemes`/`window`/`capabilities` 形状 | `examples/gallery/nsh.json:1-81` |
| `capabilities` 键名（`windows`/`audio`/`application`/`homeDir`/…）与 `network.http` 的 `host`/`port`/`schemes` | `crates/nsh-core/src/access.rs:1151-1165, 1195-1248, 1898-1987` |
| `android.usesCleartextTraffic` | `crates/nsh-cli/src/package.rs:250-258`，`crates/nsh-cli/src/android.rs:205-207` |
| theme.json 的 `cssVars` / `theme` / `light` / `dark`，`var(--x)`、`radius-card` 自定义 token | `docs/dev/components.md:768-790`，`examples/nsh-gallery-ui/theme.json:1-132` |
| `token(name)` 取 token（canvas 颜色、响应主题/外观） | `docs/dev/components.md:780-790`，`examples/nsh-gallery-ui/theme.ts:97-108` |
| `<Scroll class="flex-1">` | `examples/gallery/App.tsx:212-216` |
| `<Each of={…} key={…}>`，行是 accessor（`session().id`） | `skills/nsh/references/tsx.md` "If, Each, List" |
| `<If when={…} else={…}>` + 函数子节点拿 accessor | 同上 |
| `classList={{ … }}` 做状态样式 | `skills/nsh/references/tsx.md` "Styling: class and tokens" |
| `resource(fetcher)` 无 source 只加载一次；`error()` / `state()` / `()` | `crates/nsh-js/src/modules.rs:172-184, 305-352`，`skills/nsh/references/tsx.md` "resource, and stale results" |
| `Canvas` + `draw={(cx, { width }) => …}`、`Path2D` | `docs/dev/canvas.md:3-10`，`examples/gallery/icons.tsx:21-80` |
| `JSX.Element` 收 number（`<Text>{n}</Text>`） | `crates/nsh-js/src/declarations.rs:207-217` |
| `CanvasRenderingContext2D` 类型 | `examples/gallery/icons.tsx:3` |
| 模块级 `signal` 作 store | `skills/nsh/references/tsx.md` "Signals and writes" |
| 禁止的 class（`peer-*`/`order-*`/伪元素/`transform-3d`/`snap-*`） | `docs/dev/styles.md:124-132` |
