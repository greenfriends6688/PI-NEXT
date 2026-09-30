# 画板 ↔ 产品对表（真 Chrome）· 2026-09-30

- 产品地址：`http://127.0.0.1:30141`
- 画板：30 张，共 1451 类引用（去重 212）
- 产品巡检：10 步，实际渲染出 104 个画板类
- **画板有、产品巡检未出现：112 个类**
- 产品用了、任何画板都没有的类：4 个（pw-detail-stack pw-narrow pw-rowgap pw-scrim-layer）

## 一、逐帧对表

| 画板 | 该帧在定什么 | 用到的类 | 巡检未出现 |
|---|---|---|---|
| 00-tokens.html | 中性色阶 · 浅色 · 同一色相偏移（向强调色偏，饱和度 ≤ 0.02）· 层次全部靠明度差表达，不靠换色相 | 2 | pw-swatch-cell pw-swatches-row |
| 00-tokens.html | 中性色阶 · 深色 · 一个浅色 token 名对应且只对应一个深色值，无深色专有 token | 2 | pw-swatch-cell pw-swatches-row |
| 00-tokens.html | 强调色（唯一）· 语义色（4）· 三级表面 | 11 | pw-grid3 pw-grid4 pw-swatch-cell pw-swatches-row |
| 00-tokens.html | 字阶（5 档）· 间距（4px 网格）· 圆角（3 档）· 控件高度 | 13 | pw-grid4 |
| 00-tokens.html | 图标总览 · 全部取自 lucide（lucide-static v1.48.0）· 225 个已注册在 assets/icons.js · 用法 <i data-ico="search"></i> · 禁用 emoji | 3 | pw-icon-cell |
| 01-workbench.html | 帧 A · 新会话（空态首屏） · 右栏收起 · 侧栏展开 · 无项目时顶部给引导1440 × 900 | 40 | pw-await pw-body pw-chipbtn pw-composer-wrap pw-m pw-main pw-session pw-side-search pw-starter pw-starters pw-t |
| 01-workbench.html | 帧 B · 进行中的一轮 · 过程时间轴 + 权限卡 + 运行中的工具卡 · 输入框变停止 · 侧栏会话行出运行点1440 × 900 | 53 | pw-arg pw-assistant pw-await pw-body pw-chat pw-chipbtn pw-composer-wrap pw-dur pw-m pw-main pw-perm pw-perm-acts pw-perm-body pw-perm-title pw-proc pw-proc-body pw-proc-head pw-session pw-side-search pw-step pw-step-ico pw-t pw-think pw-verb |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | 70 | pw-assistant pw-await pw-body pw-card pw-card-head pw-chat pw-chipbtn pw-chips pw-composer-wrap pw-diff-body pw-diff-line pw-m pw-main pw-path pw-proc pw-proc-head pw-session pw-side-search pw-t pw-tab pw-tok-key pw-tok-num pw-tool pw-tree pw-viewer pw-viewer-body pw-viewer-head |
| 01-workbench.html | 帧 D · 零会话起步 · 选中型空态 · 两个「还没有内容」的首屏 + 起步卡的展开态 · 不画壳，只画首屏本身840 × 480 | 20 | pw-grid3 pw-starter pw-starters |
| 01-workbench.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion切会话只动转录内容 | 11 | pw-anim-phase pw-anim-rise pw-anim-shimmer pw-anim-stream pw-step pw-step-ico pw-verb |
| 02-sidebar-topbar.html | 侧栏 · 三种 pane 状态并排 · 宽 280 · 高 660A 项目 pane · B 聊天 pane · C 搜索 | 33 | pw-await pw-body pw-m pw-mark pw-row-toggle pw-search-hit pw-search-project pw-search-results pw-session pw-side-search pw-t |
| 02-sidebar-topbar.html | 用户自定义分组 · 四态 + 移出落点 · 分组头 = 折叠开关 + 名字 + 数量；改名就地编辑，不弹对话框 | 11 | pw-drop pw-grid4 pw-row-toggle |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | 24 | pw-await pw-body pw-grid3 pw-m pw-rail pw-session pw-t |
| 02-sidebar-topbar.html | 顶栏 · 三种上下文 · 高 36 · 左侧标题随上下文变化，右侧动作随能力显示 | 9 | pw-chipbtn |
| 05-motion.html | 十一个值 + 四类转场 · 值全部登记在 assets/tokens.css 第 12 节 | 10 | ✅ 全出现 |
| 05-motion.html | 轻量交互规格 · 这五条覆盖全系统所有「没有转场、只有反馈」的地方 | 5 | ✅ 全出现 |
| 05-motion.html | 全系统动效清单 · 十七项 · 每一格都是真在播的循环演示每格一个动效 | 37 | pw-anim-breathe pw-anim-collapse pw-anim-drop pw-anim-expand pw-anim-flash pw-anim-notice pw-anim-pending pw-anim-phase pw-anim-pop pw-anim-reveal pw-anim-rise pw-anim-row pw-anim-saved pw-anim-sheet pw-anim-shimmer pw-anim-spin pw-anim-step pw-anim-stream pw-anim-sweep pw-anim-trigger pw-card pw-card-body pw-drop pw-dur pw-proc-head pw-step pw-step-ico pw-toast pw-verb |
| 05-motion.html | 分帧时间轴 · A 整块替换 · B 重载 agent · 2px / ms只作示意 | 9 | ✅ 全出现 |
| 05-motion.html | 反例与禁区 · 每一条都对应一个真实会犯的错 | 3 | ✅ 全出现 |
| 07-dark-tokens.html | 中性色阶 10 · 强调色 6 · 左 = 浅色值，右 = 深色值 | 7 | ✅ 全出现 |
| 07-dark-tokens.html | 语义色 8 · 弹层表面 1 · 阴影 1 · 合计 26 项 | 4 | ✅ 全出现 |
| 07-dark-tokens.html | 不新增 token 的三类 · 跟随派生 / 代码高亮 / 终端 ANSI | 8 | pw-grid3 |
| 10-transcript-text.html | 用户消息气泡 · 三种状态：默认（含 @ 芯片）/ 悬浮出操作 / 编辑中 | 10 | pw-quote |
| 10-transcript-text.html | 助手富文本正文 · 标题 / 段落 / 有序无序列表 / 任务清单 / 行内代码 / 引用 / 文件链接 / 分割线 | 2 | pw-tasklist |
| 10-transcript-text.html | 代码块卡片 · 语言标签 + Copy（→ Copied）；长行横向滚动，不折行 | 9 | pw-tok-key |
| 10-transcript-text.html | GFM 表格 · 数学公式 · 表格列可对齐、偶数行斑马纹；公式行内与块级 | 3 | pw-math |
| 10-transcript-text.html | Mermaid 图 · 两态：图形态（默认）/ 源码态；渲染失败时退化成源码 + 一行错误 | 14 | pw-card-foot pw-tok-key |
| 11-transcript-process.html | 思考折叠块 · 流式中 / 结束折叠 / 展开三种 | 9 | pw-card pw-card-body pw-card-head pw-tool |
| 11-transcript-process.html | 过程时间轴（ProcessGroup） · 进行中 / 含失败 / 已完成折叠三态；汇总行给计数，失败行就地标红 | 13 | pw-arg pw-dur pw-proc pw-proc-body pw-proc-head pw-step pw-step-ico pw-think pw-verb |
| 11-transcript-process.html | 可展开的工具卡 · 完成（展开输出）/ 失败 / 取消 / 原始入参 | 11 | pw-card pw-card-body pw-card-foot pw-card-head pw-path pw-term pw-tool |
| 11-transcript-process.html | 文件差异对比卡 · 行内视图 / 分栏视图 / 只读（无 Keep·Reject） | 13 | pw-card pw-card-foot pw-diff-body pw-diff-head pw-diff-line pw-path |
| 11-transcript-process.html | 终端卡 · 子代理卡 · 终端运行中 / 已退出；子代理运行中 / 完成 | 22 | pw-arg pw-card pw-card-body pw-card-head pw-dur pw-path pw-proc-body pw-step pw-step-ico pw-sub pw-sub-head pw-sub-line pw-term pw-tool pw-verb |
| 11-transcript-process.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion展开折叠只动高度与透明度 | 15 | pw-anim-breathe pw-anim-expand pw-anim-spin pw-anim-stream pw-card pw-card-body pw-dur pw-proc-head pw-step pw-step-ico pw-verb |
| 12-transcript-interactive.html | 权限授权卡 · 三档动作 + 范围下拉；原始入参可折叠 | 17 | pw-card pw-card-head pw-path pw-perm pw-perm-acts pw-perm-body pw-perm-title pw-tool |
| 12-transcript-interactive.html | 计划（Todo）卡 · 上下文压缩卡 · 计划展开/折叠；压缩进行中/完成/失败 | 14 | pw-card pw-card-head pw-compact pw-path pw-plan pw-plan-head pw-strong pw-todo pw-tool |
| 12-transcript-interactive.html | 非文本内容块 · 图片 / 资源文件 / 音频 / 不可渲染的兜底 | 16 | pw-audio pw-card pw-card-body pw-card-head pw-filecard pw-fname pw-img pw-meta pw-path pw-term pw-tool |
| 12-transcript-interactive.html | 回合结束行 · 七个 stopReason 全列（pi 的真实取值）+ 一个失败态；非正常结束要一眼区分 | 6 | ✅ 全出现 |
| 12-transcript-interactive.html | agent 状态条 · 「等你处理」停靠条 · 通知条 · 出现在转录里或输入框上方 | 20 | pw-card pw-card-head pw-path pw-perm pw-perm-acts pw-perm-body pw-perm-title pw-toast pw-tool |
| 12-transcript-interactive.html | 转录的三种壳级状态 · 会话正在加载 / 滚动到最新 / 查找结果被截断 | 11 | pw-toast |
| 12-transcript-interactive.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion通知条最多 3 条、6 秒自收 | 8 | pw-anim-flash pw-anim-notice pw-anim-spin pw-toast |
| 20-composer.html | 输入框 · 三种状态 · 空闲 / 流式中（停止 + 队列）/ 无项目（禁用） | 13 | pw-chips |
| 20-composer.html | 附件与引用 · 附件芯片条 / 引用上下文条 / 图片附件预览 / 上传失败 | 13 | pw-chips |
| 20-composer.html | 输入框内的 token 高亮 · 输入框可拖高 · 透明 textarea + 高亮层叠加；顶部一条拖拽把手 | 15 | pw-tok-cmd pw-tok-ref |
| 20-composer.html | 阅读态输入框塌陷 · 上下文浮窗 · 向上翻阅时收成一行；悬浮圆环看 Context / Rules / cost | 21 | ✅ 全出现 |
| 20-composer.html | 上下文环三档 · 正常 accent / >70% warning / >90% error —— 载体是 composer 工具条里的圆环 + 浮窗（§2.7 裁定：输入框下方没有第二条横条） | 4 | ✅ 全出现 |
| 20-composer.html | 流式排队 · 运行中继续输入 → 排队；可召回编辑、逐条移除、立即发送 | 11 | ✅ 全出现 |
| 20-composer.html | 输入历史 · 模型错误 · 流式两种模式 · 收起控件 | 18 | pw-desc |
| 20-composer.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion输入框下面没有第二条横条 | 10 | pw-anim-pending pw-anim-pop pw-anim-step pw-anim-trigger |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | 18 | pw-desc pw-pop-search |
| 22-top-panels.html | 顶栏下拉合集 · 全部从顶栏图标按钮挂出 · 圆角 6 · 唯一一种阴影1200 × 800 | 23 | pw-card pw-card-foot pw-card-head pw-desc pw-pop-search |
| 30-files-panel.html | 整屏 · 文件面板展开 · 右栏 420 · 左树 220 + 右查看器 · 转录在左1440 × 900 | 54 | pw-arg pw-assistant pw-await pw-body pw-chat pw-composer-wrap pw-dur pw-m pw-main pw-proc pw-proc-body pw-proc-head pw-session pw-step pw-step-ico pw-t pw-tab pw-tree pw-verb pw-viewer pw-viewer-body pw-viewer-head |
| 30-files-panel.html | 查看器的六种形态 · 源码 / Markdown 预览 / 图片 / 外部改动冲突 / 文件已删除 / 空态 | 18 | pw-live pw-meta pw-tok-key pw-viewer-head |
| 30-files-panel.html | 文件树右键菜单 · 文件与目录两套；危险项在末尾并用 error 色 | 14 | pw-modal-body pw-modal-foot |
| 31-terminal-browser-git.html | 终端面板 · 多标签（可关）/ 运行中 / 已退出 / 空态 · cwd 常驻标签栏右侧 | 14 | pw-tab pw-term |
| 31-terminal-browser-git.html | 应用内浏览器 · 地址栏 + 前进后退刷新 + 视口预设；空态 / 已加载 | 14 | pw-browser pw-browser-bar pw-chipbtn pw-url |
| 31-terminal-browser-git.html | Git 图谱 · 标签条与标签概览 · 泳道 + 变更文件；标签溢出折叠 | 22 | pw-card-foot pw-commit pw-desc pw-git pw-pop-search pw-tab |
| 40-settings-general.html | 设置 · 常规（整屏） · 左导航 200 + 右内容 · 分节 13 个 · 内容区左右各留 401440 × 900 | 27 | pw-wallpaper-thumb |
| 40-settings-general.html | 设置 · 常规（续） · 字体 / 聊天 / 语言 | 12 | ✅ 全出现 |
| 40-settings-general.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion布局尺寸是唯一允许 >200ms 的一类 | 6 | pw-anim-collapse pw-anim-reveal pw-anim-saved |
| 41-settings-models.html | 模型 · 供应商详情 · 左列表 260 + 右详情 · 订阅登录 / 用量摘要 / 模型启用 / 上游导入1440 × 900 | 31 | ✅ 全出现 |
| 41-settings-models.html | 模型详情 · 能力 / 规格 / 成本 / 高级 / 测试连接 | 19 | pw-tok-key |
| 42-settings-agents-skills.html | 子代理 · 内置开关 + 并发上限 + 作用域分组 + 编辑器1440 × 900 | 37 | ✅ 全出现 |
| 42-settings-agents-skills.html | 技能 · 作用域列表 + SKILL.md 编辑 + 市场安装对话框1440 × 900 | 27 | ✅ 全出现 |
| 42-settings-agents-skills.html | 安装技能对话框 · 市场切换（skills.sh ↔ SkillHub）+ 搜索 + 结果 | 19 | pw-desc pw-modal-body pw-modal-foot |
| 43-settings-plugins-mcp.html | 插件 · 包列表 + 详情（描述 / 状态 / 版本 / 资源数 / 安装路径 / 已解析资源）+ 更新与移除1440 × 900 | 26 | ✅ 全出现 |
| 43-settings-plugins-mcp.html | MCP 服务器 · 列表 + 详情（Basic / JSON 双模式）+ 从其它 agent 导入 + OAuth1440 × 900 | 33 | pw-tok-key |
| 43-settings-plugins-mcp.html | 从其它 agent 导入 MCP · OAuth 授权 · 八个来源 + 同名冲突提示；http 型服务器的授权流程 | 24 | pw-desc pw-modal-body pw-modal-foot pw-tok-key |
| 44-settings-cron-memory.html | 定时任务 · 左：任务列表 + 运行历史 · 右：新建表单（频率六种 + 会话模式 + 通知策略）1440 × 900 | 32 | pw-grid3 |
| 44-settings-cron-memory.html | 记忆 · 开关与状态 / 工具说明 / 记忆文件（列表 + 编辑，含冲突重载）1440 × 900 | 29 | ✅ 全出现 |
| 45-settings-shortcuts-usage.html | 快捷键 · 搜索 + 分组 + 录制 + 冲突提示1440 × 900 | 25 | ✅ 全出现 |
| 45-settings-shortcuts-usage.html | 用量 · 范围切换 + 九张统计卡 + 五种图表1440 × 900 | 26 | ✅ 全出现 |
| 46-settings-prompts-archive-import.html | 自定义命令 · 列表 + 编辑（命令名 / 描述 / 正文）1440 × 900 | 28 | ✅ 全出现 |
| 46-settings-prompts-archive-import.html | 归档历史 · 项目归档（展开会话 + 恢复）与归档会话（分组 + 恢复 + 彻底删除）1440 × 900 | 24 | ✅ 全出现 |
| 46-settings-prompts-archive-import.html | 从其它 agent 导入 · 四类资产 + 扫描 + 按来源分组 + 结果统计1440 × 900 | 26 | ✅ 全出现 |
| 47-skin-studio.html | 皮肤条 · 设置 → 常规 → 主题皮肤 · 选中 / 新建 / 导入 / 导出 | 9 | ✅ 全出现 |
| 47-skin-studio.html | 皮肤工作室 · 两页签：皮肤设置 / 自定义 CSS · 左侧实时预览900 × 720 | 18 | pw-modal-foot |
| 47-skin-studio.html | 工作室对话框外壳 · 头 / 页签行 / 内容行 / 提示行 / 动作行 · 五行，缺一行就少一条约定900 × 720 | 20 | pw-modal-body pw-modal-foot pw-scrim pw-tab |
| 47-skin-studio.html | 自定义 CSS 页签 · 内置壁纸选择器 · CSS 覆盖层 + 壁纸画廊 | 20 | pw-grid3 pw-modal-body pw-modal-foot |
| 50-dialogs.html | 项目信任 · 目录选择器 · 信任三态（确认 / 信任中 / 失败）；目录选择两态：系统原生对话框（主路径） / 自绘浏览器（回退） | 23 | pw-desc pw-modal-body pw-modal-foot |
| 50-dialogs.html | 扩展请求对话框 · 四种：选择 / 确认 / 输入 / 编辑器 · 带倒计时条 · 对应参考项目的 elicitation 卡 | 18 | pw-modal-body pw-modal-foot |
| 50-dialogs.html | 二次确认 · 通知条 · 通用确认框（含危险动作）；壳级通知条三色 | 11 | pw-modal-body pw-modal-foot pw-toast |
| 50-dialogs.html | 附件预览灯箱 · 遮罩 + 全屏 <dialog> · 图片整屏壳 / 多类型卡片壳（最多 1000 宽）/ 壳本身的约定 | 13 | pw-card-foot pw-scrim |
| 51-menus.html | 菜单原子 · 一套原子拼出全部菜单；圆角 6、宽 320（可收窄）、唯一一种阴影 | 14 | pw-grid3 pw-pop-search |
| 51-menus.html | 新建任务选择器 · 工作区切换器 · 侧栏与顶栏挂出的两个长菜单 | 10 | pw-desc pw-pop-search |
| 51-menus.html | 会话行右键菜单 · 顶栏溢出菜单 · 标签概览 · 三个真实菜单 | 13 | pw-desc pw-pop-search |
| 51-menus.html | 路径动作簇 · 复制路径 / 在文件管理器中显示 / 用默认应用打开 · 行内 .pw-btn sm，失败时才多出一枚徽章 | 7 | ✅ 全出现 |
| 52-file-viewer-modes.html | 可编辑源码 · 只读 / 编辑中（有未保存改动）/ 保存冲突 | 17 | pw-card pw-card-foot pw-tok-key pw-viewer-head |
| 52-file-viewer-modes.html | CSV 表格预览 · Markdown frontmatter 卡 | 12 | pw-card pw-card-foot pw-card-head pw-viewer-head |
| 52-file-viewer-modes.html | 图片缩放预览 · 长列表滚动淡出 | 13 | pw-card-foot pw-viewer-head |
| 52-file-viewer-modes.html | HTML 预览 · 查看器的全部分支 · 沙箱 iframe；同一份文件可以换视图，不重开标签 | 10 | pw-card pw-card-foot pw-viewer-head |
| 52-file-viewer-modes.html | 与 HEAD 对比（覆盖层）· 文件被删除 · 对比不是新标签、不是新页面，是同一个查看器上盖一层 | 12 | pw-card pw-card-foot pw-diff-body pw-diff-line pw-viewer-head |
| 53-turn-and-nav.html | 转录迷你地图（ChatMinimap） · 右缘 36px 导轨 + 悬浮展开的 320px 时间线浮层 · 锚在导轨左侧整屏局部 | 15 | pw-anim-flash pw-assistant pw-chat pw-minimap-pop pw-minimap-rail pw-proc pw-proc-head |
| 53-turn-and-nav.html | 等待首 token 的阶段行 · 回合写过的文件 | 15 | pw-card pw-card-body pw-card-foot pw-dur pw-step pw-step-ico pw-verb |
| 53-turn-and-nav.html | 输入框旁的芯片 · 路径动作 · Git ref 芯片 · 项目芯片 / 待办芯片 / 路径菜单 / 分支标签 | 20 | pw-chips pw-desc |
| 54-extension-links-exploration.html | 扩展浮窗 · 状态胶囊 · widget 在顶栏 blocks 浮窗里展开；状态收成聊天区右上角一枚 mono 胶囊（输入框下方无常驻行） | 13 | pw-card pw-card-head pw-desc |
| 54-extension-links-exploration.html | 链接在哪儿打开 · 附件预览 · 正文里的外链给三选一；附件点开按类型分渲染分支 | 15 | pw-filecard pw-fname pw-meta |
| 54-extension-links-exploration.html | 探索分支 · 转录顶部的抬头条 + 右栏只读并排视图（带「带回结论」）1440 × 760 | 44 | pw-assistant pw-body pw-card-foot pw-chat pw-composer-wrap pw-m pw-main pw-session pw-t pw-tab |
| 56-update-and-auth.html | 插件更新 · 五态 · 状态机是 PluginUpdateState：update-available / up-to-date / unsupported / error，外加一个 checking 布尔 | 8 | ✅ 全出现 |
| 56-update-and-auth.html | 列表项状态 · 技能更新指示 · 应用更新提示 | 11 | pw-grid3 |
| 56-update-and-auth.html | agent 认证（设计提案） · agent 报 -32000 auth_required 时：先在转录里出一条状态卡，再给一个认证方式选择 | 23 | pw-card pw-card-body pw-card-foot pw-card-head pw-modal-body pw-modal-foot pw-path pw-term pw-tool |
| 60-mobile-pwa.html | 手机 · 三种主状态 · A 主界面（与桌面同构）· B 抽屉侧栏 · C 窄屏「更多控件」（展开在顶栏，不是底部）390 × 800 | 40 | pw-assistant pw-await pw-body pw-chat pw-composer-wrap pw-m pw-mobile-actions pw-mobile-top pw-proc pw-proc-head pw-session pw-t |
| 60-mobile-pwa.html | PWA · 独立窗口与安装 · 触控适配 · 信任横幅 | 25 | pw-assistant pw-banner pw-chat pw-composer-wrap pw-mobile-top pw-perm pw-perm-acts pw-perm-title |
| 60-mobile-pwa.html | 断点与布局切换表 · 四档宽度下三栏壳怎么变（交互不新增，只改尺寸与折叠） | 4 | pw-grid4 |
| 60-mobile-pwa.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion移动端与桌面同构 | 8 | pw-anim-pop pw-anim-sheet |
| 61-system-states.html | 应用级错误页 · A 路由错误（带主题 token）· B 根布局错误（无 token，跟随系统） | 8 | pw-card-foot |
| 61-system-states.html | 拖放落区 · A 可接受（拖文件进窗口）· B 拒绝（拖进的是不支持的东西）· C 拖到输入框 | 16 | pw-drop |
| 61-system-states.html | worktree 切换器 · 一个项目下多份检出：切换 / 过滤 / 新建 / 移除（未提交要强制确认） | 29 | pw-await pw-body pw-desc pw-m pw-modal-body pw-modal-foot pw-pop-search pw-session pw-t |
| 61-system-states.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion拖到输入框 = 加附件 | 7 | pw-anim-drop pw-anim-row pw-drop |
| 62-settings-layout.html | 诊断 · 现在有四种骨架 · 同一层级的 12 个分节，切换时视觉锚点会跳2026-09-30 仓库构建实测 | 5 | pw-desc pw-grid4 |
| 62-settings-layout.html | 新框架解剖 · 一套骨架 · 两个宽度（列表 300 / 内容 760）· 唯一滚动在内容区1440 × 900 | 32 | ✅ 全出现 |
| 62-settings-layout.html | 块流页 · 两栏 · 没有「条目」概念的分节用两栏块流，每栏 570 —— 字段行跨度从 1160 收到 5701440 × 900 | 30 | pw-wallpaper-thumb |
| 62-settings-layout.html | 空态三态 · 动作层级 · 空态必须有落点；动作只有四个层级，页脚不再放动作 | 11 | ✅ 全出现 |
| 62-settings-layout.html | 12 个分节逐页落位 · 骨架二选一 · 页头恒在 · 页级动作最多 2 个骨架 A = 两栏块流（570 × 2） 骨架 B = 列表 300 + 详情 760 | 1 | ✅ 全出现 |
| 62-settings-layout.html | 新框架的硬规则 · 每一条都对应一个实测到的现状问题 | 3 | ✅ 全出现 |

