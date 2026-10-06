# 手机远程访问设置指南（fork:mobile-shell）

> 一页说清「不在局域网也能用手机操控 PI NEXT」。配对、令牌、闸门的原理见
> `docs/mobile-shell-plan-2026-10-05.md`；本页只写操作。

## 原理一句话

电脑上的服务只绑本机回环或局域网；手机通过 **Tailscale 的 100.x 稳定地址**访问——
在家里和在外面是同一个地址，cookie 配对一次永久有效。

## 步骤

### 1. 装 Tailscale（电脑 + 手机，同一账号，免费）

- macOS：`brew install tailscale` 或 App Store 版，登录后菜单栏图标点亮。
- 手机：App Store / Play 商店装 Tailscale，同一账号登录，**App 保持开启**（iOS 装
  VPN 描述文件后可常驻；Android 下拉快捷开关）。
- 验证：电脑跑 `tailscale ip -4`，应输出 `100.x.y.z`。

### 2. 桌面开启 LAN 闸门（必须先做）

桌面「设置 → 手机与推送」→ 左栏点**「启动」**。它会：

- 生成 `~/.pi/agent/lan-access.json`（0600，48 位十六进制令牌）；
- `bin/lan-supervisor.cjs` 盯到开关变化，自动把服务重启绑到 `0.0.0.0`。

> ⚠️ **不开闸门就暴露远程地址 = 裸奔**：令牌不存在时 `checkLanAccess()` 恒放行，
> 那个 URL 就是唯一的秘密。先开闸门，再谈远程。

### 3. 自检

```bash
npm run mobile:doctor
```

全部 ✔ 后它会打印 `手机上打开：http://100.x.y.z:30141/pair`。

### 4. 手机首次配对

- **在局域网内**（第一次最省事）：手机浏览器扫桌面「手机与推送」里的二维码，
  或直接打开 doctor 打印的地址——`/pair` 页面输 6 位码 → 自动种 cookie 回首页。
- **人已在网络外**：手机开着 Tailscale，直接打开 `http://100.x.y.z:30141/pair`，
  码在桌面设置页上看。

### 5. 验收清单（DoD）

- [ ] 手机**关 WiFi 用蜂窝**，打开 `http://100.x.y.z:30141/` 能进会话列表
- [ ] 浏览器/App **杀掉重开**，仍是已配对状态（cookie 持久，host-only 跟着 100.x 走）
- [ ] 电脑上跑一个 agent，手机能看到实时输出（SSE 通）
- [ ] **反向验证**：桌面点「停止」（或删 `lan-access.json`）后手机被拒——闸门真的在工作
- [ ] 重启电脑服务后**不需要重新配对**（地址没变，cookie 还在）

## 可选升级

| 想要 | 做法 |
|---|---|
| HTTPS（iOS 加主屏 PWA / Web Push） | `tailscale serve --bg 30141`，得到 `https://<机器>.<tailnet>.ts.net`，然后 `PI_WEB_ALLOWED_HOSTS=<该域名>` 放行（放行名单每次请求现读，改完不用重启服务） |
| 公网任意设备可达（手机不用装 Tailscale） | cloudflared **命名**隧道（要自己的域名 + Cloudflare 账号），域名加进 `PI_WEB_ALLOWED_HOSTS`。**不要用 quick tunnel**——随机域名重启就变，host-only cookie 全部失配 |
| 不想装任何东西就能收通知 | 已有的 IM 桥（设置 → 手机与推送右栏）：飞书/钉钉/Telegram/企微推送，跨网络天然可用 |

## 常见问题

- **`PI_WEB_HOSTNAME` 不要拿来放行域名**——它在 `bin/pi-web-options.js` 里是**绑定地址**，
  写域名会启动失败。放行只用 `PI_WEB_ALLOWED_HOSTS`。
- 手机连不上但 doctor 全绿：确认手机 Tailscale 在线（同一 tailnet）、桌面闸门开着、
  服务绑的是 0.0.0.0（`npm run mode:status` 或重启一次 `npm run prod`）。
- 换了令牌（设置里 rotate）：所有已配对设备失效，重新配对一次即可。
