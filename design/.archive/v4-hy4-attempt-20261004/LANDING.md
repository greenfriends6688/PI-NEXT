# 落地契约 · LANDING.md（v4）

> **这份文档是「设计 → 代码」的唯一通道。常驻，不随任何一次改版作废。**
> 用户说「**按 v4 设计落地**」→ 从这里开始，不需要再说第二遍。

---

## 0 · 三次失败，一条正道（根因档案，别再犯）

1. **两套 DOM**：画板一套类名、产品一套，靠桥接映射 → `fork-ui.css` 写
   `.fork-msg-actions`、组件渲染 `.pw-msg-acts`，规则**静默失效**，消息动作行永久透明。
2. **加类不换 DOM**：类名相同 ≠ 结构相同（`.pw-step` 假设了父结构）。
3. **两套令牌**：`--n-*` 与 `--ds-*` 同时进运行时，无人校验同值 → 「改一处只对一半」。

**正道：画板 DOM 即产品 DOM；角色令牌只有一个来源；产品运行时只挂一套形态。**

---

## 1 · 四条铁律

### 铁律一：禁止截图模仿 —— 只抄 DOM 原文
打开定义该组件的画板 HTML，**原样复制**那段 DOM（类名/层级/`data-ico`/状态类一字不动）。
产品只改两处：静态文本 → 真实数据；静态元素 → 可交互元素（`div`→`button` 保留原类名，UA 归零在接线层）。
验收看 **structdiff**（DOM 签名逐节点 diff）+ **几何对数**（getBoundingClientRect / getComputedStyle 对数），**不看截图**。

### 铁律二：`base.css` 是角色令牌唯一出处；`{web,pwa}/system.css` 是各自类名唯一出处
- 新增 `d-` / `m-` 类必须先进对应 `system.css`，且必须有一帧画板在用；
- 产品 CSS（`app/*.css`）**不许**另起同名 `d-`/`m-` 类；
- 双向可查：画板用到的类必须已定义；定义了没人用的类记进 §8 台账。

### 铁律三：产品运行时 = `base.css` + **一套**形态
- 绝不同时加载 `web/` 与 `pwa/`。两套类名刻意不同名（`d-side` vs `m-drawer`）。
- **深色主题不需要第二套 CSS**：产品在 `<html>` 切 `data-theme="dark"`，变量板整体翻转。
  组件**禁止**为深色单写规则（system.css 里仅有的例外已注释标明）。

### 铁律四：画板帧不许用内联样式画设计几何
颜色/字号/间距/圆角/时长必须取自 `base.css` 或本形态 `tokens.css` 的 `var()`。
（例外：取景框视口尺寸、1px 发丝边。`check-v4.mjs` 拦截字面量。）

---

## 2 · 落地四步法（每个组件都走这四步）

1. **抄 DOM 原文**：从画板 HTML 原样复制片段。
2. **接数据与事件**：产品布尔 → 画板状态类（`.is-on` / `.is-open` / `.on` / `.running`）；
   事件不进 CSS；浮窗一律考虑裁切与翻转（宿主链 overflow 或 portal + fixed；下方放不下才 `.up`）。
3. **产品侧 CSS 纪律**：画板值一个不重复写；接线层只做 UA 归零 + cursor + 窄屏语义；
   覆盖用 0-2-0 双类选择器并注释原因；改完顺手删 stale 规则。
4. **验收六件套**：
   ① `tsc --noEmit` / `npm run lint` / `npm test` 全绿（守卫测试断言新结构）；
   ② structdiff 组件级 0 偏差；③ 几何对数（1440×900 + 390×844）；
   ④ 浮窗裁切审计 0 处；⑤ `node design/v4/scripts/check-v4.mjs` 退出码 0；
   ⑥ 改色跑对比度校验，截图存 `docs/screenshots/`。

---

## 3 · 触发口令（用户一句话 → 执行什么）

| 用户说 | 执行 |
|---|---|
| **「按 v4 设计落地」/「启动改版 v4」** | 跑 `check-v4.mjs` + 读 `README.md §3` 拿清单 → 按 D-02→D-40、M-02→M-18 顺序逐项走四步法 → 每项更新 README 状态列 → 全部归零后跑六件套 |
| 「只落地 D-23」 | 只做该项，同样四步法 + 六件套 |
| 「画板改了，同步产品」 | `check-v4.mjs` 找受影响组件 → 逐项 structdiff → 只改有偏差的 |
| 「设计检查」 | `check-v4.mjs` + 浏览器自检，只报告不修改 |
| 「新增画板 XX」 | 编号未占用 → 只用已有类（要新类先进 system.css）→ 加进 README §3 → 跑校验 |
| 「出对应 PWA 页」 | 同上，但前缀/令牌/控件高度是另一套，**不许混用** |

