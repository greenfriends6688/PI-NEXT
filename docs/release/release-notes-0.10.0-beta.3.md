# PI NEXT 0.10.0-beta.3（预发行）

> `0.10.0-beta.2` 之后的 19 个提交：**上游对齐第二批（12 个 PR）** + **10-08/10-09 两个功能批次**。
> 这一版把「追上游」和「自己的手感」一起发出来 —— 前者以 PR 为单位逐项对拍，后者是侧栏、
> 输入卡、文件树、主题四处按实拍收的口。

范围：`v0.10.0-beta.2..HEAD` —— **145 个文件，+10401 / −2399 行**，19 个提交。

## 新增

**上游对齐第二批（`docs/upstream-round-2*`，12 个 PR 拆分）**

- **PR-3** pi SDK `1.0.0 → 1.1.0` 并跟完适配。
- **PR-4a** 子代理 profile 的 `skills:` / `extensions:` 白名单（上游 #1034 + #1091）。
- **PR-5** 只在 `session_start` 注册的 provider 不再从模型选择器消失（#1071）。
- **PR-6** 归档会话自动回归（上游 `2e87ddb1b` 的一部分）。
- **PR-7** 侧栏行菜单分叉 + 短后缀命名（#1091 系列）。
- **PR-8a** 信任对话框列出项目里的 MCP server 与它们会跑的命令。
- **PR-9** 聊天 / 渲染五项（#1024 / #1032 / #1056 / #1058 / #1072 / #1098 / #1060）。
- **PR-10** Git 忽略文件显示开关；**PR-11** 侧栏与移动端两处修正。

**侧栏**

- 项目菜单 / 折叠 / 归档 /「显示更多」照上游重做（`1000cf4f`）。
- 项目名右侧加运行转圈：这个项目里有会话在跑时给一枚行内 `nx-spin`，只表达「在动」，
  不占行高、不撑行宽（`fork:proj-running-spinner`）。

**文档编辑器（`fork:office-editor`）**

- 接入 **GenOffice**（Apache-2.0）的 DOCX 编辑器：`.docx` 默认仍是只读预览（mammoth），
  工具栏上多一枚铅笔钮即可切到可编辑视图；保存走 `/api/files` 的 upload 通路（multipart 原子替换），
  打开时记 `{size, mtimeMs}`、保存前比对，外部改过就拒绝覆盖。
- 编辑器产物与字体在 `public/office/`（18 MB，含许可与 `provenance.json`），
  宿主层是 `public/office/host.html` + `host.js`；上游 CSS 里写死的 `/assets/*` 由
  `next.config.mjs` 一条 rewrite 指回 `/office/assets/*`，**不改上游字节**。
- `/api/files?type=meta` 补 `mtimeMs` 供冲突检查。

**输入卡**

- 窄列（多栏布局）里把**模型 / 权限 / 工具**三枚芯片收进一枚「设置」钮，点开是输入卡上方的
  浮层（标题「设置」）；宽列仍平铺（`fork:composer-narrow-caps`）。
- 窄列工具条回到单行 flex：附件在左、上下文环与发送在右；输入卡高度从 138px 收到 76px。

**文件树**

- 整列可显隐（面板头行 folder-tree 钮 + 文件树头行 `chevrons-right-left` 钮），
  偏好持久化；面板 ≥700px 时**强制显示**，手动收起只对窄面板生效
  （`fork:explorer-column-toggle`）。

**主题**

- 默认走「开着壁纸」那套玻璃：壳与聊天列透明、侧栏 / 右栏 / 顶栏 65% 面板色 + 毛玻璃，
  背后是 v5 画布灰（`fork:glass-by-default`）。装壁纸时两套值同值，不打架。

**其他**

- 浏览器面板自带全屏钮（`fork:browser-fullscreen`）。
- 等模型指示器改用画板 D-03d 的 3×3 波点阵（`fork:waiting-wave`）。

## 修复

- **安全**：轮换 Next preview-mode 密钥并升 Next 16.3.8（PR-1）；目录 junction 越权 +
  上传覆盖丢原文件（PR-2，上游 #1039）。
- **输入框占位提示从来没显示过**：textarea 的字形是透明的（可见文字全部来自高亮层），
  `::placeholder` 因此继承了透明色（`fork:composer-placeholder`）。
- **Agents 浮窗挂到 body**（`backdrop-filter` 的包含块陷阱）+ 去掉顶栏下方阴影。
- **引导块闪现**：会话目录还在加载时被判成「一个会话都没有」（`fork:no-guide-flash`）。
- **扩展风险确认框**只发 `title` / `body` 两个 key，不再拼 `[accept] / [deny]`
  （那串括号在渲染端翻不出来，实测显示成一行英文键名，`fork:ext-i18n-keys`）。

## 移除

- 输入框的**环绕光带**（`fork:composer-no-orbit`）；摘掉窄屏 composer 上已失效的
  `m-loader` 类并把 `position: relative` 归位。

## 已知

- `.pptx` / `.pdf` **仍不可编辑**：浏览器里不存在免费的开源引擎；可编辑的只有 `.docx`
  与（本轮已移除的）`.xlsx` 通路。
- `fork:glass-by-default` 在没有壁纸图时，玻璃背后只有一层画布灰，层次感有限 ——
  想要更明显的「毛玻璃」需要底图（内置画或自备图）。
- 对比度门禁 `check-contrast` 有 4 项低于阈值（主按钮文字、accent 文字 / 画布与侧栏，
  亮色 3.52:1），是既有状态，本版未动 `--bg` / `--accent-text`。

## 验收

- `tsc --noEmit` 通过；`eslint` 0 error。
- 单测：`ChatInput*` / `ChatWindow*` / `AppShell*` / `ExplorerPanel*` / `FileViewer*` /
  `file-explorer-state` 等 164 项全绿。
- 图标门禁 906 处 `data-ico` 全部命中；`check-style-literals` 无新增（存量两项在
  工作区既有的未提交改动上）。
- 真机（Chrome + 30141 生产构建）逐项复看：文档编辑器打开/保存、窄列设置浮层、
  文件树 759px 面板下强制显示、灰底 + 毛玻璃三层同色。
