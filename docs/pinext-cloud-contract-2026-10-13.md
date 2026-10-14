# 接上你自己的云 —— pinext 云服务契约（可自建）

日期：2026-10-13  
来源：逐行读 FastVibe 0.19.5 的客户端代码反推出的服务端契约（`src/main/engine/account.ts`、`src/main/rtc/**`、`src/shared/account.ts`、`apps/mobile_flutter/lib/account/**`、`lib/protocol/rtc_*.dart`，以及 `test/rtc-fake-cloud.ts` 这个官方假服务端——它把消息形状写死了）。  
用途：你要加自己的云，照着这份把服务端实现出来，客户端只改一个 origin。

---

## 0. 先分清两个服务器（别混）

| | 云服务（本文） | 局域网服务（桌面自带） |
|---|---|---|
| 现在指向 | `https://app.fastvibe.dev` | 桌面进程自己监听 `:7777` |
| 作用 | 登录、设备登记、ICE 下发、**WebRTC 信令中转** | 同网段手机直连 |
| 认证 | 设备令牌 `fvs_…`（Bearer） | 密码 → 设备令牌（scrypt） |
| 代码 | `src/main/engine/account.ts`、`src/main/rtc/**` | `src/main/server/**` |

**`src/main/remote/**` 不是云** —— 那是「桌面连另一台桌面的 App Server」，走 SSH 隧道，不碰任何云端点。

---

## 1. 你要实现的端点（8 个）

全部 JSON；除 `/authorize` 外都要 `Authorization: Bearer fvs_…`。客户端超时 15s、`redirect: "error"`。

| # | 方法 | 路径 | 请求 | 成功响应 | 用途 |
|---|---|---|---|---|---|
| 1 | GET | `/authorize` | query 参数见 §2 | HTML 页；同意后 302 → `redirect_uri?code=…&state=…` | 发起登录 |
| 2 | POST | `/api/oauth/token` | `{grant_type:"authorization_code", code, code_verifier, client_id, redirect_uri}` | `{access_token, token_type:"Bearer", expires_in, user}` | 换令牌 |
| 3 | GET | `/api/me` | — | `user` 对象 | 校验令牌 + 刷新用户 |
| 4 | POST | `/api/auth/logout` | — | 任意 2xx | 吊销当前令牌 |
| 5 | PUT | `/api/devices/me` | `{install_id, name, platform}` | `{device:{id, name}}` | 登记/改名这台电脑 |
| 6 | GET | `/api/devices` | — | `{devices:[{id,name,platform,online}]}` | 手机列出账号里的电脑 |
| 7 | GET | `/api/rtc/ice` | — | `{ice_servers:[…], expires_at?, relay_exhausted?}` | 下发 STUN/TURN |
| 8 | WS | `/api/rtc/signal` | `Authorization` 头 | 见 §3 | 信令中转 |

可选：`GET /console` —— 桌面右下角账号区「管理设备」会打开 `${origin}/console`（普通网页即可）。

`user` 对象字段名是**精确的**：

```json
{ "id": "u1", "login": "octocat", "avatar_url": "https://…", "email": "o@example.com", "role": "user" | "admin" }
```

桌面端要求：`id` 是字符串、`login` 非空；`avatar_url` 必须匹配 `^https://` 否则置空；`role` 非 `"admin"` 一律当 `"user"`。

错误信封（所有 JSON 失败统一）：

```json
{ "error": { "code": "invalid_grant" | "account_disabled" | "unauthorized" | "too_many_devices" } }
```

---

## 2. 登录：授权码 + PKCE（RFC 8252 / 7636）

桌面与手机同一套流程，只有 `client_id` 与 `redirect_uri` 不同：

| | 桌面 | 手机 |
|---|---|---|
| client_id | `fastvibe-desktop`（改名后 → `pinext-desktop`） | `fastvibe-mobile` → `pinext-mobile` |
| redirect_uri | `http://127.0.0.1:<随机端口>/callback` | `fastvibe://oauth/callback` → `pinext://oauth/callback` |
| PKCE | verifier = 32 随机字节 base64url；challenge = `SHA256(verifier)` base64url | 同 |
| state | 24 随机字节 base64url | 同 |

`/authorize` 的 query 参数名（精确）：

```
client_id, redirect_uri, state, code_challenge, code_challenge_method=S256, device_name, platform
```

`platform` = `darwin` / `win32` / `linux`，手机是 `ios` / `android`；`device_name` 是主机名（≤80 字符，服务端要尊重这个上限）。

