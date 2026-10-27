# -*- coding: utf-8 -*-
"""设置家族第三批：手机与推送 / 归档与导入 / 记忆 / 联网搜索 / 图片生成。"""
from settings import (
    ICO, modal, section, card, row, sw, seg, btn, tag, mono, table, fill,
)


def note(text):
    return f'''            <div class="card" style="padding:10px 14px;display:flex;gap:8px;align-items:flex-start;background:var(--fill-1)">
              {ICO("info")}
              <span style="font-size:11px;line-height:1.65;color:var(--ink-2)">{text}</span>
            </div>'''


def qr(size=132):
    """二维码占位：真实编码走 lib/qrcode.ts，板上只画它的形状与尺寸。"""
    cells = []
    for r in range(21):
        for c in range(21):
            finder = (r < 7 and c < 7) or (r < 7 and c >= 14) or (r >= 14 and c < 7)
            if finder:
                rr = r if r < 7 else r - 14
                cc = c if c < 7 else c - 14
                on = rr in (0, 6) or cc in (0, 6) or (2 <= rr <= 4 and 2 <= cc <= 4)
            else:
                on = (r * 7 + c * 11 + (r * c) % 5) % 3 == 0
            if on:
                cells.append(
                    '<i style="grid-column:%d;grid-row:%d;background:#111"></i>' % (c + 1, r + 1)
                )
    return (
        f'<div style="width:{size}px;height:{size}px;padding:7px;border-radius:10px;background:#fff;'
        'box-shadow:inset 0 0 0 1px var(--line);display:grid;'
        'grid-template-columns:repeat(21,1fr);grid-template-rows:repeat(21,1fr)">'
        + "".join(cells)
        + "</div>"
    )


def mask(s):
    """密钥 / 令牌掩码：两端可见，中间恒定 12 个点。"""
    return f'<span class="mono" style="font-size:11px">{s[:4]}{"·" * 12}{s[-4:]}</span>'


# ---------------------------------------------------------------- 手机与推送

def phone_a():
    body = section("局域网访问", card(
        row("允许同一网络内的设备访问", "开启后，手机在同一 Wi-Fi 下打开下面的地址即可", sw(True), "wifi")
        + row("访问地址", '<span class="mono" style="font-size:11px">http://192.168.1.24:30141</span>', btn("复制", "btn--sm"), "globe")
        + row("状态", '<span class="tag"><span class="spin spin--mini" data-spin="mini"></span>已连接 · 2 台</span>', btn("刷新", "btn--sm"), "circle-dotted")
    )) + section("访问令牌", card(
        row("令牌", mask("pi_live_7f3a91c4e2b8"), '<div style="display:flex;gap:6px">' + btn("复制", "btn--sm") + btn("重新生成", "btn--sm") + '</div>', "key")
        + row("只读令牌", mask("pi_ro_2c8d41ab90fe"), btn("复制", "btn--sm"), "lock")
        + row("令牌有效期", "永久，除非手动重新生成", seg(["7 天", "30 天", "永久"], 2), "clock")
    )) + section("配对码", card(
        row("6 位配对码", "在手机上输入这 6 位，就能直接拿到令牌", '<span class="mono" style="font-size:19px;letter-spacing:.22em;font-weight:600">4 8 2 9 1 7</span>', "hash")
        + row("剩余有效期", "还有 4 分 12 秒，过期自动换一枚", btn("换一枚", "btn--sm"), "refresh")
    )) + note("开关是真的能点的：关掉 LAN 访问后，地址那一行立刻变成「未开启」，手机上的页面会掉线。")
    return modal("手机与推送", "手机与推送", "让手机通过同一网络访问这个工作区；也可以推到 IM 里。", body)


