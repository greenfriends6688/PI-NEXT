# IM 桥（fork:im-bridge）—— 已做出站，入站的现状与决策点

> 2026-10-03。参考项目 MusePi **没有任何 IM 集成**（全仓 grep 过 feishu / wecom / dingtalk /
> telegram / slack bot，零命中），所以这块不是移植，是新做。形态先按本仓铁律定：
> **改状态 ⇒ 工具**（`AGENTS.md` 的 `fork:proma-00-skill-policy`），不是 skill。

## 1. 已做：出站（agent → 群机器人）

一个工具 `im_send`（`action: send | list`），一条 `/api/im-bridge` 配置面，一个设置分节。

| 平台 | 出站 | 加签 | 文档核对情况 |
|---|---|---|---|
| 飞书 / Lark | ✅ `msg_type: text` / `post` | ✅ key = `ts\nsecret`、message 为空、**秒**、字段在 body | ✅ 已核对官方文档 |
| 企业微信 | ✅ `msgtype: text` / `markdown`（正文 `content`） | ❌ **官方文档里没有签名**，只有 IP 白名单 | ✅ 已核对（这是「没有」，不是「没查到」） |
| 钉钉 | ✅ `msgtype: text` / `markdown`（正文 `text`，不叫 content！） | ✅ key = `secret`、message = `ms\nsecret`、**毫秒**、字段在 query、base64 后再 URL 编码 | ✅ 已核对（文档是 JS 渲染页，用无头 Chrome 取的） |
| Slack | ✅ `{"text": …}` | ❌ URL 即凭证 | 请求已核对；响应体「ok」官方页面没写，代码里只看 HTTP 2xx |
| Telegram | ✅ `sendMessage?chat_id=&text=` | ❌ | ⚠️ **未能核对**（core.telegram.org 在本机网络不可达），按长期公开契约实现并在代码里标注 |
| 自建 | ✅ 原样 POST `{title?, text}` | — | 平台没收录时的活路 |

**最容易踩的坑，已经钉进测试**：飞书与钉钉的加签是**镜像**的（key / message 对调、单位一个秒一个毫秒、
字段一个 body 一个 query、编码一个 URL-encode 一个不 encode）。所以 `feishuSignature()` 与
`dingtalkSignature()` 是两个具名函数，**不许合并成一个「通用签名」**。

长度上限只登记文档写明的：飞书请求体 20 KB、企业微信 `text.content` 2048。钉钉 / Slack / Telegram
的当前文档没给，**代码里就不给** —— 编一个上限只会把本来能发的长消息拒掉。

配置面：`~/.pi/agent/im-bridge.json`（0600，URL 与 secret 都是凭证）。设置页与 `im_send` 的
`list` **只回 host + 掩码**，不回完整 URL；编辑时字段缺失 = 沿用已存值，显式空串 = 用户清掉。

## 2. 入站（fork:bot-channel）—— 已做 Telegram，其余四家按平台事实挡着

右栏「使用 Bot Channel」已经能配、能启动、能停。平台清单照 MusePi 的右半
（Huawei-Today / Discord / Wechat / Telegram / Feishu / Lark），**真跑通的只有 Telegram**：

| 平台 | 状态 | 为什么 |
|---|---|---|
| **Telegram** | ✅ 已实现（`lib/telegram-channel.ts`） | `getUpdates` 长轮询 + `sendMessage`，纯 HTTPS、**零新依赖、不需要公网 URL**。消息经 `POST /api/agent/<id>` 的 prompt 帧交给会话，跑完用 `get_last_assistant_text` 取答复回 Telegram |
| Discord | ⚠️ 未实现 | Gateway 是 WebSocket + 心跳 + identify；`ws` 目前只是 `next` 的传递依赖，要用得先写进 `dependencies` |
| 飞书 / Lark | ⚠️ 未实现 | 长连接要走官方 SDK（`lark-oapi`，自带 protobuf 与重连），手写不划算 |
| 微信 / 华为 Today | ❌ 架构上不可行 | 个人微信**没有任何官方 bot API**；企微与华为 Today 只有出站推送 |

**实测踩出来的三条，都已写进代码：**
1. **别把渠道绑到人正在用的会话上** —— 实测那样机器人消息会直接插进正在跑的那轮，
   把人的操作冲掉。所以注入前先 `get_state`，`isStreaming` 为真就**不注入**，只回一句
   「它在忙」。（`app/api/bot-channel/route.ts` 的 `runOnce`）
