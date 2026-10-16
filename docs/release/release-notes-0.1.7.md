# PI NEXT v0.1.7

这一版把 9 月底那一轮换肤与手机适配收了尾，同时把积压的上游改动并了进来。
三件大事：**设计系统有了唯一风格源和门禁**（颜色/间距/图标不再靠人眼比）、
**手机 / PWA 从「能用」改成「按得准」**、**pi SDK 升到 1.0.0**
（工具曝光规则、消息投递方式、MCP 内置扩展都按新契约对齐）。

## 新增

- **设计系统**：29 张界面画板 + 一份规格说明是界面唯一风格来源，颜色不再在产品样式里写死。
  配套自动检查：样式字面量、动效 token、图标名、对比度、以及**逐张画板量几何**
  （一板一条规则，跑真浏览器逐元素比对）。桌面 >1024px 一个像素不动。
- **手机 / PWA 两档**（≤640 手机、641–1024 平板）：工作台输入区在手机上收成固定两行、
  发送键回到工具条内（之前平板宽度下它被渲染进隐藏层，等于没有发送键）；侧栏行内动作
  命中区抬到 40×40、会话行动作收成一枚常驻 `⋯`、抽屉补 Esc 与左滑关闭；
  文件面板头部分档到行内 + `⋯`；设置各分节（模型 / 技能 / 子代理 / 插件）逐页把
  表格改成卡片、按钮抬到触控档。
- **设置里新增**：发送键可配（Enter 直发 / Ctrl+Enter 才发）、上下文压缩预算、
  思考档 token 预算（四档）、重试参数、技能与插件按组全开全关。
- **模型配置**：兼容项开关表按协议展开（26 个字段不用再手改 JSON）、
  阶梯定价编辑器、api 协议下拉覆盖全部已知协议、
  模型规格可从 provider 自己回填、新会话按模型记忆预选思考档。
- **输入框工具条上的供应商配额芯片**：显示当前模型所属 provider 最紧那个额度窗口的
  剩余量（≤10% 红、≤30% 橙），鼠标悬停看全部窗口；查不到就不渲染。
- **文件**：符号链接目录指向项目外时显式放行（一次一条链接、重启失效）；
  文件树里哪些条目显示改由 Git 决定（被忽略的隐藏，被跟踪的照常显示）；
  压缩包 zip / 解包；拖入绝对路径变成相对提及。
- **MCP 换成 pi 1.0 的官方实现**：配置的读/写/删/改、校验、OAuth 入口全部走官方实现
  （从 Claude Code / Codex / Cursor / VS Code 发现已有 server 的能力保留，pi 没这项）；
  会话里能真连上本地 stdio server 并拿到工具，而「只看一眼会话」
  （切会话取工具列表、自动命名、预热）不会把 server 拉起来常驻。
  子进程环境变量做了清洗（不再把整个环境交出去）。

## 改动

- **pi SDK 升级到 1.0.0**：工具曝光规则（直接给模型 / 只在脚本里搜 / 按需加载 / 撤回）
  与消息投递方式都按新契约对齐；可用模型范围改由 SDK 自己解析。
- **设置页 12 个分节收敛到两套骨架**（列表页 / 详情页），无用的样式清退。
- **会话与流**：后台子代理在跑的父会话不再被空闲回收误杀（原先跑着跑着被回收，
  子代理结果永远取不回来）。
- **MCP 的校验与认证入口换名换语义**：测试按钮现在只报**结构是否有效**（不再真连一次握手），
  OAuth 登录走官方命令；`socket` 与旧版 `sse` 两种传输不再支持。旧配置里的禁用项仍按禁用处理。
- **fork 可以在会话正在跑的时候做**：复制只取已完成的记录，不再就地改写原会话状态。
- **子代理**：取回标记按运行记、重启后的孤儿报告成「已中断」、恢复的报告写清来源；
  扩展禁用名单改成对着真实扩展来源解析（别名与 npm 作用域写法绕不过去）。
