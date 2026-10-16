# Pinext 云服务端部署清单（可执行）

日期：2026-10-15
适用契约：`docs/pinext-cloud-contract-2026-10-13.md`（下称「契约」）
读者：要实现并部署 Pinext 云服务端的人
目标：把 `app.pinext.dev` 从 NXDOMAIN 变成真域名，让「账号登录」与「官方连接」真的可用

现状证据：`nslookup app.pinext.dev` 返回 **NXDOMAIN**（本机实测）。客户端默认 origin 是 `https://app.pinext.dev`（`src/shared/account.ts:43`），所以登录必然失败于网络层。

---

## 0. 结论速览

| 目标 | 需要哪些端点 | 说明 |
|---|---|---|
| 「已登录」是真的 | `/authorize` + `/api/oauth/token` + `/api/me` | 3 个，最小可用集 |
| 「官方连接」可用 | 上面 3 个 + `PUT /api/devices/me` + `GET /api/devices` + `GET /api/rtc/ice` + `WS /api/rtc/signal` | 7 个（`/api/devices` 只有手机用） |
| 完整体验 | 全部 8 个 + 可选 `/console` | `/api/auth/logout` 是尽力而为，缺了不影响登录 |

判断依据见 §1.1。**部署到 Vercel 只能做前 3 个（登录）；官方连接需要常驻进程平台**，见 §3。

---

## 1. 端点总表

契约 §1（第 22–37 行）列了 8 个端点。下表补上「谁在调、缺了会怎样」：

| # | 方法 | 路径 | 调用方（证据） | 缺失后果 |
|---|---|---|---|---|
| 1 | GET | `/authorize` | 桌面 `src/main/engine/account.ts:76`；手机 `apps/mobile_flutter/lib/account/account.dart:225` | 登录无法开始 |
| 2 | POST | `/api/oauth/token` | 桌面 `engine/account.ts:263`；手机 `account.dart:317` | 拿到 code 也换不到令牌 |
| 3 | GET | `/api/me` | 桌面 `engine/account.ts:208`；手机 `account.dart:282` | 启动时校验失败，但**仍显示已登录**（离线不登出） |
| 4 | POST | `/api/auth/logout` | 桌面 `engine/account.ts:192,238`；手机 `account.dart:271` | 仅服务端吊销失败；本地已登出，无功能影响 |
| 5 | PUT | `/api/devices/me` | 桌面 `src/main/rtc/official.ts:510` | 官方连接登记不了 |
| 6 | GET | `/api/devices` | 手机 `official_devices.dart:60`（桌面不调） | 手机看不到电脑列表 |
| 7 | GET | `/api/rtc/ice` | 桌面 `official.ts:480`；手机 `rtc_connection.dart:305` | 没有 STUN/TURN，跨网络连不上 |
| 8 | WS | `/api/rtc/signal` | 桌面 `src/main/rtc/signaling.ts:166`；手机 `rtc_signaling.dart:311` | 官方连接完全不可用 |
| — | GET | `/console`（可选） | 桌面 `sidebar-account.tsx:106` | 「管理设备」打不开 |

### 1.1 为什么「登录」只要 3 个端点

- 登录链路的必经步骤是：`/authorize`（拿 code）→ `/api/oauth/token`（换令牌）→ `/api/me`（启动时校验并刷新用户）。桌面 `registerAccount` 在启动时无条件调 `service.refresh()`（`src/main/account.ts:82`），而 `refresh()` 打的就是 `/api/me`（`engine/account.ts:208`）。
- `/api/auth/logout` **不是必经**：桌面与手机都是先清本地、再尽力吊销，失败只写日志（`engine/account.ts:192`、`account.dart:271`）。
- `/api/devices/*`、`/api/rtc/*` 属于「官方连接」，与登录正交：登录只表明「这台电脑是谁的」（`AGENTS.md:1245`）。