## 二、全局缺失的画板类

- `pw-anim-breathe`
- `pw-anim-collapse`
- `pw-anim-drop`
- `pw-anim-expand`
- `pw-anim-flash`
- `pw-anim-notice`
- `pw-anim-pending`
- `pw-anim-phase`
- `pw-anim-pop`
- `pw-anim-reveal`
- `pw-anim-rise`
- `pw-anim-row`
- `pw-anim-saved`
- `pw-anim-sheet`
- `pw-anim-shimmer`
- `pw-anim-spin`
- `pw-anim-step`
- `pw-anim-stream`
- `pw-anim-sweep`
- `pw-anim-trigger`
- `pw-arg`
- `pw-assistant`
- `pw-audio`
- `pw-await`
- `pw-banner`
- `pw-body`
- `pw-browser`
- `pw-browser-bar`
- `pw-card`
- `pw-card-body`
- `pw-card-foot`
- `pw-card-head`
- `pw-chat`
- `pw-chipbtn`
- `pw-chips`
- `pw-commit`
- `pw-compact`
- `pw-composer-wrap`
- `pw-desc`
- `pw-diff-body`
- `pw-diff-head`
- `pw-diff-line`
- `pw-drop`
- `pw-dur`
- `pw-filecard`
- `pw-fname`
- `pw-git`
- `pw-grid3`
- `pw-grid4`
- `pw-icon-cell`
- `pw-img`
- `pw-live`
- `pw-m`
- `pw-main`
- `pw-mark`
- `pw-math`
- `pw-meta`
- `pw-minimap-pop`
- `pw-minimap-rail`
- `pw-mobile-actions`
- `pw-mobile-top`
- `pw-modal-body`
- `pw-modal-foot`
- `pw-path`
- `pw-perm`
- `pw-perm-acts`
- `pw-perm-body`
- `pw-perm-title`
- `pw-plan`
- `pw-plan-head`
- `pw-pop-search`
- `pw-proc`
- `pw-proc-body`
- `pw-proc-head`
- `pw-quote`
- `pw-rail`
- `pw-row-toggle`
- `pw-scrim`
- `pw-search-hit`
- `pw-search-project`
- `pw-search-results`
- `pw-session`
- `pw-side-search`
- `pw-starter`
- `pw-starters`
- `pw-step`
- `pw-step-ico`
- `pw-strong`
- `pw-sub`
- `pw-sub-head`
- `pw-sub-line`
- `pw-swatch-cell`
- `pw-swatches-row`
- `pw-t`
- `pw-tab`
- `pw-tasklist`
- `pw-term`
- `pw-think`
- `pw-toast`
- `pw-todo`
- `pw-tok-cmd`
- `pw-tok-key`
- `pw-tok-num`
- `pw-tok-ref`
- `pw-tool`
- `pw-tree`
- `pw-url`
- `pw-verb`
- `pw-viewer`
- `pw-viewer-body`
- `pw-viewer-head`
- `pw-wallpaper-thumb`