- **品牌统一为 PI NEXT**：窗口标题、PWA 清单、应用图标与桌面版的应用目录
  全部换名；桌面包会把旧版本目录里的用户数据迁过来。

## 修复

- **旧 Safari / iOS 16.2 首页白屏**：改掉本仓里浏览器解析不了的写法，依赖里那条也用打包
  插件绕开；旧浏览器的编译目标降到 16.2。
- **路径授权过宽**：MCP / 扩展工具结果里的字符串不再能用来读文件；
  打开文件夹先查白名单再判断，不再用状态码猜路径是否存在。
- **`models.json` 读不出来时禁用保存**，不再把用户配置覆盖成空。
- **渲染**：行内公式旁的货币金额不再被吃掉、紧跟链接的中文标点不再被吞进链接、
  用户消息里用 Shift+Enter 排的版不再被折成一行。
- **压缩期间**报「正在压缩」而不是一直报等模型；多个审批同时弹出不再互相顶掉。
- **9 个复制点接上失败反馈**（原先 8 个点下去没反应）。
- **手机上开关被拉变形**：触控档给所有按钮补的最小高度把板面里 30×17 的开关压成 30×36 的椭圆
  （用户实拍那颗「月牙」）—— 现在开关回到板面几何，命中区改用外扩。

## 已知

- **MCP 仍没有 per-prompt 的连接管理**：连接在浏览器会话打开期间常驻，
  靠空闲回收关闭；没有「每次发消息前比对配置」这一层。
  远程部署还要单独处理 OAuth 回调（只监听本机回环）与项目配置的目录信任。
- 用量统计里 fork 出来的会话会把父会话的历史再算一遍，总 token/成本比真实支出偏高。
- 画板几何自动比对只覆盖了部分画板，没写规则的那几张仍靠人眼比。
- 真机旧版 Safari / iOS 与 Playwright WebKit 没跑过，白屏修复只在源码层验证。

---

## English

This release wraps up the late-September round of reskinning and mobile adaptation, and merges in the backlog of upstream changes. Three big things: **the design system now has a single source of style and a gate** (colors/spacing/icons are no longer compared by eye), **mobile / PWA went from "usable" to "accurately tappable"**, and **the pi SDK was upgraded to 1.0.0** (tool exposure rules, message delivery method, and the built-in MCP extension are all aligned with the new contract).

### Added

- **Design system**: 29 interface artboards + a specification document are the single source of style for the interface; colors are no longer hard-coded in product styles. Accompanying automated checks: style literals, motion tokens, icon names, contrast, and **per-artboard geometry measurement** (one rule per board, running a real browser to compare element by element). Desktop >1024px moves not a single pixel.
- **Two mobile / PWA tiers** (≤640 phone, 641–1024 tablet): on phones the workbench input area collapses to a fixed two rows and the send key returns to the toolbar (previously at tablet width it was rendered into a hidden layer, effectively leaving no send key); sidebar inline actions have a 40×40 hit area, session-row actions collapse into a persistent `⋯`, and the drawer gains Esc and swipe-left-to-close; the file panel header is tiered into inline + `⋯`; each Settings subsection (models / skills / subagents / plugins) converts its table into cards page by page and raises buttons to the touch tier.
- **New in Settings**: configurable send key (Enter sends directly / Ctrl+Enter to send), context compaction budget, thinking-tier token budget (four tiers), retry parameters, and enable/disable all skills and plugins by group.
- **Model configuration**: the compatibility toggle table expands by protocol (26 fields no longer need manual JSON editing), a tiered-pricing editor, an api protocol dropdown covering all known protocols, model specs can be backfilled from the provider itself, and new sessions remember and preselect the thinking tier per model.
- **Provider quota chip on the input toolbar**: shows the remaining amount of the tightest quota window for the provider the current model belongs to (≤10% red, ≤30% orange); hover to see all windows; if it cannot be found, nothing is rendered.
- **Files**: when a symlinked directory points outside the project it is explicitly allowed (one link at a time, expires on restart); which entries show in the file tree is now decided by Git (ignored ones are hidden, tracked ones show as usual); archive zip / unzip; dropping in an absolute path becomes a relative mention.
- **MCP switched to pi 1.0's official implementation**: reading/writing/deleting/editing configuration, validation, and the OAuth entry point all go through the official implementation (the ability to discover existing servers from Claude Code / Codex / Cursor / VS Code is retained, since pi lacks it); sessions can actually connect to a local stdio server and get tools, while "just glancing at a session" (switching sessions to fetch the tool list, auto-naming, prewarming) does not spin the server up and keep it resident. Child-process environment variables are sanitized (the entire environment is no longer handed over).

