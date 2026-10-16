# PI NEXT v0.0.4

这一版专治你截图里点出来的四个界面问题：**内置浏览器不再独占主区把对话挤没**、**顶栏图标并回同一排**、
**重复的那个「隐藏右侧工作区」按钮只剩一个**、**上下文图标不再和面板开关撞脸**。

## 改动

- **面板宽度统一**：文档预览与内置浏览器标签现在走同一套规则——聊天留在主区不动，只打开右侧面板；
  面板过窄时一次性加宽到视口 58% 与 1020px 中的较小者。1680 宽的屏上实测面板、聊天与树列三者的比例，
  与文档预览完全一致。
- **两个顶栏图标**：🌐 是新建浏览器标签，⇄ 是交换聊天区与工作区（把文档放到主区），
  两者功能不同，都保留。

## 修复

- **浏览器不再盖住对话**：打开内置浏览器标签原来会独占整个主区、把聊天整个挤走，现已改为只开右侧面板，
  面板宽度实测与文档预览完全一致。
- **顶栏图标分两行**：文件树原本从标签栏下方才开始，顶栏图标因此被拆成两排；现已把树列上提，
  两排图标并成同一排。
- **上下文图标撞脸**：会话信息里的上下文窗口指示原来是拱形图标，和面板开关长得很像，
  已换成三根柱子的用量图标。

## 移除

- **重复的侧区开关**：聊天顶栏动作组里的「隐藏右侧工作区」与布局边界上的那个是同一个按钮被渲染了两次，
  现在只保留边界控件这一处。

## 已知

- 内置浏览器的能力边界不变：声明 X-Frame-Options 或 frame-ancestors 的站点无法嵌入，
  面板内已提示并给出「在新窗口打开」的出口。
- 源码包见本页下方 Assets，只含受版本控制的源码；装完先装依赖再起生产模式，默认端口 30141。
- 单测有 4 条既有环境性插件用例失败，与本版无关；桌面 1280px 与手机 390px 两轮端到端用例全通过，
  顶栏按钮清点复测也只剩一个实例。类型检查干净，五套主题都做了真实浏览器渲染核对，
  皮肤自检（29 个刻度 token 与 34 个 token × 5 套调色板）通过。

---

## English

This release specifically addresses the four UI issues you pointed out in your screenshots: **the built-in browser no longer monopolizes the main area and squeezes out the conversation**, **the top bar icons merge back into the same row**, **the duplicated "Hide right workspace" button is reduced to one**, and **the context icon no longer looks like the panel toggle**.

### Changed

- **Unified panel width**: The document preview and built-in browser tabs now follow the same rules—chat stays put in the main area, and only the right panel opens; when the panel is too narrow it widens once to the smaller of 58% of the viewport and 1020px. On a 1680-wide screen, the measured ratio of the panel, chat and tree column is exactly the same as for the document preview.
- **Two top bar icons**: 🌐 creates a new browser tab, and ⇄ swaps the chat area and workspace (putting the document in the main area); the two have different functions and both are kept.

### Fixed

- **Browser no longer covers the conversation**: Opening a built-in browser tab used to monopolize the entire main area and squeeze out the whole chat; it now only opens the right panel, and the measured panel width is exactly the same as the document preview.
- **Top bar icons split into two rows**: The file tree originally started below the tab bar, so the top bar icons were split into two rows; the tree column has now been raised, merging the two rows into the same row.
- **Context icon looked alike**: The context window indicator in the session info used to be an arch icon that looked very much like the panel toggle; it has been replaced with a three-bar usage icon.

### Removed

- **Duplicated side toggle**: The "Hide right workspace" in the chat top bar action group and the one on the layout boundary were the same button rendered twice; now only the boundary control is kept.

### Known

- The capability boundary of the built-in browser is unchanged: sites that declare X-Frame-Options or frame-ancestors cannot be embedded; the panel already shows a notice and gives an "Open in new window" way out.
- See Assets at the bottom of this page for the source package, which contains only version-controlled source; after installing, install dependencies first and then start production mode, default port 30141.
- Unit tests have 4 pre-existing environment-related plugin test failures, unrelated to this release; both rounds of end-to-end tests at desktop 1280px and mobile 390px pass fully, and a recount/re-test of the top bar buttons left only one instance. Type checking is clean, all five themes were verified with real browser rendering, and the skin self-check (29 scale tokens and 34 tokens × 5 palettes) passes.