## 三、按钮签名差异（画板有、产品巡检未命中）

| 画板 | 帧 | 类 | 图标 | 文本 |
|---|---|---|---|---|
| 00-tokens.html | 字阶（5 档）· 间距（4px 网格）· 圆角（3 档）· 控件高度 | pw-btn |  | 移上来 |
| 00-tokens.html | 字阶（5 档）· 间距（4px 网格）· 圆角（3 档）· 控件高度 | pw-btn |  | 按住我 |
| 00-tokens.html | 字阶（5 档）· 间距（4px 网格）· 圆角（3 档）· 控件高度 | pw-btn |  | 主按钮 |
| 00-tokens.html | 字阶（5 档）· 间距（4px 网格）· 圆角（3 档）· 控件高度 | pw-btn |  | 危险 ghost |
| 01-workbench.html | 帧 A · 新会话（空态首屏） · 右栏收起 · 侧栏展开 · 无项目时顶部给引导1440 × 900 | pw-session |  | 排查最新 Release 与本地待上传改动2 分钟前 · 18 条消息 |
| 01-workbench.html | 帧 A · 新会话（空态首屏） · 右栏收起 · 侧栏展开 · 无项目时顶部给引导1440 × 900 | pw-session | triangle-alert | 窗口切在回合中间时的渲染修复12 分钟前 · 6 条消息 等你处理 |
| 01-workbench.html | 帧 A · 新会话（空态首屏） · 右栏收起 · 侧栏展开 · 无项目时顶部给引导1440 × 900 | pw-session |  | AcpAgentClient 对比与借鉴清单1 小时前 · 24 条消息 |
| 01-workbench.html | 帧 A · 新会话（空态首屏） · 右栏收起 · 侧栏展开 · 无项目时顶部给引导1440 × 900 | pw-iconbtn | square-pen |  |
| 01-workbench.html | 帧 A · 新会话（空态首屏） · 右栏收起 · 侧栏展开 · 无项目时顶部给引导1440 × 900 | pw-iconbtn | rotate-cw |  |
| 01-workbench.html | 帧 A · 新会话（空态首屏） · 右栏收起 · 侧栏展开 · 无项目时顶部给引导1440 × 900 | pw-iconbtn | panel-right |  |
| 01-workbench.html | 帧 A · 新会话（空态首屏） · 右栏收起 · 侧栏展开 · 无项目时顶部给引导1440 × 900 | pw-starter | scan-search | 探索代码库这个项目的入口在哪，模块怎么分 |
| 01-workbench.html | 帧 A · 新会话（空态首屏） · 右栏收起 · 侧栏展开 · 无项目时顶部给引导1440 × 900 | pw-starter | git-compare | 评审改动看看工作区里未提交的改动有没有问题 |
| 01-workbench.html | 帧 A · 新会话（空态首屏） · 右栏收起 · 侧栏展开 · 无项目时顶部给引导1440 × 900 | pw-starter | square-check | 补测试给刚才改的那几个文件补上回归用例 |
| 01-workbench.html | 帧 A · 新会话（空态首屏） · 右栏收起 · 侧栏展开 · 无项目时顶部给引导1440 × 900 | pw-starter | book-open | 讲解一段代码把这个文件从头到尾讲一遍 |
| 01-workbench.html | 帧 B · 进行中的一轮 · 过程时间轴 + 权限卡 + 运行中的工具卡 · 输入框变停止 · 侧栏会话行出运行点1440 × 900 | pw-session |  | 排查最新 Release 与本地待上传改动刚刚 · 19 条消息 |
| 01-workbench.html | 帧 B · 进行中的一轮 · 过程时间轴 + 权限卡 + 运行中的工具卡 · 输入框变停止 · 侧栏会话行出运行点1440 × 900 | pw-session | triangle-alert | 窗口切在回合中间时的渲染修复12 分钟前 · 6 条消息 等你处理 |
| 01-workbench.html | 帧 B · 进行中的一轮 · 过程时间轴 + 权限卡 + 运行中的工具卡 · 输入框变停止 · 侧栏会话行出运行点1440 × 900 | pw-session |  | AcpAgentClient 对比与借鉴清单1 小时前 · 24 条消息 |
| 01-workbench.html | 帧 B · 进行中的一轮 · 过程时间轴 + 权限卡 + 运行中的工具卡 · 输入框变停止 · 侧栏会话行出运行点1440 × 900 | pw-iconbtn | square-pen |  |
| 01-workbench.html | 帧 B · 进行中的一轮 · 过程时间轴 + 权限卡 + 运行中的工具卡 · 输入框变停止 · 侧栏会话行出运行点1440 × 900 | pw-iconbtn | rotate-cw |  |
| 01-workbench.html | 帧 B · 进行中的一轮 · 过程时间轴 + 权限卡 + 运行中的工具卡 · 输入框变停止 · 侧栏会话行出运行点1440 × 900 | pw-iconbtn | panel-right |  |
| 01-workbench.html | 帧 B · 进行中的一轮 · 过程时间轴 + 权限卡 + 运行中的工具卡 · 输入框变停止 · 侧栏会话行出运行点1440 × 900 | pw-step | brain | 推理 先看 release 目录里落的是哪个版本，再拿 git status 跟它比… |
| 01-workbench.html | 帧 B · 进行中的一轮 · 过程时间轴 + 权限卡 + 运行中的工具卡 · 输入框变停止 · 侧栏会话行出运行点1440 × 900 | pw-step | terminal | 运行 git log --oneline -5 0.4s |
| 01-workbench.html | 帧 B · 进行中的一轮 · 过程时间轴 + 权限卡 + 运行中的工具卡 · 输入框变停止 · 侧栏会话行出运行点1440 × 900 | pw-step | file-search | 搜索 "v0.9.4" → release/ 下 3 处 0.9s |
| 01-workbench.html | 帧 B · 进行中的一轮 · 过程时间轴 + 权限卡 + 运行中的工具卡 · 输入框变停止 · 侧栏会话行出运行点1440 × 900 | pw-step | file-text | 读取 release/RELEASE.md 0.2s |
| 01-workbench.html | 帧 B · 进行中的一轮 · 过程时间轴 + 权限卡 + 运行中的工具卡 · 输入框变停止 · 侧栏会话行出运行点1440 × 900 | pw-step | terminal | 运行 git diff --stat HEAD 运行中 |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-session |  | 排查最新 Release 与本地待上传改动刚刚 · 22 条消息 |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-session | triangle-alert | 窗口切在回合中间时的渲染修复12 分钟前 · 6 条消息 等你处理 |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-iconbtn | square-pen |  |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-iconbtn | rotate-cw |  |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-iconbtn | panel-right |  |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-chip | file-text | AGENTS.md |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-chip | file-text | design/README.md |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-chip | list-checks | 2 / 4 本轮计划 |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-prow |  | Context26,480 |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-prow |  | Rules4,182 |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-prow |  | 本轮 ↑ / ↓8,912 / 1,328 |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-prow |  | 本会话花费$0.021 |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-prow |  | 结束原因stop |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-iconbtn | folder-tree |  |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-iconbtn | terminal |  |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-trow | chevron-down | app |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-trow | chevron-down | api |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-trow | file-code | route.ts |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-trow | file-code | layout.tsx |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-trow | file-code | globals.css |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-trow | file-code | page.tsx |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-trow | chevron-down | components |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-trow | file-code | ChatInput.tsx |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-trow | file-code | AppShell.tsx |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-trow | chevron-right | lib |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-trow | chevron-right | design |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-trow | file-text | AGENTS.md |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-iconbtn | code |  |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-iconbtn | copy |  |
| 01-workbench.html | 帧 C · 回合结束 + 右栏展开 · 右栏是文件树 + 查看器 · 转录里过程已折叠成一行 · 末尾是回合结束行1440 × 900 | pw-iconbtn | external-link |  |
| 01-workbench.html | 帧 D · 零会话起步 · 选中型空态 · 两个「还没有内容」的首屏 + 起步卡的展开态 · 不画壳，只画首屏本身840 × 480 | pw-starter | scan-search | 探索代码库这个项目的入口在哪，模块怎么分 |
| 01-workbench.html | 帧 D · 零会话起步 · 选中型空态 · 两个「还没有内容」的首屏 + 起步卡的展开态 · 不画壳，只画首屏本身840 × 480 | pw-starter | git-compare | 评审改动看看工作区里未提交的改动有没有问题 |
| 01-workbench.html | 帧 D · 零会话起步 · 选中型空态 · 两个「还没有内容」的首屏 + 起步卡的展开态 · 不画壳，只画首屏本身840 × 480 | pw-starter | square-check | 补测试给刚才改的那几个文件补上回归用例 |
| 01-workbench.html | 帧 D · 零会话起步 · 选中型空态 · 两个「还没有内容」的首屏 + 起步卡的展开态 · 不画壳，只画首屏本身840 × 480 | pw-starter | book-open | 讲解一段代码把这个文件从头到尾讲一遍 |
| 01-workbench.html | 帧 D · 零会话起步 · 选中型空态 · 两个「还没有内容」的首屏 + 起步卡的展开态 · 不画壳，只画首屏本身840 × 480 | pw-starter | folder | 选择文件夹为这个会话选一个工作目录 |
| 01-workbench.html | 帧 D · 零会话起步 · 选中型空态 · 两个「还没有内容」的首屏 + 起步卡的展开态 · 不画壳，只画首屏本身840 × 480 | pw-starter | clock | 用最近的项目来自 VS Code、Zed、Claude Code、Codex 或 OpenCod |
| 01-workbench.html | 帧 D · 零会话起步 · 选中型空态 · 两个「还没有内容」的首屏 + 起步卡的展开态 · 不画壳，只画首屏本身840 × 480 | pw-starter | import | 导入会话粘贴会话链接或 ID |
| 01-workbench.html | 帧 D · 零会话起步 · 选中型空态 · 两个「还没有内容」的首屏 + 起步卡的展开态 · 不画壳，只画首屏本身840 × 480 | pw-litem | folder | pi-codexCodex |
| 01-workbench.html | 帧 D · 零会话起步 · 选中型空态 · 两个「还没有内容」的首屏 + 起步卡的展开态 · 不画壳，只画首屏本身840 × 480 | pw-litem | folder | AcpAgentClientVS Code |
| 01-workbench.html | 帧 D · 零会话起步 · 选中型空态 · 两个「还没有内容」的首屏 + 起步卡的展开态 · 不画壳，只画首屏本身840 × 480 | pw-litem | folder | chat-workspaceZed |
| 01-workbench.html | 帧 D · 零会话起步 · 选中型空态 · 两个「还没有内容」的首屏 + 起步卡的展开态 · 不画壳，只画首屏本身840 × 480 | pw-btn |  | 打开 |
| 01-workbench.html | 帧 D · 零会话起步 · 选中型空态 · 两个「还没有内容」的首屏 + 起步卡的展开态 · 不画壳，只画首屏本身840 × 480 | pw-btn |  | 打开 |
| 01-workbench.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion切会话只动转录内容 | pw-anim-phase pw-step | brain | 正在思考… |
| 01-workbench.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion切会话只动转录内容 | pw-anim-phase pw-step | clock | 等待模型响应 |
| 01-workbench.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion切会话只动转录内容 | pw-anim-phase pw-step | wrench | 准备运行工具 |
| 01-workbench.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion切会话只动转录内容 | pw-anim-phase pw-step | terminal | 执行命令 |
| 01-workbench.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion切会话只动转录内容 | pw-anim-stream pw-step | search | grep fork:ui- |
| 01-workbench.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion切会话只动转录内容 | pw-anim-stream pw-step | file-text | read delta.md |
| 01-workbench.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion切会话只动转录内容 | pw-anim-stream pw-step | pencil-line | edit tokens.css |
| 02-sidebar-topbar.html | 侧栏 · 三种 pane 状态并排 · 宽 280 · 高 660A 项目 pane · B 聊天 pane · C 搜索 | pw-session |  | 排查最新 Release 与本地待上传改动刚刚 · 19 条消息 |
| 02-sidebar-topbar.html | 侧栏 · 三种 pane 状态并排 · 宽 280 · 高 660A 项目 pane · B 聊天 pane · C 搜索 | pw-session | triangle-alert | 窗口切在回合中间时的渲染修复12 分钟前 · 6 条消息 待授权 |
| 02-sidebar-topbar.html | 侧栏 · 三种 pane 状态并排 · 宽 280 · 高 660A 项目 pane · B 聊天 pane · C 搜索 | pw-session |  | AcpAgentClient 对比与借鉴清单1 小时前 · 24 条消息 |
| 02-sidebar-topbar.html | 侧栏 · 三种 pane 状态并排 · 宽 280 · 高 660A 项目 pane · B 聊天 pane · C 搜索 | pw-session |  | Codex 皮肤 token 台账昨天 · 41 条消息 |
| 02-sidebar-topbar.html | 侧栏 · 三种 pane 状态并排 · 宽 280 · 高 660A 项目 pane · B 聊天 pane · C 搜索 | pw-session |  | 标讯详情页正文加载失败3 天前 · 9 条消息 |
| 02-sidebar-topbar.html | 侧栏 · 三种 pane 状态并排 · 宽 280 · 高 660A 项目 pane · B 聊天 pane · C 搜索 | pw-session |  | React 19 的 use() 到底怎么用2 小时前 · 8 条消息 |
| 02-sidebar-topbar.html | 侧栏 · 三种 pane 状态并排 · 宽 280 · 高 660A 项目 pane · B 聊天 pane · C 搜索 | pw-session |  | 帮我算一下这个月开销昨天 · 5 条消息 |
| 02-sidebar-topbar.html | 侧栏 · 三种 pane 状态并排 · 宽 280 · 高 660A 项目 pane · B 聊天 pane · C 搜索 | pw-session |  | 两个方案的取舍刚刚 · 3 条消息 |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-session |  | 运行中 · 底边一条扫掠亮点线 刚刚 · 19 条消息 |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-session |  | 未读 · N 条消息 之后一个绿点 1 小时前 · 24 条消息 |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-session | triangle-alert | 等你处理 · 之后一个 warning 标记 12 分钟前 · 6 条消息 待授权 |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-session |  | 已读 · 什么都没有 昨天 · 41 条消息 |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-session |  | 默认态1 小时前 · 6 条消息 |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-session | square-pen | 悬浮 · 出重命名与删除1 小时前 · 6 条消息 |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-session |  | 选中 + 运行中 · 底加深、标题加重、底边扫掠刚刚 · 19 条消息 |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-session | corner-down-right | 子代理缩进一级Explore · 12s |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-session |  | 重命名中 · 内联输入 |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-iconbtn | panel-right |  |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-iconbtn | square-pen |  |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-iconbtn | settings |  |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-prow | folder-open | 在文件管理器中打开 |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-prow | square-pen | 重命名项目 |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-prow | archive | 归档项目 |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-prow | minus | 从列表移除 |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-prow | pin | 置顶P |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-prow | archive | 归档 |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-prow | tag | 状态标签 |
| 02-sidebar-topbar.html | 会话行五态 · 折叠导轨 · 项目行悬浮动作 · 状态点 7px，用颜色表达状态，不写状态文字 | pw-prow | copy | 复制会话引用 |
| 02-sidebar-topbar.html | 顶栏 · 三种上下文 · 高 36 · 左侧标题随上下文变化，右侧动作随能力显示 | pw-iconbtn | square-pen |  |
| 02-sidebar-topbar.html | 顶栏 · 三种上下文 · 高 36 · 左侧标题随上下文变化，右侧动作随能力显示 | pw-iconbtn | rotate-cw |  |
| 02-sidebar-topbar.html | 顶栏 · 三种上下文 · 高 36 · 左侧标题随上下文变化，右侧动作随能力显示 | pw-iconbtn | panel-right |  |
| 02-sidebar-topbar.html | 顶栏 · 三种上下文 · 高 36 · 左侧标题随上下文变化，右侧动作随能力显示 | pw-iconbtn | panel-right |  |
| 02-sidebar-topbar.html | 顶栏 · 三种上下文 · 高 36 · 左侧标题随上下文变化，右侧动作随能力显示 | pw-iconbtn | arrow-right-left |  |
| 02-sidebar-topbar.html | 顶栏 · 三种上下文 · 高 36 · 左侧标题随上下文变化，右侧动作随能力显示 | pw-iconbtn | panel-right |  |
| 05-motion.html | 全系统动效清单 · 十七项 · 每一格都是真在播的循环演示每格一个动效 | pw-prow |  | GPT-5.6 Luna |
| 05-motion.html | 全系统动效清单 · 十七项 · 每一格都是真在播的循环演示每格一个动效 | pw-prow |  | Claude Sonnet 4.5 |
| 05-motion.html | 全系统动效清单 · 十七项 · 每一格都是真在播的循环演示每格一个动效 | pw-step | file-text | read a.ts |
| 05-motion.html | 全系统动效清单 · 十七项 · 每一格都是真在播的循环演示每格一个动效 | pw-step | pencil-line | edit b.ts |
| 05-motion.html | 全系统动效清单 · 十七项 · 每一格都是真在播的循环演示每格一个动效 | pw-anim-stream pw-step | terminal | npm run prod2.1s |
| 05-motion.html | 全系统动效清单 · 十七项 · 每一格都是真在播的循环演示每格一个动效 | pw-anim-stream pw-step | file-text | read delta.md |
| 05-motion.html | 全系统动效清单 · 十七项 · 每一格都是真在播的循环演示每格一个动效 | pw-anim-stream pw-step | search | grep fork:ui |
| 05-motion.html | 全系统动效清单 · 十七项 · 每一格都是真在播的循环演示每格一个动效 | pw-anim-phase pw-step | brain | 正在思考… |
| 05-motion.html | 全系统动效清单 · 十七项 · 每一格都是真在播的循环演示每格一个动效 | pw-anim-phase pw-step | clock | 等待模型响应 |
| 05-motion.html | 全系统动效清单 · 十七项 · 每一格都是真在播的循环演示每格一个动效 | pw-anim-phase pw-step | wrench | 准备运行工具 |
| 05-motion.html | 全系统动效清单 · 十七项 · 每一格都是真在播的循环演示每格一个动效 | pw-anim-phase pw-step | terminal | 执行命令 |
| 11-transcript-process.html | 过程时间轴（ProcessGroup） · 进行中 / 含失败 / 已完成折叠三态；汇总行给计数，失败行就地标红 | pw-step | brain | 推理 先看三个调用点的实际取值，再决定 hook 的签名… |
| 11-transcript-process.html | 过程时间轴（ProcessGroup） · 进行中 / 含失败 / 已完成折叠三态；汇总行给计数，失败行就地标红 | pw-step | file-search | 搜索 "RIGHT_PANEL_FALLBACK_WIDTH" → 4 处 0.6s |
| 11-transcript-process.html | 过程时间轴（ProcessGroup） · 进行中 / 含失败 / 已完成折叠三态；汇总行给计数，失败行就地标红 | pw-step | file-text | 读取 hooks/useResizablePanel.ts 0.2s |
| 11-transcript-process.html | 过程时间轴（ProcessGroup） · 进行中 / 含失败 / 已完成折叠三态；汇总行给计数，失败行就地标红 | pw-step | pencil-line | 编辑 hooks/useResizablePanel.ts +42 −18 6s |
| 11-transcript-process.html | 过程时间轴（ProcessGroup） · 进行中 / 含失败 / 已完成折叠三态；汇总行给计数，失败行就地标红 | pw-step | triangle-alert | 运行 npm run test:panel 失败3s |
| 11-transcript-process.html | 过程时间轴（ProcessGroup） · 进行中 / 含失败 / 已完成折叠三态；汇总行给计数，失败行就地标红 | pw-step | brain | 推理 测试文件没跟上新签名，先补断言… |
| 11-transcript-process.html | 过程时间轴（ProcessGroup） · 进行中 / 含失败 / 已完成折叠三态；汇总行给计数，失败行就地标红 | pw-step | terminal | 运行 node --test hooks/useResizablePanel.test.mjs  |
| 11-transcript-process.html | 过程时间轴（ProcessGroup） · 进行中 / 含失败 / 已完成折叠三态；汇总行给计数，失败行就地标红 | pw-step | file-text | 读取 AGENTS.md 0.1s |
| 11-transcript-process.html | 终端卡 · 子代理卡 · 终端运行中 / 已退出；子代理运行中 / 完成 | pw-step | file-text | 读取 design/README.md 0.3s |
| 11-transcript-process.html | 终端卡 · 子代理卡 · 终端运行中 / 已退出；子代理运行中 / 完成 | pw-step | file-search | 搜索 "data-screen-label" → 40 处 1.1s |
| 11-transcript-process.html | 终端卡 · 子代理卡 · 终端运行中 / 已退出；子代理运行中 / 完成 | pw-step | terminal | 运行 wc -l design/round-design/*.dc.html 0.2s |
| 11-transcript-process.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion展开折叠只动高度与透明度 | pw-step | file-text | read a.ts |
| 11-transcript-process.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion展开折叠只动高度与透明度 | pw-step | pencil-line | edit b.ts |
| 11-transcript-process.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion展开折叠只动高度与透明度 | pw-anim-stream pw-step | terminal | npm run prod2.1s |
| 11-transcript-process.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion展开折叠只动高度与透明度 | pw-anim-stream pw-step | file-text | read delta.md |
| 11-transcript-process.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion展开折叠只动高度与透明度 | pw-anim-stream pw-step | search | grep fork:ui- |
| 12-transcript-interactive.html | 权限授权卡 · 三档动作 + 范围下拉；原始入参可折叠 | pw-prow | circle-dot | 只允许这一条命令 |
| 12-transcript-interactive.html | 权限授权卡 · 三档动作 + 范围下拉；原始入参可折叠 | pw-prow | terminal | 本会话内允许 bash |
| 12-transcript-interactive.html | 权限授权卡 · 三档动作 + 范围下拉；原始入参可折叠 | pw-prow | folder | 本会话内允许 pi-codex 下全部工具 |
| 12-transcript-interactive.html | 权限授权卡 · 三档动作 + 范围下拉；原始入参可折叠 | pw-prow | ban | 本会话内始终拒绝 bash |
| 20-composer.html | 输入框 · 三种状态 · 空闲 / 流式中（停止 + 队列）/ 无项目（禁用） | pw-chip | file-text | docs/codex-skin/delta.md |
| 20-composer.html | 输入框 · 三种状态 · 空闲 / 流式中（停止 + 队列）/ 无项目（禁用） | pw-chip | x |  |
| 20-composer.html | 附件与引用 · 附件芯片条 / 引用上下文条 / 图片附件预览 / 上传失败 | pw-chip | image | screenshot.png |
| 20-composer.html | 附件与引用 · 附件芯片条 / 引用上下文条 / 图片附件预览 / 上传失败 | pw-chip | file-code | AppShell.tsx |
| 20-composer.html | 附件与引用 · 附件芯片条 / 引用上下文条 / 图片附件预览 / 上传失败 | pw-chip | file-text | delta.md |
| 20-composer.html | 附件与引用 · 附件芯片条 / 引用上下文条 / 图片附件预览 / 上传失败 | pw-chip | circle-x | screenshot-4k.png · 超过 20 MB |
| 20-composer.html | 阅读态输入框塌陷 · 上下文浮窗 · 向上翻阅时收成一行；悬浮圆环看 Context / Rules / cost | pw-litem | arrow-up | 收起真实用户滚动（wheel / 触摸 / 键盘 / 拖滚动条）+ 方向向上 + 离底 > 12 |
| 20-composer.html | 阅读态输入框塌陷 · 上下文浮窗 · 向上翻阅时收成一行；悬浮圆环看 Context / Rules / cost | pw-litem | arrow-down | 展开方向向下且离底 ≤ 8px，或者输入框拿到焦点（一定展开） |
| 20-composer.html | 阅读态输入框塌陷 · 上下文浮窗 · 向上翻阅时收成一行；悬浮圆环看 Context / Rules / cost | pw-litem | ban | 不参与判定程序化滚动（打开会话锚点、懒加载前插、完成自动滚）与 ResizeObserver 复 |
| 20-composer.html | 阅读态输入框塌陷 · 上下文浮窗 · 向上翻阅时收成一行；悬浮圆环看 Context / Rules / cost | pw-prow |  | Context10k / 1M |
| 20-composer.html | 阅读态输入框塌陷 · 上下文浮窗 · 向上翻阅时收成一行；悬浮圆环看 Context / Rules / cost | pw-prow |  | Rules4.2k |
| 20-composer.html | 阅读态输入框塌陷 · 上下文浮窗 · 向上翻阅时收成一行；悬浮圆环看 Context / Rules / cost | pw-prow |  | 本会话花费$0.021 |
| 20-composer.html | 阅读态输入框塌陷 · 上下文浮窗 · 向上翻阅时收成一行；悬浮圆环看 Context / Rules / cost | pw-prow |  | 本轮 in / out8,912 / 1,328 |
| 20-composer.html | 阅读态输入框塌陷 · 上下文浮窗 · 向上翻阅时收成一行；悬浮圆环看 Context / Rules / cost | pw-prow |  | Context10k / 1M |
| 20-composer.html | 阅读态输入框塌陷 · 上下文浮窗 · 向上翻阅时收成一行；悬浮圆环看 Context / Rules / cost | pw-prow |  | Rules4.2k |
| 20-composer.html | 阅读态输入框塌陷 · 上下文浮窗 · 向上翻阅时收成一行；悬浮圆环看 Context / Rules / cost | pw-dim pw-prow |  | 花费与用量行整段省略，不留空行 |
| 20-composer.html | 输入历史 · 模型错误 · 流式两种模式 · 收起控件 | pw-prow | zap | Steer · 立即打断停掉当前这轮，把新消息插进去 |
| 20-composer.html | 输入历史 · 模型错误 · 流式两种模式 · 收起控件 | pw-prow | inbox | Follow-up · 排队等这轮跑完再发，不打断 |
| 20-composer.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion输入框下面没有第二条横条 | pw-prow | check | GPT-5.6 Luna |
| 20-composer.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion输入框下面没有第二条横条 | pw-prow |  | Claude Sonnet 4.5 |
| 20-composer.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion输入框下面没有第二条横条 | pw-anim-step pw-prow |  | design/pi-web-design/DESIGN-SPEC.md |
| 20-composer.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion输入框下面没有第二条横条 | pw-anim-step pw-prow |  | docs/design-system-comparison-2026-09-28.md |
| 20-composer.html | 本页动效 · 循环播放 · 规格与全量清单见画板 05-motion输入框下面没有第二条横条 | pw-anim-step pw-prow |  | AGENTS.md |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | zap | DeepSeek V4.1 FlashLatest |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | sparkles | Claude Sonnet 4.5订阅 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | zap | V4.1 Flash128K |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | brain | V4.1 Reasoner128K |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | sparkles | Claude Opus 4.5订阅 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | circle-off | Claude Haiku 4未启用 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow |  | auto由模型决定 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow |  | off不思考 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow |  | minimal1,024 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow |  | low4,096 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | check | high16,384 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow |  | max不限制 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | message-square | chat-only只用对话 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | wrench | 内置默认集 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | boxes | 全部内置含危险工具 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | sliders-horizontal | 已配置12 / 18 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | zap | 全自动不问直接做 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | shield-check | 需审批写文件与命令要问 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | list-checks | 计划模式先给方案再动手 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | file-code | AppShell.tsxcomponents/ |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | file-code | AppShell.test.mjscomponents/ |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | folder | app目录 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | message-square | 窗口切在回合中间时的渲染修复12 分钟前 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | list-todo | 补窄屏与宽屏两条单测 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | server | filesystem / project-root已连接 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | database | postgres / schema.sql已连接 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | server | playwright未连接 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | history | design/README.md |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | history | AGENTS.md |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | refresh-cw | /reload重载 agent 连接 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | package | /compact压缩上下文 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | square-function | /review评审当前改动 <范围> |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | square-function | /release打 tag 并更新台账 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | box | /zhaobiao-extract招标结构化抽取 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow | box | /pdf已禁用自动调用 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow |  | 1把 design/pi-web-design 的断点表按实现改成 1024 / 640 / 4 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow |  | 2排查最新 Release 与本地待上传改动 |
| 21-menus.html | 弹层合集 · 全部 320 宽 · 圆角 6 · 唯一一种阴影 · 悬浮行用 6% 深色容器1200 × 800 | pw-prow |  | 3窗口切在回合中间时的渲染修复 |

## 四、巡检步骤与截图

- `step-01-空态首屏.png` — **01-空态首屏**：画板 01 帧 A：新会话页（上下文条 / 起步卡 / 输入卡）（40 类 / 62 可点）
- `step-02-输入卡弹层.png` — **02-输入卡弹层**：画板 20/21：五个 pw-select + 上下文环浮窗 + 附件芯片（44 类 / 64 可点）
- `step-03-引用与命令菜单.png` — **03-引用与命令菜单**：画板 21：@ 四类 + / 命令 + 输入历史（46 类 / 69 可点）
- `step-04-转录与过程时间轴.png` — **04-转录与过程时间轴**：画板 10/11/12：消息卡 + 步骤流 + 结束行 + 迷你地图（46 类 / 69 可点）
- `step-05-右栏各标签.png` — **05-右栏各标签**：画板 30/31/52：文件树 / 查看器 / 终端 / 浏览器 / Git · ⚠️ document is not defined（45 类 / 67 可点）
- `step-06-设置十三分节.png` — **06-设置十三分节**：画板 40~47：左导航 13 节逐个打开（101 类 / 289 可点）
- `step-07-关闭设置后的工作台.png` — **07-关闭设置后的工作台**：画板 01 帧 B/C（45 类 / 67 可点）
- `step-08-文件树与查看器.png` — **08-文件树与查看器**：画板 30/52：树头动作组 / 分组头 / 右键菜单 / 查看器头与 diff 覆盖层（45 类 / 67 可点）
- `step-09-终端面板.png` — **09-终端面板**：画板 31：cwd 状态条 + 状态徽章 + 重连/重启（45 类 / 67 可点）
- `step-11-移动端同构.png` — **11-移动端同构**：画板 60：390×800 抽屉 / 顶栏 48 / 覆盖式工具条 / 信任横幅（47 类 / 62 可点）

## 五、汇总

- 画板类落地率：**104 / 212 = 49%**
- 按帧计无缺口：28 / 114