def phone_b():
    qr_card = f'''            <div class="card" style="padding:16px;display:flex;gap:18px;align-items:flex-start">
              {qr(132)}
              <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px">
                <div>
                  <div style="font-size:12px;font-weight:600">用手机相机扫一下</div>
                  <div style="margin-top:3px;font-size:11px;line-height:1.6;color:var(--ink-2)">
                    扫码会打开一个带令牌的地址，令牌只在这一枚二维码里有效。
                  </div>
                </div>
                <div style="display:flex;flex-direction:column;gap:5px;font-size:11px">
                  <div style="display:flex;gap:8px"><span style="width:56px;color:var(--ink-3)">地址</span><span class="mono">http://192.168.1.24:30141/?t=…</span></div>
                  <div style="display:flex;gap:8px"><span style="width:56px;color:var(--ink-3)">只读链接</span><span class="mono">http://192.168.1.24:30141/ro?t=…</span></div>
                  <div style="display:flex;gap:8px"><span style="width:56px;color:var(--ink-3)">有效期</span><span>4 分 12 秒（与配对码同一枚）</span></div>
                </div>
                <div style="display:flex;gap:6px;margin-top:2px">
                  {btn("复制地址", "btn--sm")}{btn("换一枚", "btn--sm")}{btn("只读二维码", "btn--sm")}
                </div>
              </div>
            </div>'''
    body = section("扫码配对", qr_card) + section("同一网络内的设备", card(
        row("iPhone · Safari", "刚刚访问 · 可读写", '<span class="tag">在线</span>', "smartphone")
        + row("iPad · Safari", "12 分钟前 · 只读", '<span class="tag">在线</span>', "tablet")
    )) + note("二维码是 lib/qrcode.ts 真编码出来的，板上只占位：形状与尺寸是最终值，内容不是。")
    return modal("手机与推送", "手机与推送", "扫一次就能连上，不用手动输地址和令牌。", body)


def phone_c():
    chans = [
        ("Telegram", "@pi_next_bot", "已连", "paper-plane"),
        ("企业微信", "机器人 · pi-notify", "已连", "message-circle"),
        ("飞书", "webhook · 8f2c…", "已连", "message-circle"),
        ("Slack", "webhook · T04…", "未连", "hash"),
        ("Discord", "webhook · 9a1…", "未连", "gamepad"),
        ("自定义 Webhook", "https://…", "未连", "globe"),
    ]
    rows = ""
    for name, target, state, icon in chans:
        badge = '<span class="tag">已连</span>' if state == "已连" else '<span class="tag" style="color:var(--ink-3)">未连</span>'
        ctrl = f'<div style="display:flex;gap:6px;align-items:center">{badge}{btn("测试", "btn--sm")}{btn("⋯", "btn--sm")}</div>'
        rows += row(f"{name}", mask(target) if len(target) > 16 else f'<span class="mono" style="font-size:11px">{target}</span>', ctrl, icon)
    body = section("推送目标", card(rows)) + section("加一个目标", card(
        row("渠道", "", seg(["Telegram", "企业微信", "飞书", "Webhook"], 0), "plus")
        + row("机器人令牌", '<span class="mono" style="font-size:11px">输入后自动掩码</span>', btn("粘贴", "btn--sm"), "key")
        + row("推什么", "需要你处理的（授权 / 提问 / 失败）· 不推日常进度", '<span class="switch is-on" role="switch"><i></i></span>', "bell")
    )) + note("掩码两端可见、中间恒定 12 个点：长度不泄露密钥长度。加目标与测试都是真接线。")
    return modal("手机与推送", "手机与推送", "六个渠道，全部掩码显示；点「测试」真的会发一条。", body)


def phone_d():
    def channel(name, icon, state, sub, action):
        tone = {"已连": "var(--success)", "未连": "var(--ink-4)", "扫码中": "var(--warning)"}[state]
        return f'''              <div class="card" style="padding:14px 16px;display:flex;gap:12px;align-items:flex-start">
                <span class="rowicon">{ICO(icon)}</span>
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-size:12.5px;font-weight:600">{name}</span>
                    <span style="display:inline-flex;align-items:center;gap:5px;font-size:10.5px;color:{tone}">
                      <i style="width:5px;height:5px;border-radius:50%;background:{tone}"></i>{state}
                    </span>
                  </div>
                  <div style="margin-top:4px;font-size:11px;line-height:1.6;color:var(--ink-2)">{sub}</div>
                  <div style="margin-top:8px">{action}</div>
                </div>
              </div>'''
    body = section("机器人渠道", f'''            <div style="display:flex;flex-direction:column;gap:10px">
{channel("Telegram", "paper-plane", "已连", "@pi_next_bot · 推到 私聊 · 最近一次 2 分钟前", btn("断开", "btn--sm") + " " + btn("发送测试", "btn--sm"))}
{channel("企业微信", "message-circle", "未连", "需要一个群机器人 webhook。在群里「添加机器人」拿到地址后粘贴进来。", btn("粘贴 webhook", "btn--sm"))}
{channel("飞书", "message-circle", "扫码中", "用飞书扫下面的码，30 秒内有效；扫完这里会自动变成「已连」。", '<span class="tag"><span class="spin spin--mini" data-spin="mini"></span>等待扫码 · 24s</span> ' + btn("取消", "btn--sm"))}
            </div>''') + note("三态各自的「下一步动作」写在行里：已连给断开与测试，未连给粘贴，扫码中给倒计时与取消。")
    return modal("手机与推送", "手机与推送", "三个机器人渠道，三种状态，下一步动作都在行里。", body)


