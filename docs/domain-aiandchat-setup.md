# aiandchat.cloud 接上 Pinext 云服务

日期：2026-10-16
适用：桌面端 `src/shared/account.ts`、手机端 `apps/mobile_flutter`
前置：服务端要实现什么，见 `docs/pinext-cloud-contract-2026-10-13.md`；
部署与验收细节见 `docs/pinext-cloud-deploy-checklist-2026-10-15.md`。
本文只回答一件事：**这个域名怎么配，才能和客户端对上。**

---

## 1. 先说清楚现在的状况（实测）

```
$ dig +short NS aiandchat.cloud @8.8.8.8
dns19.hichina.com.
dns20.hichina.com.

$ dig +short A www.aiandchat.cloud @dns19.hichina.com
121.196.230.156

$ dig +short A aiandchat.cloud @dns19.hichina.com
（空）
$ dig +short A app.aiandchat.cloud @dns19.hichina.com
（空）
```

三件事：

1. **没有「指向别处」这回事，是正常的。** `dns19/dns20.hichina.com` 是阿里云的
   **DNS 服务器（NS）**，不是被谁劫持——那正是你要去改记录的地方（阿里云控制台 →
   云解析 DNS → aiandchat.cloud）。
2. **`aiandchat.cloud` 本身没有 A 记录**（裸域不通），`www` 指向 `121.196.230.156`。
3. **那台机器在阿里云杭州（大陆）**：

   ```
   $ whois 121.196.230.156 | grep descr
   netname:  ALISOFT
   descr:    Aliyun Computing Co., LTD
   descr:    No.391 Wen'er Road, Hangzhou, Zhejiang, China
   $ curl -I http://www.aiandchat.cloud/
   HTTP 403   （响应头里有 nginx，说明机器在跑，但没有配这个域名的站点）
   ```

   `121.196.x.x` 是阿里云华东 1（杭州）。**这一点决定了下面的选择。**

---

## 2. 客户端要用的域名，已经改好了

| 位置 | 现在指向 | 说明 |
|---|---|---|
| 桌面端默认站点 | `https://app.aiandchat.cloud` | `src/shared/account.ts` 的 `DEFAULT_ACCOUNT_ORIGIN` |
| 手机端默认站点 | `https://app.aiandchat.cloud` | `apps/mobile_flutter/lib/account/account.dart` |
| 手机端测试固定值 | 同上 | `apps/mobile_flutter/test/account_test.dart` |

**两端必须是同一个域名**——登录同一账号才能互相发现设备；不同域名就只是两台各连各的。

想换成裸域（`https://aiandchat.cloud`）也行，改上面三处即可；但裸域做 CNAME 在 DNS 上
不合法，所以只在用 A 记录（自己的服务器）时才推荐。

**换 origin 会登出**：本地 `account.json` 记着签发站点，origin 不一致即视为未登录
（`src/main/engine/account.ts`）。这是有意的：一个站点发的令牌不该发到另一个站点。
`pn.dev` 之类旧域名签发的登录态不会跟过来，需要重新登录一次。

**路径写死在客户端**，服务端必须用这几个（契约 §1）：

```
/authorize
/api/oauth/token
/api/me
/api/auth/logout
/api/devices/me
/api/devices
/api/rtc/ice
/api/rtc/signal        ← WebSocket，手机远程连接要用
```

账号站点和信令是**同一个 origin**，不用另开子域。

---

## 3. 要加哪条 DNS 记录

### 3.1 用你自己的阿里云服务器（`121.196.230.156`）

阿里云控制台 → 云解析 DNS → 找到 `aiandchat.cloud` → 添加记录：

| 字段 | 填什么 |
|---|---|
| 记录类型 | `A` |
| 主机记录 | `app` |
| 解析线路 | 默认 |
| 记录值 | `121.196.230.156` |
| TTL | 10 分钟 |

> 顺手建议把裸域的 A 记录也补上（主机记录填 `@`），否则 `aiandchat.cloud` 打不开；
> 这和 Pinext 无关，但你现在是空的。

### 3.2 用 Vercel 或境外的服务器

| 场景 | 记录 |
|---|---|
| Vercel | `CNAME`，主机记录 `app`，记录值 `cname.vercel-dns.com` |
| 其他 VPS | `A`，主机记录 `app`，记录值 = 那台机器 IP |

### 3.3 大陆服务器必须先过 ICP 备案 —— 这是最容易卡住的一步

**工信部要求：在大陆的服务器上对 80/443 提供 HTTP 服务，域名必须有 ICP 备案。**
没备案时，阿里云会拦掉对这两个端口的访问（常见表现是解析正常但连不通，或者被重定向到
备案提示页）。DNS 怎么配都绕不过去。

所以：

| 你的情况 | 该怎么做 |
|---|---|
| `aiandchat.cloud` **已有备案** | 用 §3.1，把 `app` 指到 `121.196.230.156`，最省事，而且**手机远程连接需要的长连接 WebSocket 只有自己的服务器能做**（见 §5） |
| **没有备案**，也不想办 | 换一台**境外**服务器（阿里云香港/新加坡、或 Vercel）——DNS 在阿里云不影响，解析可以指向任何地方。代价：国内访问延迟高一些 |
| 没有备案，且只用登录 | Vercel 够用（登录不需要 WebSocket，见 §5） |

