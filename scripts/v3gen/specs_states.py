# -*- coding: utf-8 -*-
"""最后六板：welcome / dialogs-states / system-states / motion×2 / keyboard-focus。"""
from transcript import ICO, bubble, grp, prose, steps, step, stat, filecard, out, tag, add, dele
import shell

TICKS = [("右栏现在默认是开的", "有点挤。"), ("先读一下现在的外壳", "别急着改。")]


def _win(detail, ticks=None, chrome_html=None):
    body = (shell.rail(ticks or TICKS) + "\n") + detail
    return shell.win(body, chrome_html=chrome_html)


def _scrim(inner):
    return f'<div class="modal-scrim" style="z-index:55"></div>\n{inner}'


def modal_card(title, body, acts, w=420, danger=False, icon=None):
    ic = ICO(icon) if icon else ""
    return f'''<div class="settings-modal" style="width:{w}px;height:auto;z-index:60;left:50%;top:44%">
  <div style="padding:18px 20px 16px">
    <div style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600">{ic}{title}</div>
    <div style="margin-top:8px;font-size:11.5px;line-height:1.7;color:var(--ink-2)">{body}</div>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">{acts}</div>
  </div>
</div>'''


def _thread_short():
    return "\n".join([
        bubble("把右栏的默认收起也一起改了。"),
        grp("用时 1m 18s", closed=True),
        steps(step("pencil", "编辑", "components/AppShell.tsx", stat=stat(12, 4), last=True, d=0.02)),
    ])


# ---------------------------------------------------------------- 引导


def welcome_a():
    steps6 = "".join(
        f'''<div style="display:flex;align-items:center;gap:8px;font-size:11px;{"color:var(--ink)" if i < 2 else "color:var(--ink-4)"}">
  <span style="width:16px;height:16px;border-radius:50%;display:grid;place-items:center;font-size:9px;background:{"var(--accent)" if i == 1 else "var(--fill-2)"};color:{"var(--on-accent)" if i == 1 else "var(--ink-3)"}">{i + 1}</span>{t}</div>'''
        for i, t in enumerate(["欢迎", "选工作区", "配模型", "工具档", "连手机", "完成"]))
    body = f'''<div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:0 40px;gap:28px">
  <div style="width:150px;flex:none;display:flex;flex-direction:column;gap:10px">
    {steps6}
  </div>
  <div class="card" style="width:480px;padding:22px 24px">
    <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--ink-3)">
      <span>第 2 步 / 6</span><span style="flex:1"></span><span>左边这条是全程</span>
    </div>
    <div style="margin-top:10px;font-size:17px;font-weight:600;letter-spacing:-.015em">选一个工作区</div>
    <div style="margin-top:4px;font-size:11.5px;line-height:1.7;color:var(--ink-2)">pi 在这个目录里读写文件、跑命令。之后随时能换。</div>
    <div style="margin-top:14px;display:flex;flex-direction:column;gap:8px">
      <button class="srow is-sel" style="height:46px;padding:8px 10px"><span class="srow__badge">{ICO("folder-fill", "ic ic-sm")}</span>
        <span class="srow__title">pi-web<span style="display:block;font-size:10.5px;font-weight:400;color:var(--ink-3)">~/Desktop/pi-web · 6 个会话</span></span>{ICO("check", "ic ic-sm")}</button>
      <button class="srow" style="height:46px;padding:8px 10px"><span class="srow__badge">{ICO("folder-fill", "ic ic-sm")}</span>
        <span class="srow__title">tivano<span style="display:block;font-size:10.5px;font-weight:400;color:var(--ink-3)">~/Desktop/tivano · 2 个会话</span></span></button>
      <button class="srow" style="height:46px;padding:8px 10px"><span class="srow__badge">{ICO("plus", "ic ic-sm")}</span>
        <span class="srow__title">选一个别的目录…</span></button>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn" style="flex:1;justify-content:center">上一步</button>
      <button class="btn" style="flex:1;justify-content:center;background:var(--accent);color:var(--on-accent)">下一步</button>
    </div>
  </div>
</div>'''
    return _win(body)


def welcome_b():
    body = f'''<div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:0 40px">
  <div class="card" style="width:520px;padding:22px 24px">
    <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--ink-3)">
      <span>第 3 步 / 6</span><span style="flex:1"></span><span>可以跳过，之后在设置里改</span>
    </div>
    <div style="margin-top:10px;font-size:17px;font-weight:600;letter-spacing:-.015em">配一个模型</div>
    <div style="margin-top:4px;font-size:11.5px;line-height:1.7;color:var(--ink-2)">Key 只落本机（<code class="mono">~/.pi/config.json</code>），不上传、不进日志。</div>

    <div style="margin-top:14px;display:flex;flex-direction:column;gap:8px">
      <button class="srow is-sel" style="height:44px;padding:8px 10px"><span class="srow__badge"><img src="../assets/providers/claude.svg" alt="" style="width:14px"></span>
        <span class="srow__title">Claude<span style="display:block;font-size:10.5px;font-weight:400;color:var(--ink-3)">Sonnet 4.6 · 已检测到环境变量</span></span>{ICO("check", "ic ic-sm")}</button>
      <button class="srow" style="height:44px;padding:8px 10px"><span class="srow__badge">{ICO("key", "ic ic-sm")}</span>
        <span class="srow__title">OpenAI<span style="display:block;font-size:10.5px;font-weight:400;color:var(--ink-3)">填 API Key</span></span></button>
      <button class="srow" style="height:44px;padding:8px 10px"><span class="srow__badge">{ICO("terminal", "ic ic-sm")}</span>
        <span class="srow__title">本地模型<span style="display:block;font-size:10.5px;font-weight:400;color:var(--ink-3)">Ollama / LM Studio</span></span></button>
    </div>

    <div style="margin-top:14px;padding:12px 14px;border-radius:12px;background:var(--fill-1)">
      <div style="font-size:11px;font-weight:600">第 4 步 · 默认工具档</div>
      <div style="margin-top:6px;display:flex;gap:6px">
        <span class="tag" style="height:26px;flex:1;justify-content:center;background:var(--accent-soft);color:var(--accent-ink)">只读</span>
        <span class="tag" style="height:26px;flex:1;justify-content:center">受监督</span>
        <span class="tag" style="height:26px;flex:1;justify-content:center">全放开</span>
      </div>
      <div style="margin-top:6px;font-size:10.5px;color:var(--ink-3)">先给安全的那一档：只读能跑起来，要写文件再放宽。</div>
    </div>

    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn" style="flex:1;justify-content:center">上一步</button>
      <button class="btn" style="flex:1;justify-content:center;background:var(--accent);color:var(--on-accent)">下一步</button>
    </div>
  </div>
</div>'''
    return _win(body)


