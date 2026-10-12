# CONTROLS.md · 控件严格规格（macOS 27 / iOS 27 kit）

> 这份文档是「控件的数值只能从 kit 来」的**人读版**。机器读版在
> `macos.json` / `ios.json`（`node scripts/kit-spec.mjs` 生成）；令牌在
> `--nx-sk-cs-*`（`npm run sketch:tokens` 生成，scripts/sketch-tokens.mjs §5）。
> 组件消费的角色名在 `design/v5/web/tokens.css` §控件内核 / `pwa/tokens.css`。
>
> **结构**：kit 把控件拆成两层 —— 符号（放文字/图标/几何）＋**共享图层样式**（放底板）。
> 底板只在 layerStyles 里，符号导出图里看不到 chrome，别拿导出图判断"有没有底色"。

## 0 · 通用规律

| 规律 | 值 | 出处 |
|---|---|---|
| 控件高度阶梯 | 16 / 20 / 24 / 28 / 36 | Text Fields 四档（Mn/Sm/Rg/Lg/XL） |
| **圆角 = 高度 ÷ 4** | 16→4 · 20→5 · 24→6 · 28→7 · 36→9 | 各控件符号 `style.corners.radii` 实测 |
| 正文/控件字号 | 13px（macOS Body）· 字重 500 | `--nx-sk-t-body-*` |
| 菜单/按钮文字字距 | −0.2pt（菜单行） | Menus 符号 `kerning` |
| 聚焦环 | 1px 实线 accent ＋ 3.5px 50% accent 外环 | Text Fields Focus Ring（两层 border） |
| kit 无 hover 档 | 按钮只有 Idle/Clicked/Disabled —— web 端 hover 是**推导**（8%↔16% 取 12%），登记 §AH | — |

## 1 · 按钮（macOS，Content Area）

五类底板（共享样式 `Content Area/{Light,Dark}/0X - …`）：

| 类 | Idle | Clicked | Disabled |
|---|---|---|---|
| 01 Bordered（标准） | `#00000014` | `#00000029` | `#0000000a` ＋文字 25% |
| 02 Bordered Tinted | `#0088ff`＋10% 黑，**整层 22%** | `#0091ff`＋10% 黑，28% | 10% |
| 03 Bordered Destructive | `#ff383c`＋10% 黑（红洗） | 28% | — |
| 04 Prominent（Default/主行动） | **`#0088ff`** 实心（＋3% 黑） | `#0078f0`（＋10% 黑） | `#0078f0` **40%** |
| 05 Prominent Destructive | 实心红 | — | — |

- 透明度（22%/28%/40%）不在共享样式里 —— 在符号 BG 的 `contextSettings.opacity`，已并入令牌注释。
- 无边框、无阴影（除 Over-Glass 档另有 fill 组合）。
- 尺寸抽样：`Rg` 高 24（宽 66 = 16 边距×2 ＋ 34 文字）；`5 XL` 高 36。

## 2 · 输入框 / 搜索框 / 弹出钮

| 控件 | 规格 | 出处 |
|---|---|---|
| 输入框 Idle | 白 `#ffffff` ＋ 1px `#0000000d` 发丝边 | Input Fields/01 |
| 输入框 Disabled | 白 50% ＋ 1px `#0000000a` | Input Fields/04 |
| 输入框 Focus | 边框换 accent ＋ 3.5px 50% 外环 | Focus Ring（radius = h/4） |
| 输入文本 | 13 / 500，`#000000d9`（禁用 25%） | Text Fields 符号 |
| 搜索框 | **药丸形**＋灰底（`#0000000d`）＋放大镜（左 8px）＋文本左起 32px＋清空钮右端 | Search Fields 符号 |
| 弹出钮 | Bordered 灰洗底；文字左 12px；右侧 ⌃⌄ 字形（13/600），Pulldown 用 ⌄（10/700） | Pop-up and Pull-down |

## 3 · 菜单（Menus）

| 项 | 值 |
|---|---|
| 行高 | 24px；文本 13/500 `#363636`（kerning −0.2） |
| 高亮（hover＝键盘，**只有一种**） | 底 `#0069f9` ＋ 全部前景白（含图标、快捷键）|
| 高亮圆角 | 8px（高亮比行宽出 11px/侧） |
| 禁用 | 文字 `#b3b3b3` |
| 行内槽位 | 勾选框 x=0（4w）· 图标 x=12（11w）· 文本 x=31 · 快捷键右对齐灰 `#b3b3b3` |

