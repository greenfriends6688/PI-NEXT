# PI NEXT Apple 平台化设计规范与 DeepSeek 执行交接

> 文档用途：交给 DeepSeek 执行 PI NEXT 的页面设计系统整理与界面优化。
>
> 本文的结论来自当前源码、样式加载关系、组件分支、Apple UI Kit 提取文件和设计目录结构的独立审计。不要把 `docs/design-review-oil-ui-2026-10-10.md` 或任何历史视觉评审文档当作本规范的问题基线，也不要引用其中的截图、结论、优先级或修复建议。

## 1. 设计目标与不可改变的产品定位

PI NEXT 是本地编码 Agent 工作台，不是普通聊天应用。页面需要同时服务于：

- 长时间阅读模型回复、代码、工具输出和终端日志；
- 管理会话、项目、文件、模型、插件、Skills、MCP 和权限；
- 在运行中观察 Agent、工具、子代理和扩展的状态；
- 在桌面、iPhone PWA、iPad/平板窗口中保持清晰的工作上下文。

最终视觉方向确定为“Apple 平台化”，而不是“所有屏幕使用同一套 CSS”：

| 平台 | 目标语言 | 核心交互 | 布局策略 |
| --- | --- | --- | --- |
| macOS Web | macOS 工具应用 / developer utility | toolbar、sidebar、pane、popover、inspector、快捷键 | 桌面三栏工作台 |
| iPad / 平板 | iPadOS 双栏应用 | 触控优先、popover、sheet、可收缩侧栏 | 自适应双栏 |
| iPhone PWA | iOS 原生应用 | navigation、grouped list、bottom sheet、safe area | 单列、底部操作 |

三端共享：品牌、业务语义、数据状态、文案、颜色语义和无障碍规则。

三端允许不同：布局、控件密度、圆角、触控尺寸、导航方式、浮层位置和手势。

不要为了所谓“统一”把 macOS 的侧栏缩小成手机抽屉，也不要把 iOS 的大触控控件原样放进桌面高密度工具栏。

## 2. 源码审计：当前真正的问题

### 2.1 运行时有多个设计系统同时生效

`app/layout.tsx` 的样式引入链包含：

1. `design/pi-web-design/assets/tokens.css`
2. `app/design/tokens.css`
3. `app/globals.css`
4. `app/settings.css`
5. `app/wallpaper.css`
6. `design/pi-web-design/assets/board.css`
7. `app/design/v5-forms.css`
8. `app/pwa-settings.css`
9. `app/pwa-models-skills.css`
10. `app/pwa-plugins-agents.css`
11. `app/fork-ui.css`
12. `app/fork-mac-skeuo.css`

其中 `app/design/v5-forms.css` 继续引入 `design/v5` 的 Apple 提取层、Web token、PWA token 和两套 system CSS。

这导致以下几套规则共同参与：

- `design/pi-web-design` 的 `--n-*` 和 `pw-*`；
- `app/design/tokens.css` 的 `--ds-*`；
- `app/globals.css` 中历史 Zeno/BoardUI 槽位；
- `design/v5/base.css` 的 `--nx-*` 角色 token；
- `design/v5/web/tokens.css` 的桌面形态值；
- `design/v5/pwa/tokens.css` 的移动形态值；
- `design/v5/sketch-ios.css` 和 `sketch-macos.css` 的 Apple Kit 原始值；
- `app/fork-ui.css` 的产品覆盖层；
- `app/fork-mac-skeuo.css` 的 macOS 材质覆盖层。

问题不只是“样式文件多”，而是同一语义存在多个名字和多个来源。例如：

- 旧组件读 `--radius-*`，V5 组件读 `--nx-r-*`；
- 旧设计系统有 `--n-*`，产品副本有 `--ds-*`，V5 又有 `--nx-*`；
- 颜色先由 Zeno/BoardUI 映射，再被 Apple 覆盖；
- `fork-ui.css` 和 `fork-mac-skeuo.css` 依赖加载顺序决定最终视觉。

### 2.2 字体优先级仍然不是 Apple 优先

