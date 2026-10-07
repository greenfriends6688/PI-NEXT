# PI NEXT 0.1.9（正式版）

> 0.1.8 之后的 123 个提交：V5 设计体系完整落地（Web 与 PWA 两套形态一次性换完）、
> 设置面重做、手机壳与出门 5G 打通，以及一批真实新增能力（生图、记忆、联网搜索、
> 定时任务、用量）。这一版也从「能跑」变成了「能量」—— 每一处形态修正都带一条
> 画板对位或结构守卫，用户报的每一条都先量再改。

范围：`v0.1.8..HEAD` —— **906 个文件，+122,973 / −22,287 行**，123 个提交。

## 新增

- **V5 设计体系落地（Web · `d-*`）**：画板逐一抄进产品 —— 工作台与新会话、侧栏与顶栏
  （项目树 / 会话三态 / 折叠导轨 / 会话动作 ⋯）、转录全集（过程时间轴、工具卡、代码、
  diff、失败重试、未读分割）、输入框与全部浮层、右栏六面板、文件查看器多模式、
  设置全部分节（弹窗与整页两种宿主）、命令中心、计划卡与队列、系统态与对话框。
- **V5 设计体系落地（PWA · `m-*`）**：手机画板全部落地 —— 会话页与抽屉、手机转录、
  输入卡与能力面板、设置两层（hub → 分节二级页）、商店 / 定时任务 / 用量三个一级页、
  文件与终端（含软键盘键排）、浏览器与命令中心、安装更新信任、手势与系统态、手机右栏六面板。
- **设置面重做**：一列分节（通用 / 模型 / 生图 / 技能 / 子代理 / 插件 / 记忆 / 联网搜索 /
  MCP / 定时任务 / 用量 / 归档 / 导入 / 手机与推送），长分节真的能滚；模型页改成一列
  可点行 + 详情弹窗，砍掉三处重复入口；子代理 / 插件 / MCP / 导入的添加与编辑一律走弹窗。
- **生图模型（`generate_image`）**：独立于对话模型的档案（预设档各有端点 / 密钥 / 模型 /
  尺寸，密钥掩码存取），三种请求方言按参考实现逐字对拍；「测试」是真出一张图；
  工具只回路径与尺寸，图片按 URL 来源通道渲染。
- **记忆分节**：第三方记忆扩展的开关是**本应用自己的偏好**（不动别的运行时），
  默认关；记忆文档能看能改，渲染栏一条一块、渲染与原文可切。
- **联网搜索（`web_search`）**：免 API key 的 provider 链（自建 SearXNG / Bing /
  DuckDuckGo / Mojeek / 多引擎聚合），失败逐条如实报（谁被风控 / 谁超时 / 谁没配）；
  端点只允许 http(s)，云元数据地址永远拒绝。
- **手机壳与出门 5G**：独立子项目 `mobile/`（iOS / Android 壳、同步、通知、镜像库）、
  局域网绑定改双栈（`0.0.0.0` → `::`，蜂窝走 IPv6 直连）、`npm run tunnel` 一条命令出门、
  设置页「5G 控制」卡（启停 / 看地址 / 扫码配对）。
- **即时提示（`InstantTooltip`）**：指针停到图标按钮上立刻出名称，不再等原生 `title`；
  无障碍属性与可访问名称不受影响。
- **命令中心与设备视口**：⌘K 三域分组、命中片段高亮、最近打开；五档机型预设 + 旋转 + 取景。
- **字阶补两档**：`--nx-f-2xs`=10、`--nx-f-xl`=18；阅读性正文行高独立成 `--nx-lh-reading: 1.75`。
- **桌面壳接上局域网绑定监督器**：界面上的「启动 / 停止」在打包版里也真的生效。

## 修复

- **会话行重叠**（用户报「重影」）：行距写死 48/54 而 v5 的行是 58.9。真值改成量第一枚
  行的盒高，窗口与偏移共用同一个数；行尾控件的高度在元信息格里预留，行高与状态无关。