**⚠️ 一个必踩的坑（不做就每次首次登录都 `invalid_grant`）**：站点侧（Next 中间件）会把 URL 里第一个 loopback 字面量从 `127.0.0.1` 改写成 `localhost`。桌面端的 loopback 监听两种 Host 都接受，**并按实际到达的那个拼写回传 code**。所以服务端必须：

- 把 code 绑定到**实际发出重定向的那个 `redirect_uri`**，而不是 `/authorize` 里收到的那个；
- `/api/oauth/token` 校验 `redirect_uri` 必须与绑定的完全一致。

另外必须校验：code 一次性且 ~5 分钟内有效、`SHA256(code_verifier)` == 存下的 challenge、`client_id` 匹配。

**令牌**：`fvs_…`，**90 天滑动有效期**，**没有 refresh token**（`GET /api/me` 既校验也顺延窗口）。客户端行为：**401 ⇒ 立刻登出删除本地令牌**；离线 / 5xx ⇒ 保持登录。所以无效令牌一律回 **401**，不要 403。

**本地存储**：桌面 `<userData>/account.json`（0600，临时文件 + rename 原子写，内含 `{version,origin,token,user}`，读取时校验 `origin` 一致，否则视为登出）；手机在 Keychain/Keystore。

**登出**：客户端先清本地再尽力调 `/api/auth/logout` 吊销。

---

## 3. 信令：`WS /api/rtc/signal`

UTF-8 JSON 文本帧，每条带 `type`；呼叫相关的带 `cid`。

### 3.1 消息表

| 方向 | 消息 | 字段 | 含义 |
|---|---|---|---|
| 手机→服务端 | `hello` | `{type:"hello", role:"client", name, platform}` | 手机上线（与第一条 `connect` 连续写出，服务端按顺序读） |
| 桌面→服务端 | `hello` | `{type:"hello", role:"device", device_id, platform}` | 桌面上线（每次重连都发） |
| 服务端→双方 | `hello` | `{type:"hello", role}` | 确认；客户端只匹配 `type` |
| 手机→服务端 | `connect` | `{type:"connect", device_id}` | 呼叫某台电脑 |
| 服务端→手机 | `connected` | `{type:"connected", cid}` | 呼叫建立（`cid` 不能为空） |
| 服务端→手机 | `error` | `{type:"error", code}`（无 cid） | 拒绝呼叫：`device_offline`（可重试）/ `device_not_found` |
| 服务端→桌面 | `incoming` | `{type:"incoming", cid, peer:{name, platform?}}` | 有电话打进来 |
| 双方→服务端 | `signal` | `{type:"signal", cid, data}` | 中转到 `cid` 的**另一端** |
| 双方→服务端 | `hangup` | `{type:"hangup", cid}` | 挂断并释放 |
| 服务端→任一端 | `error` | `{type:"error", code, cid?, message?}` | 呼叫级错误；`unknown_call` 是 `hangup` 竞态的正常现象 |

`data` 内容对服务端**不透明**（原样转发即可），但两端约定：

| `data.type` | 字段 | 谁发 |
|---|---|---|
| `offer` | `{type:"offer", sdp, client_id?, rollover?, deflate?}` | 手机 |
| `answer` | `{type:"answer", sdp, deflate?}` | 桌面 |
| `candidate` | `{type:"candidate", candidate, mid}` | 双方 |
| `candidates` | `{type:"candidates", candidates:[...], mid}` | 仅桌面（批量预测端口） |

SDP 上限 64 KiB，单 candidate ≤2 KiB，缓冲信号 ≤64 条。**不要解析 SDP**，但要保证只转发给 `cid` 的两端成员。

### 3.2 服务端要维护的状态

- `device_id → 活的桌面 socket`（在线状态就来自这里，**没有单独的心跳端点**）
- `cid → {手机 socket, 桌面 socket}`
- **会话隔离**：两端必须属于**同一账号**；`connect` 只能到达同账号的设备；`signal`/`hangup` 只发给该 `cid` 的另一端，**绝不广播**。
- 同一个 `device_id` 只允许一个活 socket；旧的用 **关闭码 `4001`** 关掉。

### 3.3 超时 / 心跳（服务端必须满足）