> 备案按**域名**办，不是按子域。`www` 已经指到那台机器上了，所以要么你已经有备案、
> 只是 nginx 没配站点（403 就是这个意思）；要么那台机器上的站点本来也没真正对外提供过。
> 这一条只有你能确认。

---

## 4. 服务器上的最小配置（nginx 反代）

客户端对 `/authorize` 和每个 API 都用默认 TLS 校验，**必须是有效 https**，自签不行。

```nginx
server {
    listen 443 ssl http2;
    server_name app.aiandchat.cloud;

    # 阿里云免费证书，或 Let's Encrypt（certbot）
    ssl_certificate     /etc/nginx/cert/app.aiandchat.cloud.pem;
    ssl_certificate_key /etc/nginx/cert/app.aiandchat.cloud.key;

    location / {
        proxy_pass http://127.0.0.1:9088;      # 你的云服务端口
        proxy_http_version 1.1;

        # 信令是 WebSocket，这两行少了它会在握手时 400
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 默认 60s 会把安静的连接切断；客户端心跳 30s，给足余量
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

`proxy_read_timeout` 别用默认值：`/api/rtc/signal` 是个安静的长连接（只在手机和电脑互相
发现时才说话），nginx 默认 60 秒会把它断掉，表现是手机「连上一会儿就掉」。

---

## 5. 服务端放哪：两个能力的代价不一样

| 能力 | 需要什么 | 能不能只靠 Vercel |
|---|---|---|
| **登录**（头像、设备列表） | `/authorize` + `/api/oauth/token` + `/api/me` | ✅ 可以 |
| **官方连接**（手机不在同一网络时远程用电脑） | 上面全部 **+ `/api/rtc/signal` 长连接 WebSocket** | ⚠️ Vercel 的 WebSocket 是 **Public Beta**，且连接会**钉在单个实例**上；设备在线状态还要外部 KV |

所以：

- **只想让「登录」变真** → Vercel 就够，加一条 CNAME 即可。
- **要用手机的官方连接** → 自己的服务器（或任何能跑长连接驻留进程的地方）。
  这也是为什么 §3.1 那条路更值：那台杭州机器本来就在运行。

**登录之后到底有什么用**（很容易误解，契约 §6 也写了）：登录**不配置任何模型**，
它的全部价值是「手机与电脑不在同一网络时也能连」。局域网里扫码 + 密码那条路
**不依赖账号**，现在就能用，不需要这个域名。

---

## 6. 还想跑模型转发（可选）

如果你打算把这台机器也当模型网关（`https://api.aiandchat.cloud/v1` 之类），
那是**另一件事**：它只是一个普通供应商端点，在 设置 → 供应商 里添加、粘贴 API key 即可，
与账号站点无关，也不需要改客户端代码。

mock 数据里已经把示例的 relay 写成 `https://api.aiandchat.cloud/v1`
（`src/renderer/src/mock/preview-data.ts`），只是预览台用的假数据。

---

## 7. 验证：按顺序打勾

DNS 与 TLS：

```bash
dig +short app.aiandchat.cloud                     # 要返回 IP 或 CNAME
curl -sS -o /dev/null -w "%{http_code}\n" https://app.aiandchat.cloud/authorize
curl -sS https://app.aiandchat.cloud/api/hello      # 期望 {"configured": ...} 或 404 JSON
```

客户端侧（做完上面再看）：

1. 桌面端 设置 → 账号 → 登录，浏览器跳转到 `app.aiandchat.cloud/authorize`（**不是**
   `pinext.dev`，说明改动生效了），授权后回到应用并显示头像。
2. 手机端 设置 → 登录，同样跳到 `app.aiandchat.cloud`。
3. 两端都登录后，手机「添加设备」里能看到这台电脑（这条要走通，说明设备登记
   `PUT /api/devices/me` 与 `GET /api/devices` 都对）。
4. 要验证远程连接，见 `docs/pinext-cloud-deploy-checklist-2026-10-15.md` §2 里
   `/api/rtc/signal` 的 WebSocket 验收脚本。

排查时记住两条：

- **跳转里的域名不对** → 客户端没生效（重新构建/重启，`PINEXT_CLOUD_URL` 有没有被设成别的）。
- **跳转对但页面 502/超时** → 服务端或 nginx 的问题，与客户端无关。

---

## 8. 一句话总结

代码里已经把账号站点改成 `app.aiandchat.cloud` 了；你需要在**阿里云云解析**加一条
`A` 记录（`app` → 你服务器的 IP），**前提是那个域名有 ICP 备案**——没有就把服务端放到
境外，DNS 在阿里云不影响。那台杭州机器正在跑 nginx（`www` 返回 403 是没配站点），
备案齐了的话它是最合适的位置，因为手机的远程连接需要一条 Vercel 给不了的长连接。
