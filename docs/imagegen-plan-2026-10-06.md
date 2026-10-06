# 生图能力计划（fork:imagegen）—— 对话直接出图，标书配图共用同一底座

日期：2026-10-06 · 前置调研：`pi参考项目/` 全量排查（结论见 §1）
与 `docs/bid-suite-plan-2026-10-06.md` 的关系：本文 G1+G2 = 那份计划 **B1** 的展开；G3 = **B9** 的生图执行面。先做本文，标书套件直接消费，不重复建设。

---

## 1. 调研结论：哪些参考产品有独立的生图配置

| 项目 | 独立生图配置 | 执行方式 |
|---|---|---|
| **标书功能**（易标） | ✅ 设置页独立「生图模型」Tab：6 家服务商（金龙中转/火山方舟/Google AI Studio/Agnes/自定义/ComfyUI），每家独立档案，尺寸/比例/并发/请求方式，测试状态机（untested/available/unavailable） | 正文 agent 的「配图阶段」自动触发；OpenAI 兼容 `/images/generations` 一招吃三家；独立生图队列（并发 2），与文本模型**双配置双队列** |
| **PI-Desktop** | ✅ `AppSettings.imageGeneration`（默认绑定）+ `imageGenerationModels` 多选（≤128）；被标记的模型从对话模型选择器里排除 | `GenerateImages` agent 工具（批量 1-10、1-4 参考图编辑），走高风险工具审批；未配置返回引导性错误 |
| **MusePi** | ✅ `generate_image.enabled` 开关（默认关）+ `providers.imageOrder` 优先级 + 8 家内置 provider，工具参数可单次覆盖 | `generate_image` custom tool（approval: write）；**二进制进 `details.images`、content 只给文本摘要+路径**——不撑模型上下文和会话文件 |
| **Wegent** | ✅ 两套：wework 每模型 `imageGenerationEnabled` 开关（Responses 内置工具）；后端 `image` 独立模型类别（专属 size/max_images/参考图配置） | 聊天自动触发 / `generate_image` MCP 工具（Seedream/GPT-Image provider 工厂） |
| zeno / paseo / ZCode / Aether / pi-web / pi-agent-desktop / AcpAgentClient / pi-移动端 | ❌ 无（zeno 的 changelog 明说 pi 生图能力「可达但无 UI」；paseo 只展示 Codex 的生图结果；其余全是图片输入/预览/附件压缩） | — |

**pi-ai 1.0（本仓已依赖）自带生图管线**：`generateImages()` / `ImageModel`（`type:"image"`）/ `ImagesContext`（支持参考图输入）/ `AssistantImages`，但内置只注册 `openrouter-images` 一个 API，且 models.json 不收 image 模型。**裁定：不用 SDK 这条**——为一个 POST 引入 catalog/registry 复杂度不值，直连 OpenAI 兼容 `/images/generations` 与三家参考项目的做法一致，一个协议覆盖 OpenAI/金龙/硅基流动/火山方舟。

## 2. 本仓可直接复用的现状（零新轮子）

- **显示链路现成**：`components/MarkdownBody.tsx:77-93` 把 `![](本地路径)` 解析成 `/api/files/...?type=read` 并挂 `ImagePreview` 灯箱；`components/MessageView.tsx` 的 `ResultImages` 吃工具结果 content 里的图片块。
- **凭证边界模式**：`~/.pi/agent/im-bridge.json`（0600、GET 掩码、PUT 缺字段沿用已存值）——imagegen 配置照抄这套。
- **设置分节机制**：`components/SettingsPanel.tsx` 已有分节（「手机与推送」同款），i18n 三语。
- **扩展注册**：`lib/rpc-manager.ts` `extensionFactories`，工具 direct 曝光即随会话激活（`todo` 同款）；Chat-only 会话天然不带。
- **文件授权**：`allowFileRoot()` 把新根登记进 `/api/files` 允许清单（cwd/配对路由同款）。

## 3. 方案裁定

- **D1 配置**：`~/.pi/agent/imagegen.json`（0600，staging+rename 原子写）。字段：`active` + providers 档案（`openai-compatible` 一种协议，预设端点：OpenAI 官方 / 金龙中转 / 硅基流动 / 火山方舟 ark / 自定义），每档 `baseUrl / apiKey / model / size 默认值 / concurrency`，外加 `status: untested|available|unavailable` 测试三元组（照搬易标）。`GET /api/imagegen` 掩码 apiKey；`PUT` 字段缺失 = 沿用已存值。
- **D2 测试**：`POST /api/imagegen/test` 真跑一张小图回显，成功自动落 `available`（易标同款——**只有 available 才允许标书自动配图**）。
- **D3 工具**：`lib/imagegen-extension.ts` 注册 `generate_image`。参数：`prompt`（必填）/ `n`（1-4）/ `size`（可选覆盖）/ `dest`（可选，须在会话 cwd 内）。落盘：默认 `~/.pi/agent/generated-images/YYYYMMDD/<uuid>.png`（工具工厂 init 时幂等 `allowFileRoot()`）；`dest` 给了就写项目内（标书 `bid/<项目>/images/` 直落）。**content 永不含 base64**：只回一行文本（路径+尺寸+字节，模型可读可引用），图片元数据进 `details.images: [{path, mimeType, bytes, width, height}]`（MusePi 同款）。未配置 → isError 结果 +「到设置 → 生图模型」指引，模型不瞎猜路径。
- **D4 结果卡**：`MessageView` 工具卡加一块 `GeneratedImagesCard`，读 `details.images` → `/api/files` 缩略图 → 点图 `ImagePreview` 灯箱/下载。确定性显示不靠模型自觉（skill-policy：UI 组件）；助手回复里 `![](<路径>)` 的 markdown 内联是兜底不是主体。DIVERGENCE 登记。
- **D5 审批**：`generate_image` 是花钱+写盘的工具 → 进 `lib/approval-policy.ts` 的写级，plan/build 模式拦得住。MVP 不进 token 统计，结果文本带 provider/model/size 一行供追溯。
- **D6 设置分节**：`SettingsPanel` 新增「生图模型」分节（V5 类，i18n 三语）：服务商下拉、Base URL、API Key（掩码）、模型名、尺寸、并发、「测试」钮回显试跑图、状态徽标。
- **D7 参考图编辑 / Gemini / ComfyUI 方言**：Phase 2，MVP 只做 `/images/generations` 同步模式。

