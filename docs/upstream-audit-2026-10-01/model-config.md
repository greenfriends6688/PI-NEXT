# 「模型配置」线：上游（agegr/main）vs 本 fork 全景审计

生成时间：2026-10-01 · 只读审计，**未修改工作区任何文件**（仅 `read` / `grep` / `git show` / `git apply -3 --check` / `curl -o /tmp/...`）
对照基准：`agegr/main` HEAD = `e17d2cc` · 本地副本 `pi参考项目/pi-web-main/` · 我们 fork 分支 `main` HEAD = `e34c1c6`

---

## 0. 三个必须先说的事实

1. **两边已经高度分叉，「上游有 ≠ 我们没有」。** 我们 fork 在模型线上**比上游多**：`samplingParams`（温度/top_p 等高级参数）编辑器、`thinkingLevelMap` 从 models.dev `reasoning_options` 推导、收藏模型、provider 图标模式、`builtin-models` 覆盖告警、`thinking-profile` 请求镜像、`usage-stats` 逐模型 token/成本统计。上游 `agegr/main` 反而**没有**这些。
2. **我们缺的东西集中在两类**：① `models.json` 读文件的**数据安全语义**（会静默删掉用户全部 provider）；② **全局默认模型 / 思考档位**这一层完全没有（上游 #871 引入）。
3. **fork 上游时用 `git apply -3` 拿 patch 基本无效**——我们改了同一个文件的同一块（`ModelsConfig.tsx` 已经重写成画板设计系统），9 条候选 PR 里 8 条在 `ModelsConfig.tsx` / i18n 上冲突。真正能干净落的只有 #813（thinking level 记忆），但那个功能我们已有 fork 自研版。

---

## 第 1 节 · 上游「模型配置」能力全景

### 1.1 `models.json` 的读写语义（`lib/models-config-store.ts`）

| # | 文件:行号 | 用户能得到什么 |
|---|---|---|
| 1.1.1 | `lib/models-config-store.ts:76` `stripJsonComments` | 读 `models.json` 时容忍 `//` 行注释、尾逗号、BOM（`:95` 去 BOM），**与 pi CLI 的 loader 行为一致** |
| 1.1.2 | `lib/models-config-store.ts:65` `ModelsConfigReadError` + `app/api/models-config/route.ts:9-15` | 文件在但内容不可用时，GET 返回 **422** 并把原因显示出来，而不是假装是空配置 |
| 1.1.3 | `lib/models-config-store.ts:114` `writeModelsConfig` 第一行 `readModelsConfig(modelsPath)` | **绝不覆盖读不出来的文件**（草稿不是从它构建的，写下去等于静默丢内容）；PUT 因此返回 **409**（`app/api/models-config/route.ts:26-29`） |
| 1.1.4 | `lib/models-config-store.ts:119` `writePrivateFileAtomicSync` | 原子写 + 0600 权限（同 `lib/atomic-file.ts`，两边一致） |
| 1.1.5 | `lib/models-config-store.ts:29-44` `normalizeModelsConfigCosts` | 价格表缺字段自动补 0；整组非法则整组丢弃 |
| 1.1.6 | `lib/models-config-store.ts:46-57` `sanitizeModelsConfig` | 丢掉 `id` 为空/纯空格的模型行（配合 `83c3757` #473） |
| 1.1.7 | `lib/models-config-store.ts:114` 尾部 `invalidateModelsCache()` | 写完立刻让 `/api/models` 缓存失效 |

### 1.2 provider / model 定义字段全集 · 每个字段上游有没有 UI

字段全集来自 pi-ai `Model<TApi>`（`node_modules/@earendil-works/pi-ai/dist/types.d.ts:805-833`）+ models.json 的 provider 层（`baseUrl/api/apiKey/headers/compat/models/modelOverrides`）。

**provider 层**

| 字段 | 上游 UI 位置 | 状态 |
|---|---|---|
| `baseUrl` | `components/ModelsConfig.tsx:423` | ✅ 可改 |
| `api`（协议下拉） | `:323` + `API_OPTIONS:161`（openai-completions / openai-responses / anthropic-messages / google-generative-ai） | ✅ 可改 |
| `apiKey` | `:336`（支持 `ENV_VAR`、`!shell-cmd`、字面量三种语法，`:492-495`） | ✅ 可改 |
| `headers` | `:444` `HeaderListEditor` | ✅ 可改（provider 级） |
| `compat` | `:722` `effectiveCompat` 合并 provider+model，UI 里只有两个布尔开关（deepseek `thinkingFormat` `:703-714`、developer role `:1018`） | ⚠️ 部分：任意 compat 子键**无 UI**，只能在 Advanced 折叠里"显示覆盖数量"（`:1025-1032`） |
| `models[]` | 发现/目录/手填 | ✅ |
| `modelOverrides` | — | ❌ **上游也没有 UI** |

**model 层**