> 契约 §1 把 8 个端点都列成「必须」，但它也把 `/console` 标为可选（契约第 37 行）。本清单把 `/api/devices`、`/api/rtc/*` 归入官方连接，理由见 §6。

---

## 2. 逐端点 curl 验收

约定：`ORIGIN=https://app.pinext.dev`，`TOKEN=fvs_…`（登录后得到）。契约第 25 行：全部 JSON、客户端超时 15s、`redirect: "error"`。

### 2.1 `GET /authorize`（不能纯 curl 跑完）

它需要浏览器里的 GitHub 登录与用户点击。可脚本化的是**参数契约**：

```bash
# 只验证 /authorize 接受契约参数并回 HTML（不做完整登录）
curl -sS -D- -o /dev/null "$ORIGIN/authorize?client_id=pinext-desktop&redirect_uri=http%3A%2F%2F127.0.0.1%3A55900%2Fcallback&state=s&code_challenge=c&code_challenge_method=S256&device_name=Mac&platform=darwin"
# 期望：200，Content-Type: text/html
```

参数名必须精确为 `client_id, redirect_uri, state, code_challenge, code_challenge_method=S256, device_name, platform`（契约第 68–69 行；桌面生成见 `engine/account.ts:77-83`）。`device_name` 上限 80 字符（契约第 72 行；桌面 `engine/account.ts:82` 已截断，手机 `account.dart:231` 按码点截断）。

完整登录的**手工验收**：把上面 URL 粘进浏览器 → 用 GitHub 登录 → 允许 → 浏览器应 302 到 `redirect_uri?code=…&state=…`。

> **必踩的坑**：站点若把 URL 里第一个 loopback 从 `127.0.0.1` 改写成 `localhost`，code 必须绑定**实际重定向的那个拼写**，换令牌时校验同一个字符串（契约第 74–77 行）。桌面监听两种 Host 都接受并回传实际到达的那个（`engine/account.ts:404,424`）。

### 2.2 `POST /api/oauth/token`

```bash
curl -sS -X POST "$ORIGIN/api/oauth/token" \
  -H 'Content-Type: application/json' \
  -d '{"grant_type":"authorization_code","code":"<code>","code_verifier":"<verifier>","client_id":"pinext-desktop","redirect_uri":"http://127.0.0.1:55900/callback"}'
# 期望 200：
# {"access_token":"fvs_…","token_type":"Bearer","expires_in":7776000,
#  "user":{"id":"u1","login":"octocat","avatar_url":"https://…","email":"o@example.com","role":"user"}}
# 失败：400 {"error":{"code":"invalid_grant"}}；403 {"error":{"code":"account_disabled"}}
```

**注意：此端点不带 `Authorization`**，桌面 `#exchange` 只传 body（`engine/account.ts:263-271`），手机同理（`account.dart:317-325`）。契约 §1 第 25 行说「除 `/authorize` 外都要 Bearer」，与此矛盾，见 §8。

客户端只读 `access_token` 与 `user`（`engine/account.ts:286-288`；`account.dart:342-344`）。`token_type` / `expires_in` 客户端**不读**（§8）。

`user` 字段名精确（契约第 39–45 行）：桌面要求 `id` 是字符串、`login` 非空、`avatar_url` 匹配 `^https://` 否则置空、`role` 非 `admin` 一律当 `user`（`engine/account.ts:340-351`）。

### 2.3 `GET /api/me`

```bash
curl -sS -D- "$ORIGIN/api/me" -H "Authorization: Bearer $TOKEN"
# 期望 200：{"id":"u1","login":"octocat","avatar_url":"https://…","email":"o@example.com","role":"user"}
# 令牌无效：401 {"error":{"code":"unauthorized"}}   ← 必须 401，不要 403
```

桌面 `refresh()` 只在 **401** 时删本地令牌；5xx / 离线保持登录（`engine/account.ts:209-217`）。手机同（`account.dart:283`）。契约第 81 行同义。

### 2.4 `POST /api/auth/logout`