**硬性动作顺序**：读 LANDING → 读 README §3 清单 → 逐项四步法 → 更新状态列 → 提交。

---

## 4 · 陷阱清单（每条都真实翻过）

| 陷阱 | 事故 | 对策 |
|---|---|---|
| demo.js 在 `<head>` 引入 | body 未解析，全部 handler 绑空集合，**交互全灭且无报错** | 引擎已自带 DOMContentLoaded 调度（2026-10-04 修）；画板仍应把 `<script src="../../assets/demo.js">` 放 body 末尾 |
| 画板资源相对路径差一级 | `../../pi-web-design/...` 从 boards/ 出发落到 `v4/pi-web-design/`，404 静默 | 正确写法：`../../../pi-web-design/assets/icons.js` 与 `../../assets/demo.js` |
| `.d-shell` 写 `100vh` | 900px 取景框里按视口撑高，底栏被裁 | 壳高用 `100%`，让 frame 控制 |
| 浮层宿主 `overflow:hidden` | 向上弹的菜单被整张裁掉 | 浮层宿主竖向 `overflow-y: visible` 或 portal |
| `min-width:0` 链 | 模型芯片被压瘪成「D…」 | 芯片 `flex:0 0 auto`，放不下走折叠形态 |
| 折叠判据用视口断点 | 开右栏后聊天列变窄但断点不感知 | 视口断点 **或** ResizeObserver 实测 |
| scope 挂在页签条自己身上 | pane 找不到，切换静默失效 | scope 挂共同祖先；check-v4 有静态拦截 |
| dev/prod 共用 `.next` | `Module factory is not available` 假故障 | 只走 `npm run dev:clean` / `npm run prod` |
| 截图模仿 | 全部历史错位的根因 | 铁律一 |

---

## 5 · 工具速查

| 命令 | 判定 |
|---|---|
| `node design/v4/scripts/check-v4.mjs` | 静态校验，退出码 0 |
| `NO_PROXY=127.0.0.1,localhost node .scratch/v4-all.mjs` | 浏览器逐张真点（画板齐后生成） |
| `npx tsc --noEmit` · `npm run lint` · `npm test` | 全绿 |
| `npm run check:design` | 产品侧守卫 |

---

## 6 · 裁定索引（已定，不再重议）

- 本产品没有登录体系；主题只有 light / dark / auto（v4 落地后 auto = 跟系统切 `data-theme`）。
- 用量与上下文占用收进上下文环浮窗，输入框下方无第二条常驻横条。
- 会话分支（git-fork）≠ Git 分支（git-branch）。
- 色相总数 ≤ 5（中性 + 强调 + 4 语义）；强调色唯一 `#5566d8`；图标一律 lucide，零 emoji。
- 目录选择器系统原生优先；PWA 是独立形态（渐隐顶栏、大曲率、44px 命中），不是断点换算。
- Web 40 + PWA 18 + 跨端 4 = 62 张为 v4 全量；数量再增走「新增画板」流程。

---

## 7 · 新画板检查单

- [ ] 编号未占用（D-01…D-40 / M-01…M-18 / X-01…），已加进 README §3
- [ ] 头部：编号、名称、一句话说明、三个标签；末尾：「这一张在定什么」
- [ ] 所有设计值取自 `base.css` / 本形态 `tokens.css`
- [ ] 类全部已定义（base + 本形态 system.css）；新类先补 system.css
- [ ] 图标 `data-ico` 且在库；零 emoji
- [ ] 无内联设计几何；`data-demo-*` 已接且真点过；**脚本引用路径正确**（§4 前两条）
- [ ] `check-v4.mjs` 退出码 0；文案真实（产品 i18n 原文可用）

---

## 8 · 落地台账（定义未用 / 待清理）

| 类 | 所在 | 处置 |
|---|---|---|
| `.d-slotstrip` / `.d-slotoverlay` | web/system.css | 留给 D-38/D-39，暂无画板用 |
| `.m-skel-50` / `.m-pickhl` / `.m-viewbox-sel` | pwa/system.css | 留给 M-11/M-15 |
| `.d-err` / `.d-stat` | web/system.css | D-33/D-40 使用中 |