`app/layout.tsx` 使用 Next Font 加载 Geist，并把 `--font-geist` 注入 HTML。`app/globals.css` 又把 Geist 放进 `--font-ui` 和 body 字体链的前部。

当前实际优先级接近：

```text
Geist → Noto Sans SC → system-ui → SF Pro Text → PingFang SC → 其他回退
```

这会让 Apple Kit 里的 SF Pro 字体只在 Geist 不可用时生效。中文又会因为不同系统回退到不同字体，造成字面高度、按钮宽度和行高漂移。

最终规则：

- macOS/Web：`-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", "PingFang SC", sans-serif`；
- iOS/PWA：优先系统 San Francisco，再回退 PingFang SC；
- 等宽：`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`；
- Geist 只能作为明确的跨平台回退，不能作为第一字体；
- 字体栈、字号、字重、字面行高必须进入 Apple 平台 token；
- 不要在组件内用 `fontFamily` 重新定义字体，除代码、终端和二维码编号等明确等宽场景外，全部继承平台字体。

### 2.3 圆角和控件尺寸并不唯一

源码中同时存在：

- `app/design/tokens.css` 的 3/4/6px 圆角；
- `app/globals.css` 的 `--radius-xs/sm/md/lg/xl/2xl`；
- `design/v5/web/tokens.css` 的 4/6/8/10/14/18px；
- `design/v5/pwa/tokens.css` 的 8/12/16/20/24/28px；
- Apple 覆盖层重新定义的 4/8/10/12/16/20px。

这意味着“卡片”“弹层”“输入框”“行容器”并没有稳定的视觉含义。

最终必须使用语义 token，而不是按大小猜角色：

```css
--nx-radius-control
--nx-radius-row
--nx-radius-card
--nx-radius-pane
--nx-radius-popover
--nx-radius-sheet
--nx-radius-pill
```

桌面和 PWA 可以为同一角色提供不同值，但角色名称必须相同，组件不能直接读取未经语义约束的 `--radius-md` 或 `--nx-r-lg`。

### 2.4 材质策略相互冲突

`docs/codex-skin/visual-spec.md` 描述的是 Zeno 中性灰、平面材质；`design/v5` 又提供玻璃、阴影、光晕和移动浮层；Apple 覆盖层再给侧栏、输入区和弹层加入 standard material。

最终不是“全站玻璃”，也不是“全站平面”，而是按平台和空间角色分层：

#### macOS Web

- 侧栏和顶部 toolbar 可以使用 Apple standard material；
- 主聊天阅读区是稳定画布，不依赖背景模糊；
- Markdown、代码、终端、工具结果必须在稳定表面上保证阅读；
- 菜单、popover、dialog 使用清晰的 elevated surface；
- 透明材质只用于真正需要透出壁纸或背景的层。

#### iPad / iPhone PWA

- 顶部导航、底部 composer、sheet 可以使用 iOS material；
- Alert、权限确认、设置页和 MCP/模型详情必须保持内容清晰；
- composer 必须同时处理 safe area 和键盘变化；
- 不能把所有 `.m-*` 组件都做成玻璃浮层；
- `backdrop-filter` 不能成为带 `position: fixed` 后代的定位祖先。

#### 固定技术规则

- 带 `backdrop-filter` 的容器不能包住依赖 viewport 定位的 fixed 浮层；
- 浮层统一通过 portal 渲染到 body 或应用级 overlay root；
- 暂时无法 portal 的浮层使用不透明背景；
- 不能通过降低透明度掩盖定位和层级错误；
- 不要用背景模糊替代边界、层级和信息结构。

### 2.5 断点和 React 平台分支不一致

`hooks/useIsMobile.ts` 当前有：

- `useIsMobile()`：`max-width: 640px`；
- `useIsCompact()`：`max-width: 1024px`；
- 横屏短视口：`max-width: 1024px and max-height: 500px`。

但 `AppShell.tsx`、`ChatInput.tsx` 等组件主要仍通过 `isMobile` 决定 `m-*` 与 `d-*` 结构，`compact` 只对部分工具条生效。结果是 641–1024px 处于“桌面 DOM + 部分移动压缩”的中间状态，没有明确的 iPad 交互层。

固定三档：

