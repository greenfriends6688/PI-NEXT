# 0062 · Todo / 日程工作区（fork:proma-44-planning）

| 项 | 值 |
| --- | --- |
| 意图 | 本机 Todo + 日程工作区：五类数据、描述草稿式自动保存、周/月日历、提醒、从 Todo 发起 Agent 对话 |
| fork 标记 | `fork:proma-44-planning` |
| 新增文件 | `lib/planning-*.ts`（10）、`app/api/planning/**`（6）、`components/fork/Planning*.tsx`（5）、6 份 `.test.mjs` |
| 上游文件接触面 | 4 个：`components/AppShell.tsx`（3 处接线）、`app/fork-ui.css`（追加一段）、`lib/i18n/messages/{en,zh-CN,zh-TW}.ts` |
| 依据 | Proma `packages/shared/src/types/planning.ts`、`main/lib/planning-manager.ts`、`renderer/components/planning/*`、`release-notes/v0.16.8.md` |
| 计划文档 | `docs/proma-borrowing-plan-2026-10-02.md` PR-44 |

## 与本仓已有 `todo` 工具的关系（**两回事，别搞混**）

| | `lib/todo-extension.ts`（既有） | 本补丁（`lib/planning-*.ts`） |
| --- | --- | --- |
| 是什么 | 会话内的 `todo` 工具，产物在**消息流**里 | 跨会话的**本机数据面**（`~/.pi/agent/planning/`） |
| 生命周期 | 随会话；删会话就没了 | 与会话无关，跨会话累积 |
| 谁能写 | 模型的工具调用 | 用户界面 + `POST /api/planning` |
| 界面 | `components/fork/TodoChip.tsx`（只读面板 + 复制） | `components/fork/PlanningWorkspace.tsx`（可写工作区） |

两者**没有**接线关系，也不打算接线：会话内 todo 的存储格式是历史的一部分（改它要重写
已录制的 toolResult，见 `AGENTS.md`「in-session branching stays locked mid-run」那一节），
而工作区需要跨会话、需要提醒、需要日历 —— 是另一个数据面。

## 数据模型（五类）

全部落在 `~/.pi/agent/planning/store.json`（单文件、原子写、0600），旁边放一个
`README.md` 说明「这个目录归 pi-web，pi CLI 不读它」。**pi CLI 忽略它时不报错**：
目录里没有 `settings.json` / `*.jsonl` 这些它会去解析的形状。

| 类 | 字段 |
| --- | --- |
| `todos` | `id` `title` `notes?` `status`(open/completed) `priority`(low/medium/high) `dueAt?` `groupId?` `tagIds[]` `reminderIds[]` `sessionLinks[{sessionId,firstTouchedAt,lastTouchedAt}]` `workspaceCwd?` `createdAt` `updatedAt` `completedAt?` |
| `calendar_events` | `id` `title` `notes?` `startAt` `endAt?` `allDay` `groupId?` `tagIds[]` `reminderIds[]` `todoId?` `workspaceCwd?` `createdAt` `updatedAt` |
| `groups` | `id` `scope`(todo/calendar) `name` `sortOrder` `createdAt` `updatedAt` |
| `tags` | `id` `name` `createdAt` `updatedAt` |
| `reminders` | `id` `targetType`(todo/calendar_event) `targetId` `triggerAt` `snoozedUntil?` `status`(pending/acknowledged/completed) `origin`(manual/`todo_due_at`) `acknowledgedAt?` `lastNotifiedAt?` `createdAt` `updatedAt` |

相对 Proma 的三处有意收窄（`lib/planning-types.ts` 头部有同样一份）：

- 关系存 **id 数组**而不是嵌套对象。Proma 走 SQLite，todo 上挂三张联表结果；这里是
  一个 JSON 文件，嵌套副本意味着「一次保存要同时改三处数组，漏一处就产生幽灵引用」。
- **不带 `color`**。本仓设计系统没有调色板这一档，加一个只能填十六进色的输入框是纯负担。
- **不带 EventKit 的 `nativeOrigin` / 同步档案**（见下方「不做」）。

## 描述草稿式自动保存（Proma v0.16.8 那个坑）

判定在 `lib/planning-draft-save.ts`（纯状态机），React 外壳在
`lib/planning-draft-autosave.ts`，落点在 `components/fork/PlanningTodoDetail.tsx`。

- 状态：`draft`（只由用户输入改变）/ `persisted`（服务端已确认）/ `dueAt`（去抖到期）/
  `inFlight` / `sent`（在途请求携带的那份）/ `blocked`（版本冲突后停手）/ `status` / `statusSince`。