# ---------------------------------------------------------------- 归档与导入

def archive_a():
    def srow(title, sub, size, checked=False):
        box = ('<span style="width:14px;height:14px;border-radius:4px;background:var(--accent);display:grid;place-items:center;color:#fff">'
               + ICO("check", "ic ic-xs") + '</span>') if checked else \
              '<span style="width:14px;height:14px;border-radius:4px;box-shadow:inset 0 0 0 1px var(--line);display:block"></span>'
        return f'''              <div class="crow" style="gap:10px">
                <div class="crow__control" style="width:auto">{box}</div>
                <div class="crow__text">
                  <div class="crow__title">{title}</div>
                  <div class="crow__detail">{sub}</div>
                </div>
                <div class="crow__control"><span class="mono" style="font-size:10.5px;color:var(--ink-3)">{size}</span></div>
              </div>
              <div class="cdivider"></div>'''
    batch = '''            <div class="card" style="padding:8px 12px;display:flex;align-items:center;gap:10px;background:var(--fill-2)">
              <span style="font-size:11px">已选 <b>3</b> 个会话 · 合计 42.8 MB</span>
              <span style="flex:1"></span>
              <button class="btn btn--sm">导出 .jsonl</button>
              <button class="btn btn--sm">压缩归档</button>
              <button class="btn btn--sm" style="color:var(--danger)">删除…</button>
            </div>'''
    body = section("归档会话", batch + card(
        srow("重做工作区外壳", "今天 09:12 · 14 条消息", "1.2 MB", True)
        + srow("令牌只写一次：running.css", "昨天 22:40 · 41 条消息", "8.4 MB", True)
        + srow("V5 落地清单跑到第几批了", "昨天 18:03 · 12 条消息", "3.1 MB", True)
        + srow("文件面板的 diff 视图", "10 月 21 日 · 23 条消息", "30.1 MB", False)
    )) + section("两种空态（并排）", f'''            <div style="display:flex;gap:12px">
              <div class="card" style="flex:1;padding:22px 16px;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center">
                {ICO("archive", "ic ic-lg")}
                <div style="font-size:12px;font-weight:600;margin-top:2px">还没有归档的会话</div>
                <div style="font-size:11px;line-height:1.6;color:var(--ink-2)">归档不是删除：它只是从侧栏挪到这里，随时能取回。</div>
              </div>
              <div class="card" style="flex:1;padding:22px 16px;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center">
                {ICO("search", "ic ic-lg")}
                <div style="font-size:12px;font-weight:600;margin-top:2px">没有匹配「设计稿」的归档</div>
                <div style="font-size:11px;line-height:1.6;color:var(--ink-2)">搜的是标题与首条消息，不搜正文。清空搜索看全部。</div>
                <button class="btn btn--sm" style="margin-top:4px">清空搜索</button>
              </div>
            </div>''') + note("点会话行可多选；批量操作条只在有选中时出现，没选中时不占高度。")
    return modal("归档与导入", "归档与导入", "归档是「挪走」不是「删掉」；导入是两段式，先看再落。", body)


def archive_b():
    body = section("导入 · 第一步：扫描", card(
        row("来源", '<span class="mono" style="font-size:11px">~/Downloads/pi-export-2026-10-18.jsonl</span>', btn("选择文件", "btn--sm"), "file")
        + row("扫描结果", "18 个会话 · 6 个项目 · 合计 214.6 MB", '<span class="tag">已完成</span>', "search")
        + row("冲突策略", "同名会话已存在时怎么处理", seg(["跳过", "覆盖", "另存为副本"], 2), "git-fork")
    )) + section("第二步：勾选", card(
        row("pi-web · 6 个会话", "最近 30 天，全部选中", '<span style="font-size:11px;color:var(--ink-3)">6 / 6</span>', "folder-fill")
        + row("tivano · 8 个会话", "其中 2 个与本地同名，按策略「另存为副本」", '<span style="font-size:11px;color:var(--ink-3)">8 / 8</span>', "folder-fill")
        + row("pi-web-design · 4 个会话", "3 个与本地同名", '<span style="font-size:11px;color:var(--ink-3)">1 / 4</span>', "folder-fill")
    )) + section("试运行结果", card(
        row("将新建", "17 个会话", '<span class="add" style="font-size:11px">+17</span>', "plus")
        + row("将另存为副本", "3 个会话（同名冲突）", '<span style="font-size:11px;color:var(--ink-2)">3</span>', "copy")
        + row("将跳过", "0 个", '<span style="font-size:11px;color:var(--ink-3)">0</span>', "circle-minus")
    ) + '<div style="display:flex;gap:8px;padding:10px 2px 0"><button class="btn btn--sm">重新试运行</button><button class="btn btn--sm" style="background:var(--accent);color:var(--on-accent)">写入 20 个会话</button></div>') \
        + note("两段式：/api/import/scan 只读不写，/api/import/apply 才落盘。试运行与落盘用同一份清单，不会两次结果不一样。")
    return modal("归档与导入", "归档与导入", "先扫一遍、勾选、试运行，确认后才落盘。", body)