```bash
curl -sS -D- -X POST "$ORIGIN/api/auth/logout" -H "Authorization: Bearer $TOKEN"
# 期望：任意 2xx（桌面假服务端用 204，test/account.test.ts:59）
```

### 2.5 `PUT /api/devices/me`

```bash
curl -sS -X PUT "$ORIGIN/api/devices/me" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"install_id":"inst_0123456789abcdef0123456789abcdef","name":"Ada\u2019s MacBook","platform":"darwin"}'
# 期望 200：{"device":{"id":"<uuid>","name":"Ada’s MacBook"}}
# 超限：409 {"error":{"code":"too_many_devices"}}   ← 客户端不重试
# 令牌无效：401
```

- `install_id` 形如 `inst_<32 hex>`，校验 `^[\x21-\x7e]{8,64}$`（契约第 186、203 行；桌面生成 `official.ts:557,561`）。
- 按 `(账号, install_id)` 幂等 upsert，改名保持同一 `device.id`（契约第 186 行；桌面重登记用同一 install 文件，`official.ts:555-563`）。
- 5xx 桌面按 `[5,15,30,60]`s 重试（`official.ts:34`、契约第 187 行）。

### 2.6 `GET /api/devices`

```bash
curl -sS "$ORIGIN/api/devices" -H "Authorization: Bearer $TOKEN"
# 期望 200：
# {"devices":[{"id":"<uuid>","name":"Ada’s MacBook","platform":"darwin","online":true}]}
```

手机只读 `id`、`name`、`platform`、`online`；`id`/`name` 缺失或 `name` 为空的行被跳过（`official_devices.dart:77-82`）。`online` = 该 `device_id` 有活的信令 socket（契约第 188 行）。

### 2.7 `GET /api/rtc/ice`

```bash
curl -sS "$ORIGIN/api/rtc/ice" -H "Authorization: Bearer $TOKEN"
# 期望 200（最小形态，只有 STUN）：
# {"ice_servers":[{"urls":["stun:turn.example.com:3478"]}]}
# 带 TURN：
# {"ice_servers":[{"urls":["turn:…:3478?transport=udp","turn:…:3478?transport=tcp","turns:…:443?transport=tcp"],
#                  "username":"1790000000:user-id","credential":"base64+/="}],
#  "expires_at":"2026-10-10T02:00:00Z","relay_exhausted":false}
```

- `urls` 可为字符串或数组，支持 `stun:`/`stuns:`/`turn:`/`turns:` 与 `?transport=udp|tcp`，端口默认 3478 / 安全 scheme 5349（契约第 170 行；桌面解析 `src/main/rtc/ice.ts:56-70`）。
- `credential` 是 base64，**必须能带 `/ + =`**，当字段传，别塞进 URL（契约第 171 行；`ice.ts:32`）。
- `expires_at` ISO-8601；缺失/null = 不过期（契约第 172 行；桌面 `iceExpiry` `ice.ts:91`）。中继凭证寿命约 5 分钟，下发时至少留 3 分钟，客户端剩 2.5 分钟弃用（契约第 177 行；手机 `rtc_connection.dart:377` 用 150s 余量）。
- **桌面只保留 STUN**（`official.ts` 调 `stunServers`，`ice.ts:78`）；手机每个条目取一条 TURN（`rtc_connection.dart:314-323`）。
- `relay_exhausted` 客户端**不读**（§8）。

### 2.8 `WS /api/rtc/signal`

WebSocket，需 `Authorization` 头鉴权升级（契约第 93 行）。用仓库自带的 `ws`（`package.json:65`，`^8.21.3`）写一小段 Node 脚本即可完整验收：