```text
M0: 0–639px       iPhone PWA
M1: 640–1023px    iPad / 平板双栏
M2: 1024px+       macOS Web
```

实施要求：

- CSS、React hook、设计 token、测试必须使用同一组断点常量；
- 组件不允许自行新增 640、641、959、1024 等判断；
- `pointer: coarse` 只决定触控命中区和手势，不单独决定整套页面结构；
- M1 必须有明确的双栏策略，不得只是让桌面布局自然挤压；
- M0 必须使用 iOS 导航和 sheet 语义，不得把桌面侧栏缩小后直接塞进手机。

### 2.6 Web/PWA 存在大量重复 JSX 分支

`AppShell.tsx`、`ChatInput.tsx`、`MessageView.tsx`、`FileViewer.tsx` 和设置组件中存在大量 `isMobile ? "m-*" : "d-*"` 和重复 DOM。

这会带来：

- 同一个状态只在一端显示；
- 错误、运行中、权限和空状态不一致；
- 业务语义与平台皮肤耦合；
- 修复一个组件需要同时修改多个分支；
- PWA 由于没有对应画板而静默隐藏信息。

不要求把所有 DOM 强行合并，但必须执行以下架构规则：

- 数据和状态模型共享；
- 平台只负责布局、交互方式和控件表现；
- 每个功能有 Web、iPad、PWA 三档状态矩阵；
- 共享逻辑先输出语义结构，再由 platform skin 决定视觉；
- 被隐藏的信息必须进入合理的详情、popover 或 sheet，不能静默丢失；
- 同一字段在三端使用相同文案和状态语义。

## 3. 唯一设计真值与迁移策略

### 3.1 真值层级

最终采用四层：

1. Apple Kit 原始提取层：`design/v5/sketch-ios.css`、`design/v5/sketch-macos.css`；
2. 共享语义层：`--nx-*`，只定义角色，不定义组件私有值；
3. 平台形态层：macOS、iPad、iPhone 分别提供同名角色的值；
4. 组件层：只读取语义角色，不直接引用原始 Apple 值。

Apple 原始层由脚本生成，不得手改。需要调整产品决策时修改语义映射层，并保留来源注释。

### 3.2 迁移顺序

DeepSeek 必须按此顺序执行：

1. 绘制当前 CSS import 图和 token 引用图；
2. 建立 `--n-*`、`--ds-*`、`--radius-*` 到 `--nx-*` 的迁移表；
3. 将字体、颜色、圆角、间距、控件高度、材质、阴影、动画统一映射到 `--nx-*`；
4. 让新组件只使用 `--nx-*`；
5. 逐批迁移旧组件；
6. 删除已无引用的旧 token 和覆盖层；
7. 最后才处理页面的视觉细节。

禁止通过以下方式“完成迁移”：

- 在 `fork-ui.css` 末尾再加一层覆盖；
- 把旧变量改名但继续保留两套别名；
- 让某个页面用 inline style 绕开 token；
- 用 `!important` 解决本应由所有权解决的问题；
- 为旧画板保留一套永远与运行时不同的设计值。

## 4. 平台外壳规范

### 4.1 macOS Web

- 侧栏是稳定的 macOS sidebar，支持收缩、项目分组和会话层级；
- 顶栏是通栏 toolbar，不是漂浮的圆角卡片；
- 中央聊天区保持连续画布，不把每一段内容都包成独立卡片；
- 右侧文件、终端、Git、调用轨迹和审查使用 inspector/pane 语义；
- 设置使用左侧分组导航 + 内容面板；
- 菜单支持 hover、键盘焦点、快捷键提示和上下文动作；
- 桌面控件使用 macOS 的 20/24/28/36px 密度阶梯；
- 桌面小控件可以紧凑，但所有键盘焦点必须可见。

### 4.2 iPhone PWA

- 顶部导航只负责当前标题、返回和必要的上下文动作；
- 会话和项目使用单列 grouped list；
- 模型、思考级别、工具权限、引用和附件使用 bottom sheet；
- 设置采用 grouped list + drill-in 页面；
- 所有主要操作命中区不小于 44pt；
- safe area 只在外层处理一次，避免顶部或底部重复留白；
- composer 不遮挡最后一条消息，并在键盘展开/收起时保持可用；
- 不依赖 hover；纯图标操作必须有 accessible name 和可发现的触控语义；
- 长路径、长 URL、代码和表格必须在内容层处理断行或水平滚动。