def archive_c():
    groups = [
        ("会话", [("新建会话", "⌘N", "已接入"), ("搜索会话", "⌘K", "已接入"),
                ("归档当前会话", "⌘⇧A", "已接入"), ("导出当前会话", "⌘⇧E", "已接入")]),
        ("视图", [("切换侧栏", "⌘B", "已接入"), ("切换右栏", "⌘⇧B", "已接入"),
                ("命令面板", "⌘⇧P", "已接入")]),
        ("输入", [("发送", "↵", "已接入"), ("换行", "⇧↵", "已接入"),
                ("附加文件", "⌘⇧O", "未接入")]),
        ("其它", [("设置", "⌘,", "已接入"), ("快捷键地图", "⌘/", "已接入")]),
    ]

    def cell(name, items):
        rows = []
        for label, key, state in items:
            tail = "" if state == "已接入" else '<span class="tag" style="color:var(--ink-3)">' + state + "</span>"
            rows.append(
                '<div style="display:flex;align-items:center;gap:8px;height:26px;font-size:11.5px">'
                + label + '<span style="flex:1"></span><span class="kbd" style="font-size:10px">'
                + key + "</span>" + tail + "</div>"
            )
        return ('<div class="card" style="padding:10px 14px">'
                '<div style="font-size:10.5px;color:var(--ink-3);margin-bottom:4px">' + name + "</div>"
                + "".join(rows) + "</div>")

    grid = "".join(cell(g, items) for g, items in groups)
    body = section("快捷键地图（只读）", f'''            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">{grid}</div>''') \
        + note("可编辑键位表已下线：这里只展示、改不了。未接入的行显式标注状态，不留空白让人猜。")
    return modal("快捷键", "快捷键", "只读地图：4 组 13 条命令，平台键帽自动换成 ⌘ / Ctrl。", body, width=980)


def archive_d():
    body = section("记忆与知识（产品已下线）", f'''            <div class="card" style="padding:12px 14px;display:flex;gap:10px;align-items:flex-start;background:var(--fill-1)">
              {ICO("circle-alert")}
              <div style="flex:1">
                <div style="font-size:11.5px;font-weight:600">这一页是提案，产品里没有</div>
                <div style="margin-top:3px;font-size:11px;line-height:1.65;color:var(--ink-2)">
                  `lib/knowledge-*` 与 `/api/knowledge-maintenance` 已删除。若恢复，按这一页画：条目能选、开机能点、预览写清「下一轮会带什么」。
                </div>
              </div>
            </div>''') + section("条目", card(
        row("项目约定", "12 条 · 最近更新 3 天前", '<span class="switch is-on" role="switch"><i></i></span>', "book-open")
        + row("个人偏好", "8 条 · 最近更新 昨天", '<span class="switch is-on" role="switch"><i></i></span>', "user")
        + row("这段代码的来龙去脉", "34 条 · 未开机", '<span class="switch" role="switch"><i></i></span>', "code")
    )) + section("下一轮会带什么（预览）", card(
        row("系统提示词追加", "约 412 字符 · 2 条约定 + 1 条偏好", btn("展开", "btn--sm"), "doc-text")
        + row("检索命中", "3 条与「右栏宽度」相关", btn("展开", "btn--sm"), "search")
    )) + note("预览必须写清「下一轮会带什么」：不写清，用户就没法判断该不该开。")
    return modal("记忆", "记忆", "已装未开的状态下，文档仍可编辑，只是不参与下一轮。", body)


# ---------------------------------------------------------------- 记忆 / 联网 / 图片