def welcome_c():
    body = f'''<div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:0 40px">
  <div class="card" style="width:520px;padding:22px 24px">
    <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--ink-3)">
      <span>第 5 步 / 6</span><span style="flex:1"></span><span>失败也不拦你</span>
    </div>
    <div style="margin-top:10px;font-size:17px;font-weight:600;letter-spacing:-.015em">手机也能用</div>
    <div style="margin-top:4px;font-size:11.5px;line-height:1.7;color:var(--ink-2)">扫一下就能连上，不用输地址和令牌。</div>

    <div style="margin-top:14px;display:flex;gap:16px;align-items:flex-start">
      <div style="width:120px;height:120px;border-radius:12px;background:var(--fill-1);box-shadow:inset 0 0 0 1px var(--line);display:grid;place-items:center">
        {ICO("smartphone", "ic ic-lg")}
      </div>
      <div style="flex:1;font-size:11px;line-height:1.9;color:var(--ink-2)">
        <div><span style="color:var(--ink-3)">地址</span> <span class="mono">http://192.168.1.24:30141</span></div>
        <div><span style="color:var(--ink-3)">配对码</span> <span class="mono" style="letter-spacing:.2em">4 8 2 9 1 7</span></div>
        <div><span style="color:var(--ink-3)">有效期</span> 4 分 12 秒</div>
      </div>
    </div>

    <div class="retry" style="margin-top:14px">{ICO("circle-alert")}<span style="flex:1">没连上？不影响继续用桌面端。</span><span class="retry__meta">跳过</span></div>

    <div style="margin-top:14px;padding:12px 14px;border-radius:12px;background:var(--fill-1);display:flex;gap:8px;align-items:center">
      {ICO("check-circle")}
      <span style="font-size:11px;color:var(--ink-2)">第 6 步 · 完成：三步都做完了，直接进工作台。</span>
    </div>

    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn" style="flex:1;justify-content:center">上一步</button>
      <button class="btn" style="flex:1;justify-content:center;background:var(--accent);color:var(--on-accent)">开始用</button>
    </div>
  </div>
</div>'''
    return _win(body)


def welcome_d():
    rows = [
        ("把这一轮改动写成 changelog", "参数：范围 / 语言", "跑过 12 次"),
        ("跑 typecheck 再修", "参数：目录", "跑过 8 次"),
        ("审一遍当前 diff", "无参数", "跑过 3 次"),
    ]
    items = "".join(
        f'''<button class="srow" style="height:48px;padding:8px 10px">
  <span class="srow__badge">{ICO("play", "ic ic-sm")}</span>
  <span class="srow__title">{t}<span style="display:block;font-size:10.5px;font-weight:400;color:var(--ink-3)">{s}</span></span>
  <span class="srow__trail">{n}</span></button>''' for t, s, n in rows)
    body = f'''<div style="flex:1;min-height:0;display:flex;padding:84px 24px 20px;gap:20px">
  <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:12px">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:13px;font-weight:600">保存的工作流</span>
      <span class="tag">按项目分组</span>
      <span style="flex:1"></span>
      <span class="tag" style="background:var(--accent-soft);color:var(--accent-ink)">PI NEXT</span>
      <span class="tag">全局</span>
    </div>
    <div class="card" style="padding:8px">{items}</div>
    <div style="font-size:10.5px;line-height:1.7;color:var(--ink-3)">带参启动 → 表单；跑过之后 → 运行历史；想看它怎么写的 → 定义。三个页签，一份东西。</div>
  </div>
  <div style="width:360px;flex:none;display:flex;flex-direction:column;gap:10px">
    <div class="card" style="padding:14px 16px">
      <div style="font-size:11px;color:var(--ink-3)">启动表单 · 把这一轮改动写成 changelog</div>
      <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px">
        <label class="field" style="flex:none">{ICO("list")}<input value="design/v3" aria-label="范围"></label>
        <label class="field" style="flex:none">{ICO("globe")}<input value="中文" aria-label="语言"></label>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn--sm">看定义</button>
        <button class="btn btn--sm" style="margin-left:auto;background:var(--accent);color:var(--on-accent)">运行</button>
      </div>
    </div>
    <div class="card" style="padding:14px 16px">
      <div style="font-size:11px;color:var(--ink-3)">运行历史</div>
      <div style="margin-top:6px;font-size:11px;line-height:1.9;color:var(--ink-2)">
        <div>今天 14:02 · 成功 · 42s</div>
        <div>昨天 22:40 · 成功 · 51s</div>
        <div>10-23 09:12 · 失败 · 退出码 2</div>
      </div>
    </div>
  </div>
</div>'''
    return _win(body)


# ---------------------------------------------------------------- 弹窗与状态

def dlg_a():
    m = modal_card("删除「V5 落地清单跑到第几批了」？",
                   "这条会话的 12 条消息会一起删掉，<b>不能撤销</b>。同一分支下的子代理会话也会一起删。",
                   '<button class="btn">取消</button><button class="btn btn--danger" style="background:var(--danger);color:#fff">删除</button>',
                   danger=True, icon="trash-2")
    return _win(shell.thread(_thread_short()) + "\n" + _scrim(m) + "\n" + shell.composer())


def dlg_b():
    left = modal_card("归档这个会话？",
                      "归档不是删除：它从侧栏挪到「已归档」，随时能取回。默认动作是归档。",
                      '<button class="btn">取消</button><button class="btn" style="background:var(--accent);color:var(--on-accent)">归档</button>',
                      w=380, icon="archive")
    wait = '''<div class="settings-modal" style="width:360px;height:auto;z-index:60;left:50%;top:68%">
  <div style="padding:18px 20px 16px">
    <div style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600">
      <span class="spin spin--sm" data-spin="grid"></span>正在归档…
    </div>
    <div style="margin-top:8px;font-size:11.5px;line-height:1.7;color:var(--ink-2)">这条会话有 41 条消息，大约 3 秒。等待态不给「取消」，只给「后台跑」。</div>
    <div class="bar" style="margin-top:12px"><i style="width:62%"></i></div>
    <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
      <button class="btn">后台跑</button>
    </div>
  </div>
</div>'''
    return _win(shell.thread(_thread_short()) + "\n" + _scrim(left) + "\n" + wait + "\n" + shell.composer())