### 4.3 iPad / 平板

- 使用可收缩侧栏 + 内容列的双栏布局；
- 右侧 inspector 根据宽度选择常驻第二列或 popover；
- 保持较高信息密度，但所有直接操作采用触控尺寸；
- 顶部动作不能只靠 hover；
- 不把 iPhone 的单列卡片拉宽，也不把 macOS 三栏强行压缩；
- 横屏短视口优先收缩 composer 和工具条，不降低触控命中区。

## 5. 核心页面改造顺序

按以下顺序实施，不要同时修改整个项目：

### 阶段 A：设计系统清权

- 完成 token ownership 表；
- 完成 CSS import 图；
- 修正 Apple 字体优先级；
- 建立平台断点常量；
- 建立 macOS/iPad/iPhone 的语义 token；
- 清理 `fork-mac-skeuo.css` 与 Apple standard material 冲突的规则；
- 禁止新增末尾覆盖层。

### 阶段 B：工作台外壳

先改 `AppShell`、侧栏、顶栏、主工作区、右栏和移动端 drawer：

- 统一 toolbar、sidebar、pane、sheet 的结构语义；
- 去除“漂浮大圆角卡片包住整个页面”的倾向；
- 明确 M0/M1/M2 的导航、宽度和命中区；
- 保证安全区、滚动容器和键盘高度链完整。

### 阶段 C：会话与 composer

- 会话正文与工具输出建立不同的阅读密度；
- 用户消息、助手身份、模型徽章、运行状态和工具状态使用统一语义；
- composer 的模型、思考、权限、工具、上下文和附件在三端都可访问；
- PWA 将复杂控制收进 sheet，但不能隐藏当前有效设置；
- 运行中、排队、停止、失败和需要用户处理的状态三端一致。

### 阶段 D：工作区工具

依次处理文件查看器、编辑器、终端、浏览器、Git、调用轨迹和审查面板：

- macOS 使用 inspector/pane；
- iPad 使用第二列或 popover；
- PWA 使用全屏详情页或 sheet；
- 不能因为窄屏没有对应画板而删除状态、路径、错误或操作入口。

### 阶段 E：设置和系统态

处理设置 hub、通用、模型、Skills、Agents、Plugins、MCP、权限确认、项目 Trust、错误、离线、安装和通知：

- 设置分组标题、行标题、说明文字和状态必须有明确层级；
- MCP 行至少保留启用状态、名称和传输/运行状态；
- 高级路径、环境变量和工具详情进入详情页；
- 危险操作必须使用平台对应的 Alert/确认交互；
- PWA 使用 sheet 或 drill-in，不把桌面弹窗压缩到手机宽度。

### 阶段 F：个性化层

最后处理主题、壁纸、皮肤工作室、透明度和材质调节：

- 个性化只能改变允许的视觉变量；
- 不得降低正文可读性、焦点可见性或状态辨识度；
- 深色模式必须是独立的 Apple 平台色板，不是浅色值简单反相；
- 壁纸开启时，正文、代码、弹层和设置仍必须保持稳定对比度。

## 6. 状态矩阵要求

每个核心组件都必须在交接文档或实现 PR 中登记以下状态：

- default
- hover
- focus-visible
- pressed
- selected
- disabled
- loading
- streaming/running
- queued
- success
- warning
- error
- empty
- offline
- dark
- reduced-motion
- narrow width
- keyboard open
- safe-area inset

每个状态要明确 Web、iPad、PWA 的呈现方式。不能只写“移动端适配”，必须写清楚是页面、sheet、popover、折叠行还是底部操作栏。

## 7. 禁止事项

