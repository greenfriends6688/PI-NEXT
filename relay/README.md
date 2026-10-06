# PI NEXT 自建中继（fork:mobile-shell · relay）

出门 5G 也能连回家的「信使」——Paseo 中继的极简子集（单用户、无端到端加密层）。

## 架构

```
手机(5G) ──HTTPS──▶ 中继（Deno Deploy，本文件） ◀──WebSocket 主动拨出── Mac 拨号端（lib/relay-dialer.ts）
                     只做字节搬运：不解读、不落盘                       对 127.0.0.1:30141 执行真实请求
```

- **Mac 主动拨出**：家里设备永不监听公网，不用动路由器、不需要公网 IP。
- **应用层鉴权不变**：中继只是搬运工，每个请求到 Mac 都过令牌闸门
  （`lib/lan-access.ts` 的 `checkLanAccess()`），6 位码配对照旧。
- **地址稳定**：中继 URL 固定 → host-only cookie 配对一次永久有效
  （这正是 quick tunnel 做不到的）。
- **局域网自动不在场**：在家里直接用局域网地址（更快）；出门才走中继。
  两边配对互不影响（cookie 按 host 分开）。
- v1 不做 Paseo 的 NaCl 端到端加密——中继是你自己部署的，TLS + 令牌闸门够了。

## 部署（Deno Deploy，免费）

1. 打开 <https://dash.deno.com> → **Sign in with GitHub**（用你的 GitHub 账号）。
2. **New Deployment → Deploy from Git repository** → 选 `greenfriends6688/P-NEXT`
   （首次会装 Deno 的 GitHub App，按提示授权）→ 分支 `main`。
3. **Entrypoint** 填 `relay/deno/relay.ts`。
4. **Environment Variables** 加一条：
   `RELAY_TOKEN` = 自己生成一个随机串（如 `openssl rand -hex 16` 的输出）。
5. Deploy → 得到 `https://<项目名>.deno.dev`。

> 命令行党：`npx deployctl deploy --project=<名> --entrypoint=relay/deno/relay.ts --env=RELAY_TOKEN=<串>`
> （需要先在 dash.deno.com 的 Access Tokens 里拿 token）。

> 已知边界：`*.deno.dev` 在国内 5G 直连**可能时好时坏**；不稳的话换 VPS 部署同一份
> 文件（`RELAY_TOKEN=xxx PORT=443 deno run --allow-net --allow-env relay/deno/relay.ts`
> + 反代 TLS），协议零改动。

## 接到 Mac（设置页）

桌面「设置 → 手机与推送 → 出门访问（自建中继）」：

1. 「中继地址」填 `https://<项目名>.deno.dev`
2. 「中继 token」填部署时的 `RELAY_TOKEN`
3. 点 **连接中继** → 状态变「已连接」
4. 卡片里会给出**「手机上填这个地址」**（`https://…/m/<服务器ID>/`）——把它填进手机
   App 的地址页，输一次 6 位码配对，以后 5G 直接用。

Mac 重启服务后拨号端会**自动重连**（配置持久在 `~/.pi/agent/relay-link.json`，0600），
手机端什么都不用动。

## 本地验证

```bash
npm run relay:smoke
```

一条龙跑「deno 起中继 → 真拨号端 → 穿透 5 项检查（JSON / 大 HTML 流式 / 同步清单 /
带 body 的 POST / 断开 502）」。前置：30141 有跑着的服务。

## 协议（JSON 帧，见 relay/deno/relay.ts 头注释）

```
中继 → Mac：{type:"req", id, method, path, headers, bodyB64} · {type:"cancel", id}
Mac → 中继：{type:"res-head", id, status, headers} · {type:"chunk", id, b64} · {type:"res-end", id}
双向：{type:"ping"} / {type:"pong"}（25s 保活）
```

响应头里的 `content-encoding/content-length` 由拨号端剥掉（本机内网按 `identity`
取回明文，见 `lib/relay-dialer.ts` 的注释——双重解压是实测过的坑）。