2. **白名单默认空 = 谁都不许** —— 拿到机器人令牌的人不该顺手就能用你的凭据驱动 agent。
3. **空批次必须歇脚** —— 任何一次「立刻返回」的长轮询都会让循环 100% CPU 空转，
   把整个 Next 的热事件循环一起饿死（第一版真的死锁过）。

### 仍然要你拍板的两件事

- **绑定哪个会话**：现在界面上手填 session id。更好的做法是从最近会话里选一个，或者给
  渠道各建一个独立会话（会出现在侧栏里）。我倾向后者，但你先说要不要。
- **要不要自动命名/轮换**：一个渠道一天发很多条时，会话名怎么起（按来源标前缀？）。

## 3. 局域网接入：为什么「点一下就生效」是靠重启子进程做到的

> **迁移结论（先答你那句「能不能直接迁移」）**：能直接搬的是**形状与流程** ——
> 大二维码、状态点、启动/停止、刷新/复制链接/复制只读链接、6 位码兜底，这些本仓都实现了，
> 二维码编码器还是从 MusePi 逐字 vendor 过来的（`lib/qrcode.ts`，MIT）。
> **不能直接搬的是他们的实现**：他们为了让「点一下就生效」，在 daemon 里另开了一个
> collab relay socket（明文 7654 + 自签 TLS 7655 + AES-GCM 信封），还额外开了一个**无鉴权**
> 的 8301 端口专门解析 6 位码。本仓是同源 HTTP，绑哪张网卡由 `next start` 决定、进程内改不了，
> 所以「点一下就生效」是**由启动器（父进程）重启子进程**做到的（`bin/lan-supervisor.cjs`）。
> 代价是一次约 2 秒的重启，换来的是「不用敲任何 env、不用加任何参数」。

入站这件事在**只有局域网**的本机上有真实约束，先把事实摆清楚：

| 平台 | 收消息需要什么 | 局域网能不能做 |
|---|---|---|
| 飞书 | **长连接**（`lark-oapi` 的 `WSClient`），不需要公网 URL | ✅ 可以 |
| 钉钉 | **Stream 模式**（`dingtalk-stream`），不需要公网 URL | ✅ 可以 |
| 企业微信 | 只有**回调 URL**，必须公网 HTTPS | ❌ 要么开隧道（cloudflared / Tailscale Funnel），要么不做 |
| 微信个人号 | **没有任何官方 bot API** | ❌ 只有第三方方案（itchat / wechaty 一类），个人号有封号风险，不建议 |

所以「手机微信里跟 agent 说话」这条路，官方能做到的只有：**飞书 或 钉钉**（长连接）+ 一个公网
隧道（企业微信）。个人微信这条路我不做，也不建议第三方库去碰 —— 那是拿你的账号赌。

## 4. 剩下三个待拍板的决策（已实现的 telegram 不受第一条影响）

1. **消息落到哪个会话？** 选项：(a) 每个 chat id 固定绑一个会话；(b) 每条消息都 fork 一个新会话；
   (c) 只有一个「私聊专用」会话，所有人共用。(a) 最可预测，(b) 最干净但会话列表会爆。
2. **谁能驱动你的 agent？** 这是**拿着你的模型额度 + 文件权限**的入口。企业微信/钉钉的群成员
   默认都能发消息。默认应当是「只有白名单里的 open_id / unionid 能触发，其余只回一句『没权限』」。
   我倾向：**入站默认全禁**，逐个加白名单，而不是默认全开。
3. **长连接的生命周期**：入站服务是个常驻后台进程（断线重连、退避、启动时机）。是跟着
   `npm run prod` 一起起，还是单独一个 `pi-web im-bridge` 前台命令？前者省事但把「聊天机器人的
   出网」塞进了 Web 服务的生命周期里；后者更干净，也更容易单独停掉。

另外一件工程量：飞书/钉钉的官方 SDK 都不小（`lark-oapi`、`dingtalk-stream` 都是带传递依赖的
运行时包）。与本仓「能不加包就不加」的取向有冲突，届时要么接受，要么自己实现那套长连接协议
（不建议 —— 两家的协议都带 protobuf/帧格式，重写不划算）。

## 4. 相关文件

```
lib/im-bridge-shared.ts   客户端安全的那一半：类型 / 平台清单 / URL 识别 / 掩码 / 上限
lib/im-bridge.ts          服务端：加签、报文构造、发送、配置读写（node:crypto + node:fs）
lib/im-extension.ts       im_send 工具（注册点：lib/rpc-manager.ts 的 extensionFactories）
app/api/im-bridge/        GET 掩码列表 / PUT 整表替换 / POST 测试发送
components/fork/ImBridgePanel.tsx   设置分节「IM 推送」
```