- **时间轴两种线 / 竖线两端没接到图标 / 工具卡头首行对齐**：逐值对齐成一条线，
  两端落到图标中心，工具名与命令第一行的差从 3.2px 收到 1.1px。
- **服务端缓存不轮换**（真故障）：`sw.js` 的 `CACHE_VERSION` 原本只取包版本号，
  开发期几十次构建都不变，装到主屏的 PWA 一直吃旧 chunk。改成包版本 + 源码指纹。
- **皮肤开着时浮窗 / 弹层整块错位**（一个根因五个症状）：带 `backdrop-filter` 的祖先
  成了后代 `position: fixed` 的包含块。模型浮窗、会话分支浮窗、设置里的六个弹层
  全部改为 portal 到 body，定位算法一个字没改。
- **设置里的弹层不再「内嵌在设置弹窗里」**；共享右键 / 下拉菜单不再被设置弹窗盖成空白。
- **壁纸分节收敛**：开启壁纸后给上传（不再只显示内置画作），解释句退场，
  内置画廊与皮肤工作室不再各摆一份。
- **皮肤工作室**：两个滑块在预览里是死的（层序问题）、编辑内置皮肤时名称空、
  壁纸串了（内置定义被覆盖写盖住）—— 逐个修。
- **导入页**：细选弹窗补上「确认导入」、入口钮做明显、弹窗内可搜；多选行的勾选盒
  不再独占一行。
- **服务崩溃重启的退避预算从来没生效过**（永远 1s、上限从不触发）。
- 以及一批用户实拍逐条改：顶栏瘦身、焦点环按输入模态分档、「滚到最新」钮位置、
  子代理会话默认收起、顶栏浮窗点外面即关、上下文浮窗中缝过宽、收藏星标两套读法、
  迷你地图回到 0.1.8 形态、调用轨迹铺满 pane、思考正文逐字揭示提速、
  窄屏开关几何与抽屉 chrome。

## 移除

- **语音输入**：本轮曾加入（浏览器原生识别 + 本地离线模型），定稿前按用户裁定整体下线 ——
  输入卡那枚麦克风钮、设置分节、`/api/voice`、本地模型下载与 `public/vendor` 的
  wasm 运行时（约 55MB）一并退场。
- **设置面的解释性文案**：页头说明整件退场，各分节里的纯解释句按同一条口径去掉
  （设置面只留控件标签、当前值与会阻止动作的信息）。
- **顶栏重复入口**：「生成会话标题」搬进会话动作 ⋯ 菜单（与「重命名」相邻）、
  「导出 Markdown」与 MCP 图标退场；会话动作 ⋯ 里的重命名改成标题原地编辑。
- **删掉的形态件**：描边深度滑杆、点头像翻滚版本号的彩蛋、导入页第二张「确认导入」卡、
  空态那句「在 … 里做点什么？」、设置里重复的分节标题、Deno 自建中继整套、旧皮肤层。

## 已知

- **形态过渡期**：`verify:boards` 的几何对位覆盖率 19/30（改到哪张画板补哪张 spec）；
  真机 Safari / iOS 16.2 与 Playwright WebKit 仍未验证。
- **样式字面量门禁是红的**：11 个键超出基线（`AgentSessionPanel` / `ChatInput` /
  `CodeFileEditor` / `app/error.tsx` / `app/pair` 等）。这轮没有跑 `--update`
  重新冻结基线 —— 那等于把新字面量洗成「存量」。要收口得逐条换成 token。
- **PWA 库缺口**：代码高亮分色、引用、并排 diff 等少数件在 PWA 库中没有定义，
  手机上退到基础形态或桌面类。
- **远程部署**：MCP 的 OAuth 回调只听 `127.0.0.1`；除 host-only 名单外的宿主环境变量
  仍会传给 stdio server 子进程。
- 源码包**不含** DMG / EXE（要安装包走打包技能，产物用同一套 asset 接口补传到这个 release 上）。