def dlg_c():
    toast = f'''<div style="position:absolute;left:50%;bottom:96px;transform:translateX(-50%);z-index:40;display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:999px;background:color-mix(in srgb,var(--ink) 90%,transparent);color:#fff;font-size:11.5px;box-shadow:0 16px 32px -20px rgba(0,0,0,.6)">
  {ICO("check")}已复制路径 · components/AppShell.tsx
</div>'''
    banner = f'''<div style="position:absolute;left:20px;right:20px;top:72px;z-index:35;display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--warning) 12%,var(--surface));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--warning) 28%,transparent);font-size:11.5px">
  {ICO("hand-raised")}<span style="flex:1">MCP 服务器 filesystem 掉线了，点开重连</span>
  <button class="btn btn--sm">重连</button>
</div>'''
    note = '''<div style="position:absolute;left:20px;right:20px;bottom:150px;z-index:30;font-size:10.5px;line-height:1.7;color:var(--ink-3)">
  Toast 只报「已经发生的事」，没有按钮、不提问；横幅承载「要你现在做点什么」，可以带行动。
</div>'''
    return _win(shell.thread(_thread_short()) + "\n" + banner + "\n" + toast + "\n" + note + "\n" + shell.composer())


def dlg_d():
    def cell(title, body, kind):
        inner = {
            "empty": f'<div class="empty-state" style="padding:18px 12px"><div class="empty-state__icon">{ICO("folder-fill")}</div>'
                     f'<div style="font-size:12px;font-weight:600;margin-top:6px">这个目录还没有文件</div>'
                     f'<div style="font-size:10.5px;color:var(--ink-3);margin-top:3px">拖一个进来，或新建一个</div>'
                     f'<div class="empty-state__actions"><button class="btn btn--sm">新建文件</button></div></div>',
            "skeleton": '<div class="skeleton" style="padding:14px 12px"><i></i><i></i><i style="width:52%"></i>'
                        '<div style="margin-top:8px;font-size:10px;color:var(--ink-3)">正在读 1 284 行…</div></div>',
            "error": f'<div class="empty-state" style="padding:18px 12px"><div class="empty-state__icon">{ICO("circle-alert")}</div>'
                     f'<div style="font-size:12px;font-weight:600;margin-top:6px">读不出来</div>'
                     f'<div style="font-size:10.5px;color:var(--ink-3);margin-top:3px">文件被外部进程占用（EBUSY）</div>'
                     f'<div class="empty-state__actions"><button class="btn btn--sm">重试</button></div></div>',
            "trust": f'<div class="empty-state" style="padding:18px 12px"><div class="empty-state__icon">{ICO("shield")}</div>'
                     f'<div style="font-size:12px;font-weight:600;margin-top:6px">这个目录还没信任</div>'
                     f'<div style="font-size:10.5px;color:var(--ink-3);margin-top:3px">信任后 pi 才能读写</div>'
                     f'<div class="empty-state__actions"><button class="btn btn--sm">信任一次</button></div></div>',
        }[kind]
        return f'''<div class="card" style="padding:0">
  <div class="code-head" style="padding:8px 12px">{title}</div>
  {inner}
</div>'''
    grid = "".join([
        cell("空态", "", "empty"),
        cell("骨架", "", "skeleton"),
        cell("错误", "", "error"),
        cell("目录未信任", "", "trust"),
    ])
    body = f'''<div style="flex:1;min-height:0;display:flex;flex-direction:column;padding:84px 24px 20px;gap:12px">
  <div style="font-size:12.5px;font-weight:600">四种「现在没有，或者现在做不到」</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">{grid}</div>
  <div style="font-size:10.5px;line-height:1.7;color:var(--ink-3)">空态带下一步 · 骨架带进度 · 错误带原因与重试 · 未信任带信任入口。四种都不许只写一句「加载失败」。</div>
</div>'''
    return _win(body)


def dlg_e():
    toast = f'''<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;background:color-mix(in srgb,var(--ink) 90%,transparent);color:#fff;font-size:11.5px">{ICO("check")}已保存</div>'''
    ann = f'''<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;background:var(--accent-soft);color:var(--accent-ink);font-size:11.5px">{ICO("info")}<span style="flex:1">新版 0.1.9 已可用</span><span style="font-size:10.5px">去看</span></div>'''
    center = f'''<div class="card" style="padding:0">
  <div class="card__head" style="display:flex;align-items:center;gap:8px;padding:10px 14px;font-size:11.5px;font-weight:600">{ICO("bell")}通知中心<span style="flex:1"></span><span class="tag">3</span></div>
  <div style="padding:0 14px 12px;font-size:11px;line-height:1.9;color:var(--ink-2)">
    <div>· 2 分钟前 · 会话跑完了 · 重做工作区外壳</div>
    <div>· 12 分钟前 · 等你授权 · npm run db:migrate</div>
    <div>· 1 小时前 · MCP 掉线 · filesystem</div>
  </div>
</div>'''
    body = f'''<div style="flex:1;min-height:0;display:flex;flex-direction:column;padding:84px 24px 20px;gap:14px;max-width:760px">
  <div style="font-size:12.5px;font-weight:600">三个都是「系统说话」，但语气与位置不同</div>
  {toast}
  {ann}
  {center}
  <div class="card" style="padding:12px 14px;font-size:10.5px;line-height:1.8;color:var(--ink-3)">
    Toast：4 秒、无按钮、居中偏下 —— 只说已经发生的事。<br>
    公告条：可带行动、在内容上方 —— 说「现在有新东西」。<br>
    通知中心：可回溯、有历史 —— 说「刚才发生了什么，我错过了吗」。
  </div>
</div>'''
    return _win(body)


# ---------------------------------------------------------------- 系统态

