# 技能/插件批量路由 + 扩展对话框长标题钳位 + 两条 CSS 缺口

| | |
| --- | --- |
| 状态 | 已实现（单测 20+；合并时全量 2584 pass / 0 fail，设计门禁全绿） |
| 上游依据 | `eceac13`（#1020/#1021 的路由侧）、`46b5235`（#961 / Refs #890）、`2e66e40`（#1008 的另一半） |
| fork 标记 | `grep -rn "fork:bulk-routes" app components`、`grep -rn "fork-ext-dialog" app components` |

## 批量路由

G4 的「按组全开全关」原本只能**逐条串行请求 + 逐条报错**（路由当时不在改动面内）。

- `PATCH /api/skills`：单条 `{filePath, disableModelInvocation}` → `{success:true}`
  **形状与状态码逐字节不变**；批量 `{filePaths, disableModelInvocation}` → **整体 200** +
  `results:[{filePath, error?}]`，被拒的保持原状。路径去重；**已在目标状态的不重写**
  （mtime 不动，否则一次批量操作会刷爆文件监听）；形态错（非字符串数组 / 开关非布尔）
  在**任何写盘前**整体 400。
- `POST /api/plugins`：`enable`/`disable` 另收 `packages:[{source,scope}]`，**每作用域一次
  settings 写入**；响应 = 全量 `PluginsResponse` + 逐条 `results`。四类错误各有明确文案
  （未配置 / 带 resource filter / 项目未信任 / `drainErrors()` 读回失败）。
- **带 resource filter 的包不被批量停用**（单包开关不受限）；启用只摘四个资源列表，保留 `autoload`。
- 客户端兜底：拿不到 `results`（整体 4xx/5xx 或网络层挂）→ 整组算失败、列表一行不动。

## 长标题钳位

标题过长会撑破对话框、把选项和取消键裁掉。**根因**：`max-height` 用百分比在
内容驱动高度里解不出来（上游 #890）。所以 `flex-shrink:1; min-height:0` 是必需前置项，
不是装饰。规则在 `app/fork-ui.css`（画板 `.pw-modal-head` 未动，两个 `fork-*` 钩子需登记
DIVERGENCE）。**换行没被吞**：标题继续内联 `pre-wrap`，CSS 不碰 `white-space`，
全文另有 `title` + 既有 `aria-label`。布局抽成纯函数 `dialogHeadLayout` 按实际声明算。

## 两条 CSS 缺口

- `.pw-group-title + .pw-alert { margin-top: var(--s2) }` —— `board.css` 只给
  `.pw-block > .pw-alert` 上了边距，分组标题下的状态条贴得偏紧。**用 token，零字面量。**
- 手机档命中区：`app/pwa-models-skills.css` 只把 `.pw-litem > .pw-switch` 扩到 32×32，
  **分组标题里的开关仍是 30×17** → 窄屏/粗指针下 `::after { inset: calc(var(--s2) * -1) }`，
  热区 30×17 → 46×33，**视觉尺寸一个像素没改**（热区靠伪元素撑开）。