| 字段 | 上游 UI 位置 | 状态 |
|---|---|---|
| `id` | `:1043` 区 | ✅ |
| `name` | `:1046` 区 | ✅ |
| `reasoning` | `:1147` Checkbox | ✅ |
| `input`（text/image） | `:1148` Checkbox（只暴露 `image`） | ✅（只到 image 粒度） |
| `contextWindow` | `:1167` `Field` 纯数字输入 | ✅ 手填 |
| `maxTokens` | `:1171` `Field` 纯数字输入 | ✅ 手填 |
| `cost.{input,output,cacheRead,cacheWrite}` | `:1179-1190` 四个数字框 + 「全部必填」校验（`:1001-1009`, `:127-137` helpers） | ✅ |
| `cost.tiers` | — | ❌ 类型里有（`:98`）但**上游也无 UI** |
| `headers` | `:1252` | ✅ 模型级覆写 |
| `api`（单模型覆写协议） | `:1248` | ✅ |
| `compat` | `:1264-1275` 两个开关 | ⚠️ 部分 |
| `thinkingLevelMap` | `:1277-1290` 逐档编辑器（level → wire 值 / null=不支持） | ✅ |
| `samplingParams`（temperature/top_p/…） | — | ❌ **上游没有 UI**（fork 有，见 §2） |
| `inputLimits` / `promptCache` | — | ❌ 上游 fork 双方都没有 |

### 1.3 模型选择器：分组 / 收藏 / 思考档位 / 三层默认

| # | 文件:行号 | 用户能得到什么 |
|---|---|---|
| 1.3.1 | `components/ModelSelector.tsx:88-104` | 按 provider 分组的下拉；`>8` 个模型时出现过滤框（`MODEL_FILTER_THRESHOLD:36`） |
| 1.3.2 | `components/ModelSelector.tsx:295` + `components/SelectorRow.tsx:1-136` | **★ 收藏/默认共用的 gutter**：每行右侧一颗星 |
| 1.3.3 | `components/ModelSelector.tsx:320-325` `star={onSetDefault ? {defaultLabel: t("chat.defaultModel"), …}}` | ★ 星标 = **「设为新会话默认模型」**，且默认值那行的星是实心 |
| 1.3.4 | `components/ChatInput.tsx:2511-2519` `onSetDefaultThinkingLevel` | 思考档选择器上同款星标 = 设为全局默认推理强度 |
| 1.3.5 | `app/api/models/default/route.ts:44` `PUT` | 保存全局默认模型/思考档；`:86-95` 若项目 `.pi/settings.json` 会遮蔽则 **409 + 指名文件**，不假装成功 |
| 1.3.6 | `lib/default-preferences.ts:26-38` `shadowingProjectKeys` | 上面那条 409 的判定逻辑 |
| 1.3.7 | `lib/default-preferences.ts:44-62` `writeDefaultPreferences` | drain `SettingsManager` 的存储错误队列 → 写盘失败必须报错，不返回假成功 |
| 1.3.8 | `app/api/models/route.ts:78-89` | 返回 `defaultThinkingLevel`（新会话起手档）与 `savedDefaultThinkingLevel`（settings.json 里存的值，星标对齐用） |
| 1.3.9 | `lib/models-cache.ts:18-20` | 上面两个字段进缓存 payload |
| 1.3.10 | `6a1246e` 提交说明 | 反向修复：新会话里选模型**不再**写全局默认（与 TUI 一致），只有点星标才写 |
| 1.3.11 | `app/api/models/enabled/route.ts:206-210` | `enabledModels` 三层作用域：**项目 `.pi/settings.json` > 全局 `~/.pi/agent/settings.json`**，项目层存在时 UI 显示「项目设置覆盖了 enabledModels」且禁用编辑 |

### 1.4 发现 / 目录（discovery）