def sys_a():
    left = f'''<div class="card" style="padding:14px 16px">
  <div style="font-size:11px;color:var(--ink-3)">主路径 · 系统原生选框</div>
  <div style="margin-top:8px;padding:10px 12px;border-radius:10px;background:var(--fill-1);font-family:var(--mono);font-size:11px">/Users/lin/pi-web</div>
  <div style="margin-top:8px;font-size:10.5px;line-height:1.7;color:var(--ink-2)">点「选择目录」直接开系统对话框，不自己画一个假的访达。</div>
</div>'''
    rows = [
        ("正在读目录", "spin", ""),
        ("空目录", "folder-fill", "这里没有子目录，可以选它自己"),
        ("权限不足", "lock", "读不了：把这个目录的权限改一下，或换一个"),
        ("路径不存在", "circle-alert", "上一级也没有了，可能被删了"),
        ("网络盘超时", "clock", "等 10 秒还没回，重试或换本地目录"),
    ]
    items = "".join(
        f'''<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;font-size:11.5px">
  {'<span class="spin spin--sm" data-spin="grid"></span>' if i == "spin" else ICO(i, "ic ic-sm")}
  <span style="flex:1">{t}</span><span style="font-size:10.5px;color:var(--ink-3)">{s}</span></div>''' for t, i, s in rows)
    right = f'''<div class="card" style="padding:0">
  <div class="card__head" style="display:flex;align-items:center;gap:8px;padding:10px 14px;font-size:11.5px;font-weight:600">{ICO("folder-fill")}回退 · 自绘浏览器</div>
  {items}
  <div style="padding:8px 12px;font-size:10px;color:var(--ink-3);box-shadow:inset 0 1px 0 var(--line-soft)">五种状态都是行内切换，不换弹窗、不丢已输入的路径</div>
</div>'''
    body = f'''<div style="flex:1;min-height:0;display:flex;flex-direction:column;padding:84px 24px 20px;gap:12px">
  <div style="display:grid;grid-template-columns:360px 1fr;gap:14px">{left}{right}</div>
</div>'''
    return _win(body)


def sys_b():
    seg = f'''<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:var(--sheet)">
  {ICO("circle-alert", "ic ic-lg")}
  <div style="font-size:13px;font-weight:600">这一页打不开了</div>
  <div style="font-size:11px;color:var(--ink-3);max-width:260px;text-align:center;line-height:1.6">段级 error.tsx 接住了错误：主题 token 还在，所以它还像这个应用。</div>
  <div style="display:flex;gap:8px;margin-top:4px"><button class="btn btn--sm">重试</button><button class="btn btn--sm">回会话</button></div>
</div>'''
    root = f'''<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:#fff;color:#111">
  <div style="font-size:13px;font-weight:600">应用出错了</div>
  <div style="font-size:11px;color:#666;max-width:260px;text-align:center;line-height:1.6">根级 global-error.tsx：连 token 都没有，只能用系统色。</div>
  <div style="display:flex;gap:8px;margin-top:4px"><button style="height:28px;padding:0 12px;border-radius:8px;border:1px solid #ccc">重试</button></div>
</div>'''
    body = f'''<div style="flex:1;min-height:0;display:flex;flex-direction:column;padding:84px 24px 20px;gap:12px">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:1;min-height:0">
    <div style="display:flex;flex-direction:column;border-radius:14px;overflow:hidden;box-shadow:inset 0 0 0 1px var(--line)">{seg}
      <div style="padding:8px 12px;font-size:10px;color:var(--ink-3);background:var(--fill-1)">app/error.tsx · 带主题 token</div></div>
    <div style="display:flex;flex-direction:column;border-radius:14px;overflow:hidden;box-shadow:inset 0 0 0 1px var(--line)">{root}
      <div style="padding:8px 12px;font-size:10px;color:#666;background:#f4f4f4">app/global-error.tsx · 无 token，跟系统色</div></div>
  </div>
  <div style="font-size:10.5px;line-height:1.7;color:var(--ink-3)">两级都必须给「重试」。差别在样式来源，和「谁能救它」：段级能只重挂这一页，根级只能整页重载。</div>
</div>'''
    return _win(body)


def sys_c():
    def zone(title, tone, note):
        return f'''<div style="border-radius:14px;padding:16px;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;background:{tone[0]};box-shadow:inset 0 0 0 1.5px {tone[1]}">
  {ICO(tone[2], "ic ic-lg")}
  <div style="font-size:12px;font-weight:600">{title}</div>
  <div style="font-size:10.5px;line-height:1.6;color:var(--ink-2)">{note}</div>
</div>'''
    zones = "".join([
        zone("松手放到这里", ("var(--fill-1)", "var(--line)", "download"), "还没拖进来：虚线不出现，只留一句提示"),
        zone("可以放", ("color-mix(in srgb,var(--accent) 8%,transparent)", "color-mix(in srgb,var(--accent) 45%,transparent)", "plus"),
             "拖进来且类型合法：描边变强调色，写清会做什么"),
        zone("这个不行", ("color-mix(in srgb,var(--danger) 8%,transparent)", "color-mix(in srgb,var(--danger) 40%,transparent)", "xmark"),
             "类型不合法：说清为什么被拒，而不是只变红"),
    ])
    rules = ["只接文件与目录，不接选中的文字", "目录整体收下，不递归挑类型", "同名文件不覆盖，自动加 -1", "一次最多 20 个，超了先问"]
    rule_html = "".join(f'<div style="display:flex;gap:8px;font-size:11px;line-height:1.9"><span style="color:var(--ink-3)">{i + 1}</span><span>{r}</span></div>' for i, r in enumerate(rules))
    body = f'''<div style="flex:1;min-height:0;display:flex;flex-direction:column;padding:84px 24px 20px;gap:14px">
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">{zones}</div>
  <div class="card" style="padding:14px 16px;max-width:620px">
    <div style="font-size:11.5px;font-weight:600;margin-bottom:6px">四条规则（先于动效）</div>
    {rule_html}
  </div>
  <div style="font-size:10.5px;line-height:1.7;color:var(--ink-3)">不写清「什么算文件」，用户永远不知道自己为什么被拒。</div>
</div>'''
    return _win(body)