def memory_a():
    body = section("记忆", f'''            <div class="card" style="padding:12px 14px;display:flex;gap:12px;align-items:flex-start">
              <span class="rowicon">{ICO("book-open")}</span>
              <div style="flex:1">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:12.5px;font-weight:600">记忆</span>
                  <span class="tag" style="color:var(--ink-3)">已装未开</span>
                  <span style="flex:1"></span>
                  <span class="switch" role="switch" aria-checked="false"><i></i></span>
                </div>
                <div style="margin-top:4px;font-size:11px;line-height:1.6;color:var(--ink-2)">
                  关着的时候，下面的文档仍然能编辑，只是下一轮不会带进上下文。
                </div>
              </div>
            </div>''') + section("文档", card(
        row("AGENTS.md", "项目约定 · 4.2 KB · 3 天前改过", '<button class="btn btn--sm">编辑</button>', "doc-text")
        + row("MEMORY.md", "长期笔记 · 1.1 KB · 昨天改过", '<button class="btn btn--sm">编辑</button>', "doc-text")
        + row("2026-10-25.md", "今天的工作日志 · 6.8 KB", '<button class="btn btn--sm">编辑</button>', "doc-text")
    )) + note("开关在页头，文档列表在下面：一个开关管全局，每条文档点开就能改。")
    return modal("记忆", "记忆", "已装未开：装上了但没启用，文档仍可编辑。", body)


def websearch_a():
    body = section("联网搜索", card(
        row("启用联网搜索", "模型可以主动搜网页；关掉时只能靠上下文", '<span class="switch is-on" role="switch"><i></i></span>', "globe")
        + row("主 provider", "默认走它，失败时按下面的顺序兜底", seg(["Bing", "Google", "Brave", "自定义"], 0), "circle-dotted")
        + row("兜底顺序", '<span class="mono" style="font-size:11px">Bing → Google → Brave</span>', '<button class="btn btn--sm">调整</button>', "list-tree")
    )) + section("Bing", card(
        row("密钥", mask("bing_9f2c71ab4e"), '<div style="display:flex;gap:6px"><button class="btn btn--sm">测试</button><button class="btn btn--sm">重新输入</button></div>', "key")
        + row("每次结果数", "越多越慢，10 条是默认值", seg(["5", "10", "20"], 1), "list")
        + row("安全搜索", "", seg(["严格", "中等", "关"], 1), "shield-check")
        + row("引用格式", "回答里带来源，链接可点", seg(["脚注", "行内链接"], 1), "doc-text")
    )) + note("改完立刻生效，不用重载会话：下一次工具调用就用新配置。")
    return modal("联网搜索", "联网搜索", "已开启，主 provider 是 Bing。改完立刻生效。", body)


def imagegen_a():
    presets = [
        ("Agnes（国内）", "已选", "https://api.agnes.cn/v1 · gpt-image-1", True),
        ("Agnes（国际）", "", "https://api.agnes.ai/v1 · gpt-image-1", False),
        ("火山方舟", "", "https://ark.cn-beijing.volces.com/api/v3 · doubao-seedream", False),
        ("Google AI Studio", "", "https://generativelanguage.googleapis.com · imagen-3", False),
        ("OpenAI", "", "https://api.openai.com/v1 · gpt-image-1", False),
        ("自定义", "", "自己填端点与模型名", False),
    ]
    rows = ""
    for name, state, ep, on in presets:
        badge = '<span class="tag" style="background:var(--accent-soft);color:var(--accent-ink)">已选</span>' if on else ""
        ctrl = f'<div style="display:flex;gap:6px;align-items:center">{badge}<button class="btn btn--sm">{"编辑" if on else "使用"}</button></div>'
        rows += row(f"{name}", f'<span class="mono" style="font-size:10.5px">{ep}</span>', ctrl,
                    "check" if on else "circle")
    body = section("预设档", card(rows)) + section("当前档 · Agnes（国内）", card(
        row("端点", '<span class="mono" style="font-size:11px">https://api.agnes.cn/v1</span>', '<button class="btn btn--sm">改</button>', "globe")
        + row("模型", '<span class="mono" style="font-size:11px">gpt-image-1</span>', '<button class="btn btn--sm">改</button>', "circle-dotted")
        + row("密钥", mask("sk_agnes_7c41d9"), '<div style="display:flex;gap:6px"><button class="btn btn--sm">测试</button><button class="btn btn--sm">替换</button></div>', "key")
        + row("默认尺寸", "", seg(["1024²", "1536×1024", "1024×1536"], 0), "size")
    )) + note("端点与模型照参考项目预填：选一档就能用，只有密钥要自己填。")
    return modal("模型", "图片生成", "预设六档，端点与模型预填，密钥掩码存取。", body)


FRAMES = {
    "web-settings-phone-push": [("A", phone_a), ("B", phone_b), ("C", phone_c), ("D", phone_d)],
    "web-settings-archive-import": [("A", archive_a), ("B", archive_b), ("C", archive_c), ("D", archive_d)],
    "web-settings-memory": [("A", memory_a)],
    "web-settings-websearch": [("A", websearch_a)],
    "web-settings-imagegen": [("A", imagegen_a)],
}
