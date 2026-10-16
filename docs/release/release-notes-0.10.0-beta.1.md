# PI NEXT 0.10.0-beta.1（预发行）

> v0.1.9 之后的 6 个提交：**Apple 官方 UI Kit 接管整套设计令牌** —— 从两份 Apple 官方
> Sketch kit 抽出机器可读规范并生成数值层，Zeno / BoardUI 两层角色改指 Apple 的值；
> 外加一轮用户逐条实拍的形态修正（顶栏内阴影、相位行高、侧栏宽、扫光动画、浮窗被裁）。
> 预发行通道：功能已可用，形态仍在过渡期（见「已知」）。

范围：`v0.1.9..HEAD` —— **79 个文件，+59,451 / −97 行**，6 个提交。
其中 `design/apple/sketch/*.json` 两份抽取规范占 55,481 行；代码与文档部分是 +3,970 / −97。

## 新增

- **Apple 接管设计令牌（`fork:apple-sketch`）**：用户裁定「把 Zeno 令牌体系弄掉，
  全部让 Apple 接管」。角色层（`--nx-*`）与 Zeno 槽位（`--bg` / `--text` / `--accent`…）
  一并改指 Apple 的值 —— **名字留给引用方，值归 Apple**，值只在一处（生成物），
  回滚就是删掉那两块 bridge。
- **Apple Sketch 抽取管线**：两份 Apple 官方 Sketch kit（macOS 27 / iOS 27）抽成
  `design/apple/sketch/*.json`（色板 / 具名字体样式 / 共享样式，可 diff、可对拍），
  再生成两份只定义 `--nx-sk-*` 的数值层 CSS —— Web ↦ macOS，PWA ↦ iOS。
  `npm run sketch:build` 一条命令重跑；kit 原件合计 ~270MB 不入库。
  生成物请勿手改，角色绑定在 `web/tokens.css` / `pwa/tokens.css` 里手维护。
- **Apple 标准材质**：侧栏 / 右栏 / 输入区接上 kit 的 `Materials/Regular`
  （半透明底 + `blur(60px) saturate(1.45)`，暗色另一套）；弹层只给半透明底。
- **几何改取 kit 实测档**：控件高 20/24/28/36（Text Fields 四档）、开关 54×24、
  分段控件 macOS 28 / iOS 32、菜单行 macOS 24 / iOS 42、iOS 列表行 68、
  顶栏 36（Apple 工具栏高）、侧栏 256；字号改用 kit 的**具名样式**（自带 size + line-height
  + weight），长文用 Loose Leading 变体。
- **安卓启动器图标换成主品牌图形**，安装包名统一为「PI NEXT.apk」。
- `docs/kun-borrowing-plan-2026-10-08.md`：Kun 借鉴首轮对比（PolyForm Noncommercial
  —— 只借语义与形状，不抄代码），逐档标了「形状可抄 / 需重写 / 不可移植」。

## 修复

- **顶栏那两条黑边**（用户实拍）：根因不是边框，是 kit 玻璃共享样式里四层 `#272727`
  的 **inset** —— 那是给「玻璃浮在花哨背景上」准备的，纯白底页上没有背景可分离，
  只把自己读成一根黑边框（真 Chrome 实测顶栏上下缘合成到 `rgb(77,77,77)`）。
  只留白色高光；外缘 rim 与 `border-bottom` 不动。有意偏离，登记 `DIVERGENCE.md` §AB。
- **过程相位行太高**：`PhaseRoll` 的 8px 叠上 `.d-step` 的 6px，一行文字吃了 28px
  纵向内边距，卡片显得空而高 → 收到 2px。
- **浮窗「看不见了」**（Agents 选人 / 模型选择 / 分支导航）：`backdrop-filter` 会让元素
  成为 `position: fixed` 后代的**包含块**，浮窗改以弹层为定位祖先后被裁、被推出视口。
  模糊只给不会做祖先的**面**（侧栏 / 面板 / 输入区），弹层只给半透明底。
- **勾选框被撑成灰长条**：`min-height` 只被宽度锁住的一侧生效，16×16 的指示器变成
  16×24。指示器尺寸就是它的全部，行高交给父行。
- 顶栏圆角/外边距防御性收口（通栏），不碰颜色与材质。
- 侧栏宽 260 → 256（产品与画板同值）。

## 移除

- **运行中文案的扫光动画**（用户裁定「去掉运行过程中的输入框跑马灯」）：只把文案降为
  次要色，不再动；类名与关键帧留着（别处可能引用）。
- `design/苹果设计/` 参考仓与两份 `*.sketch` 原件不入库（改以官方 kit 为准，
  抽取产物入库）；`tsconfig` 同步排除，实测消掉 41 条来自该目录 React 子包的 TS 错误。

## 已知

- **本版 release 只有源码 zip**，没有 DMG / EXE。要挂安装包就用
  `mac-dmg-packaging-arm` / `windows-exe-packaging` 打到同一个 release 上。
- `check:design` 的**样式字面量基线在 v0.1.9 时就已经落后** 12 个键
  （ChatWindow / ChatInput / app/error.tsx 等，全是既有代码）。本版**没有新增违规**
  （今日改动文件一条都没进超基线清单），也未收窄基线 —— 留给下一轮单独清理。
- `--nx-glass-rim-dark` / `--nx-glass-inner-dark` / `--nx-glass-ambient-dark` 三条在
  `base.css` 定义后**全仓零引用**（`DIVERGENCE.md` §AB 已登记）：要么接上，要么删掉。
- `design/apple/README.md` 里写的重跑需要两份 `.sketch` 原件（不入库），
  所以仓库里跑不了 `npm run sketch:build` —— 只有本机留着原件的人能重跑。