```bash
# 存为 /tmp/check-signal.mjs，然后：node /tmp/check-signal.mjs
#   ORIGIN=wss://app.pinext.dev  TOKEN=fvs_…  DEVICE_ID=<uuid>  node /tmp/check-signal.mjs
import WebSocket from "ws";
const { ORIGIN, TOKEN, DEVICE_ID } = process.env;
const ws = new WebSocket(`${ORIGIN}/api/rtc/signal`, { headers: { Authorization: `Bearer ${TOKEN}` } });
const send = (m) => ws.send(JSON.stringify(m));
ws.on("open", () => send({ type: "hello", role: "client", name: "checker", platform: "linux" }));
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  console.log("<-", m);
  if (m.type === "hello") send({ type: "connect", device_id: DEVICE_ID });
  if (m.type === "connected") { send({ type: "signal", cid: m.cid, data: { type: "offer", sdp: "v=0" } }); send({ type: "hangup", cid: m.cid }); }
  if (m.type === "error") { console.log("refused:", m.code); ws.close(); }
});
ws.on("close", (code) => console.log("closed", code));
setTimeout(() => ws.close(), 5000);
```

期望序列（消息形状见契约 §3.1 第 93–117 行，假服务端 `test/rtc-fake-cloud.ts:103-122`）：

| 步骤 | 期望 |
|---|---|
| 连接 | 升级成功（带 Bearer）；无 token / 坏 token → HTTP 401 |
| 客户端发 `hello{role:"client",name,platform}` | 服务端回 `hello{role}` |
| 客户端发 `connect{device_id}` | 该设备在线 → `connected{cid}`；不在线 → `error{code:"device_offline"}`；不存在 → `error{code:"device_not_found"}` |
| 桌面侧应收到 | `incoming{cid,peer:{name,platform?}}` |
| 任一端发 `signal{cid,data}` | 只到该 `cid` 的另一端，`data` 原样转发 |
| `hangup{cid}` | 释放该 call |

服务端必须满足的超时/心跳（契约第 126–137 行）：主动 WS ping **每 25s**、必须回客户端的 ping 的 pong；桌面自探测每 15s（`signaling.ts:26`）、8s 无 pong 就 terminate（`signaling.ts:28`）、70s 静默判死（`signaling.ts:16`）。关闭码 `4001`（被替换）/ `4005`（被移除）（契约第 139–146 行；`signaling.ts:13-14`）。每 socket 必须限流（契约第 148 行）。

**验收参考**：`test/rtc-signaling.test.ts` 把上述形状与超时写成了断言（第 97–272 行），可直接当服务端的验收清单。

---

## 3. 部署到 Vercel 的可行性

分两部分，结论不同。

### 3.1 Vercel 能做：登录（`/authorize` + `/api/oauth/token` + `/api/me` + `/api/auth/logout`）

标准 Serverless 函数即可。这 4 个是短请求-响应，无长连接、无本地状态。**Vercel 完全够用**。

注意两点：

- `/authorize` 需要一个 GitHub OAuth 回调与一个同意页；Next.js 路由或 Serverless 函数都能做。
- 令牌/账号状态需要外部存储（Vercel 文件系统是临时的）：Vercel Postgres / KV / 外部 Redis 都行。**不要**用本地文件。

### 3.2 Vercel 不能可靠做：信令 `WS /api/rtc/signal`

- Vercel 的 WebSocket 是 **Public Beta**，且连接会**钉在单个实例**上（`docs/pinext-next-plan-2026-10-15.md:354`）。
- 契约要求服务端维护 `device_id → 活的桌面 socket` 与 `cid → {手机, 桌面}`，并在**同一账号**内转发（契约第 119–124 行）。这要求两个 socket 落在同一进程/同一内存视图里。
- 实例钉住意味着：桌面连到实例 A、手机连到实例 B 时，`connect` 找不到设备；且实例回收即断连。
- 此外 Vercel 的文件系统是临时的，**设备列表与在线状态必须外部 KV/数据库**（`pinext-next-plan-2026-10-15.md:352`）。

**结论**：信令与 ICE/设备登记建议放在能跑**长连接驻留进程**的平台（Fly.io / Railway / 一台 VPS），或与登录同一台 VPS。若坚持全 Vercel，则只上线登录，官方连接暂缺。

### 3.3 推荐路线（每步都能停）