| # | 文件:行号 | 用户能得到什么 |
|---|---|---|
| 1.4.1 | `app/api/models-config/discover/route.ts:33` `POST` + `components/ModelsConfig.tsx:463` 「Fetch models」 | 拉 provider 自己的 `/models`，勾选后导入 |
| 1.4.2 | `lib/model-discovery.ts:56-74` `buildModelsListUrl` | 按 `api` 拼协议正确的列表 URL：anthropic 补 `/v1` + `?limit=1000`；google 补 `/v1beta` + `?pageSize=1000` |
| 1.4.3 | `lib/model-discovery-auth.ts:44-53`（d8f89c5 #1006） | **没有 `baseUrl` 时，从 pi 的 provider catalog 反查 `model.baseUrl` / `model.api`** → 只列模型的 provider 和 pi 自带 provider 也能发现 |
| 1.4.4 | `app/api/models-config/discover/route.ts:14-31` `buildHeaders` | 按协议拼鉴权头（`x-api-key` + `anthropic-version` / `x-goog-api-key` / `Bearer`） |
| 1.4.5 | `lib/model-discovery.ts:8-54` `parseDiscoveredModels` | 兼容 6 种响应形状（`data`/`models`/`results`/`items`/裸数组/对象表）+ 去 `models/` 前缀 + display_name |
| 1.4.6 | `app/api/models-config/catalog/route.ts` + `lib/model-catalog.ts:296-343` `flattenModelsDevCatalog` | models.dev 目录，1h TTL |
| 1.4.7 | `lib/model-catalog.ts:345-411` `recommendModelCatalogPreset` | 「填入模型信息」：按 provider / base-url / 多数共识三级匹配，回填 name/reasoning/input/contextWindow/maxTokens + 价格 |
| 1.4.8 | `lib/model-catalog.ts:238-291` `consensusPrice` | 价格共识：≥60% 或 ≥5 家一致才采信，否则标 `unreliable` |
| 1.4.9 | `components/EnabledModelsSection.tsx:391-394` + `app/api/models/refresh/route.ts` + `lib/model-catalog-refresh.ts`（058341d #938） | **Refresh catalog 手动按钮**：`{"changed":n,"completed":bool,"reason":"offline"}` 四态提示 |
| 1.4.10 | `app/api/models-config/test/route.ts` + `components/ModelsConfig.tsx:1300+` | **测试 key 按钮**：真发一次请求，回延迟 / HTTP 状态 / 响应片段 |

### 1.5 用量 / 配额

| # | 文件:行号 | 用户能得到什么 |
|---|---|---|
| 1.5.1 | `app/api/provider-usage/route.ts` + `components/ProviderUsageSummary.tsx:88-120` | provider 配额桶列表（分组名/标签/剩余量），设置页模型详情内 |
| 1.5.2 | `lib/i18n/format.ts:70` `formatUpdatedTime`（8b084d3） | 「今天 / 昨天 / 3 小时前」相对时间，而不是绝对时间戳 |
| 1.5.3 | `lib/provider-usage.ts` + `lib/provider-usage-ids.ts`（6e95fba #844） | OpenCode Go 配额适配器 |

### 1.6 鉴权：apiKey / oauth 双通道 + 扩展 provider

| # | 文件:行号 | 用户能得到什么 |
|---|---|---|
| 1.6.1 | `components/ModelsConfig.tsx:1434` 「订阅」区 + `:1624` 「API Key」区 | 侧栏按「订阅 / 自定义」两组列 provider |
| 1.6.2 | `components/ModelsConfig.tsx:81` `OAuthLoginState` + `OAuthPastePanel` | OAuth 6 阶段机：callback url / **device_code**（`:1893`）/ prompt / select / progress |
| 1.6.3 | `app/api/auth/providers/route.ts` | 同时返回 `oauthProviders` 和 `apiKeyProviders`，双通道 provider（Anthropic/Copilot/Codex）两边都出现（`ModelEntry.supportsApiKey` `:76`, `supportsOAuth` `:73`） |
| 1.6.4 | `lib/model-runtime.ts:18-22` `createModelRuntimeWithExtensions`（79894b9 #833） | 扩展 `registerProvider` 注册的 provider 出现在设置页与 4 条鉴权路由（providers / api-key / login / logout）里 |
| 1.6.5 | `app/api/auth/api-key/[provider]/route.ts` `POST` | 存 key 走 `provider-credential-store.ts`（原子写 auth.json） |

---

## 第 2 节 · 逐项对照我们 fork

判定口径：`已有` = 能力等价（实现可不同）；`部分` = 主路径在但有缺口；`缺失` = grep 无命中。

### 2.1 models.json 读写语义

| 上游项 | 判定 | 证据 |
|---|---|---|
| 1.1.1 注释/BOM/尾逗号容忍 | **缺失（高危）** | `lib/models-config-store.ts:63-69` 只有裸 `JSON.parse(readFileSync(...))`，无 `stripJsonComments`、无 BOM 处理。`grep -n stripJsonComments lib/` **0 命中** |
| 1.1.2 读失败报 422 | **缺失** | `lib/models-config-store.ts:68-70` `catch { return { providers: {} } }` —— 解析失败被吞成空配置。`grep -rn ModelsConfigReadError lib/ app/` **0 命中** |
| 1.1.3 不覆盖读不出的文件 | **缺失** | `lib/models-config-store.ts:73-81` `writeModelsConfig` 不做前置读校验，直接写 |
| **综合后果** | **数据丢失 bug** | 用户 `models.json` 里只要有一行注释 → `GET /api/models-config` 返回 `{providers:{}}` → 面板显示空 → 用户随便改一处点 Save → **全部 provider 被删**。上游 499aa4f 正是修这个 |
| 1.1.4 原子写 | 已有 | `lib/models-config-store.ts:80` `writePrivateFileAtomicSync`；`lib/atomic-file.ts` 与上游 `diff -q` 完全一致 |
| 1.1.5 价格补零 | 已有 | `lib/models-config-store.ts:14-42`，与上游逐字相同 |
| 1.1.6 空 id 行剔除 | 已有 | `lib/models-config-store.ts:46-57` |
| 1.1.7 缓存失效 | 已有 | `lib/models-config-store.ts:81` |