- 停手 **800ms** 自动保存（`DRAFT_SAVE_DEBOUNCE_MS`）；失焦立即保存；
  关闭详情面板（**× / Esc / 点空白三条手势都汇到父组件的 `closeDetail()`**）时先 flush
  标题与描述，再清 `selectedId`。
- 状态提示 `保存中… / ✓ 已保存`，**2 秒**（`DRAFT_SAVE_STATUS_MS`）后自动消失，
  切走实体时立刻消失（`visibleDraftStatus`）。
- **自动保存不回写输入框**：状态机的 `draftSaveSettled()` 根本不碰 `draft`（不是「记得
  别调」，是结构上做不到），组件也从不拿保存回包去 setState。Proma 在这里是
  `setDetailNotes(notes)` 回写服务端 trim 过的值 —— 那就是「边打字边被光标抢走」。
- 续存只在「请求期间用户又打了字」（`draft !== sent`）时发生，且立刻续（`dueAt = now`）。
  按 `draft !== persisted` 判会在服务端做归一化时**每 0ms 重发一次**，永不停止。
- 标题与描述是**两个独立的 autosave 实例**：共享一个会让「描述在途」把标题的保存一起卡住。

## 日历格算法（`lib/planning-calendar.ts`，不引任何日期库）

- 「同一自然日」一律 `new Date(y, m, d)` 本地构造 + `getFullYear/getMonth/getDate` 判，
  不用 `toISOString().slice(0,10)`（UTC+8 下会把周一夜里算成周日）。
- `addLocalDays` 走 `setDate`（夏令时切换日 ≠ +86400000ms）。
- `addLocalMonths` **锚到 1 号**（`new Date(y, m ± 1, 1)`）：`setMonth(getMonth()+1)` 在
  1/31 上会溢出成 3/3。
- 月格阵：`lead = (当月 1 号 getDay() - weekStartsOn + 7) % 7`，总格数向上取整到 7 的倍数
  （最后一行必须是完整一周，不裁掉 30/31 号）。补白格用 `new Date(y, m, 0)` / `(y, m+1, d)`
  让 `Date` 自己滚月。
- 周视图时间轴：按开始时间排序后**贪心放列**（`end <= 该列最后一条的 end`），再按重叠簇
  结算列宽（一条与簇里最晚结束的那条都不重叠时收束本簇）。输出百分比，前端塞进
  `--fork-plan-top/height/left/width` 由 CSS 消费 —— 组件里没有一个写死的几何数字。
- 全天日程不进时间轴（周视图另有全天行）；跨天条目按 `[dayStart, dayEnd]` 裁剪。
- 全部单测在 **Asia/Shanghai / America/New_York / Europe/Berlin / Pacific/Auckland**
  四个时区下各跑一遍。

## 提醒

- 判定（纯）：`lib/planning-reminders.ts` —— `dueReminders`（到点且 pending）、
  `upcomingReminders`（24 小时内预告，提醒条要预告）、`displayReminders`（接上目标标题）。
- 驱动器：`lib/planning-reminder-scheduler.ts`，**30 秒短 tick**（长 `setInterval` 在系统
  休眠回来后会漂），`unref()`，`stop()` 清单例位。依赖全注入，所以「响过哪几条」是
  同步断言。
- 读盘接线在 `app/api/planning/scheduler-server.ts`：**驱动器本体不含 `fs`**，否则
  `components/fork/PlanningWorkspace.tsx` 间接拖进 `node:fs` →
  `lib/client-graph-purity.test.mjs` 会拦（这个坑本仓已经踩过两次，见那个文件头）。
- **与 PR-43 的自动化调度器刻意不共用**：那边跑的是「定时开一条 agent 会话」，有队列 /
  失败退避 / 无人值守权限；这边是一次性提醒，失败不该退避（提醒不是任务，重试三次只会
  让人关掉它）。两边唯一的共同点是短 tick。
- 生命周期：tick 由 `/api/planning/reminders` 路由在**授权通过之后**启动，于是它的时长
  恰好等于「有人正在看工作区」。关掉工作区就收不到提醒 —— 刻意的取舍（不引 Web Push /
  通知权限那一整套）。

## 从 Todo 发起 Agent 对话