| 行为 | 值 |
|---|---|
| 服务端**主动 WS ping** | **每 25s**（桌面的 70s 静默判死是按这个值校准的） |
| 桌面握手超时 | 10s |
| 桌面重连退避 | `[1,2,4,8,15,30]` s ±20% 抖动 |
| 桌面自探测 | 每 15s，8s 内没 pong 就 terminate |
| 桌面静默判死 | 70s 无任何帧 |
| 手机 `connect` 期限 | 新连接 12s / 复用连接 **2.5s** |
| 手机呼叫后保留 socket | 20s |
| 服务端必须回 WS `ping` 的 `pong` | 是 |

### 3.4 关闭码与限流

| 关闭码 | 含义 | 客户端反应 |
|---|---|---|
| `4001` | 被替换（同一设备在别处连上） | 桌面停止，不再重连 |
| `4005` | 被移除（设备从账号删掉 / 会话结束） | 桌面停止，需重新打开开关才会重新登记 |
| `1000` | 正常停止 | — |
| 升级时 401/403 | 令牌失效 | 桌面登出，手机 `needsAccount` |

必须做**每 socket 消息限流**（桌面之所以把端口预测合并成一条 `candidates`，就是因为服务端会数消息条数并在洪泛时关连接）。

---

## 4. ICE / TURN：`GET /api/rtc/ice`

```json
{
  "ice_servers": [
    { "urls": ["stun:turn.example.com:3478"] },
    { "urls": ["turn:turn.example.com:3478?transport=udp",
               "turn:turn.example.com:3478?transport=tcp",
               "turns:turn.example.com:443?transport=tcp"],
      "username": "1790000000:user-id",
      "credential": "base64+/=" }
  ],
  "expires_at": "2026-10-10T02:00:00Z",
  "relay_exhausted": false
}
```

规则：
- `urls` 可以是字符串或字符串数组，可混 `stun:`/`stuns:`/`turn:`/`turns:`；端口默认 3478，安全 scheme 默认 5349；`?transport=udp|tcp` 要支持。
- `credential` 是 base64，**必须能带 `/ + =`**（当字段传，别塞进 URL）。
- `expires_at` ISO-8601；缺失/null = 凭证不过期。

两端怎么用：
- **桌面只保留 STUN**（`node-datachannel`/libjuice **没有 TURN-over-TCP/TLS**，且中继配额要和手机共享）。
- **手机每个条目只取一条 TURN**（优先 UDP），并另存一份 `turns:…:443` / `…transport=tcp` 作为「UDP 被封」的兜底。
- 中继凭证寿命约 5 分钟；服务端下发时**至少留 3 分钟**；客户端剩 2.5 分钟就弃用。
- 服务端要限制中继并发分配（注释里是**同时 4 条**，两端共享），并**拒绝中继→中继**。

**没有 TURN 会怎样**：同局域网照常；有 UDP 的 NAT 打洞（srflx）照常；**对称 NAT ↔ 对称 NAT（手机流量 / CGNAT 常见）连不上**；手机网络封 UDP 时兜底也没了。桌面本身只吃 STUN，所以**桌面所在网络封 UDP 时，从外面完全连不上**。

---

## 5. 设备登记与在线状态

- 桌面用 `PUT /api/devices/me` 登记，`install_id` 形如 `inst_<32 hex>`，存在 `<userData>/rtc-device.json`（0600），**同一 install 跨登录/改名保持同一个 `device.id`**。按 `(账号, install_id)` 幂等 upsert。
- 超限回 **409** `{error:{code:"too_many_devices"}}`（客户端提示去 console 删设备，**不重试**）；**401 直接登出**；5xx 按 `[5,15,30,60]` s 重试。
- `online` = 该 `device_id` 有活的信令 socket。**没有独立心跳接口**。
- 设备被移除时，服务端必须用 **`4005`** 关闭它的信令 socket；若活 socket 指向已删除的 `device_id`，再补一条 `error{code:"device_not_found"}`（桌面据此重新登记）。
- 同一 `(账号, device_id)` 出现第二个活 socket → 旧 socket 用 **`4001`** 关闭。

---

## 6. 服务端必须强制的安全项