### 2.2 字段级：我们能不能配

| 字段 | 判定 | 我们的证据 |
|---|---|---|
| provider `baseUrl` | 已有 | `components/ModelsConfig.tsx:742` |
| provider `api` | 已有 | `:752-753` |
| provider `apiKey` | 已有 | `:747-750`（`SecretTextInput`） |
| provider `headers` | 已有 | `:756-757` |
| provider `compat` | **部分** | 只有 `effectiveCompat` 合并（`:905`）+ deepseek/developer 两个开关（`:1561-1575`），任意子键无编辑器 |
| **`contextWindow`** | **已有（比上游好）** | `components/ModelsConfig.tsx:1467-1478` —— 既有手填 `NumInput`（`:1470`）又有 `LimitChips` 阶梯 `[128k,256k,512k,1M]` + 「跟随目录 / 覆盖」（`:913-919`, `:945-958`） |
| **`maxTokens`** | **已有（比上游好）** | `:1480-1494` 阶梯 `[4096…65536]`；`:1494` 还有 `maxTokensExceedsContext` 校验告警 |
| **`cost.{input,output,cacheRead,cacheWrite}`** | 已有 | `:1501-1535`，四个 `NumInput` + 「全部必填」内联校验 `:1525` |
| `cost.tiers` | **缺失（双方都缺）** | 只有类型声明 `components/ModelsConfig.tsx:132`，无编辑器 |
| **`samplingParams`（temperature/topP/…）** | **已有（上游没有）** | 类型 `components/ModelsConfig.tsx:134-135`；编辑器 `SamplingParamsEditor` `:966-1017`（JSON textarea）；接线 `:1497-1498`；i18n `lib/i18n/messages/en.ts:1078-1080` + `zh-CN.ts:1078-1079` |
| model `headers` | 已有（带 bug，见 §4） | `:1556-1557` |
| model `api` 覆写 | 已有 | `:1552-1553` |
| `reasoning` / `input.image` | 已有 | `:1451-1464` |
| `thinkingLevelMap` | **已有（比上游好）** | 编辑器 `:1578-1592`；且 `lib/model-catalog.ts:112-135` `thinkingLevelMapFromReasoningOptions` 能从 models.dev 的 `reasoning_options` 自动推导（上游无此逻辑） |
| `inputLimits` / `promptCache` | **缺失（双方都缺）** | `grep -rn "inputLimits\|promptCache" components/ app/ lib/` **0 命中** |
| `modelOverrides`（provider 层） | **缺失（双方都缺）** | 只有类型 `:147` |

**「我们已有但比上游多」的模型参数能力（3 项）**：`samplingParams`、`thinkingLevelMap` 自动推导、`contextWindow/maxTokens` 阶梯芯片 + 覆盖标记。

### 2.3 模型选择器

| 上游项 | 判定 | 证据 |
|---|---|---|
| 1.3.1 provider 分组 + 过滤框 | 已有 | `components/ModelSelector.tsx:87-104` |
| 1.3.2/1.3.3 **★ 设为默认模型** | **缺失** | `grep -n "onSetDefault\|defaultValue" components/ModelSelector.tsx components/ChatInput.tsx components/ChatWindow.tsx` → **0 命中**；`components/SelectorRow.tsx` 文件不存在；`lib/default-preferences.ts` 不存在 |
| 1.3.4 ★ 设为默认思考档 | **缺失** | `grep -n "onSetDefaultThinkingLevel\|savedDefaultThinkingLevel" components/` → **0 命中** |
| 1.3.5 `PUT /api/models/default` | **缺失** | `app/api/models/default/` 目录不存在（上游有 `route.ts` 115 行） |
| 1.3.6 项目遮蔽 409 | **部分** | 逻辑在，但只用于 `enabledModels`（`app/api/models/enabled/route.ts:206-210`），默认模型/思考档没有 |
| 1.3.7 写盘错误不吞 | **缺失** | 无 `drainErrors` 调用 |
| 1.3.8/1.3.9 `defaultThinkingLevel` 字段 | **缺失** | `lib/models-cache.ts:14-16` 只有 `thinkingInputs` / `thinkingLevelMemory`，无 `defaultThinkingLevel` / `savedDefaultThinkingLevel` |
| 1.3.10 新会话选模型不写全局默认 | **已有** | `hooks/useAgentSession.ts:902` `if (!selectedModel) setNewSessionDefaultModel(result.model)` —— 仅本地 state |
| 1.3.11 enabledModels 项目/全局作用域 | 已有 | `app/api/models/enabled/route.ts:51,206-210`；`components/EnabledModelsSection.tsx:74,409` |
| **收藏**（上游没有） | **已有（自研）** | `lib/favorite-models.ts`（120 行）+ `components/ModelSelector.tsx:73-79,90-101,2692`（ModelsConfig 侧也接了 `components/ModelsConfig.tsx:2692-2693`） |

