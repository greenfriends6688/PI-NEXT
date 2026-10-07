# PI NEXT · 设计体系 V5

> **一份真值 · 两套形态 · 一个落地口**
> `base.css` 是唯一的角色令牌出处；`web/`（`d-` 前缀，桌面 1440×900）与 `pwa/`（`m-` 前缀，手机 390×844）
> 各带一套形态值与组件库，两套**刻意不同名**。落地的全部规矩在 [`LANDING.md`](./LANDING.md)，
> 偏离登记在 [`DIVERGENCE.md`](./DIVERGENCE.md)。

---

## 0 · 这一版与上一版的差别（一句话）

上一版的问题不是画得不好，是**同一个视觉有两个来源**：画板一套类名、产品一套类名，中间靠桥接层追，
追不上就漂移（活 bug：`.fork-msg-actions` 写进 CSS，组件渲染的却是 `.pw-msg-acts`，消息动作行**永久透明**）。
编译器绿、单测绿、人眼评审也绿 —— 因为这类漂移**没有任何仲裁者**。

V5 的做法只有两条，但这两条是不能松的：

1. **画板 DOM 即产品 DOM**。落地的唯一动作是「打开画板，抄那段 DOM」，不许照着截图做一个差不多的。
2. **机器判，不靠人记**。`check-v5.mjs` 拦静态（令牌/类/图标/接线/静默失效），
   `land-status.mjs` 生成落地清单（不凭记忆），`shoot.mjs` 在真浏览器里真点一遍并出图，
   `board-diff.mjs` 与产品逐选择器对几何。

---

## 1 · 目录

```
design/v5/
  demo/index.html        **整体 Demo**：一个能点的完整应用（桌面 ⇄ 手机形态 ⇄ 设置弹窗），
                        41 张画板背后的数据模型就是它 —— 看它等于看整套设计在跑
  assets/brand/         品牌（logo / 字标，由 PI NEXT品牌/ 原图精确裁切）
  index.html            画板集合页（缩略图 + 搜索 + 分域；file:// 双击也能开）
  base.css            角色令牌（间距/字阶比例/行高/圆角角色/控件高度/动效曲线与时长/层级/透明度）
  base.css 末尾        共享动效原子：13 组关键帧（两端共用，只在这里出现一次）
  web/tokens.css      Web 形态值：基准 14px、圆角 4–20、控件 20–32、触控下限 28
  web/system.css      Web 组件库（d- 前缀，唯一出处）+ 画板家具（d-board/d-scene/d-frame）
  web/boards/         Web 画板
  pwa/tokens.css      PWA 形态值：基准 17px、圆角 8–28、控件 28–48、触控下限 44
  pwa/system.css      PWA 组件库（m- 前缀，唯一出处）
  pwa/boards/         PWA 画板
  assets/demo.js      画板交互引擎（12 类声明式接线，零手写脚本）
  scripts/check-v5.mjs  静态门禁（退出码 0 才算过）
  scripts/land-status.mjs 落地清单生成器（「我说一句话就启动改版」的数据源）
  scripts/shoot.mjs   真浏览器出图 + 交互件冒烟
  .shots/             截图存档（不入库）
```

## 2 · 三条铁律

1. **一个类名只有一个来源。** 类写在 `system.css`，不许在产品 CSS 里另起同名 `d-` / `m-` 类。
2. **一个值只有一个来源。** 角色值只在 `base.css`；形态值只在各自的 `tokens.css`；
   产品运行时**只挂 `base.css` + 其中一套形态**，绝不同时挂两套。
3. **值必须能被算出来。** 内联样式只许写字面量以外的东西（宽度百分比、动画错峰、几何定位）；
   颜色/字号/间距/圆角/阴影一律 `var()`。`check-v5.mjs` 直接拦。

## 3 · 画板清单

