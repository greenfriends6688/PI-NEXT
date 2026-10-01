# 0049 · 跨 agent 导入（会话 / 模型 / 技能 / MCP）

| 项 | 值 |
| --- | --- |
| 意图 | 把别的 AI agent（Claude Code / Codex / Cursor 等）在本机留下的会话、模型配置、技能、MCP 服务搬进本 fork，一屏扫描、一屏勾选、显式应用 |
| 参照实现 | ZCode 的「从其他工具导入」；MCP 页那条「从其他工具导入」入口是它的前身 |
| fork 标记 | `fork:import-scan`、`fork:import-apply`、`fork:import-self-source`、`fork:import-ui`、`fork:disabled-reasons` |
| 新增文件 | `lib/import/`：`contract.ts`、`types.ts`、`groups.ts`、`sessions.ts`、`skills.ts`、`models.ts`、`mcp.ts`、`apply.ts`、`index.ts` + 6 份 `.test.mjs`；`app/api/import/scan/route.ts`、`app/api/import/apply/route.ts`；`components/ImportPanel.tsx` |
| 上游文件接触面 | `components/SettingsPanel.tsx`（挂「导入」分节）、`components/ProviderUsageSummary.tsx`、`lib/settings-disabled-reasons.ts` |
| `.patch` | 无（引入 commit 在换肤大快照里，无 staged-baseline 可反演） |

## 核实（不是照抄审计报告）

```
$ git log --oneline -- lib/import/
ac4ec72 feat: 导入 / 文件预览重做 / 用量仪表盘 + 六处界面修正      ← 全部 8 个 + 6 份测试
$ git log --diff-filter=A --format=%h -- app/api/import/scan/route.ts  → ac4ec72
$ git log --oneline -S "ImportPanel" | tail -6
ac4ec72 → 8d879cb → ad99dd3 → 7eb575e → bbd2093 → 1ed2708   （后五个都是后续的接线/改版）
$ git cat-file -e agegr/main:lib/import/index.ts   → absent
```

审计报告把「首次提交」记作 `ac4ec72`，**这条是对的**（8 个文件 + 2 条路由 + 面板同批落盘）。
审计说「patches 里 `import` 只出现过 1 次，且是别的东西」——核实后**恰好是 1 次，但比它说的更无关**：
改动前 `git show 6ded9e4:docs/patches/README.md | grep -n import` 只有 0007 行里的
「均加一行 import + 字号换 token」，与本能力毫无关系。结论（台账无条目）正确。

## 与上游的关系

上游 `agegr/main` 完全没有 `lib/import/`、`app/api/import/`、`ImportPanel.tsx`。
纯新增。

## 三条必须保留的设计纪律

写在文件头注释里，不是可选项：

1. **`lib/import/contract.ts` 及其依赖图不许 import 任何 Node 内建模块。**
   设置页在客户端组件里渲染这些候选，任何 `node:` import 都会让 `next build` 挂在
   `UnhandledSchemeError` 上。文件系统那部分住在 `./types.ts`，由它 re-export 出去。
2. **渲染端只送候选 id，从不送路径。** `/api/import/apply` 收到 id 后会**重新扫一遍再反查**，
   所以从 UI 注入不了任何读/写路径。`/api/import/scan` 更是**不接受来自客户端的路径**：
   读哪里由服务端扫描器决定，`cwd` 只是为将来的「按项目作用域的来源」留的兼容参数，
   本条**不用于选择读取位置**。
3. **凭据只出 `hasSecret: boolean`。** 任何 API key / token / env 值 / 凭据头都不得离开
   `contract.ts`。错误诊断只用**错误码**，不用 parser 的原始消息 —— V8 的 JSON 解析错误
   会把出错输入整段引出来。

## 四个分段为什么同时挂载

`components/ImportPanel.tsx` 的四个面板**同时挂载、只切 `hidden`**：切 tab 不丢已经扫出来的结果，
也不偷偷再扫一次。扫描永远是**显式动作** —— 扫描按钮是唯一的触发器，页面加载不自动扫。
结果按 `imported / skipped / failed` 三个数分别报，**不假装「全部成功」**。

`lib/import/groups.ts` 单独拆出来（`fork:import-ui`）是因为「一次组点击选中哪些行」「组的复选框
该显示勾 / 未勾 / 半选」这些决定「什么会被导入」的逻辑要能脱离 DOM 被测。

## 能否独立 revert

**能。**

- 删 `lib/import/`（含 6 份测试）+ 两条路由 + `ImportPanel.tsx`。
- `SettingsPanel.tsx` / `ProviderUsageSummary.tsx` / `settings-disabled-reasons.ts` 上的改动
  按 `fork:import-ui` / `fork:import-self-source` / `fork:disabled-reasons` 标记整段删。
- 无 `package.json` 依赖增删，无 `.gitignore` 改动。

删完后 MCP 页那条旧的「从其他工具导入」入口如果还有残留文案要一并清掉，别留一个指向已删路由的按钮。

## 验证手段

- 单测 61 例：`apply` 14、`sessions` 13、`groups` 9、`mcp` 9、`models` 9、`skills` 7。
- 路由可直接打：`POST /api/import/scan {kind:"sessions"}`（只读，返回候选 + `hasSecret`）、
  `POST /api/import/apply {ids:[…]}`（返回三段计数）。
- 浏览器验收：设置 → 导入 → 四个分段 tab → 显式扫描 → 勾选 → 应用 → 三段计数与实际落盘一致。

## 合并上游后怎么重打

```bash
git grep -n "fork:import-" -- lib components app
# 四条不变式：
#   1) lib/import/contract.ts 及其依赖图不许出现 node: 内建模块；
#   2) 渲染端只送候选 id，服务端 apply 必须重扫再反查；
#   3) 凭据只出 hasSecret，错误诊断只用错误码；
#   4) 扫描不自动触发。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