| 项 | 要求 |
|---|---|
| 令牌作用域 | `fvs_…` 是**设备令牌**，绑定一个账号；所有 `device_id` 只在本账号内可见/可连 |
| 401 vs 403 | 令牌无效/过期 → **401**；账号被禁 → **403** `account_disabled` |
| 令牌落库 | **只存哈希**，永不回显、不写日志 |
| PKCE 绑定 | code 一次性 + ~5min TTL；校验 verifier 哈希、`client_id`、**实际重定向的那个 `redirect_uri`** |
| 防重放 | `state` 由客户端生成并原样回传 |
| `install_id` 校验 | 接受 `^[\x21-\x7e]{8,64}$`，拒绝超长/含控制字符 |
| 信令鉴权 | `Authorization` 头鉴权升级；socket 与账号 + `hello.role` 关联 |
| 跨账号隔离 | `connect` 不得到达别的账号的设备；`signal`/`hangup` 只发给该 `cid` 的另一端 |
| DTLS 指纹 | 指纹在 SDP 里（`a=fingerprint`）随 `signal.data` 走**已鉴权信道**——服务端**不需要**解析 SDP，但**绝不能**把 `signal` 转发给 `cid` 两端之外的人。这是「第三方无法冒充任一端」的全部依据 |
| 限流 | 每 socket 消息速率受限，洪泛即关闭 |
| 心跳方向 | 服务端 25s ping；且必须容忍并回应客户端的 15s 探测 |
| 数量上限 | 账号设备数上限 + 中继并发上限（~4，且禁止中继→中继） |

---

## 7. 最小可用配方（推荐起步形态）

一个进程同时提供 HTTP + WebSocket + 一份 `ice_servers`（指向你自己的 STUN）：

1. `/authorize` + `/api/oauth/token` + `/api/me` + `/api/auth/logout` —— 登录（GitHub OAuth 或你自己喜欢的 IdP）
2. `PUT /api/devices/me` + `GET /api/devices` —— 手机要拿到桌面的 `device_id`
3. `WS /api/rtc/signal` —— **核心就这一块**
4. `GET /api/rtc/ice` 至少回一个 `stun:…`（自建 coturn 免费提供）

持久状态只有三样：账号、令牌哈希、设备（`install_id → id/name/platform`）。`cid → {手机, 桌面}` 是内存里的临时状态，进程重启即清空（客户端会自动重连重呼）。

**要不要 TURN**：想覆盖「手机在外网 + 家里宽带对称 NAT」，就需要 coturn 开 TURN。国内家宽普遍有 IPv6，IPv6 直连可以绕过一部分 NAT 问题。

---

## 8. 客户端只改一个 origin（+ 改名清单）

| 项 | 位置 | 现在 | 改成 |
|---|---|---|---|
| 云端 origin（桌面） | `src/main/account.ts:16` 读 `FASTVIBE_CLOUD_URL` | `https://app.fastvibe.dev` | 你的域名 —— 改名后是 `PINEXT_CLOUD_URL` |
| 默认 origin | `src/shared/account.ts:29` `DEFAULT_ACCOUNT_ORIGIN` | 同上 | 同上 |
| 云端 origin（手机） | `apps/mobile_flutter/lib/account/account.dart:19`，构建时 `--dart-define=FASTVIBE_CLOUD_URL=…` | 同上 | 同上 |
| 桌面 client_id | `src/main/engine/account.ts` | `fastvibe-desktop` | `pinext-desktop` |
| 手机 client_id | `account.dart` | `fastvibe-mobile` | `pinext-mobile` |
| 手机自定义 scheme | iOS/Android 清单 + `account.dart` | `fastvibe://oauth/callback` | `pinext://oauth/callback` |
| 路径 | 硬编码 | `/api/rtc/signal`、`/api/rtc/ice`、`/api/devices/me` | **不可配置**，服务端必须用这些路径 |

> 注意：**只有 origin 可配**，路径写死。所以你的服务端要么用同样路径，要么改客户端。

---

## 9. 建议实现顺序

1. **先只做 `/api/rtc/signal` + `PUT/GET /api/devices` + `/api/rtc/ice`（只返 STUN）** —— 用一个临时令牌，让手机在**同一局域网/有 IPv6** 的情况下连上，验证信令与隔离逻辑。
2. 补登录（`/authorize` + `/api/oauth/token` + `/api/me`）—— 这时才需要账号体系与 PKCE。
3. 起 coturn 并在 `/api/rtc/ice` 里下发 TURN —— 覆盖外网与对称 NAT。
4. 补 `/api/auth/logout` 与 `/console`（设备删除，删除时记得用 `4005` 关 socket）。

**测试可参考 FastVibe 自带的假服务端** `test/rtc-fake-cloud.ts` 与 `test/rtc-signaling.test.ts` —— 它把上面每一条消息形状与超时都写成了断言，可以直接当服务端的验收清单。