def sys_d():
    kinds = [
        ("select", "选择", "允许跑这条命令？", "两个选项"),
        ("confirm", "确认", "要删掉 3 个文件，继续？", "是 / 否"),
        ("input", "输入", "分支名叫什么？", "单行输入"),
        ("editor", "编辑器", "把这段配置改一下", "多行 + 校验"),
    ]
    cards = "".join(
        f'''<div class="card" style="padding:12px 14px;display:flex;flex-direction:column;gap:8px">
  <div style="display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600">{ICO("hand-raised")}{t}<span style="flex:1"></span><span class="tag">{k}</span></div>
  <div style="font-size:11px;color:var(--ink-2)">{q}</div>
  <div style="font-size:10px;color:var(--ink-3)">{a}</div>
  <div class="bar" style="margin-top:2px"><i style="width:64%"></i></div>
  <div style="font-size:9.5px;color:var(--ink-3)">倒计时条：还剩 64%</div>
</div>''' for k, t, q, a in kinds)
    light = f'''<div class="card" style="padding:0;overflow:hidden">
  <div class="code-head" style="padding:8px 12px">附件预览 · 灯箱</div>
  <div style="display:flex;gap:6px;padding:0 12px 12px">
    <div class="att-thumb att-thumb--img1" style="width:96px;height:64px"></div>
    <div class="att-thumb att-thumb--img2" style="width:96px;height:64px"></div>
    <div class="att-thumb" style="width:96px;height:64px;display:grid;place-items:center;font-size:10px;color:var(--ink-3)">+2</div>
  </div>
</div>'''
    body = f'''<div style="flex:1;min-height:0;display:flex;flex-direction:column;padding:84px 24px 20px;gap:14px">
  <div style="font-size:12.5px;font-weight:600">四种扩展请求共用一个壳，只换正文区</div>
  <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">{cards}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">{light}
    <div class="card" style="padding:12px 14px;font-size:10.5px;line-height:1.8;color:var(--ink-3)">
      壳 = 标题（谁在问）+ 正文区 + 底部动作 + 倒计时条。<br>
      正文区按类型换：选项 / 确认 / 单行 / 多行编辑器。<br>
      倒计时走完 = 按默认动作执行，不是直接失败。
    </div>
  </div>
</div>'''
    return _win(body)


def sys_e():
    trust = f'''<div class="card" style="padding:0">
  <div class="card__head" style="display:flex;align-items:center;gap:8px;padding:10px 14px;font-size:11.5px;font-weight:600">{ICO("shield")}项目信任<span style="flex:1"></span><span class="tag">未信任</span></div>
  <div style="padding:0 14px 12px;font-size:11px;line-height:1.7;color:var(--ink-2)">/Users/lin/pi-web · 信任后才能读写与跑命令</div>
  <div style="display:flex;gap:6px;padding:0 14px 14px">
    <span class="tag" style="height:26px;flex:1;justify-content:center">信任一次</span>
    <span class="tag" style="height:26px;flex:1;justify-content:center;background:var(--accent-soft);color:var(--accent-ink)">本次会话</span>
    <span class="tag" style="height:26px;flex:1;justify-content:center">永不</span>
  </div>
</div>'''
    wt = f'''<div class="card" style="padding:0">
  <div class="card__head" style="display:flex;align-items:center;gap:8px;padding:10px 14px;font-size:11.5px;font-weight:600">{ICO("git-fork")}worktree<span style="flex:1"></span><span class="tag">3 个</span></div>
  <div style="padding:0 6px 8px">
    <button class="srow is-sel"><span class="srow__badge">{ICO("branch", "ic ic-sm")}</span><span class="srow__title">fork/v3-boards</span><span class="srow__trail">当前</span></button>
    <button class="srow"><span class="srow__badge">{ICO("branch", "ic ic-sm")}</span><span class="srow__title">main</span><span class="srow__trail">2h</span></button>
    <button class="srow"><span class="srow__badge">{ICO("branch", "ic ic-sm")}</span><span class="srow__title">feat/pwa-shell</span><span class="srow__trail">昨天</span></button>
  </div>
  <div style="padding:0 14px 14px"><label class="field" style="flex:none">{ICO("search")}<input placeholder="过滤 worktree" aria-label="过滤"></label></div>
</div>'''
    rm = modal_card("移除 worktree「feat/pwa-shell」？",
                    "这个 worktree 有 <b>3 个未提交改动</b>，移除会把它们一起丢掉。可以先提交，或者只移除目录保留分支。",
                    '<button class="btn">取消</button><button class="btn">只移除目录</button><button class="btn" style="background:var(--danger);color:#fff">一起丢掉</button>',
                    w=440, icon="trash-2")
    body = f'''<div style="flex:1;min-height:0;display:flex;flex-direction:column;padding:84px 24px 20px;gap:12px;max-width:820px">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">{trust}{wt}</div>
  <div style="font-size:10.5px;line-height:1.7;color:var(--ink-3)">有未提交的检出，移除必须先说清会丢什么——所以第三个按钮写「一起丢掉」，不写「确定」。</div>
</div>'''
    return _win(body + "\n" + _scrim(rm))


# ---------------------------------------------------------------- 动效（反馈）

def _mrow(demo, title, meta, src, muted=False):
    return f'''<div class="motion">
  <div class="motion__demo">{demo}</div>
  <div class="motion__body"><div class="motion__title">{title}</div><div class="motion__meta">{meta}</div></div>
  <div class="motion__src">{src}</div>
</div>'''


def _mhead(title, note):
    return f'''<div style="padding:84px 26px 0">
  <div style="font-size:15px;font-weight:600;letter-spacing:-.01em">{title}</div>
  <div style="margin-top:6px;font-size:11.5px;line-height:1.7;color:var(--ink-2);max-width:900px">{note}</div>
  <div class="card" style="margin-top:14px;padding:0 16px">'''


def _mfoot(note):
    return f'''</div>
  <div style="margin-top:12px;font-size:10.5px;line-height:1.7;color:var(--ink-3)">{note}</div>
</div>'''


def mot_fb_a():
    rows = "".join([
        _mrow('<span class="spin spin--sm" data-spin="grid"></span>', "运行中点阵", "静止终态：静态三点", "spin--sm"),
        _mrow('<span class="shimmer" data-text="思考中">思考中</span>', "流光扫过", "静止终态：满色文字", "shimmer"),
        _mrow('<span class="spin spin--mini" data-spin="mini"></span>', "侧栏行徽标", "静止终态：静态点", "spin--mini"),
        _mrow(f'<span class="tag">{ICO("hand-raised")}待授权</span>', "徽章出现", "静止终态：常显徽章", "tag"),
        _mrow('<span class="add">+48</span>', "数字淡入", "静止终态：终值", "num-in"),
        _mrow('<i class="caret"></i>', "流式光标", "静止终态：隐藏", "caret"),
        _mrow('<span class="demo-dots"></span>', "点阵波", "静止终态：静态点阵", "demo-dots"),
        _mrow('<span class="dot"></span>', "未读绿点", "静止终态：常显", "dot"),
    ])
    body = _mhead("反馈类台账 · 8 条已有", "「静止终态」这一列是重点：每条动效都得有一个能停住的样子，否则开了「减弱动效」的用户永远看见半路。") + rows + _mfoot("缺口 4 条（按压 / 焦点环 / 抽屉 / 底部面板）在帧 E、F 单列。") 
    return _win(body)


