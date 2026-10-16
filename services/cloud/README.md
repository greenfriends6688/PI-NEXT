# PI NEXT 云服务

一台电脑和一部手机要在**不在同一个网络**时互相连上，各自都在 NAT 后面，谁也拨不通谁。
这个服务是两个人都已经连着的地方，所以是唯一能做介绍的地方：手机发起呼叫，这里把它们对上，
之后 SDP 和候选地址原样转发——它从不解析 `data`，真正的会话也不经过这里。

它实现的是仓库里的 `docs/pinext-cloud-contract-2026-10-13.md`。客户端把路径写死了
（`/api/rtc/signal`、`/api/rtc/ice`、`/api/devices/me`），所以这里也不能配——**只有 origin 可配**。

## 它做什么

| 端点 | 用途 |
| --- | --- |
| `GET /authorize` | 浏览器里那一页：确认「让这台电脑登录」 |
| `POST /authorize/decision` | 允许 / 拒绝，允许则带一次性 code 跳回客户端 |
| `POST /api/oauth/token` | code + PKCE verifier 换设备令牌（`fvs_…`，90 天滑动） |
| `GET /api/me` | 这台电脑是谁的；读一次就顺延令牌 |
| `POST /api/auth/logout` | 吊销当前令牌 |
| `PUT /api/devices/me` | 电脑按 `install_id` 登记自己（幂等，可改名） |
| `GET /api/devices` | 这个账号下的电脑，含 `online`（= 信令 socket 活着） |
| `GET /api/rtc/ice` | STUN，以及配了 TURN 时的临时凭据 |
| `WS /api/rtc/signal` | 介绍两端、转发信令 |
| `GET /console` | 控制台：管理账号下的电脑（桌面账号菜单里那个链接） |

只落盘三样东西：账号、令牌哈希、设备。**呼叫只在内存里**——重启就没了，这是对的：
两端都会重连，电脑重新登记，手机重新拨。

## 本地跑

不需要域名、不需要备案、不需要服务器：

```bash
cd services/cloud
DEV_LOGIN=1 PUBLIC_ORIGIN=http://127.0.0.1:9088 node src/node/index.ts
```

然后把客户端指过来：

```bash
PINEXT_CLOUD_URL=http://127.0.0.1:9088 pnpm dev
```

`DEV_LOGIN=1` 会提供一个不需要 GitHub 的登录入口（页面上填一个用户名即可），
所以本机开发不需要注册任何 OAuth 应用。**它不能开在生产上**：那等于谁都能登录成任何人。

## 测试

```bash
node --test test/cloud.test.ts      # 服务端自己：14 项
```

覆盖的是那些「看起来在正常工作」的坏法：code 能不能用两次、`signal` 会不会转发给不该收到的人、
别人的设备能不能被冒认、被顶替的那条 socket 会不会还留着。

另外仓库根的 `test/cloud-login.test.ts` 跑的是**真实客户端连真实服务**——`test/account.test.ts`
用的是照着同一份契约写出来的假服务，两边按构造就是一致的；只有真客户端配真服务才能发现两边
对同一个字段、同一个状态码的理解不一致，而按部署清单，契约和客户端**确实曾经在八处不一致**。

## 部署

### 域名和备案

大陆的服务器对**没有备案**的域名会在边缘直接拦掉（阿里云会给一个
`Non-compliance ICP Filing` 页）。所以只有两条路：

- **服务端放境外**（香港、新加坡、Vercel……）：域名指过去就能用，不需要备案。
  登录流程只要求「浏览器能打开 `https://<域名>/authorize`」，所以能跑 HTTPS 的地方都行。
- **服务端放大陆**：先办 ICP 备案（1–3 周），办下来之前这个域名在 80/443 上不可用。