```
第 1 步（Vercel 即可）：/authorize + /api/oauth/token + /api/me + /api/auth/logout
                        → 「已登录」是真的
第 2 步（+ 外部 KV）：  + PUT/GET /api/devices          → 能看到设备列表
第 3 步（换常驻平台）： + WS /api/rtc/signal + /api/rtc/ice → 手机跨网络能连
```

第 3 步的 TURN 需要自建 coturn（契约 §4 第 174–180 行）；只回 STUN 时，同局域网与有 UDP 的 NAT 打洞可用，对称 NAT ↔ 对称 NAT 连不上。

---

## 4. 域名与 DNS

> **实际用的域名是 `aiandchat.cloud`（阿里云 DNS），不是 `app.pinext.dev`。**
> 客户端默认值已改，具体怎么加记录、备案这个坑、nginx 反代配置，
> 见 `docs/domain-aiandchat-setup.md`。下面这一节保留为「契约要求什么」的通用说明。

### 4.1 让占位域名变真

1. 在 `pinext.dev` 的 DNS 服务商添加解析：`app` 记录指向部署平台。
   - Vercel：加 CNAME `app → cname.vercel-dns.com`（或平台给出的值），再在 Vercel 项目里绑定 `app.pinext.dev`。
   - VPS：加 A（IPv4）/ AAAA（IPv6）记录指向服务器 IP。
2. 证书由平台自动签发（Vercel 自动 Let's Encrypt；VPS 用 Caddy/nginx + certbot）。**必须是有效 https**：客户端对 `/authorize` 与所有 API 都用默认 TLS 校验。
3. 验证：`nslookup app.pinext.dev` 有结果（当前是 NXDOMAIN），`curl -I https://app.pinext.dev/authorize` 能建 TLS。
4. 若要用手机连 `wss://`，同一域名即可，无需另开。

### 4.2 不想用这个域名时怎么改

**只有 origin 可配，路径写死**（契约第 238–240 行）。

| 端 | 改法 | 证据 |
|---|---|---|
| 桌面 | 环境变量 `PINEXT_CLOUD_URL`（必须是 http(s) origin，取 `url.origin`） | `src/main/account.ts:17,21` |
| 手机 | 构建时 `--dart-define=PINEXT_CLOUD_URL=https://your.host` | `apps/mobile_flutter/lib/account/account.dart:18-21` |
| 默认值（两者） | `https://app.pinext.dev` | `src/shared/account.ts:43`；`account.dart:21` |

桌面端读取逻辑：非 http(s) 的值被忽略并回退默认（`src/main/account.ts:20-26`）。

**路径不可配**：`/authorize`、`/api/oauth/token`、`/api/me`、`/api/auth/logout`、`/api/devices/me`、`/api/devices`、`/api/rtc/ice`、`/api/rtc/signal`。服务端要么用这些路径，要么改客户端。

**换 origin 会登出**：本地 `account.json` 记录签发站点，origin 不一致即视为未登录（`engine/account.ts:322`；手机 `account.dart:207`）。

---

## 5. GitHub OAuth App 配置

契约 §2（第 55–79 行）要求 `/authorize` 用 GitHub 登录。

1. 打开 https://github.com/settings/developers → New OAuth App。
2. 字段：
   - **Application name**：`Pinext`（任意）。
   - **Homepage URL**：`https://app.pinext.dev`。
   - **Authorization callback URL**：`https://app.pinext.dev/api/auth/github/callback`（这是**你的站点**的回调，不是客户端的）。客户端回调是 `http://127.0.0.1:<随机端口>/callback`（桌面）与 `pinext://oauth/callback`（手机），它们是**你的** `/authorize` 重定向的目标，不填进 GitHub。