### 2.4 发现 / 目录 / 测试 key

| 上游项 | 判定 | 证据 |
|---|---|---|
| 1.4.1 Fetch models 按钮 | 已有 | `components/ModelsConfig.tsx:578,633` |
| 1.4.2 `buildModelsListUrl` | 已有 | `lib/model-discovery.ts:56-74`，与上游**逐字相同** |
| 1.4.3 从 pi catalog 反查 baseUrl（#1006） | **已有（实现不同）** | 我们走 `app/api/models-config/discover/route.ts:31-40`：自己 `createModelRuntimeWithExtensions().getAvailable()`，并按 `api` 挑匹配的 baseUrl（解决 opencode-go 的 anthropic/openai 双 endpoint 问题，注释见 `:23-30`）。上游走 `lib/model-discovery-auth.ts:44-53` 返回 `baseUrl`/`api`。**功能等价，我们的还多一层协议匹配** |
| 1.4.4 按协议拼鉴权头 | 已有 | `lib/model-discovery.ts:77-103` `buildDiscoveryHeaders`（我们抽到了共享模块，上游还在 route 里） |
| 1.4.5 `parseDiscoveredModels` | 已有 | `lib/model-discovery.ts:43-54`，与上游相同 —— **但只取 id/name，不取上下文档位**（见 §3 #957） |
| 1.4.6 models.dev 目录 | 已有（重构过） | `lib/models-dev-catalog.ts`（我们抽成共享模块，上游内联在 `catalog/route.ts:10-58`） |
| 1.4.7 「填入模型信息」推荐 | 已有 | `lib/model-catalog.ts:388-425` + `components/ModelsConfig.tsx:1426-1448` |
| 1.4.8 价格共识可信度 | 已有 | `lib/model-catalog.ts:238-291` |
| 1.4.9 **Refresh catalog 按钮**（#938） | **已有** | `components/EnabledModelsSection.tsx:307,400-403`；`lib/model-catalog-refresh.ts`（153 行 vs 上游 152，diff 只有一行 fork 标记）；`app/api/models/refresh/route.ts` `diff -q` **完全一致**。我们还多一个改进：`:315-316` `changed` 优先于 `unreachable` |
| 1.4.10 **测试 key 按钮** | 已有 | `components/ModelsConfig.tsx:1608-1642`；`app/api/models-config/test/route.ts` `diff -q` **完全一致** |

### 2.5 用量 / 配额

| 上游项 | 判定 | 证据 |
|---|---|---|
| 1.5.1 配额桶列表 | 已有 | `components/ProviderUsageSummary.tsx:88-160`（我们重画成 `ConfigStatGrid`）；`lib/provider-usage.ts` 与上游 `diff -q` **完全一致** |
| 1.5.2 相对时间（8b084d3） | 已有 | `components/ProviderUsageSummary.tsx:11` import `formatUpdatedTime`；`lib/i18n/format.ts:70` |
| 1.5.3 OpenCode Go 配额（#844） | 已有 | `lib/provider-usage-ids.ts` / `lib/provider-usage.ts` 与上游 `diff -q` **完全一致** |
| **逐模型 token/成本**（上游无） | **已有（自研）** | `lib/usage-stats.ts:60,144`（`models: Record<string,UsageBucket>` + `UsageModelPoint[]`）+ `app/api/usage-stats/route.ts` |

### 2.6 鉴权

| 上游项 | 判定 | 证据 |
|---|---|---|
| 1.6.1 订阅/自定义分组 | 已有 | `components/ModelsConfig.tsx:2574,2622` |
| 1.6.2 OAuth 6 阶段 + device_code | 已有 | `components/ModelsConfig.tsx:81,1696-1698,1893` |
| 1.6.3 双通道 provider 列表 | 已有 | `components/ModelsConfig.tsx:70-80,2236` |
| 1.6.4 **扩展注册 provider**（#833） | 已有 | `lib/model-runtime.ts:1-22` 与上游 `diff -q` **完全一致**；4 条 auth 路由 `diff -q` **全部完全一致**；`lib/provider-listing.ts` `diff -q` **完全一致** |
| 1.6.5 存 key 原子写 | 已有 | `lib/provider-credential-store.ts` 114 行，与上游一致 |
| **内置模型覆盖告警**（上游无） | **已有（自研）** | `lib/builtin-models.ts`（90 行）+ `app/api/models-config/route.ts:22-27` 返回 `warnings` + `components/ModelsConfig.tsx:2391` |

---

## 第 3 节 · 上游 closed-unmerged 里的模型 / 设置类 PR