信令是长连接、进程要常驻，所以**不能用 Vercel 的 Serverless**：登录那三个端点可以，
`WS /api/rtc/signal` 不行（Public Beta 且实例会被钉住）。需要一台能跑 Node 的机器。

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `9088` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址；对外服务传 `0.0.0.0` |
| `PUBLIC_ORIGIN` | `http://127.0.0.1:<PORT>` | 对外 origin，**必须和客户端配的完全一致** |
| `DATA_FILE` | `~/.pinext-cloud/cloud.json` | 落盘位置（0600，临时文件 + rename） |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 空 | 配了就用 GitHub 登录；没配且 `DEV_LOGIN=1` 走开发登录 |
| `DEV_LOGIN` | `0` | `1` 打开不需要 GitHub 的登录入口（**仅开发**） |
| `MAX_DEVICES` | `10` | 每个账号的电脑上限，超了回 409 `too_many_devices` |
| `TOKEN_TTL_DAYS` | `90` | 设备令牌寿命，每次 `/api/me` 顺延 |
| `STUN_URLS` | `stun:stun.l.google.com:19302` | 逗号分隔 |
| `TURN_SECRET` / `TURN_URLS` | 空 | 配了才下发 TURN（见下） |
| `TURN_TTL_SECONDS` | `300` | 临时凭据寿命 |
| `RELAY_LIMIT` | `4` | 每账号的并发中继数（给 TURN 服务器参考） |

### GitHub 登录

在 GitHub 建一个 OAuth App，**回调地址填 `https://<域名>/auth/github/callback`**，
把 Client ID / Secret 填进环境变量。桌面端和手机端登录的是同一个站点，所以只需要这一个应用。

### TURN（可选，但跨网络几乎必需）

只有 STUN 时，同一个网络和大部分家庭宽带都能直连；两端都是对称 NAT（手机数据流量、
运营商级 NAT 很常见）时连不上，需要 TURN 中继——这是整个服务里唯一按流量花钱的部分。

用 coturn，开 `use-auth-secret`：

```
# /etc/turnserver.conf
use-auth-secret
static-auth-secret=<和 TURN_SECRET 一致>
realm=<域名>
```

然后 `TURN_URLS=turn:<域名>:3478?transport=udp,turns:<域名>:443?transport=tcp`。

> **TURN over TLS 需要证书**，而且证书的衔接由 coturn 自己做，不由这里的 nginx 做。
> `turns:` 那一项是给手机用的兜底（网络完全不放行 UDP 时），电脑端的库（libjuice）
> 不支持 TURN over TCP/TLS，所以那一项它读到了也不会用——这是有意的，不是 bug。

### 反向代理

`WS /api/rtc/signal` 走的是 `Upgrade`，要在这条路径上转发：

```nginx
location / {
  proxy_pass http://127.0.0.1:9088;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 3600s;   # 信令是长连接，默认 60s 会把它掐掉
}
```

`proxy_read_timeout` 这一行别省：信令大部分时间没有话要说，而**安静地读一份转写是正常状态**。
服务端自己每 25 秒 ping 一次，正好让这条超时不会触发。

### systemd

```ini
[Unit]
Description=PI NEXT cloud
After=network.target

[Service]
WorkingDirectory=/opt/pinext-cloud
ExecStart=/usr/bin/node src/node/index.ts
EnvironmentFile=/etc/pinext-cloud.env
Restart=always
User=pinext

[Install]
WantedBy=multi-user.target
```

## 已经验证过什么

- `node --test test/cloud.test.ts` — 14 项：PKCE 校验、code 一次性、redirect_uri 精确匹配、
  令牌只存哈希、设备幂等与上限、信令双向转发、跨账号隔离、设备顶替 4001、控制台删除 4005。
- 仓库根 `test/cloud-login.test.ts` — 真实 `AccountService` 走完整登录（浏览器授权 → 回环回调 →
  换令牌 → `/api/me` → 登出吊销），以及真实设备登记与改名。

## 还没做

- **手机端的真机联调**。桌面端已跑通；手机端读的字段、路径、信令消息名都逐条核对过一致，
  但没有在真机上跑过一次呼叫。
- **限流**。信令有每 socket 的洪泛保护（10 秒 200 条），但 HTTP 端点没有按 IP 限流。
- **令牌的滚动清理**：过期的令牌留在文件里，没有 GC。