3. 拿到 `Client ID` 与 `Client Secret`，放进服务端环境变量。**Secret 只存服务端，不进客户端**。
4. 服务端流程：`/authorize` 里跳 GitHub 授权 → GitHub 回你的 callback → 你换 GitHub access token、取用户 → 生成一次性 `code` → 302 回客户端 `redirect_uri?code=…&state=…`（契约第 76 行）。
5. 若不做 GitHub、用别的 IdP 也行——契约只规定 `/authorize` 的行为与 `user` 字段名，不规定上游是 GitHub（契约第 213 行「GitHub OAuth 或你自己喜欢的 IdP」）。

**两个 client_id 都要注册在服务端**：`pinext-desktop`（桌面，`engine/account.ts:25`）与 `pinext-mobile`（手机，`account.dart:23`）。它们不是 GitHub 的 client id，是你自己的客户端标识，用于校验 `redirect_uri` 与 PKCE。

---

## 6. 登录之后到底有什么作用（很容易误解）

**登录不配置任何模型**（`AGENTS.md:1245-1246`）。它的价值是让**手机与电脑不在同一网络时也能连**。

| 能力 | 需要账号？ | 证据 |
|---|---|---|
| **官方连接（手机远程，跨网络）** | ✅ 需要 | `AGENTS.md:108-111`；`src/main/rtc/official.ts` 全流程 |
| 手机看到账号下的电脑列表 | ✅ 需要 | `official_devices.dart:60` |
| 跨网络时的 TURN 中转（有月度额度） | ✅ 需要 | 契约第 174–180 行 |
| 模型转发 `/llm` | 未实现 | `AGENTS.md:1246` |
| **局域网扫码 + 密码连接** | ❌ 不依赖 | `AGENTS.md:108`（两条路并列）；契约 §0 第 9–20 行 |
| SSH 主机 | ❌ 不依赖 | 同上 |
| 配置模型供应商 | ❌ 无关 | `AGENTS.md:1245`「不配置任何供应商」 |

结论：**只用局域网扫码的话，登录可以先不做**。登录买的是「在公司连家里的电脑」。

---

## 7. 安全要求（契约 §6 第 194–209 行）

| 项 | 要求 |
|---|---|
| 令牌作用域 | `fvs_…` 是设备令牌，绑定一个账号；`device_id` 只在本账号内可见/可连 |
| 401 vs 403 | 令牌无效/过期 → **401**；账号被禁 → **403** `account_disabled` |
| 令牌落库 | **只存哈希**，永不回显、不写日志 |
| PKCE 绑定 | code 一次性 + ~5min TTL；校验 `SHA256(code_verifier)`、`client_id`、**实际重定向的那个 `redirect_uri`** |
| 防重放 | `state` 由客户端生成并原样回传 |
| `install_id` 校验 | `^[\x21-\x7e]{8,64}$` |
| 信令鉴权 | `Authorization` 头鉴权升级；socket 与账号 + `hello.role` 关联 |
| **跨账号隔离** | `connect` 不得到达别的账号的设备；`signal`/`hangup` **只发给该 `cid` 的另一端，绝不广播** |
| **DTLS 指纹** | 指纹在 SDP 的 `a=fingerprint`，随 `signal.data` 走**已鉴权信道**。服务端**不需要解析 SDP**，但**绝不能**把 `signal` 转发给 `cid` 两端之外的人——这是「第三方无法冒充任一端」的全部依据 |
| 限流 | 每 socket 消息速率受限，洪泛即关闭 |
| 心跳方向 | 服务端 25s ping；且必须回应客户端的 15s 探测 |
| 数量上限 | 账号设备数上限 + 中继并发上限（~4，禁止中继→中继） |

额外实现要点：

- 同一 `device_id` 只允许一个活 socket；旧 socket 用 **4001** 关闭（契约第 124 行）。
- 设备被移除时用 **4005** 关 socket；若活 socket 指向已删设备，补一条 `error{code:"device_not_found"}`（契约第 189 行；桌面据此重新登记，`official.ts:278-290`）。
- 错误信封统一 `{"error":{"code":…}}`（契约第 47–51 行）。

---

## 8. 与契约不一致 / 需要注意的地方