复核方式：未认证 `curl https://api.github.com/repos/agegr/pi-web/pulls?state=closed&per_page=100&page=1..6` → **549 条 closed**（本次实测，与 `/tmp/pi-audit-prs.md` 的 549 一致）；正则 `model|provider|param|token|limit|header|setting|context|pricing|cost|quota|usage|thinking|reason|auth|api.?key|oauth|discover|catalog` 命中 100 条，其中 **closed-unmerged 54 条**。对优先级最高的 16 条拉了 detail，9 条拉了 `.diff` 并跑 `git apply -3 --check`。

| PR | 标题 | 改了什么 | 我们能不能配 | `git apply -3 --check` | 建议 |
|---|---|---|---|---|---|
| **#957** | feat(models): auto-fill context window / max output tokens and add presets | `parseDiscoveredModels()` 开始解析 provider `/models` 响应里的上下文档位（`context_window`/`context_length`/`max_context_tokens`/`max_tokens`/`max_output_tokens`/`max_completion_tokens` + camelCase + `metadata.limits`/`limits`/`top_provider`/`capabilities` 嵌套两层），并把「填入模型信息」的取值优先级改成 provider 接口 > models.dev > 已有值 | **部分**：我们有 contextWindow/maxTokens 的阶梯 + models.dev 回填（`components/ModelsConfig.tsx:1467-1494`），但**填不进来自 provider 自己的 `/models`**（`lib/model-discovery.ts:43-54` 只取 id/name） | ❌ 冲突 4：`ModelsConfig.tsx` / `models-config-helpers.ts` / 3 个 i18n | **采纳（只取 `lib/model-discovery.ts` + test 两个文件）**——这是「模型参数」缺口里最实的一个，patch 与我们 ModelsConfig 的改动不重叠，`lib/model-discovery.ts` 那半应该能干净落 |
| **#918** | feat(settings): add retry settings to General settings panel | 新增 `lib/retry-settings.ts` + `GET/PUT /api/retry-settings`，UI 上暴露 `retry.{enabled,maxRetries,baseDelayMs}`（写 `~/.pi/agent/settings.json`，带 `proper-lockfile`） | **缺失**：`grep -rn "retry-settings\|retrySettings" app/ components/ lib/` **0 命中**。我们只有读侧 `lib/pi-types.ts:140 autoRetryEnabled` / `lib/rpc-manager.ts:854` | ❌ 冲突 4：`SettingsPanel.tsx` / 3 个 i18n（`app/settings.css`、`lib/api-types.ts` 干净） | **采纳 lib 部分、UI 自己接**。注意它绕过了 `SettingsManager` 直接改 settings.json；pi 确实认 `settings.retry`（`node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.d.ts:23-29`），但 `SettingsManager` 只有 `setRetryEnabled`，没有 `maxRetries`/`baseDelayMs` 的 setter —— 我们要写的话应该自己加 flush/drainErrors，别照抄 proper-lockfile |
| **#482** | fix(models): header override editor — blank values, stale sessions, hardcoded copy | ① `serializeHeaderRows()` 跳过空值行（否则空值会覆写父 provider 的同名 header）② `PUT /api/models-config` 后调 `refreshRpcSessionModelConfigs()` 热重载所有活会话 | **缺失（两处）**：`components/models-config-helpers.ts:66-73` 仍是 `if (name) headers[name] = row.value`（**空值照写**）；`app/api/models-config/route.ts:17-27` 保存后**不刷新活会话**，改 models.json 要等重启/10 分钟空闲回收 | ❌ 冲突 4（`models-config-helpers.ts` 反而干净） | **采纳①（3 行修复，两边都有此 bug）**；**采纳②（改动小、价值高：保存后不用重启）**；跳过硬编码文案部分（我们已全 i18n） |
| **#916** | feat(models): sync a provider's model list with its upstream endpoint | 「Sync models」按钮：上游有本地没有 → 加；本地有上游没有 → 报告，**且必须用户勾选**才删 | **缺失**：我们只有「Import models…」单边加（`components/ModelsConfig.tsx:578,633`），没有反向清理 | ❌ 冲突 4 | **采纳（降级版）**：我们已有 #1006 等价的 baseUrl 回退（`app/api/models-config/discover/route.ts:31-40`），所以只需要加"差异报告 + 勾选删除"，不必移植整个 PR |
| **#849** | feat(models): manage model visibility from the chat selector | 模型下拉底部加「管理可见模型」，直接编辑 `enabledModels` | **部分**：我们在**设置页**有完整 `EnabledModelsSection`（`components/EnabledModelsSection.tsx`，含 provider 总开关 / 过滤 / prune），但**聊天下拉里没有入口** | ❌ 冲突 5 | **跳过**（功能已由 `50f6cce` #930 在设置页覆盖，聊天侧再加一个入口是 UX 选择不是能力缺口；若要做应做成"跳转到设置"链接而非第二份编辑器） |
| **#813** | Remember the selected thinking level for new sessions | 新会话沿用上次显式选择的推理档（存浏览器，含 `auto`），旧会话隔离 | **已有（自研，更强）**：`lib/thinking-level-memory.ts` 存 `~/.pi/agent/pi-web-preferences.json`，`app/api/thinking-level-memory`，且 `lib/thinking-level-memory.ts:24-26` 记的是**SDK clamp 后实际生效**的值 | ✅ **APPLIES CLEAN** | **跳过**——功能等价且我们的更严谨；能干净落不代表该落 |
| **#867** | feat: show provider quota beside the model selector | 输入框工具栏上、模型选择器右侧加配额芯片，hover 列所有窗口 | **缺失**：`grep -n "providerUsage\|ProviderUsageSummary" components/ChatInput.tsx` → **0 命中**。我们只在设置页（`components/ModelsConfig.tsx:550`）有 | ❌ 冲突 6 | **可选**：后端 `app/api/provider-usage/route.ts` 已就绪（与上游一致），只差一个前端 chip，**性价比最高的"UI 没暴露"类**。但需要先解掉无会话时怎么拿 provider（PR 作者自己在 body 里说明了这个约束） |
| **#442** | Add provider availability toggles | 每 provider 启停开关，状态放 `models-ui.json` sidecar（pi schema 拒绝未知 provider 字段） | **已被超越**：`50f6cce` #930 的 `enabledModels` 是 pi 原生答案且已在我们 fork 里 | ❌ 冲突 4 | **跳过**（sidecar 方案与我们的设计系统冲突，功能重复） |
| **#243** | feat: enhance model validation and error handling | models.json schema 校验是全有全无的 —— 一条 `id:""` 让**所有**自定义 provider 消失且无提示 | **已有（被上游 `83c3757` #473 以另一种方式解决）**：`lib/models-config-store.ts:46-57` `sanitizeModelsConfig` 剔除空 id 行 + `:68-70` 吞异常 | ❌ 冲突 2 | **跳过**（问题不存在了） |