def mot_fb_b():
    rows = "".join([
        _mrow('<span class="shimmer" data-text="正在读 AppShell.tsx">正在读…</span>', "流光（等）", "元素没动位置，只是文字在换 → 用扫光", "shimmer"),
        _mrow('<span class="mono" style="font-size:16px">1 284</span>', "数字淡入（换）", "值变了 → 淡入新值，不滚动计数", "num-in"),
        _mrow('<span class="status__word">Tinkering…</span>', "状态词轮换", "每 2.4s 换一次，交叉淡出", "status__word"),
    ])
    body = _mhead("流光（等）与数字淡入（换）", "两条都是「元素没动位置、只是内容变了」的反馈——所以不加位移，只加透明度与遮罩。") + rows + _mfoot("判据：位置变 → 位移；内容变 → 淡入；状态在等 → 扫光。")
    return _win(body)


def mot_fb_c():
    rows = "".join([
        _mrow('<div style="width:26px;height:26px;border-radius:7px;background:var(--fill-3)"></div>', "翻卡两段", "前半翻出背面、后半翻回正面，中间不换尺寸", "flip"),
        _mrow('<span class="kbd">⌘K</span>', "标签上下交换", "两个标签互换位置：位移 + 交叉淡出", "swap"),
        _mrow(f'<span style="color:var(--success)">{ICO("check-circle", "ic ic-lg")}</span>', "对勾描边", "路径描边 220ms，描完停住", "check-draw"),
    ])
    body = _mhead("三条都在回答「这个值被换掉了」", "不只是「它动了」：翻、换、勾，三种都是「旧值 → 新值」的语法。") + rows + _mfoot("共同点：都不改容器尺寸，所以周围不会跳。")
    return _win(body)


def mot_fb_d():
    bars = "".join(f'<i style="height:{h}%"></i>' for h in (30, 55, 42, 78, 60, 88))
    rows = "".join([
        _mrow(f'<div class="bars" style="height:34px">{bars}</div>', "柱条长起", "自基线长起，both：进场前 0、结束后终值", "bars"),
        _mrow('<svg width="90" height="30" viewBox="0 0 90 30"><polyline points="2,24 20,18 38,20 56,10 74,12 88,4" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/></svg>', "折线揭开", "clip-path 从左揭开，不画描边动画", "line-reveal"),
        _mrow('<div class="sw-grid" style="display:grid;grid-template-columns:repeat(3,8px);gap:3px">' + "".join('<i style="width:8px;height:8px;border-radius:2px;background:var(--fill-4)"></i>' for _ in range(9)) + '</div>', "格子弹入", "每格错峰 40ms，最多 3 档", "grid-in"),
    ])
    body = _mhead("三条都带 both", "进场前是起点、结束后是终态，中间被「减弱动效」打断也停得住——这是 both 的意义，不是写法洁癖。") + rows + _mfoot("反例：只写 from 不写 both，动画被打断就停在半路。")
    return _win(body)


def mot_fb_e():
    rows = "".join([
        _mrow('<span class="spin spin--mini" data-spin="mini"></span>', "徽标流光", "已有", "spin--mini"),
        _mrow('<button class="btn btn--sm" style="opacity:.45">按住</button>', "按压反馈", "缺口 · 待补", "—"),
        _mrow('<span style="width:22px;height:22px;border-radius:6px;box-shadow:0 0 0 2px var(--accent)"></span>', "焦点环", "缺口 · 待补", "—"),
        _mrow('<span class="tag">4 秒</span>', "Toast 进出", "已有", "toast"),
    ])
    body = _mhead("库内现状与缺口", "缺口一律把按钮置灰并标「待补」，不拿别的动效冒充——账要记清，否则下次又忘了。") + rows + _mfoot("两条缺口在帧 F 单独给真演示。")
    return _win(body)


def mot_fb_f():
    press = f'''<div class="card" style="padding:16px;display:flex;gap:10px;align-items:center">
  <button class="btn" style="transform:scale(.96)">按住的样子</button>
  <button class="btn">松开的样子</button>
  <span style="font-size:10.5px;color:var(--ink-3)">scale(.96) · 90ms · 松手回弹 140ms</span>
</div>'''
    focus = f'''<div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
  <div style="display:flex;gap:10px;align-items:center">
    <button class="btn btn--sm" style="box-shadow:0 0 0 2px var(--accent)">按钮 · 有焦点</button>
    <span class="tag" style="box-shadow:0 0 0 2px var(--accent)">页签</span>
    <span class="srow" style="width:150px;box-shadow:0 0 0 2px var(--accent)"><span class="srow__title">行 · 有焦点</span></span>
  </div>
  <label class="field" style="flex:none;box-shadow:0 0 0 2px var(--accent)">{ICO("search")}<input value="输入框 · 已聚焦" aria-label="焦点示例"></label>
  <div style="font-size:10.5px;color:var(--ink-3)">环宽走 --nx-focus-w，颜色走 --nx-ring；输入框之前就有，按钮 / 页签 / 行现在补齐。</div>
</div>'''
    body = f'''<div style="flex:1;min-height:0;display:flex;flex-direction:column;padding:84px 26px 20px;gap:14px;max-width:880px">
  <div style="font-size:15px;font-weight:600;letter-spacing:-.01em">两个之前完全缺失的基础反馈</div>
  <div style="font-size:11.5px;line-height:1.7;color:var(--ink-2)">按压与焦点环：没有它们，键盘用户不知道自己在哪，触摸用户不知道按到了没有。</div>
  {press}
  {focus}
  <div style="font-size:10.5px;line-height:1.7;color:var(--ink-3)">两条都必须在 prefers-reduced-motion 下退化成「瞬间到位」，而不是消失。</div>
</div>'''
    return _win(body)


# ---------------------------------------------------------------- 动效（容器）

def mot_ct_a():
    rows = "".join([
        _mrow(f'<span class="tag">{ICO("xmark")}</span>', "浮层出现", "opacity + 6px 上移 · 140ms · 已进库", "pop-in"),
        _mrow('<div style="width:40px;height:26px;border-radius:7px;background:var(--fill-3)"></div>', "模态盒子", "scale .96 → 1 + 遮罩淡入 · 180ms", "modal-in"),
        _mrow('<span style="border-bottom:2px solid var(--accent);padding-bottom:2px">页签</span>', "页签下划线", "现在只「换」不「移」——待补位移", "tab-ink"),
        _mrow('<div style="width:34px;height:22px;border-radius:6px;background:var(--fill-2)"></div>', "抽屉推拉", "translateX · 240ms · 已进库", "drawer"),
        _mrow('<div style="width:44px;height:8px;border-radius:4px;background:var(--fill-3)"></div>', "底部面板升起", "translateY · 260ms · 已进库", "sheet-up"),
        _mrow('<div style="width:34px;height:22px;border-radius:6px;background:var(--ink)" opacity=".3"></div>', "遮罩淡入", "opacity · 160ms · 已进库", "scrim"),
    ])
    body = _mhead("容器类台账", "「帧」一列是索引：B/C/D/E 里都能点到同一条。带「待补」的三条在帧 F 给真演示。") + rows + _mfoot("容器动效的统一判据：它是不是「多出来的一层」？是 → 位移 + 淡入；只是内容变了 → 走反馈类。")
    return _win(body)


