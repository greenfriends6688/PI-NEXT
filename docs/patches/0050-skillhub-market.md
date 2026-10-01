# 0050 · SkillHub 市场 + 内置技能目录

| 项 | 值 |
| --- | --- |
| 意图 | 技能页能直接搜、装 skillhub.cn 上的公开技能，并在一台新机器上先种下一份许可干净的只读内置技能集 |
| 参照实现 | skillhub.cn 的公开 JSON 接口（**纯 HTTP，不经过任何 CLI**） |
| fork 标记 | `fork:skillhub`、`fork:skills-content`、`fork:gap-default-skills` |
| 新增文件 | `lib/skillhub.ts`（+ `.test.mjs`）、`app/api/skills/skillhub/route.ts`、`app/api/skills/install-skillhub/route.ts`、`lib/default-skills.ts`、`app/api/skills/defaults/route.ts`、`app/api/skills/content/route.ts` |
| 上游文件接触面 | `components/SkillsConfig.tsx`、`lib/api-types.ts` |
| `.patch` | 无（引入 commit 在换肤大快照里，无 staged-baseline 可反演） |

## 核实（不是照抄审计报告）

```
$ git log --oneline -- lib/skillhub.ts
a1d5f75 feat(skills): 接入 SkillHub 市场（skillhub.cn），纯 API，不走 CLI   ← 唯一一条
$ git log --diff-filter=A --format="%h %ad" --date=short -- \
    lib/skillhub.ts app/api/skills/skillhub/route.ts app/api/skills/install-skillhub/route.ts
a1d5f75  2026-09-21   （三个文件同为 a1d5f75 首次落盘）
$ git log --diff-filter=A --format="%h %ad" --date=short -- lib/default-skills.ts
b24f7a4  2026-09-18   feat(skills): 内置技能目录（许可核查后只收录可再分发的 2 个）+ 按需种子 API
$ git log --diff-filter=A --format="%h" -- app/api/skills/content/route.ts  → 22fa16a
$ git grep -c -i skillhub -- docs/patches/README.md docs/codex-skin/delta.md  → 0
```

审计记的 `a1d5f75` 正确。但它把 `lib/default-skills.ts` 和 `app/api/skills/{content,defaults}/route.ts`
一起归到本条下面，**时间上它们更早**（`b24f7a4` 2026-09-18 / `22fa16a` 2026-09-20），
是「SkillHub 之前」的内置技能基础面。本条把它们记成同一能力的一部分，是因为它们共用
`fork:gap-default-skills` 这条同源线索、同一个「技能来源」问题域，revert 时也确实要一起看。

## 与上游的关系

上游 `agegr/main` 没有 `lib/skillhub.ts`，没有 `app/api/skills/{skillhub,install-skillhub}/route.ts`，
没有 `lib/default-skills.ts`（`git cat-file -e` 逐个为 absent）。**纯新增。**

## 三个接口都是免登录的公开接口

`lib/skillhub.ts` 的文件头把整张表写清楚了 —— 接口是从 skillhub.cn 自己的前端 bundle
（`skill-hub.*.js`）里反查出来的：

| 用途 | 请求 | 返回 |
| --- | --- | --- |
| 列表 / 搜索 | `GET /api/skills?page&pageSize&sortBy=score&keyword` | `{code:0,data:{skills,total}}` |
| 下载 | `GET /api/v1/download?slug=<slug>` | **302 → ZIP**（内含 `SKILL.md`） |
| 文件清单 | `GET /api/v1/skills/<slug>/files` | `{files:[{path,sha256,size}],version}` |

两条容易踩的细节：**列表接口只有 `code === 0` 才算成功**（非 0 时 `message` 才是错误原因）；
基址可用 `SKILLHUB_API_URL` 覆盖（自建镜像 / 单测用），`SKILLHUB_PAGE_SIZE_MAX = 60` 是分页上限。

**为什么绕开 CLI**：不引入外部二进制依赖，装一个技能不需要用户在终端里先装个 npm 包。

## 内置技能目录的许可红线（`b24f7a4` 起）

`lib/default-skills.ts` 不是「塞几个示例技能」，它带着一条许可纪律：

- 资产在 `assets/default-skills/<slug>/`，随仓库分发；种子目标 `~/.pi/agent/skills/<slug>/`
  **由调用方传入，本模块不硬编码该路径**（单测只写 `os.tmpdir()`，绝不碰真实的 `~/.pi/`）。
- **只补缺失**：同名技能已存在一律拒绝覆盖或合并 —— 与 0049 跨 agent 导入的「同名拒绝」语义一致，
  避免盖掉用户改过的技能。
- **许可红线**：只收录允许再分发的（Apache-2.0 / MIT / 公共领域类），每个技能目录必须自带 `LICENSE*`；
  许可不明或带商用限制的一律不收录，清单见 `assets/default-skills/README.md`。

## 能否独立 revert

**能，但要分两半看。**

- 只 revert SkillHub 市场：删 `lib/skillhub.ts` + 两条路由 + `SkillsConfig.tsx` 里的市场分段 +
  `lib/api-types.ts` 里的类型。`lib/default-skills.ts` 与内置技能**可以留**（它不依赖 SkillHub）。
- 只 revert 内置技能：删 `lib/default-skills.ts` + `app/api/skills/defaults/route.ts` +
  `assets/default-skills/`。SkillHub 市场**可以留**。
- 两者都无 `package.json` 依赖增删、无 `.gitignore` 改动。

**唯一的耦合点**：`app/api/skills/install-skillhub/route.ts` 装完技能后要写进
`~/.pi/agent/skills/`，与 `lib/default-skills.ts` 的种子目标同一目录。删掉默认技能不影响安装路径，
但两者的「同名拒绝」策略必须保持一致（否则会出现「默认技能能被装来的同名技能顶掉」）。

## 验证手段

- 单测 `lib/skillhub.test.mjs` 7 例（基址覆盖、`code !== 0` 的失败路径、分页上限、
  302 → ZIP 的下载分支、文件清单解析）。
- 路由：`GET /api/skills/skillhub?keyword=…` → 代理列表；`POST /api/skills/install-skillhub` → 落盘安装。
- 浏览器验收：设置 → 技能 → 市场分段 → 搜索 → 预览文件清单 → 安装 → 技能列表里出现该条目。
- 网络依赖：`SKILLHUB_API_URL` 可指向本地镜像，所以单测不依赖外网。

## 合并上游后怎么重打

```bash
git grep -n "fork:skillhub\|fork:gap-default-skills" -- lib components app
# 四条不变式：
#   1) 走 HTTP API，不引入 skillhub CLI；
#   2) 列表接口只认 code === 0；
#   3) 内置技能只补缺失、不覆盖同名，且不硬编码 ~/.pi/agent/skills 路径；
#   4) 收录的技能必须自带 LICENSE*。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