其余 45 条 closed-unmerged 已按关键词归类扫过，无一落在「模型参数」缺口上：`885`（标签格式）、`776`（模型命名会话）、`561`（prune enabledModels，被 #930 覆盖）、`294`（重试提示动作，不含参数）、`442`/`849`（已列）、`727`（模型目录+白名单，被 #930+#938 覆盖）、`1002`/`1003`（扩展加载泄漏，非配置能力）、`885`/`814`（纯 UI）。优先级权重的「价格」「重试」「思考档位」「上下文/输出上限」「请求头」五条线已全部覆盖。

---

## 第 4 节 · 结论

### 4.1 我们「模型配置」最缺的东西（按价值排序）

| # | 缺什么 | 用户少了什么控制 | 上游依据 | 落点文件 | 工作量 |
|---|---|---|---|---|---|
| **1** | **保存模型配置后不热重载活会话** | 改完 baseUrl/headers/apiKey 后，正在跑的会话仍然用旧配置，要重启或等 10 分钟空闲回收 | PR #482 | `app/api/models-config/route.ts:17-27` + `lib/rpc-manager.ts:885`（已有 `modelRuntime.refresh({allowNetwork:false})` 可复用） | **S** |
| **2** | **模型规格不能从 provider 自己的 `/models` 回填** | 只能手填或靠 models.dev 猜；私有网关/vLLM/Self-hosted 场景下 catalog 查不到，只能抄 | PR #957 | `lib/model-discovery.ts:43-54` + `components/ModelsConfig.tsx:1078-1106`（`fillEmptyModelFields`） | **S**（前半）/ **M**（含优先级 UI） |
| **3** | **全局默认模型 / 默认思考档没有入口（★ 整个能力缺失）** | 没法把某个模型设成新会话默认；没有 per-session / per-project / 全局 三层的显式区分；星标 UI 全无 | #871 (`6a1246e`) + `lib/default-preferences.ts` | 新增 `lib/default-preferences.ts`、`app/api/models/default/route.ts`；改 `components/ModelSelector.tsx`（加 `defaultValue`/`onSetDefault`）、`components/ChatInput.tsx`、`hooks/useAgentSession.ts:344`、`lib/models-cache.ts:14-16` | **L** |
| **4** | **`retry.{enabled,maxRetries,baseDelayMs}` 无 UI** | 网络抖动时只能吃 SDK 默认的 3 次 / 2000ms，改不了 | PR #918（pi 原生支持，见 `settings-manager.d.ts:23-29`） | 新增 `lib/retry-settings.ts` + `app/api/retry-settings/route.ts` + 设置页 General | **M** |
| **5** | **请求头空值行会写入 models.json** | 模型级空值 header 会**静默覆写**父 provider 的同名 header，运行时请求头变空 | PR #482①（**上游 main 同样有此 bug**，两边都没修） | `components/models-config-helpers.ts:66-73` | **XS** |
| **6** | **`compat` 只有 2 个布尔开关** | `supportsStrictMode` / `supportsMidConvoSystemMessages` / `supportsToolSearch` / `supportsAdditionalTools` / `supportsOpenAIGrammarTools` 等只能手改 JSON | 上游同样（`components/ModelsConfig.tsx:1011-1022` 只统计数量） | `components/ModelsConfig.tsx:1560-1576` | **S-M** |
| **7** | **`cost.tiers`（阶梯定价）无编辑器** | 长上下文阶梯计价的模型，费用显示和实际扣费对不上 | 双方都缺（pi-ai `types.d.ts:780-784` 有 `ModelCostTier`） | `components/ModelsConfig.tsx:132,1501-1535` | **M** |
| **8** | **provider 只支持 4 种 `api` 协议** | 自定义 OpenAI-compatible 之外的协议（bedrock-converse、mistral-conversations、azure-openai-responses…）选不了 | 双方都缺（`API_OPTIONS` 两边都写死 4 个：`ModelsConfig.tsx:161` / `:171`） | `components/ModelsConfig.tsx:171` | **S**（数据）+ **M**（协议适配测试） |