def mot_ct_b():
    rows = "".join([
        _mrow(f'<span class="tag">{ICO("plus")}</span>', "浮层出现 · 真能重播", "从触发钮上方 6px 落下，140ms", "pop-in"),
        _mrow('<div style="width:40px;height:26px;border-radius:7px;background:var(--fill-3)"></div>', "模态盒子 · 真能重播", "scale .96→1，遮罩同时淡入", "modal-in"),
        _mrow('<span style="border-bottom:2px solid var(--accent);padding-bottom:2px">页签能真切</span>', "页签下划线", "切是真切，但下划线只「换」不「移」", "tab-ink"),
    ])
    body = _mhead("浮层 / 模态 / 页签下划线", "前两个真能重播；页签能真切，但下划线现在只「换」不「移」——这是登记在案的缺口。") + rows + _mfoot("缺口写在这里，不是等用户发现。")
    return _win(body)


def mot_ct_c():
    rows = "".join([
        _mrow('<div style="width:34px;height:22px;border-radius:6px;background:var(--fill-2)"></div>', "抽屉", "静止终态已摆好，类还没进库", "待补"),
        _mrow('<div style="width:44px;height:8px;border-radius:4px;background:var(--fill-3)"></div>', "底部面板", "静止终态已摆好，类还没进库", "待补"),
        _mrow('<div style="width:34px;height:22px;border-radius:6px;background:var(--ink)" opacity=".3"></div>', "遮罩", "静止终态已摆好，类还没进库", "待补"),
    ])
    body = _mhead("抽屉 / 底部面板 / 遮罩", "重播按钮一律置灰，并附上要补的 CSS——不假装它能播。") + rows + _mfoot("置灰是诚实的做法：点了没反应比「不能点」更糟。")
    return _win(body)


def mot_ct_d():
    skel = '''<div class="skeleton" style="width:150px"><i></i><i></i><i style="width:60%"></i></div>'''
    rows = "".join([
        _mrow(skel, "骨架扫掠", "扫在伪元素上（background-position），不动布局", "skel"),
        _mrow('<div style="width:150px;height:11px;border-radius:6px;background:var(--fill-3)"></div>', "骨架 → 内容", "交叉淡出 200ms；靠「重新挂载」重播，不靠 data-demo-motion", "swap"),
    ])
    body = _mhead("骨架扫掠与替换", "扫掠画在伪元素上，重播靠「重新挂载」而不是 data-demo-motion——后者会让整块内容重排。") + rows + _mfoot("替换时高度必须一致，否则内容会跳。")
    return _win(body)


def mot_ct_e():
    rows = "".join(
        f'''<div class="motion">
  <div class="motion__demo" style="gap:0"><div style="width:30px;height:20px;border-radius:5px;background:var(--fill-3);opacity:{o}"></div></div>
  <div class="motion__body"><div class="motion__title">第 {i + 1} 项入场</div><div class="motion__meta">延迟 {i * 40}ms · 最多 3 档</div></div>
  <div class="motion__src">stagger</div>
</div>''' for i, o in enumerate([1, .72, .46]))
    body = _mhead("错峰入场与列表增删", "错峰是节奏不是颜色：最多 3 项、每档 40ms。第 4 项起不再加延迟，否则长列表最后一项要等半秒。") + rows + _mfoot("退场必须比进场快（进场 180 / 退场 120），否则删除会显得卡。")
    return _win(body)


def mot_ct_f():
    rows = "".join([
        _mrow('<div style="width:34px;height:22px;border-radius:6px;background:var(--fill-2)"></div>', "抽屉推拉", "translateX(-100% → 0) · 240ms · cubic-bezier(.2,.8,.2,1)", "drawer"),
        _mrow('<div style="width:34px;height:22px;border-radius:6px;background:var(--ink)" opacity=".28"></div>', "遮罩淡入", "opacity 0 → 1 · 160ms", "scrim"),
        _mrow('<div style="width:44px;height:8px;border-radius:4px;background:var(--fill-3)"></div>', "底部面板升起", "translateY(100% → 0) · 260ms", "sheet-up"),
        _mrow('<span style="border-bottom:2px solid var(--accent);padding-bottom:2px">下划线</span>', "页签下划线「移」", "left + width 同时过渡 · 200ms", "tab-ink"),
    ])
    body = _mhead("四个容器原子的真演示", "四条都已进 system.css：抽屉推拉 / 遮罩淡入 / 底部面板升起 / 页签下划线「移」。") + rows + _mfoot("这四个是容器动效的全部；别的地方要用，就引用它们，不另写一套。")
    return _win(body)


# ---------------------------------------------------------------- 键盘与焦点

def kb_a():
    body = f'''<div style="flex:1;min-height:0;display:flex;flex-direction:column;padding:84px 26px 20px;gap:14px;max-width:860px">
  <div style="font-size:15px;font-weight:600;letter-spacing:-.01em">焦点环：环宽与颜色都走变量</div>
  <div style="font-size:11.5px;line-height:1.7;color:var(--ink-2)">环宽走 <code class="mono">--nx-focus-w</code>，颜色走 <code class="mono">--nx-ring</code>。输入框是真的（已自动聚焦），按钮 / 页签 / 行之前没有。</div>
  <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px">
    <label class="field" style="flex:none;box-shadow:0 0 0 2px var(--accent)">{ICO("search")}<input value="输入框 · 已聚焦" aria-label="焦点示例"></label>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn btn--sm" style="box-shadow:0 0 0 2px var(--accent)">按钮</button>
      <span class="tag" style="box-shadow:0 0 0 2px var(--accent)">页签</span>
      <span class="srow" style="width:160px;box-shadow:0 0 0 2px var(--accent)"><span class="srow__badge">{ICO("pi", "ic ic-sm pi-mark")}</span><span class="srow__title">行</span></span>
    </div>
  </div>
  <div class="card" style="padding:12px 14px;font-size:10.5px;line-height:1.8;color:var(--ink-3)">
    环在元素外侧，不吃布局：用 box-shadow 而不是 outline 的偏移，避免贴边被裁。<br>
    深色下 <code class="mono">--nx-ring</code> 自动换成更亮的一档，不单写规则。
  </div>
</div>'''
    return _win(body)


