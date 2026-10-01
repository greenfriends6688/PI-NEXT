# 0053 · 通知偏好与语义提示音

| 项 | 值 |
| --- | --- |
| 意图 | 通知从「有权限就发」的隐式行为变成一张开关矩阵（总开关 + 完成 / 出错 / 只在失焦时），并给 4 类事件配 4 套音色 |
| 参照实现 | Zeno 设置 →「通知」的开关矩阵（`fork:zn-16`）；提示音为 GAP-27 |
| fork 标记 | `fork:zn-16` |
| 新增文件 | `lib/notification-prefs.ts`、`hooks/useNotificationPrefs.ts`、`lib/sound-presets.ts`（+ `lib/sound-presets.test.mjs`） |
| 上游文件接触面 | `components/AppShell.tsx`（三处投递判定读偏好）、`components/SettingsPanel.tsx`（通知分段）、`lib/browser-notifications.ts`（只读其既有 `shouldShowBrowserNotification`，不改） |
| `.patch` | 无（引入 commit 在换肤大快照里，无 staged-baseline 可反演） |

## 核实（不是照抄审计报告）

```
$ git log --diff-filter=A --format="%h %ad %s" --date=short -- lib/notification-prefs.ts
61807c5 2026-09-23  feat(ui): 抄 Zeno 壳子（侧栏/设置行/通知/皮肤）+ 上游合并前的检查点
$ git log --diff-filter=A --format="%h %ad %s" --date=short -- hooks/useNotificationPrefs.ts
61807c5 2026-09-23  （同上，同批落盘）
$ git log --diff-filter=A --format="%h %ad %s" --date=short -- lib/sound-presets.ts
f573824 2026-09-18  feat(design-tokens,audio): 补 token 常量模块与 4 类语义提示音
$ git log --oneline -S "sound-presets" | tail -3
f573824 → a126f23（docs）→ 1ed2708（后续接线）
```

审计记的 `61807c5` / `f573824` **两个都对**，但它们是**两批相隔 5 天的独立交付**：
`f573824`（2026-09-18）只做提示音色库，`61807c5`（2026-09-23）才做通知开关矩阵。
本条把两者合记，是因为 0053 的两半在设置页是同一张卡片的相邻两段，且共享「声音偏好」这一处状态。

## 与上游的关系

上游 `agegr/main` 的 `lib/notification-prefs.ts`、`hooks/useNotificationPrefs.ts`、
`lib/sound-presets.ts` 全部 absent。**纯新增。**

`lib/browser-notifications.ts` 是**上游共有的**（0047 桌面壳给它加过 Electron 原生桥），
本条**只读它的 `shouldShowBrowserNotification`，不修改它**。

## 三个刻意做出的判断

1. **拆成两件事，而不是一个总开关。**
   `enabled` 是总开关（关掉就完全不发）；`onlyWhenUnfocused` 是独立一条。
   本仓此前没有「只在窗口没聚焦时才弹」这条能力 —— 但 `shouldShowBrowserNotification`
   **恰恰已经在做这件事，只是写死为「永远这样」**。所以关掉 `onlyWhenUnfocused`
   等于回到更吵的旧行为，而不是「关掉某功能」。
2. **刻意没有 `onHostCrash`。** Zeno 那条接的是 Electron `utilityProcess` 宿主进程崩掉；
   本仓是 Next 进程内直接跑 AgentSession，**没有第二层进程可崩**。
   加一个永远不触发的开关比不加更糟，所以这一行**故意缺**。
3. **声音偏好不开第二份。** 它和 composer 上那个声音按钮是**同一个**偏好
   （`hooks/useAudio.ts` 的 `pi-sound-enabled`）。

`hooks/useNotificationPrefs.ts` 与 `useUiDensity` 同形：**只存值、没有 DOM 副作用**，
由取值方（`AppShell` 的三处投递判定）自己决定要不要真的弹。

## 4 类语义 × 4 套音色，体积零增加

`lib/sound-presets.ts` 的全部音色都用 **Web Audio 振荡器参数**描述，不引入任何音频文件：

| 语义 | 事件 |
| --- | --- |
| `complete` | 完成 |
| `blocked` | 受阻 |
| `checkpoint` | 检查点 |
| `notification` | 普通通知 |

| 音色 | 描述 |
| --- | --- |
| `soft` | 正弦双音，沿用既有听感，默认选中 |
| `chime` | 三角波上行琶音，偏「提醒」 |
| `pulse` | 方波短促两下，偏「受阻 / 警告」 |
| `glass` | 高频正弦泛音，偏「轻通知」 |

## 能否独立 revert

**能，两半可分开撤。**

- 只撤通知开关：删 `lib/notification-prefs.ts` + `hooks/useNotificationPrefs.ts`，
  `AppShell.tsx` 的三处投递判定回到「有权限就发」，`SettingsPanel.tsx` 删通知分段。
- 只撤提示音：删 `lib/sound-presets.ts` + 测试，composer 上的声音按钮回到 `useAudio` 默认。
- 两半都**不碰** `lib/browser-notifications.ts`（上游共有，0047 也在用）。
- 无 `package.json` 依赖增删、无路由新增。

存储是 localStorage（`pi-notification-prefs`），revert 后偏好值残留在 localStorage 里，
无害（下次再打开会重新解析），但如果将来复做要认这个 key。

## 验证手段

- 单测 `lib/sound-presets.test.mjs` 5 例（音色参数完整性、4 语义 × 4 音色覆盖、默认选中 `soft`）。
- `lib/notification-prefs.ts` 是纯数据模块、**服务端可 import**，解析路径
  （`parseStoredNotificationPrefs` + `NOTIFICATION_PREFS_DEFAULT`）可直接单测，
  目前没有配套测试文件 —— 补测试时优先补它。
- 浏览器验收：设置 → 通知 → 关总开关 → 跑一轮长任务 → **没有通知** →
  打开总开关、关 `onlyWhenUnfocused` → 窗口在前台也弹 →
  换 4 套音色各听一次完成 / 受阻两种事件。

## 合并上游后怎么重打

```bash
git grep -n "fork:zn-16" -- lib hooks components
# 三条不变式：
#   1) enabled 与 onlyWhenUnfocused 是两条独立开关，别合并成一个；
#   2) 不加 onHostCrash（本仓没有可崩的第二层进程）；
#   3) 声音偏好复用 useAudio 的 pi-sound-enabled，不另开一份。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