### 4.2 「我们已经有、只是没暴露」清单（最便宜，先做这些）

| 后端/类型已在 | 缺的入口 | 成本 | 证据 |
|---|---|---|---|
| `settings.retry.{enabled,maxRetries,baseDelayMs}` | 设置页 General 无任何控件；`autoRetryEnabled` 只被读出来透传（`lib/pi-types.ts:140`、`lib/rpc-manager.ts:854`） | S-M | `grep -rn "retry-settings" app/ components/ lib/` 0 命中 |
| `app/api/provider-usage/route.ts`（与上游**逐字一致**） | 聊天输入框上没有配额芯片，只有设置页模型详情里有 | S（前端） | `components/ChatInput.tsx` 无 `providerUsage` 引用 |
| `ModelInputLimits` / `ModelInputLimits.images.resize` / `ModelPromptCache`（pi-ai 原生字段） | `models.json` 编辑器无对应字段（`ModelEntry` 类型都没声明） | S（类型+UI） | `grep -rn "inputLimits\|promptCache" components/` 0 命中 |
| `settings.compaction.{reserveTokens,keepRecentTokens,modelOverrides}` / `branchSummary.reserveTokens`（`settings-manager.d.ts:6-13`） | 设置页无上下文压缩预算/保留量/压缩模型的控件 | M | `grep -n "reserveTokens\|keepRecentTokens" components/` 0 命中 |
| `settings.thinkingBudgets.{minimal,low,medium,high}`（`settings-manager.d.ts:50-53`） | 各思考档的 token 预算不可配（`SettingsManager` 甚至没有 setter） | M | 同上 0 命中 |
| `lib/thinking-level-memory.ts` + `GET/DELETE /api/thinking-level-memory` | 记忆只在模型详情里显示「上次使用」+清除（`components/ModelsConfig.tsx:1595-1597`），聊天侧思考档选择器不预填 | S | `components/ChatInput.tsx` 无 `thinkingLevelMemory` |
| `models.dev` 的 `reasoning_options` → `thinkingLevelMap` 自动推导（`lib/model-catalog.ts:112-135`，上游没有） | 只有点「填入模型信息」才触发，没有开关说"以后新建模型自动推导" | S | — |

### 4.3 不确定 / 需要怎么验

1. **fork 的 `readModelsConfig` 数据丢失路径**我按静态代码推断（`lib/models-config-store.ts:63-70` 吞异常 → `app/api/models-config/route.ts:9-11` 直接返回）。**需实测**：在 `~/.pi/agent/models.json` 顶部加一行 `// my comment`，打开设置 → 模型面板，看列表是否为空；随便改一处保存，再看文件。
2. **#918 的 `settings.retry` 是否会被 pi 的 schema 校验拒绝**——我只验证了 `settings-manager.d.ts:23-29` 有这个类型和 `:90 retry?: RetrySettings`，没验证 pi 写 settings.json 时是否用 Typebox 严格校验。**需实测**：手写 `~/.pi/agent/settings.json` 加 `"retry":{"maxRetries":5}`，跑一次 pi CLI 看它是否保留该键。
3. **`lib/rpc-manager.ts:885` 的 `modelRuntime.refresh({allowNetwork:false})` 是否足以当 #482② 的热重载**——它现在只用于 `model-catalog-refresh`（`lib/model-catalog-refresh.ts:19,79` 注释说 runtime 会应用自己的配置）。**需实测**：保存 models.json 后不重启，看活会话下一轮是否用新 baseUrl。
4. **上游 `catalog/route.ts` 内联 vs 我们 `lib/models-dev-catalog.ts` 共享**——上游 main 目前只有 `/api/models-config/catalog` 用目录；我们的 refresh pass 也用（见 `lib/models-dev-catalog.ts:5-6` 注释）。如果将来要 pick 上游 patch，注意这是结构差异而非能力差异。