### Changed

- **pi SDK upgraded to 1.0.0**: tool exposure rules (give directly to the model / search only in scripts / load on demand / withdraw) and the message delivery method are aligned with the new contract; the range of available models is now resolved by the SDK itself.
- **The 12 Settings sections converge onto two skeletons** (list page / detail page), and unused styles are retired.
- **Sessions and streams**: a parent session with a background subagent running is no longer mistakenly killed by idle reclamation (previously it would be reclaimed while running, and the subagent's results could never be retrieved).
- **MCP's validation and authentication entry points were renamed and redefined**: the test button now only reports **whether the structure is valid** (no longer performs a real handshake); OAuth login goes through the official command; the two transports `socket` and legacy `sse` are no longer supported. Disabled items in old configurations are still treated as disabled.
- **fork can now be done while a session is running**: the copy takes only completed records and no longer rewrites the original session state in place.
- **Subagents**: retrieval markers are recorded per run, orphans after a restart are reported as "interrupted", and recovered reports state their source clearly; the extension denylist now resolves against real extension sources (aliases and npm-scoped forms can no longer slip past).
- **Brand unified as PI NEXT**: the window title, PWA manifest, app icon, and the desktop app's application directory are all renamed; the desktop package migrates user data from the old version's directory over.

### Fixed

- **White home screen on old Safari / iOS 16.2**: syntax in this repo that the browser cannot parse was changed, and the one in a dependency is bypassed with a bundler plugin; the compile target for old browsers was lowered to 16.2.
- **Path authorization too broad**: strings in MCP / extension tool results can no longer be used to read files; opening a folder first checks the allowlist before deciding, instead of guessing whether a path exists from a status code.
- **Saving is disabled when `models.json` cannot be read**, no longer overwriting the user configuration with empty content.
- **Rendering**: currency amounts next to inline formulas are no longer swallowed, Chinese punctuation immediately following a link is no longer pulled into the link, and layouts arranged with Shift+Enter in user messages are no longer collapsed into one line.
- **During compaction** it now reports "compacting" instead of perpetually reporting waiting for the model; multiple approval prompts popping up at the same time no longer displace each other.
- **9 copy points got failure feedback wired up** (previously 8 were unresponsive when clicked).
- **Toggles were stretched out of shape on mobile**: the minimum height added to all buttons in the touch tier squashed the 30×17 toggle in the panel into a 30×36 ellipse (the "crescent" a user photographed) — now the toggle returns to the panel geometry and the hit area is expanded outward instead.

### Known

- **MCP still has no per-prompt connection management**: connections stay resident while the browser session is open and are closed by idle reclamation; there is no layer that "compares configuration before each message send". Remote deployment also needs separately handling the OAuth callback (which listens only on the local loopback) and directory trust for project configuration.
- In usage statistics, forked sessions recount the parent session's history, so total token/cost is higher than actual spending.
- The automated artboard geometry comparison covers only some artboards; the ones without rules written still rely on comparison by eye.
- Old Safari / iOS on real devices and Playwright WebKit have not been run; the white-screen fix was verified only at the source level.
