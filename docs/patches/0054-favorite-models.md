# 0054 · 收藏模型（星标 + 置顶成组 + 单一 store）

| 项 | 值 |
| --- | --- |
| 意图 | 模型行内星标收藏，收藏项在选择器与设置页里置顶成组；两个入口改同一份状态，不需要刷新页面就能互相看到 |
| 参照实现 | Proma / ZCode 的模型行内星标 |
| fork 标记 | 无独立 `fork:` 标记（走 `lib/favorite-models.ts` 的单一 store 约定） |
| 新增文件 | `lib/favorite-models.ts`（+ `.test.mjs`）、`components/favorite-models-wiring.test.mjs` |
| 上游文件接触面 | `components/ChatInput.tsx`、`components/ModelSelector.tsx`、`components/ModelsConfig.tsx`（三个消费方） |
| `.patch` | 无（引入 commit 在换肤大快照里，无 staged-baseline 可反演） |

## 核实（不是照抄审计报告）

```
$ git log --oneline -- lib/favorite-models.ts
22fa16a release: Pinkslab v0.1.4          ← 当前形态（单一 store）落在这里
$ git log --oneline -S "favorite-models" | tail -4
8c73f3c feat(models): 模型行内星标收藏（用户要求：收藏应该跟在模型后面）   ← 功能起点
3e466a7 feat(models): 收藏置顶成组 + 移除输入框侧的独立收藏菜单
22fa16a release: Pinkslab v0.1.4                                      ← 抽成单一 store
1ed2708（后续接线改动）
$ grep -rn "favorite-models" --include=*.tsx components | grep -v test
components/ModelsConfig.tsx / components/ModelSelector.tsx / components/ChatInput.tsx
$ grep -n "favorite" components/fork/ProviderUsageCards.tsx   → 0 命中
```

审计记的引入 commit `22fa16a` 只对了一半：**星标与置顶成组的功能在 `8c73f3c` / `3e466a7`
就已经有了**，`22fa16a` 做的是把它们收敛成**单一 store**。三条都记，否则 revert 时会以为
「删掉 `lib/favorite-models.ts` 就等于没有收藏」。

## 审计把 `components/fork/ProviderUsageCards.tsx` 算进本条是错的

那个文件的标记是 `fork:models-usage-cards`，内容是画板 41「用量摘要（近 30 天）」的四张小卡
（按 provider 切一刀的本地用量）。它**一个字都没提到 favorite**
（`grep -n "favorite" components/fork/ProviderUsageCards.tsx` → 0 命中），
它复用的是 0025 的 `/api/usage-stats` 聚合，**不 import `lib/favorite-models.ts`**。
所以它不属于本条，已从本条落点里剔除。

## 与上游的关系

上游 `agegr/main` 的 `lib/favorite-models.ts` absent。**纯新增。**
消费方 `ChatInput.tsx` / `ModelSelector.tsx` / `ModelsConfig.tsx` 是上游文件，接线是加法。

## 核心是「单一 store」，不是「星标」

星标本身很简单。真正被修掉的是一个真实的 bug（`lib/favorite-models.ts` 文件头原文）：

> The chat model selector (ChatInput) and Settings → Models both read and write the same
> localStorage key. They used to keep independent React state seeded once on mount, so a
> favorite toggled in one place **never reached the other without a full reload** — the
> `storage` DOM event does not fire in the same document.

于是本模块是唯一真相源：**缓存快照 + 订阅者集合**，通过 `useSyncExternalStore` 被消费。

`components/favorite-models-wiring.test.mjs`（3 例）就是把这个不变式钉住的**源码守卫**：
三个消费方都必须 `from "@/lib/favorite-models"` + 用
`useSyncExternalStore(subscribeFavoriteModels, getFavoriteModelsSnapshot, getFavoriteModelsServerSnapshot)`，
且**都不许再直接出现 `pi-favorite-models` 这个 key**（只有 store 自己能拥有它）。

存储格式：JSON 数组的 `provider:modelId` 键，`parseFavoriteModels` 对任何畸形值一律返回空集；
**best-effort** —— localStorage 被浏览器策略挡住时，改动仍然在当前会话生效。

## 能否独立 revert

**能。**

- 删 `lib/favorite-models.ts` + 两份测试。
- 三个消费方按 `lib/favorite-models` 的 import 整段删，星标 UI 一并消失；
  `ChatInput.tsx` 的独立收藏菜单在 `3e466a7` 就已经删过了，revert 不会复活它。
- 无 `package.json` 依赖增删、无路由、无 `.gitignore` 改动。
- localStorage 里残留的 `pi-favorite-models` 无害。

## 验证手段

- 单测 `lib/favorite-models.test.mjs` 5 例（键格式、畸形值 → 空集、增删、订阅触发）。
- 源码守卫 `components/favorite-models-wiring.test.mjs` 3 例（见上）。
- 浏览器验收：模型行点星标 → **不刷新页面**切到设置 → 模型 → 星标已经是亮的 →
  反向亦然 → 选择器里收藏项置顶成组。

## 合并上游后怎么重打

```bash
git grep -n "lib/favorite-models\|pi-favorite-models" -- components lib
# 两条不变式：
#   1) 只有 lib/favorite-models.ts 可以出现 localStorage key，消费方一律走 useSyncExternalStore；
#   2) 键格式固定 "provider:modelId"，解析失败一律空集，不抛。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