## 4 · 开关 / 复选 / 单选（Toggles）

| 件 | 规格 |
|---|---|
| 开关轨道 | 54×24 药丸；关 `#0000001a`（暗 `#ffffff1a`）；开 `#0088ff`（暗 `#0091ff`）|
| 开关旋钮 | **32×20 白药丸**，内缩 2、行程 18；阴影 `0 3px 36px #0000000d`（暗档另一组）|
| 复选 16×16 | 未选 `#0000001a` 无描边 · 选中 accent＋白勾 · 半选 accent＋白横杠（6.5×2）· 禁用整件 ~45% |
| 单选 | 同族：未选灰圆 · 选中 accent 圆＋白点 |

## 5 · 分段控件 / 滑块 / 进度

| 件 | 规格 |
|---|---|
| 分段（Rg） | 轨 28（2px 内衬）· 钮高 24 · 选中 = **accent 实底＋白字**（窗口非活跃时选中转深灰字 `#000000d9`）|
| 滑块（Rg） | 轨高 4 · 旋钮 14 圆、白底细边（`--nx-c-slider-h` 24） |
| 进度 | 环形 16/32 两档、条高 4（`--nx-c-progress-h` 32） |

## 6 · 警告框（Alerts）

| 件 | 规格 |
|---|---|
| 标题 | 13 / **700** / `#000000d9` |
| 正文 | 13 / 400 / `#363636`，行高 16 |
| 按钮（堆叠） | 228×28（= 宽 −16×2），间距 6 |
| 取消 | 纯文字 `#000000d9` |
| 破坏性 | 底 `#f52f32` **23%** ＋ 红字 `#f52f32` |
| 首选项 | accent 实底＋白字（= Prominent） |

## 7 · 浮层（Popovers / Menus 玻璃）

| 件 | 规格 |
|---|---|
| 浮出框 Body | 圆角 **20** · 白 70%（`#ffffffb3`）＋`#bfbfbf1a` 叠层 · 箭头 46×10.5 |
| 浮出框阴影 | `0 18px 46px #00000040` ＋两侧发丝 `#dbdbdb` ＋内部白高光 |
| 菜单玻璃 | `Liquid Glass/Light/Menus`：fill `#e6e6e68c`、深色 `#5a5a5a80`；阴影 kit 原值 |
| **web 落地口径** | 弹层禁 `backdrop-filter`（§Z）→ 玻璃收敛为同色相实面（`#e9e9e9f0` / `#3d3d3df0`），见 §AH |

## 8 · 侧栏 / 工具栏（macOS）

| 件 | 规格 |
|---|---|
| 侧栏行 | L(大) 档 24 高 · 分区头 18 高 · 两侧留白 14 |
| 行前件 | 图标 15px 蓝 `#0078f0` · 折叠箭头 11/700 `#b3b3b3` |
| 行细节（Trailing） | 15/500 `#737373`（右对齐） |
| 工具栏钮 | 圆（20×20 @24 节距，kit 的 Medium 工具条） |

## 9 · iOS（→ PWA 形态）

| 件 | 规格 |
|---|---|
| 按钮 | **药丸形**；Prominent = `#0088ff`＋白字；Bordered = 灰 `#767680` 洗底；禁用文字 `#3c3c434d` |
| 按钮尺寸 | Large 高 50 / Medium 高 34（Text / Symbol / Symbol+Text 三种宽度）|
| 分段 | 32 / 48 两档；选中同 macOS（accent 实底白字）|
| 开关 | 64×28（轨道）＋big 旋钮（Toggles 页 Knob 59×37 带阴影/辉光）|
| 警告 | 宽 300 · 按钮高 48（1 Primary / 2 Secondary / 3 Destructive）|
| 材质梯 | Materials/{Light,Dark}：1 Thick · 2 Regular(Default) · 3 Thin · 4 Ultrathin |

> iOS 的 `--nx-sk-cs-*` 生成物只有 3 条（iOS kit 的底板不走 Content Area 共享样式族）——
> PWA 侧控件绑定待下一波从 `design/apple/spec/ios.json` 的符号层补齐（见 §AH 待办）。