---

## English

> 123 commits after 0.1.8: the V5 design system fully landed (both Web and PWA forms swapped in one pass),
> the settings surface redone, the phone shell and out-of-home 5G connected, plus a batch of genuinely new
> capabilities (image generation, memory, web search, scheduled tasks, usage). This version also went from
> "can run" to "can measure" — every form correction carries a board-alignment or structure guard, and every
> user report is measured before it's changed.

Scope: `v0.1.8..HEAD` — **906 files, +122,973 / −22,287 lines**, 123 commits.

### Added

- **V5 design system landed (Web · `d-*`)**: boards copied into the product one by one — workbench and new
  session, sidebar and top bar (project tree / session three states / collapse rail / session actions ⋯),
  the full transcript set (process timeline, tool cards, code, diff, failure retry, unread divider), input
  box and all floating layers, right column six panels, file viewer multi-mode, all settings sections
  (modal and full-page two hosts), command center, plan card and queue, system states and dialogs.
- **V5 design system landed (PWA · `m-*`)**: all phone boards landed — session page and drawer, phone
  transcript, input card and capability panel, settings two levels (hub → section secondary page), store /
  scheduled tasks / usage three top-level pages, files and terminal (including soft keyboard key rows),
  browser and command center, install/update trust, gestures and system states, phone right column six panels.
- **Settings surface redone**: one column of sections (General / Models / Image generation / Skills /
  Subagents / Plugins / Memory / Web search / MCP / Scheduled tasks / Usage / Archive / Import / Phone &
  push), long sections truly scroll; the models page becomes a single column of clickable rows + detail
  modal, cutting three duplicate entry points; add and edit for subagents / plugins / MCP / import all go
  through modals.
- **Image generation model (`generate_image`)**: a profile independent of the chat model (presets each have
  endpoint / key / model / size, key stored and read masked), three request dialects matched word-for-word
  against reference implementations; "Test" really produces an image; the tool returns only path and size,
  and the image renders through the URL-source channel.
- **Memory section**: the toggle for the third-party memory extension is **the app's own preference** (it
  doesn't touch other runtimes), off by default; memory documents are viewable and editable, and the render
  pane shows one block at a time with rendering and source switchable.