- 禁止引用旧视觉评审文档作为问题依据；
- 禁止把截图观察直接当成源码结论；
- 禁止新增平行 token 系统；
- 禁止组件直接使用未经语义约束的 `--radius-*`、`--ds-*`、`--n-*` 或 `--nx-r-*`；
- 禁止继续把 Geist 作为 Apple 字体第一优先级；
- 禁止全站默认玻璃；
- 禁止给带 fixed 后代的定位祖先加 `backdrop-filter`；
- 禁止用 `!important` 或文件顺序掩盖所有权问题；
- 禁止把桌面页面简单缩小到手机；
- 禁止让 PWA 因缺少对应画板而静默隐藏重要信息；
- 禁止纯图标按钮只依赖 hover 或原生 `title`；
- 禁止用 emoji 作为核心产品图标；
- 禁止在没有真实数据支持时增加统计、状态或操作控件；
- 禁止一次性重写所有页面，必须按阶段验证。

## 8. 自动化检查与验收

### 源码检查

需要补充或扩展以下检查：

- token 单一来源检查；
- 旧 token 引用检查；
- Apple 原始 token 文件不可手改检查；
- 三断点 CSS/React 一致性检查；
- 裸色、裸圆角、裸阴影和裸动画时间检查；
- backdrop-filter 与 fixed 后代关系检查；
- 组件平台状态矩阵检查。

### 可访问性检查

- 交互元素都有 accessible name；
- 键盘 focus-visible 始终可见；
- 触控主要操作命中区不小于 44pt；
- 状态不能只靠颜色表达；
- 文字和真实合成背景满足对比度要求；
- 动态运行、错误和成功状态可被辅助技术感知；
- `prefers-reduced-motion` 下不强制播放大位移动画或无限装饰动画。

### 页面检查

至少验证：

- macOS Web：1280px、1440px、1920px；
- iPad：768px、834px、1024px；
- iPhone PWA：375px、390px、430px；
- light、dark、wallpaper on/off；
- 键盘打开、弹层打开、运行中、错误、空状态和长文本；
- 长中文、长路径、长 URL、代码块、表格和工具输出；
- 切换会话、打开右栏、进入设置、返回、刷新和恢复滚动位置。

验收结果必须记录源码检查、页面检查和未完成项，不能只说“看起来像 Apple”。

## 9. DeepSeek 直接执行提示词

将以下内容作为执行任务开头：

```text
你正在改造 PI NEXT 的前端设计系统。最终目标不是复制一个静态 Apple 页面，而是建立平台自适应的 Apple 工具应用体验：桌面 Web 对齐 macOS，640–1023px 对齐 iPad 双栏，手机 PWA 对齐 iOS。

先审计当前 CSS import、token 引用和 React 平台分支。禁止先在 fork-ui.css 或任意文件末尾追加覆盖规则。先建立 Apple Kit 原始值 → --nx-* 语义 token → 平台形态 → 组件的唯一数据流，并列出 --n-*、--ds-*、旧 --radius-* 和重复 --nx-r-* 的迁移状态。

你必须先处理设计系统所有权、字体优先级、圆角来源、材质边界和三档断点，再按工作台外壳、会话/composer、工具面板、设置/系统态、个性化层的顺序实施。

macOS 不要做成全站大圆角卡片；iOS 不要做成缩小版桌面；iPad 不要只是桌面自然挤压。不要全站默认玻璃，不要让带 fixed 后代的容器使用 backdrop-filter，不要因窄屏缺少画板而隐藏核心状态。

每次修改都要同时检查 Web、iPad、PWA，检查 light/dark/reduced-motion、键盘、safe area、长中文、长路径、长 URL、代码和表格。所有视觉值必须来自语义 token；所有按钮和状态必须有可访问名称和明确的运行态。

完成后输出：改动文件、token 迁移表、删除的旧规则、三平台状态矩阵、自动化检查结果、仍未完成的页面和下一批任务。不要声称仅凭截图验证过源码行为。
```

## 10. 交付边界

本规范本身不要求变更 API、会话数据、Agent 生命周期或业务权限。设计改造允许修改：

- 前端 CSS 和 token；
- React 页面结构与平台分支；
- 组件的可访问性属性；
- 断点 hook 与布局状态；
- 设计检查脚本和回归测试。

任何会改变业务语义、会话数据格式、权限规则或 Agent 行为的修改，都必须另开技术方案，不得混入本轮视觉改造。