def kb_b():
    rows = [
        ("进 Tab 序", "输入框、发送、每一条会话行、每个工具栏按钮", "9"),
        ("跳过", "装饰图标、纯文本、禁用项", "—"),
        ("页签组", "roving tabindex：组内只有一个在 Tab 序里", "方向键切"),
        ("抽屉", "打开时焦点移进抽屉，关闭回到触发钮", "—"),
    ]
    body_rows = "".join(
        f'<div style="display:flex;gap:12px;padding:9px 0;box-shadow:inset 0 -1px 0 var(--line-soft)">'
        f'<span style="width:88px;flex:none;font-size:11px;color:var(--ink-3)">{a}</span>'
        f'<span style="flex:1;font-size:11.5px">{b}</span>'
        f'<span style="font-size:10.5px;color:var(--ink-3)">{c}</span></div>' for a, b, c in rows)
    body = f'''<div style="flex:1;min-height:0;display:flex;flex-direction:column;padding:84px 26px 20px;gap:14px;max-width:860px">
  <div style="font-size:15px;font-weight:600;letter-spacing:-.01em">Tab 序</div>
  <div style="font-size:11.5px;line-height:1.7;color:var(--ink-2)">进 Tab 序的、跳过的、页签组的 roving——真的按一下 Tab 或方向键试试。</div>
  <div class="card" style="padding:6px 16px">{body_rows}</div>
  <div style="font-size:10.5px;line-height:1.7;color:var(--ink-3)">一条纪律：Tab 序 = 视觉顺序。侧栏在左就先过侧栏，不要因为 DOM 顺序把焦点先扔进主区。</div>
</div>'''
    return _win(body)


def kb_c():
    layers = [
        ("1", "浮层 / 菜单", "先关最上面那层"),
        ("2", "抽屉", "浮层都关完了才轮到它"),
        ("3", "弹窗", "弹窗关掉后焦点回触发处"),
        ("4", "退出输入态", "最后才是离开输入框"),
    ]
    rows = "".join(
        f'''<div style="display:flex;align-items:center;gap:10px;padding:10px 0;box-shadow:inset 0 -1px 0 var(--line-soft)">
  <span style="width:20px;height:20px;border-radius:50%;background:var(--fill-2);display:grid;place-items:center;font-size:10px">{n}</span>
  <span style="font-size:11.5px;font-weight:500">{t}</span>
  <span style="flex:1"></span><span style="font-size:10.5px;color:var(--ink-3)">{d}</span></div>''' for n, t, d in layers)
    body = f'''<div style="flex:1;min-height:0;display:flex;flex-direction:column;padding:84px 26px 20px;gap:14px;max-width:860px">
  <div style="font-size:15px;font-weight:600;letter-spacing:-.01em">Esc 层级</div>
  <div style="font-size:11.5px;line-height:1.7;color:var(--ink-2)">按一次只关一层。顺序反了，就等于「要按两次才关得掉」——用户会以为卡了。</div>
  <div class="card" style="padding:6px 16px">{rows}</div>
  <div class="card" style="padding:12px 14px;font-size:10.5px;line-height:1.8;color:var(--ink-3)">
    实现口径：每层自己监听 keydown，且只在「我是最上层」时处理（栈顶判定），不靠冒泡顺序猜。
  </div>
</div>'''
    return _win(body)


def kb_d():
    rows = [
        ("⌘K", "搜索会话", "唯一"),
        ("⌘⇧K", "清空搜索", "唯一"),
        ("⌘B", "切侧栏", "唯一"),
        ("⌘⇧B", "切右栏", "唯一"),
        ("⌘/", "快捷键表", "唯一"),
        ("Esc", "关一层", "分层，见帧 C"),
    ]
    table = "".join(
        f'<div style="display:flex;gap:12px;padding:8px 0;box-shadow:inset 0 -1px 0 var(--line-soft);font-size:11.5px">'
        f'<span class="kbd" style="width:64px;justify-content:center">{k}</span><span style="flex:1">{a}</span>'
        f'<span style="font-size:10.5px;color:var(--ink-3)">{n}</span></div>' for k, a, n in rows)
    body = f'''<div style="flex:1;min-height:0;display:flex;flex-direction:column;padding:84px 26px 20px;gap:14px;max-width:880px">
  <div style="font-size:15px;font-weight:600;letter-spacing:-.01em">快捷键表与减弱动效</div>
  <div class="card" style="padding:6px 16px">{table}</div>
  <div class="card" style="padding:12px 14px;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:11.5px;font-weight:600">prefers-reduced-motion</div>
    <div style="font-size:10.5px;line-height:1.8;color:var(--ink-2)">
      停的是「终态」不是「起点」：位移与缩放直接到位，透明度仍然保留 120ms。<br>
      流光与点阵波停成静态图案，不是停成空白。
    </div>
  </div>
  <div style="font-size:10.5px;line-height:1.7;color:var(--ink-3)">两条纪律：同一组键不许有两种意思；减弱动效停终态，不停起点。</div>
</div>'''
    return _win(body)


FRAMES = {
    "web-welcome": [("A", welcome_a), ("B", welcome_b), ("C", welcome_c), ("D", welcome_d)],
    "web-dialogs-states": [("A", dlg_a), ("B", dlg_b), ("C", dlg_c), ("D", dlg_d), ("E", dlg_e)],
    "web-system-states": [("A", sys_a), ("B", sys_b), ("C", sys_c), ("D", sys_d), ("E", sys_e)],
    "web-motion-feedback": [("A", mot_fb_a), ("B", mot_fb_b), ("C", mot_fb_c), ("D", mot_fb_d), ("E", mot_fb_e), ("F", mot_fb_f)],
    "web-motion-containers": [("A", mot_ct_a), ("B", mot_ct_b), ("C", mot_ct_c), ("D", mot_ct_d), ("E", mot_ct_e), ("F", mot_ct_f)],
    "web-keyboard-focus": [("A", kb_a), ("B", kb_b), ("C", kb_c), ("D", kb_d)],
}