写作过程中核对客户端代码，发现以下与契约正文不完全一致之处（均**不影响部署**，但实现时以客户端代码为准）：

| # | 契约说法 | 客户端实际 | 位置 |
|---|---|---|---|
| 1 | §1 第 25 行「除 `/authorize` 外都要 `Authorization: Bearer`」 | `/api/oauth/token` **不带** Bearer（它是换令牌端点，此刻还没有令牌） | `engine/account.ts:263-271`；`account.dart:317-325` |
| 2 | §1 第 29 行成功响应含 `expires_in` | 桌面与手机都**不读** `expires_in` | `engine/account.ts:286-288`；`account.dart:342-344` |
| 3 | §1 第 29 行含 `token_type` | 桌面与手机都**不读** `token_type`（手机测试里才出现） | 同上；`apps/mobile_flutter/test/account_test.dart:32` |
| 4 | §1 第 34 行含 `relay_exhausted` | 桌面与手机都**不读**该字段 | `src/main/rtc/ice.ts:25-51`；`rtc_connection.dart:317-335` |
| 5 | §1 第 33 行 `GET /api/devices` 列为通用端点 | **桌面从不调用**，只有手机调；桌面用 `PUT /api/devices/me` 的返回 | `official.ts:510`；`official_devices.dart:60` |
| 6 | §1 第 42 行 `user.role` 字段 | 桌面读（非 `admin` 当 `user`）；**手机完全忽略 `role`** | `engine/account.ts:349`；`account.dart:38-50` |
| 7 | §8 第 232–234 行的行号 | 已漂移：`DEFAULT_ACCOUNT_ORIGIN` 实际在 `src/shared/account.ts:43`（非 :29）；`PINEXT_CLOUD_URL` 实际读于 `src/main/account.ts:17`（非 :16）；手机默认值在 `account.dart:21`（非 :19） | 本清单各表已用实际行号 |
| 8 | §8 第 235–237 行写「改名后 →」 | 改名**已完成**，仓库里已是 `pinext-desktop` / `pinext-mobile` / `pinext://oauth/callback` | `engine/account.ts:25`；`account.dart:23-24`；`AndroidManifest.xml:48` |

**未验证项**（无法从本仓库确认，需部署后实测）：

- iOS 的 `CFBundleURLTypes` 未在 `apps/mobile_flutter/ios/Runner/Info.plist` 中找到（该文件只有 `NSBonjourServices` 含 `_pinext._tcp`，第 35 行）。`pinext://` 的 iOS 注册可能由 `flutter_web_auth_2` 插件在构建期生成，也可能缺失——**iOS 登录需真机验证**。
- Vercel WebSocket 的实例钉住与配额细节未在本机验证（来自 `docs/pinext-next-plan-2026-10-15.md:354` 的既有结论）。
- coturn 的 TURN 并发与中继→中继拒绝未在本机验证。

---

## 9. 验收清单（逐条勾）

- [ ] `nslookup app.pinext.dev` 不再是 NXDOMAIN
- [ ] `https://app.pinext.dev/authorize?...` 返回 200 HTML（参数见 §2.1）
- [ ] 浏览器完整登录后 302 回 `redirect_uri?code=…&state=…`
- [ ] `POST /api/oauth/token` 换到 `access_token` + `user`
- [ ] `GET /api/me` 带令牌 200；坏令牌 401
- [ ] `POST /api/auth/logout` 2xx
- [ ] `PUT /api/devices/me` 200 `{device:{id,name}}`；超限 409
- [ ] `GET /api/devices` 200 `{devices:[…]}`
- [ ] `GET /api/rtc/ice` 至少一个 `stun:`
- [ ] WS 脚本走通 hello → connect → connected → signal → hangup（§2.8）
- [ ] 服务端 25s ping、回客户端 pong；4001/4005 语义正确
- [ ] 跨账号 `connect` 被拒；`signal` 不广播
- [ ] 桌面「设置 → 远程访问」显示官方连接 online；手机能连