- **Web search (`web_search`)**: an API-key-free provider chain (self-hosted SearXNG / Bing / DuckDuckGo /
  Mojeek / multi-engine aggregation), failures reported honestly one by one (who got rate-limited / who
  timed out / who isn't configured); endpoints only allow http(s), and cloud metadata addresses are always
  rejected.
- **Phone shell and out-of-home 5G**: a separate subproject `mobile/` (iOS / Android shells, sync,
  notifications, mirror repo), LAN binding changed to dual-stack (`0.0.0.0` → `::`, cellular goes IPv6
  direct), `npm run tunnel` to go out with one command, a "5G control" card on the settings page
  (start/stop / see address / scan to pair).
- **Instant tooltip (`InstantTooltip`)**: hovering over an icon button immediately shows its name, no more
  waiting for the native `title`; accessibility attributes and accessible names are unaffected.
- **Command center and device viewport**: ⌘K three-domain grouping, matched fragment highlighting, recent
  opens; five device presets + rotation + framing.
- **Two more font-size steps**: `--nx-f-2xs`=10, `--nx-f-xl`=18; reading body line height becomes its own
  `--nx-lh-reading: 1.75`.
- **Desktop shell wired to the LAN binding supervisor**: the "Start / Stop" in the UI really works in the
  packaged build too.

### Fixed

- **Session row overlap** (user reported "ghosting"): row spacing was hardcoded 48/54 while v5's rows are
  58.9. The true value is now measured from the first row's box height, with window and offset sharing the
  same number; the height of the row-end controls is reserved in the meta grid, so row height is
  independent of state.
- **Timeline's two kinds of lines / vertical line ends not reaching the icons / tool card header first-line
  alignment**: aligned value-by-value into one line, both ends landing on icon centers, and the gap between
  the tool name and the command's first line reduced from 3.2px to 1.1px.
- **Server-side cache not rotating** (real bug): `sw.js`'s `CACHE_VERSION` previously only took the package
  version, which didn't change across dozens of builds during development, so a PWA installed to the home
  screen kept eating old chunks. Changed to package version + source fingerprint.
- **Floating windows / popovers entirely mispositioned when a skin is on** (one root cause, five symptoms):
  an ancestor with `backdrop-filter` became the containing block for descendant `position: fixed`. The
  model floating window, the session branch floating window, and the six popovers in settings are all
  changed to portal to body, with the positioning algorithm unchanged by a single character.
- **Popovers in settings are no longer "nested inside the settings modal"**; shared context menus /
  dropdowns are no longer covered to blank by the settings modal.
- **Wallpaper section converged**: after enabling wallpaper, uploading is offered (no longer only showing
  built-in artwork), the explanatory sentence is retired, and the built-in gallery and skin studio no
  longer each put up a copy.
- **Skin studio**: two sliders were dead in the preview (layer order issue), the name was empty when
  editing a built-in skin, and wallpapers got crossed (built-in definitions were overwritten) — fixed one
  by one.
- **Import page**: the detail-selection modal gains "Confirm import", the entry button is made obvious, and
  it's searchable inside the modal; the checkbox of a multi-select row no longer takes a whole line by
  itself.
- **The backoff budget for service crash restarts never took effect** (always 1s, the cap never triggered).
- Plus a batch of user screenshots changed one by one: top bar slimmed down, focus ring tiered by input
  modality, "scroll to latest" button position, subagent sessions collapsed by default, top bar floating
  windows close on outside click, context floating window mid-gap too wide, favorite star two readings,
  minimap returned to its 0.1.8 form, call trace filling the pane, thinking body character-by-character
  reveal sped up, narrow-screen toggle geometry and drawer chrome.

### Removed

- **Voice input**: this round had added it (browser-native recognition + local offline model), but before
  finalizing it was taken offline entirely by user decision — the microphone button on the input card, the
  settings section, `/api/voice`, the local model download, and the wasm runtime in `public/vendor` (about
  55MB) all retired together.
- **Explanatory copy on the settings surface**: the page-header description retired entirely, and pure
  explanatory sentences in each section were removed by the same standard (the settings surface keeps only
  control labels, current values, and information that would block an action).
- **Duplicate entry points in the top bar**: "Generate session title" moved into the session actions ⋯
  menu (next to "Rename"), "Export Markdown" and the MCP icon retired; Rename in the session actions ⋯
  changed to in-place title editing.
- **Removed form pieces**: the outline depth slider, the avatar-click version-number-roll easter egg, the
  second "Confirm import" card on the import page, the empty-state line "Do something in …?", duplicate
  section titles in settings, the entire Deno self-hosted relay, and the old skin layer.

### Known

- **Form transition period**: `verify:boards` geometric alignment coverage is 19/30 (add the spec for
  whichever board you change); real-device Safari / iOS 16.2 and Playwright WebKit are still unverified.
- **The style literal gate is red**: 11 keys exceed the baseline (`AgentSessionPanel` / `ChatInput` /
  `CodeFileEditor` / `app/error.tsx` / `app/pair`, etc.). This round did not run `--update` to re-freeze the
  baseline — that would launder new literals into "existing". To close it out, each one has to be replaced
  with a token.
- **PWA library gaps**: a few pieces such as code highlighting color separation, quotes, and side-by-side
  diff are not defined in the PWA library, so on phones they fall back to the basic form or desktop classes.
- **Remote deployment**: MCP's OAuth callback only listens on `127.0.0.1`; host environment variables
  outside the host-only list are still passed to the stdio server child process.
- The source package **does not include** DMG / EXE (for installers use the packaging skill, and upload the
  artifacts to this release via the same asset interface).