## 4. 分批（每批独立 commit + 独立验证）

- **G1 配置 + API + 设置分节**：`lib/imagegen-shared.ts`（类型/归一化/掩码，**客户端纯**）+ `lib/imagegen-config.ts`（服务端读写，0600）+ `app/api/imagegen/route.ts`（GET/PUT/test，仿 `/api/im-bridge`）+ SettingsPanel 分节 + i18n 三语 + `lib/imagegen-config.test.mjs`（fetch 桩锁请求形状与四端点方言、掩码、缺字段沿用）。
- **G2 工具 + 落盘 + 结果卡**：`lib/imagegen-extension.ts`（fetch `/images/generations`，响应兼容 `b64_json` 与 `url` 两种——url 返回的要下载落盘，避免外链过期）+ `extensionFactories` 注册 + `allowFileRoot` + MessageView `GeneratedImagesCard` + i18n + `.test.mjs` + **运行时 get_tools 验证（30247 端口法，AGENTS.md 硬性 DoD）** + DIVERGENCE 登记。
- **G3 标书接入**（随 bid-suite B9）：`aiImageStyles.cjs` 的 9 种画面形式与反水印风格补丁照搬进 `lib/bid-prompts.ts`；`dest` 约定直落 `bid/<项目>/images/`；正文 figure 占位引用回填。

门禁（每批）：`tsc --noEmit` + `node --test lib/imagegen*.test.mjs` + `npm run lint` + `lib/client-graph-purity.test.mjs` 保持绿（SettingsPanel 是 "use client"，只能 import `imagegen-shared`）+ 改设置页跑 `npm run check:design`。

## 5. 风险

| 风险 | 处置 |
|---|---|
| 图片撑大会话文件 / 模型上下文 | content 永不含 base64；details 只存路径元数据；预览走 `/api/files` URL |
| 中转站方言差异（流式/b64/url 返回） | 测试钮先行暴露问题；响应解析兼容 b64_json 与 url 两种，url 一律下载落盘 |
| 模型没配就想生图 | isError + 明确指引去设置；绝不编造路径 |
| `allowFileRoot` 进程重启失效 | 工具工厂 init 幂等登记（cwd 路由同款） |
| 误烧钱 | 写级审批拦截 + n 上限 4 + size 白名单校验 |

## 6. 落地状态（2026-10-06）

G1 + G2 **已实现并验证**（G3 随 bid-suite B9）：

- 代码：`lib/imagegen-shared.ts`（客户端纯）+ `lib/imagegen-config.ts`（0600 原子写 / 掩码合并 / 落盘 / dest 护栏 / 执行器）+ `app/api/imagegen/route.ts` + `lib/imagegen-extension.ts` + `components/fork/ImageGenSettingsPanel.tsx` + `components/MessageView.tsx` 结果卡。
- 设计：新画板 `D-31-settings-imagegen.html`（`.d-test-img` 进 `web/system.css`）；15 张设置画板左导航插入「生图模型」；`DIVERGENCE.md §T` 登记。
- 门禁：`lib/imagegen-config.test.mjs` 15/15；boardnav 12 条 5/5；`client-graph-purity` 绿；icons/check-boards/check-align 绿（style-literals 与 motion-tokens 的存量红灯在 HEAD 就存在，不在本批文件里）；tsc 0 错；本批文件 eslint 0 问题。
- 运行时（30247 法）：`generate_image` 在 get_tools 里 active；`/api/imagegen` GET/PUT 掩码链路、POST 测试全链路（本地桩服务 → b64 解码 → 落盘 → status=available）全通过。
- 浏览器冒烟（Chromium，`channel: "chrome"`）：设置 → 生图模型分节渲染出 2 下拉 + 4 输入 + 2 按钮、切服务商端点联动、控制台零错误。
- 复验方法：临时目录 rsync 本仓（exclude `.next`/`node_modules`/参考项目）→ `ln -s` 真 node_modules → `next build --webpack` → `next start -p 30247`（`PI_CODING_AGENT_DIR` 指临时目录）→ `POST /api/agent/<id> {"type":"get_tools"}`（`data` 直接是工具数组）与 `GET/PUT/POST /api/imagegen`。生图测试打本地桩即可，不花钱。