`POST /api/planning/todo-agent`：校验 Todo 存在 + `expectedUpdatedAt` 对得上 + `cwd` 是
绝对路径 / 存在 / 在 allowed roots 内（与 `/api/cwd/validate`、`/api/files` 同一套，
不另写授权），然后 **`startRpcSession()` + `session.send({ type: "prompt" })`** ——
就是 `POST /api/agent/new` 用的那两条，**没有第二条消息通道实现**。前端拿到 `sessionId`
后 `window.location.assign('/?session=…')`，走 `lib/initial-navigation.ts` 已有的契约，
所以 **AppShell / TabBar / ChatWindow 一行都不用改**（TabBar 那个 kind 联合类型也不必扩）。

## 上游文件的 3 处接线（都在 `components/AppShell.tsx`）

```bash
grep -n "fork:proma-44-planning" components/AppShell.tsx
```

1. import + `const [planningOpen, setPlanningOpen] = useState(false)`。
2. 顶栏一枚入口按钮（`.fork-plan-launcher`，在 MCP / 插件两枚状态图标之后）。
   **刻意不进折叠导轨**：画板 02 帧 C 的导轨是「logo + 四枚方钮 + 设置贴底」，
   `components/AppShell.design-components.test.mjs` 钉死了 4，加第五枚会当场变红。
3. 根节点挂 `<PlanningWorkspace workspaces={…} activeCwd={…} onClose={…} />`。

## 明确不做

- **macOS EventKit 双向同步**。原生模块（Swift/ObjC 桥）+ 权限模型 +
  「同一件事被 Proma 与系统各改一次」的冲突解决 UI + 一整套同步档案，成本远超收益：
  本仓是 Node 服务端，要接 EventKit 意味着为了一个日历功能引入一条原生构建链。
  Proma 那边为此单独立了 5 张表（sync_profiles / native_connections /
  planning_native_sync_conflicts …）和 12 个 IPC 通道 —— 收益面是「提醒事项
  App 里也能看到」，而数据源仍然是本机 JSON。**这条边界要写死在类型里**：
  `lib/planning-types.ts` 刻意不含 `nativeOrigin` 字段。
- **跨时区日程**。事件存本地时间戳、不做 UTC 归一化；`allDay` 的 `startAt` 取本地当天 0 点。
- **给 Agent 暴露 planning 工具**（Proma 给了 26 个 planning MCP 工具）。AGENTS.md §0.4
  裁定：能力随工具形态落地，但这条 PR 的范围是**产品工作区**；把五类数据挂成工具要另开
  一条线（那才会动 `lib/rpc-manager.ts` 的 `extensionFactories`）。本 PR 的 agent 入口
  方向是反的：从 Todo 发起对话，而不是从 agent 改 Todo。
- **automation 的 7 个自调工具**（属 PR-43）。
- 移动端入口（顶栏那枚按钮 `!isMobile` 才渲染）、分组/标签的取色器、拖拽排序、
  日程与 Todo 的双向同步（只做 Todo → Event 的 `todoId` 单向引用）。

## 验收

- `tsc --noEmit` / `npm run lint`（0 error，**0 新增 warning**：基线 316 → 316）/
  `npm test`（2890 全绿）/ `npm run check:design`（0 新增字面量、0 未注册图标、0 画板偏差）。
- 单测：`lib/planning-state.test.mjs`（13）、`lib/planning-draft-save.test.mjs`（13）、
  `lib/planning-calendar.test.mjs`（18，四时区）、`lib/planning-reminders.test.mjs`（8）、
  `lib/planning-reminder-scheduler.test.mjs`（5）、`lib/planning-store.test.mjs`（7，
  `PI_CODING_AGENT_DIR` 指向临时目录）、`lib/planning-view.test.mjs`（9）、
  `app/api/planning/route.test.mjs`（10，op 判别式 + 首条消息模板 + 授权 seam）。
- **未验证**：没有跑 `npm run dev` / `build` / `prod`（任务明确要求不跑），所以
  浏览器端的实际渲染、周/月视图的视觉、提醒到点的真弹、Agent 对话的端到端都**没有**
  实测过。

## 合并上游后怎么重打

```bash
grep -rn "fork:proma-44-planning" components/AppShell.tsx app/fork-ui.css lib/i18n/messages/
# 六个不变式：
#   1) 自动保存永远不回写输入框（draftSaveSettled 不碰 draft）；
#   2) 关面板的 flush 只在 closeDetail() 一处（× / Esc / 点空白都走它）；
#   3) 判「同一自然日」只用 getFullYear/getMonth/getDate，不引时区库；
#   4) 驱动器 lib/planning-reminder-scheduler.ts 不得 import 任何含 fs 的模块；
#   5) 新 API 路由的授权走 isApiRequestAllowed + hasJsonContentType，不另写；
#   6) 不许新增依赖（日历不许引 moment/dayjs/date-fns）。
npm test
```