> **这一段是自动生成的**（`check-v5.mjs` 从每张板的 `<h1>` / 说明 / 三标签抽取并回写），
> 不要手改 —— 手写的清单和磁盘必然对不上，那正是「两套东西」。
> 完整清单与落地对应见 [`BOARDS.md`](./BOARDS.md)；机器可读版 `manifest.json`；
> 带缩略图的页面集合 [`index.html`](./index.html)。

<!-- boards:start -->
| 画板 | 这一张在定什么 | 页面 | 文件 |
|---|---|---|---|
| `D-01-workbench.html` | D-01 · 工作台与新会话 | 工作台 / 新会话 | D-01-workbench.html |
| `D-02-sidebar-topbar.html` | D-02 · 侧栏与顶栏 | 工作台外壳 · 侧栏 · 顶栏 | D-02-sidebar-topbar.html |
| `D-02b-topbar-popovers.html` | D-02b · 顶栏浮窗合集（九枚） | 工作台 · 顶栏浮窗 | D-02b-topbar-popovers.html |
| `D-02c-menus-atlas.html` | D-02c · 菜单合集 | 全局 · 菜单 | D-02c-menus-atlas.html |
| `D-02d-sidebar-detail.html` | D-02d · 侧栏细节补齐 | 工作台 · 侧栏细节 | D-02d-sidebar-detail.html |
| `D-03-transcript.html` | D-03 · 转录（消息全集） | 转录区 | D-03-transcript.html |
| `D-03b-transcript-content.html` | D-03b · 转录 · 内容块全集 | 转录区 | D-03b-transcript-content.html |
| `D-03c-transcript-shell.html` | D-03c · 转录 · 交互与壳级状态 | 转录区 | D-03c-transcript-shell.html |
| `D-03d-transcript-process.html` | D-03d · 转录 · 过程与工具全集 | 转录区 | D-03d-transcript-process.html |
| `D-03e-transcript-nav.html` | D-03e · 转录 · 回合导航 | 转录区 · 右栏 | D-03e-transcript-nav.html |
| `D-04-composer.html` | D-04 · 输入框与浮层 | 输入框 | D-04-composer.html |
| `D-05-right-panels.html` | D-05 · 右栏六面板（文件 / 终端 / 浏览器 / Git / 审查） | 工作台 / 右栏 | D-05-right-panels.html |
| `D-06-file-viewer.html` | D-06 · 文件查看器多模式（源码 / diff / 预览） | 工作台 / 文件查看器 | D-06-file-viewer.html |
| `D-06b-file-viewer-modes.html` | D-06b · 查看器其余形态（可编辑 / 对比覆盖层 / 表格 / 沙箱 / PDF / 降级） | 工作台 / 文件查看器 | D-06b-file-viewer-modes.html |
| `D-07-settings-general.html` | D-07 · 设置壳与通用 | 设置 / 通用 | D-07-settings-general.html |
| `D-07b-settings-general-detail.html` | D-07b · 通用分节补全（壁纸 / 侧栏 / 界面字体 / 聊天 / 通知 / Shell / 推送） | 设置 / 通用（弹窗宿主） | D-07b-settings-general-detail.html |
| `D-08-settings-models.html` | D-08 · 模型与供应商 | 设置 / 模型与供应商 | D-08-settings-models.html |
| `D-09-settings-model-advanced.html` | D-09 · 设置 · 模型高级（Header / UA / 兼容模式 / 上下文上限） | 设置 / 模型 / 高级 | D-09-settings-model-advanced.html |
| `D-10-settings-enabled-models.html` | D-10 · 设置 · 启用模型（白名单 pattern + thinking 钉 + 失配诊断） | 设置 / 启用模型 | D-10-settings-enabled-models.html |
| `D-11-settings-skills.html` | D-11 · 设置 · 技能（已加载 · 开关 · 搜索安装 · 内容查看） | 设置 / 技能 | D-11-settings-skills.html |
| `D-12-settings-agents.html` | D-12 · 设置 · 子代理（总开关 · profile · 工具白名单 · ext:） | 设置 / 子代理 | D-12-settings-agents.html |
| `D-13-settings-plugins.html` | D-13 · 设置 · 插件（已装 · 启用 · 检查更新 · 禁用 · 卸载） | 设置 / 插件 | D-13-settings-plugins.html |
| `D-15-settings-mcp.html` | D-15 · 设置弹窗 · MCP | 设置 / MCP 服务器 · 编辑器 · 粘贴解析 · 登录 · 日志 | D-15-settings-mcp.html |
| `D-16-settings-mcp-exposure.html` | D-16 · 设置弹窗 · MCP 工具曝光 | 设置 / MCP 工具曝光 · 四档 · 逐工具表 · 诊断 | D-16-settings-mcp-exposure.html |
| `D-17-settings-automation.html` | D-17 · 设置弹窗 · 定时任务 | 设置 / 定时任务 · 列表 · 编辑器 · 运行历史 · 单次详情 | D-17-settings-automation.html |
| `D-19-settings-usage.html` | D-19 · 用量与统计 | 设置 / 用量 | D-19-settings-usage.html |
| `D-20-settings-phone-push.html` | D-20 · 手机与推送 | 设置 / 手机与推送 | D-20-settings-phone-push.html |
| `D-21-settings-archive-import.html` | D-21 · 归档 · 导入 · 快捷键地图（只读）· 记忆与知识（提案 · 产品已下线） | 设置 / 归档 · 导入（数据四块） | D-21-settings-archive-import.html |
| `D-22-command-center.html` | D-22 · 全局搜索 ⌘K（命令中心） | 命令中心 / 全局搜索 | D-22-command-center.html |
| `D-23-browser-viewport.html` | D-23 · 提案 · 设备预览（模拟器的 Web 降级形态） | 设备预览 / 视口外壳 | D-23-browser-viewport.html |
| `D-24-empty-state-guide.html` | D-24 · 提案 · 首启引导与保存的工作流 | 首启引导 / 保存的工作流 | D-24-empty-state-guide.html |
| `D-25-plan-queue-slots.html` | D-25 · 计划时间线、队列两态与扩展插槽 | 会话内计划卡 · 队列 · 设置 / 扩展插槽 | D-25-plan-queue-slots.html |
| `D-26-dialogs-states.html` | D-26 · 对话框与系统态（模态 / Toast / 横幅 / 空 / 载 / 错） | 全局 / 对话框与状态 | D-26-dialogs-states.html |
| `D-26b-system-states.html` | D-26b · 系统态补全（目录选择 · 应用级错误页 · 拖放落区 · 扩展请求 · worktree） | 全局 / 系统态 | D-26b-system-states.html |
| `D-27-motion.html` | D-27 · 动效与交互规格 | 类型：规格台 | D-27-motion.html |
| `D-28-motion-feedback.html` | D-28 · 动效规格台 A · 进入与反馈 | 类型：规格台 | D-28-motion-feedback.html |
| `D-29-motion-containers.html` | D-29 · 动效规格台 B · 容器与转场 | 类型：规格台 | D-29-motion-containers.html |
| `D-30-keyboard-focus.html` | D-30 · 键盘与焦点 | 类型：规格台 | D-30-keyboard-focus.html |
| `D-31-settings-imagegen.html` | D-31 · 生图模型 | 设置 / 生图模型 | D-31-settings-imagegen.html |
| `D-32-v6-conversation.html` | D-32 · V6 提案 · Agent 会话全景 | 工作台 / 转录区 | D-32-v6-conversation.html |
| `D-33-v6-agent-parts.html` | D-33 · V6 提案 · Agent 部件规格台 | 转录区 / 组件规格 | D-33-v6-agent-parts.html |
| `D-34-v6-message-parts.html` | D-34 · V6 提案 · 消息与响应件 | 转录区 / 组件规格 | D-34-v6-message-parts.html |
| `D-35-v6-workbench-parts.html` | D-35 · V6 提案 · 工作台件 | 转录区 / 输入框 / 右栏 | D-35-v6-workbench-parts.html |
| `D-36-settings-memory.html` | D-36 · 记忆 | 设置 / 记忆 | D-36-settings-memory.html |
| `D-37-settings-websearch.html` | D-37 · 联网搜索 | 设置 / 联网搜索 | D-37-settings-websearch.html |
| `M-01-conversation-drawer.html` | M-01 · 会话页与抽屉 | 会话流 / 会话抽屉 / 模型选择 | M-01-conversation-drawer.html |
| `M-02-transcript.html` | M-02 · 手机转录 | 会话转录 | M-02-transcript.html |
| `M-03-composer-sheet.html` | M-03 · 手机输入卡与面板 | 输入卡 / 能力浮层 / 补全面板 / 队列面板 | M-03-composer-sheet.html |
| `M-04-sessions-drawer.html` | M-04 · 会话抽屉整页 | 会话抽屉整页 / 长按菜单 | M-04-sessions-drawer.html |
| `M-05-settings.html` | M-05 · 设置 | 设置 hub / 通用二级页 / 弹窗宿主 | M-05-settings.html |
| `M-06-files-terminal.html` | M-06 · 文件与终端 | 文件树 / 查看器 / 终端 / 调用轨迹 / 审查 / 降级卡 | M-06-files-terminal.html |
| `M-07-browser-cc.html` | M-07 · 浏览器与命令中心 | 浏览器 / 设备模拟 / 命令中心 / Git 图谱 | M-07-browser-cc.html |
| `M-08-search-completion.html` | M-08 · 手机命令中心 | 命令中心（弹层）/ 前缀分类 / 空态 | M-08-search-completion.html |
| `M-09-store-cron-usage.html` | M-09 · 商店 · 定时任务 · 用量 | 插件商店 / 定时任务 / 用量 | M-09-store-cron-usage.html |
| `M-10-install-update-trust.html` | M-10 · 安装 · 更新 · 离线 · 目录信任 | 安装提示 / 更新浮条 / 离线条 / 目录信任 / 首启 | M-10-install-update-trust.html |
| `M-11-gestures-states.html` | M-11 · 手势与系统态 | 手势规格 / 系统态清单 / 反馈四型 | M-11-gestures-states.html |
| `M-12-right-panels.html` | M-12 · 手机右栏六面板 | 会话页入口 / 右栏六面板全屏层 / 审查 · 轨迹 · Git 形态 | M-12-right-panels.html |
<!-- boards:end -->

## 3b · 先看哪儿

| 想看 | 打开 |
|---|---|
| **整体长什么样、能点什么** | `demo/index.html` ← 先看这个，它是一个完整应用 |
| 全部页面（缩略图 + 搜索） | `index.html` |
| 某一页怎么落地 | `LANDING.md` + 该页画板 |
| 动效都有哪些 | `web/boards/D-27-motion.html` / `D-28` / `D-29` / `D-30` |

## 4 · 命令

| 命令 | 作用 |
|---|---|
| `npm run design:v5` | 静态门禁（令牌 / 类 / 图标 / demo 接线 / 静默失效） |
| `npm run design:v5:land` | **落地清单**：每张画板哪些类还没进产品，按批次排序 |
| `npm run design:v5:shots` | 真浏览器逐张出图 + 交互件冒烟（需先起静态服务） |
| 静态预览 | `cd design && python3 -m http.server 39411` → `http://127.0.0.1:39411/v5/` |

## 5 · 看板里不许出现的东西

截图模仿、emoji、手绘 SVG（图标一律 lucide + `data-ico`）、lorem ipsum、
内联的设计值（颜色/字号/间距/圆角/阴影）、没有对应画板的 `d-`/`m-` 类、
以及**为了好看而加的类**（每个类都要有一帧画板在用）。