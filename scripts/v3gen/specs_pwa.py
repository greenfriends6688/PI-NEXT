# -*- coding: utf-8 -*-
"""PWA 家族 31 帧：transcript / composer-sheet / settings / files / search /
install-update-trust / gestures-states / right-panels。"""
from transcript import ICO, bubble, grp, prose, steps, step, stat, filecard, out, dfile, tag, add, dele
import pwa

ME = "把工作区外壳重做一下"


def mcard(head, body, extra=""):
    h = f'<div class="m-card__head">{ICO(head)}{{t}}</div>' if head else ""
    return f'<div class="m-card" {extra}><div class="m-card__body">{body}</div></div>'


def srow(icon, title, trail="", sub=False, on=False):
    cls = "srow" + (" is-sub" if sub else "") + (" is-sel" if on else "")
    tr = f'<span class="srow__trail">{trail}</span>' if trail else ""
    return (f'<button class="{cls}"><span class="srow__badge">{ICO(icon, "ic ic-sm")}</span>'
            f'<span class="srow__title">{title}</span>{tr}</button>')


def sheet(title, body, foot="", height="auto"):
    f = f'<div class="m-sheet__foot">{foot}</div>' if foot else ""
    return f'''    <div class="m-scrim"></div>
    <div class="m-sheet" style="height:{height}">
      <div class="m-sheet__grab"><i></i></div>
      <div class="m-sheet__head"><span class="m-sheet__title">{title}</span>
        <button class="cbtn" title="关闭">{ICO("xmark")}</button></div>
      <div class="m-sheet__body">{body}</div>
      {f}
    </div>'''


def sheet_menu(title, items, hint=""):
    """长按菜单：复用 .sheet-menu（12 项 / 3 段）。"""
    rows = []
    for it in items:
        if it == "---":
            rows.append('<div class="menu-sep" style="margin:5px 8px"></div>')
            continue
        icon, text, danger = it
        cls = "sheet-menu__item is-danger" if danger else "sheet-menu__item"
        rows.append(f'<button class="{cls}">{ICO(icon)}{text}</button>')
    h = f'<div class="m-menu-sheet__hint">{hint}</div>' if hint else ""
    return f'''    <div class="m-scrim"></div>
    <div class="sheet-menu">
      <div class="sheet-menu__group">
        <div class="sheet-menu__head">{title}</div>
        {h}
        <div class="sheet-menu__body">{"".join(rows)}</div>
      </div>
      <button class="sheet-menu__cancel">取消</button>
    </div>'''


# ---------------------------------------------------------------- M-03 转录

def tx_a():
    inner = "\n".join([
        grp("用时 1m 18s", closed=True),
        prose("量了一下：390 宽下右栏根本放不下，手机上它本来就该是抽屉。"),
        bubble("把工作区外壳重做一下：侧栏改成三区，右栏默认收起。"),
        grp("思考 · 运行 2 条命令 · 编辑 1 个文件", shimmer=True),
        steps(
            step("bubble-left", "思考过程", chev=True, d=0.02,
                 body="先看外壳常量，再看右栏是不是写死宽度。手机上右栏没有位置，只能是抽屉。"),
            step("terminal", "运行", "npm run typecheck", d=0.12),
            step("pencil", "编辑", "AppShell.tsx", stat=stat(48, 12), last=True, d=0.22),
        ),
        '<div style="font-family:var(--mono);font-size:11px;line-height:1.7;padding:10px 12px;border-radius:10px;background:var(--fill-2);overflow-x:auto;white-space:pre">const [rightOpen, setRightOpen] = useState(false);\nconst archived = groups.filter((g) =&gt; g.archived);</div>',
        '<div class="status"><span class="spin spin--sm" data-spin="grid"></span>'
        '<span class="status__word">正在写 sidebar.css</span>'
        '<span class="status__time" data-elapsed="42">42s</span></div>',
    ])
    return pwa.phone(pwa.thread(inner), composer_html=pwa.composer(
        '<span class="ph">引导或排队后续消息…</span>', running=True))


def tx_b():
    perm = f'''<div class="m-perm" style="margin:0 0 10px">
  {ICO("hand-raised")}
  <div style="flex:1">要跑 <code class="mono">npm run db:migrate</code>，会改生产库<div style="font-size:10.5px;color:var(--ink-3);margin-top:2px">允许一次 / 本会话都允许 / 拒绝</div></div>
  <button class="btn btn--sm">选</button>
</div>'''
    table = '''<div style="margin-top:10px;overflow-x:auto">
  <div style="display:inline-block;min-width:420px;font-size:11px">
    <div style="display:flex;gap:12px;padding:6px 10px;color:var(--ink-3);border-bottom:1px solid var(--line-soft)">
      <span style="width:96px">文件</span><span style="width:56px">+</span><span style="width:56px">−</span><span>状态</span></div>
    <div style="display:flex;gap:12px;padding:6px 10px"><span style="width:96px" class="mono">AppShell.tsx</span><span style="width:56px" class="add">+48</span><span style="width:56px" class="del">−12</span><span>已写入</span></div>
    <div style="display:flex;gap:12px;padding:6px 10px"><span style="width:96px" class="mono">sidebar.css</span><span style="width:56px" class="add">+22</span><span style="width:56px" class="del">−6</span><span>已写入</span></div>
    <div style="display:flex;gap:12px;padding:6px 10px"><span style="width:96px" class="mono">SessionTree.tsx</span><span style="width:56px" class="add">+64</span><span style="width:56px" class="del">−18</span><span>待写入</span></div>
  </div>
</div>
<div style="margin-top:6px;font-size:10px;color:var(--ink-3)">← 横滑看完整列</div>'''
    grid = '''<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px">
  <div class="att-thumb att-thumb--img1"></div>
  <div class="att-thumb att-thumb--img2"></div>
  <div class="att-thumb" style="display:grid;place-items:center;font-size:10.5px;color:var(--ink-3)">+2</div>
</div>'''
    inner = "\n".join([
        perm,
        bubble("跑完把改动列一下，附上截图。"),
        grp("用时 2m 04s", closed=True),
        steps(
            step("terminal", "运行", "npm run db:migrate", chev=True, d=0.02,
                 body=out(["→ 3 张表新增 2 列，删除 0 列", "→ 2 条索引重建（锁表 1.4s）", "dry-run 通过"])),
            step("pencil", "编辑", "3 个文件", last=True, d=0.12),
        ),
        table,
        grid,
    ])
    return pwa.phone(pwa.thread(inner), composer_html=pwa.composer('<span class="ph">引导或排队后续消息…</span>'))


def tx_c():
    fail = f'''<div class="steps">
{step("terminal", "运行", "npm run test:unit", err=True, chev=True, last=True, d=0.02,
      body=out(["✖ SessionTree › groups pinned separately", "  expected 2 to equal 3"], err=True)
      + '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn--sm">'
      + ICO("refresh") + '重试</button></div>')}
</div>'''
    branch = f'''<div class="forkbar" style="margin:0 0 8px">{ICO("git-fork")}<span>从「<b>重做工作区外壳</b>」分出来的探索分支</span><span class="forkbar__back">回主线</span></div>'''
    inner = "\n".join([
        bubble("跑一下单测，挂了就换个分支试试。"),
        grp("用时 48s", closed=True),
        fail,
        branch,
        prose("失败的那一步永远看得见：不折叠、不淡出，重试钮就在它下面。"),
    ])
    tab = f'''<div class="m-tab">{ICO("git-fork")}<span>探索分支 · 2 条</span><span class="queued">只读</span><span class="m-tab__spacer"></span>{ICO("chevron-down")}</div>'''
    return pwa.phone(pwa.thread(inner), composer_html=pwa.composer(
        '<span class="ph">在分支里问一句…</span>', tab=tab))


# ---------------------------------------------------------------- M-02 输入卡

def cp_a():
    inner = "\n".join([
        grp("用时 1m 18s", closed=True),
        prose("右栏在手机上是抽屉，输入卡这一行只放三样：上下文环、模型、发送。"),
        filecard(2, 48, 12),
    ])
    bar = f'''<div class="composer__bar">
              <button class="composer__plus" title="附加文件">{ICO("plus")}</button>
              <span class="spacer"></span>
              <button class="chip" title="模型"><img src="../assets/providers/claude.svg" alt=""><span class="chip__eff">中</span></button>
              <button class="ring" title="上下文 18%"><svg viewBox="0 0 15 15"><circle class="trk" cx="7.5" cy="7.5" r="6"></circle><circle class="val" cx="7.5" cy="7.5" r="6" stroke-dasharray="6.8 37.7"></circle></svg></button>
              <button class="send" title="发送（空输入时不可用）" style="background:var(--fill-3);color:var(--ink-4)">{ICO("arrow-up")}</button>
            </div>'''
    return pwa.phone(pwa.thread(inner), composer_html=pwa.composer(
        '<span class="ph">让 pi 构建、修复或解释…</span>', tab="", bar=bar))


def cp_b():
    inner = "\n".join([
        grp("用时 1m 18s", closed=True),
        prose("有草稿时加号脱离卡片、抬起阴影——它已经从「卡片上的一个按钮」变成「一个能按住的动作」。"),
    ])
    plus = f'<button class="composer__plus" title="附加文件" style="width:34px;height:34px;margin-left:-2px;border-radius:50%;background:var(--accent);color:var(--on-accent);box-shadow:0 8px 20px -6px rgba(0,122,255,.65);transform:rotate(45deg)">{ICO("plus")}</button>'
    tray = f'''<div class="m-tab">{ICO("paperclip")}<span>2 个附件</span><span class="m-tab__spacer"></span><span style="font-size:10.5px;color:var(--ink-3)">3.2 MB</span></div>'''
    return pwa.phone(pwa.thread(inner), composer_html=pwa.composer(
        '<span>顺手把右栏的默认收起也改了</span><i class="caret"></i>', tab=tray, plus=plus))


def cp_c():
    chips = f'''<div class="m-card" style="margin:0 12px 8px">
  <div class="m-card__head">{ICO("sliders-horizontal")}这一条用哪个模型</div>
  <div class="m-card__body" style="padding-bottom:10px">
    <button class="srow is-sel" style="height:42px"><span class="srow__badge"><img src="../assets/providers/claude.svg" alt="" style="width:14px"></span><span class="srow__title">Claude Sonnet 4.6<span style="display:block;font-size:10.5px;color:var(--ink-3)">日常默认 · 中推理</span></span>{ICO("check", "ic ic-sm")}</button>
    <button class="srow" style="height:42px"><span class="srow__badge"><img src="../assets/providers/claude.svg" alt="" style="width:14px"></span><span class="srow__title">Claude Opus 4.6<span style="display:block;font-size:10.5px;color:var(--ink-3)">重活 · 高推理 · 慢</span></span></button>
  </div>
  <div style="padding:0 14px 12px;display:flex;gap:6px">
    <span class="tag">低</span><span class="tag" style="background:var(--accent-soft);color:var(--accent-ink)">中</span><span class="tag">高</span>
    <span style="flex:1"></span><span style="font-size:10.5px;color:var(--ink-3)">推理强度</span>
  </div>
</div>'''
    inner = "\n".join([grp("用时 1m 18s", closed=True), prose("四个 chip 各开一块，浮层从输入卡上方落下，不推走消息流。")])
    return pwa.phone(pwa.thread(inner), composer_html=pwa.composer(
        '<span class="ph">引导或排队后续消息…</span>'), overlays=chips)


def cp_d():
    tray = f'''<div class="m-tab">{ICO("list-todo")}<span>1 条后续</span><span class="queued">已排队</span><span class="m-tab__spacer"></span>{ICO("chevron-down")}</div>'''
    att = '''<div style="display:flex;gap:6px;padding:0 12px 6px"><div class="att-thumb att-thumb--img1" style="width:52px;height:38px"></div><div class="att-thumb" style="width:52px;height:38px;display:grid;place-items:center;font-size:10px;color:var(--ink-3)">2</div></div>'''
    inner = "\n".join([
        grp("运行中 · 队列 1 条", closed=True),
        steps(step("pencil", "编辑", "sidebar.css", stat=stat(22, 6), last=True, d=0.02)),
        att,
    ])
    return pwa.phone(pwa.thread(inner), composer_html=pwa.composer(
        '<span class="ph">引导或排队后续消息…</span>', tab=tray, running=True))


# ---------------------------------------------------------------- M-05 设置

def set_a():
    def row(icon, title, sub):
        return (f'<button class="m-setrow" style="width:100%;text-align:left">{ICO(icon)}'
                f'<span class="m-setrow__text">{title}<span class="m-setrow__sub">{sub}</span></span>'
                f'{ICO("chevron-right", "ic ic-sm")}</button>')
    body = f'''<div style="flex:1;overflow:hidden;padding:10px 12px 0;display:flex;flex-direction:column;gap:14px">
  <div class="m-card">
    <div class="m-card__head">{ICO("sliders-horizontal")}用得最多的</div>
    {row("gear", "通用", "外观 · 输入 · 权限与信任")}
    {row("circle-dotted", "模型", "默认模型 · 推理强度")}
    {row("puzzle", "MCP 服务器", "3 个已连 · 1 个掉线")}
  </div>
  <div class="m-card">
    <div class="m-card__head">{ICO("sparkle")}装了什么</div>
    {row("sparkle", "技能", "5 个启用")}
    {row("person-2", "子代理", "3 个预设")}
    {row("puzzle", "插件", "6 个已装")}
  </div>
  <div style="font-size:10.5px;line-height:1.6;color:var(--ink-3);padding:0 4px">
    分组按「你什么时候会来改它」，不按功能树。
  </div>
</div>'''
    top = pwa.top(title="设置", sub="", left=f'<button class="cbtn">{ICO("chevron-left")}</button>', right=f'<button class="cbtn">{ICO("xmark")}</button>')
    return pwa.phone(body, top_html=top, composer_html="")


def set_b():
    def prow(label, sub, value):
        return (f'<div class="m-setrow"><span class="m-setrow__text">{label}'
                f'<span class="m-setrow__sub">{sub}</span></span>'
                f'<span class="m-pickselect">{value}{ICO("chevron-down", "ic ic-xs")}</span></div>')
    body = f'''<div style="flex:1;overflow:hidden;padding:10px 12px 0;display:flex;flex-direction:column;gap:14px">
  <div class="m-card">
    <div class="m-card__head">{ICO("sun")}外观</div>
    {prow("主题", "跟随系统，可手动覆盖", "系统")}
    {prow("字号", "正文 15 · 代码 12", "中")}
    {prow("气泡密度", "紧凑更适合长对话", "紧凑")}
  </div>
  <div class="m-card">
    <div class="m-card__head">{ICO("keyboard")}输入</div>
    {prow("回车行为", "手机上回车换行，发送点按钮", "换行")}
    {prow("发送后", "输入框清空，键盘收起", "都做")}
    {prow("震动反馈", "只在发送与授权时", "开")}
  </div>
</div>'''
    top = pwa.top(title="通用", sub="外观与输入", left=f'<button class="cbtn">{ICO("chevron-left")}</button>', right="")
    return pwa.phone(body, top_html=top, composer_html="")


def set_c():
    trust = f'''<div class="m-trust">
  <div style="display:flex;align-items:center;gap:6px;font-weight:600">{ICO("shield")}信任 PI NEXT？</div>
  <div style="margin-top:4px;color:var(--ink-2)">信任后 pi 可以在这个目录里读写文件、跑命令，不再逐条问你。</div>
  <div class="m-trust__acts">
    <span class="tag">信任一次</span>
    <span class="tag" style="background:var(--accent-soft);color:var(--accent-ink)">本次会话</span>
    <span class="tag">永不</span>
  </div>
  <div style="margin-top:8px;font-size:10px;color:var(--ink-3)">这三类永远不放行：删目录、改 .git/config、联网装包</div>
</div>'''
    body = f'''<div style="flex:1;overflow:hidden;padding:10px 12px 0;display:flex;flex-direction:column;gap:14px">
  {trust}
  <div class="m-card">
    <div class="m-card__head">{ICO("hand-raised")}权限档</div>
    <div class="m-setrow"><span class="m-setrow__text">当前档位<span class="m-setrow__sub">改完立刻生效</span></span>
      <span class="m-pickselect">受监督</span></div>
    <div style="padding:0 14px 12px;display:flex;gap:6px">
      <span class="tag" style="height:26px;flex:1;justify-content:center">只读</span>
      <span class="tag" style="height:26px;flex:1;justify-content:center;background:var(--accent-soft);color:var(--accent-ink)">受监督</span>
      <span class="tag" style="height:26px;flex:1;justify-content:center">全放开</span>
    </div>
  </div>
</div>'''
    top = pwa.top(title="通用", sub="权限与信任", left=f'<button class="cbtn">{ICO("chevron-left")}</button>', right="")
    return pwa.phone(body, top_html=top, composer_html="")


def set_d():
    body = f'''<div style="flex:1;overflow:hidden;padding:10px 12px 0;display:flex;flex-direction:column;gap:10px">
  <div class="m-card">
    <div class="m-card__head">{ICO("sun")}外观</div>
    <div class="m-setrow"><span class="m-setrow__text">主题<span class="m-setrow__sub">跟随系统，可手动覆盖</span></span><span class="m-pickselect">系统{ICO("chevron-down", "ic ic-xs")}</span></div>
    <div class="m-setrow"><span class="m-setrow__text">字号<span class="m-setrow__sub">正文 15 · 代码 12</span></span><span class="m-pickselect">中{ICO("chevron-down", "ic ic-xs")}</span></div>
  </div>
  <div class="m-card">
    <div class="m-card__head">{ICO("keyboard")}输入</div>
    <div class="m-setrow"><span class="m-setrow__text">回车行为<span class="m-setrow__sub">手机上回车换行</span></span><span class="m-pickselect">换行{ICO("chevron-down", "ic ic-xs")}</span></div>
  </div>
  <div style="font-size:10.5px;line-height:1.6;color:var(--ink-3);padding:0 4px">
    这是同一份内容的底部面板形态：改完合上就回原位置，不退化成只读预览。
  </div>
</div>'''
    over = f'''    <div class="m-scrim"></div>
    <div class="m-sheet" style="height:auto;max-height:76%">
      <div class="m-sheet__grab"><i></i></div>
      <div class="m-sheet__head"><span class="m-sheet__title">设置 › 通用</span><button class="cbtn">{ICO("xmark")}</button></div>
      <div class="m-sheet__body">{body}</div>
    </div>'''
    return pwa.phone(pwa.thread("\n".join([grp("用时 1m 18s", closed=True), prose("会话页上打开设置，是底部面板，不是新页面。")])), overlays=over)


# ---------------------------------------------------------------- M-06 文件

def _tree_rows():
    def r(name, depth=0, icon="file", on=False, badge=""):
        ind = f'<span style="width:{depth * 14}px;flex:none"></span>' if depth else ""
        cls = "srow is-sel" if on else "srow"
        b = f'<span class="srow__trail"><span class="tag" style="height:16px;font-size:9.5px">{badge}</span></span>' if badge else ""
        return (f'<button class="{cls}" style="height:34px">{ind}{ICO(icon, "ic ic-sm")}'
                f'<span class="srow__title">{name}</span>{b}</button>')
    return "\n".join([
        r("components", 0, "chevron-down"),
        r("AppShell.tsx", 1, "file-diff", True, "M"),
        r("SessionTree.tsx", 1, "file-diff", False, "M"),
        r("sidebar.css", 1, "file", False, "M"),
        r("ChatWindow.tsx", 1, "file"),
        r("lib", 0, "chevron-down"),
        r("rpc-manager.ts", 1, "file"),
        r("design", 0, "chevron-right"),
    ])


def files_a():
    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
  <div style="padding:6px 12px 8px;font-family:var(--mono);font-size:10.5px;color:var(--ink-3)">PI NEXT / fork/v3-boards</div>
  <div style="flex:1;overflow:hidden;padding:0 8px">{_tree_rows()}</div>
  <div style="display:flex;box-shadow:inset 0 1px 0 var(--line-soft)">
    <button style="flex:1;padding:12px 0;font-size:11.5px;display:flex;flex-direction:column;align-items:center;gap:3px">{ICO("doc-text")}打开</button>
    <button style="flex:1;padding:12px 0;font-size:11.5px;display:flex;flex-direction:column;align-items:center;gap:3px;box-shadow:inset 1px 0 0 var(--line-soft)">{ICO("copy")}复制路径</button>
    <button style="flex:1;padding:12px 0;font-size:11.5px;display:flex;flex-direction:column;align-items:center;gap:3px;box-shadow:inset 1px 0 0 var(--line-soft)">{ICO("download")}下载</button>
  </div>
</div>'''
    top = pwa.top(title="文件", sub="12 个文件 · 3 个已改", right=f'<button class="cbtn">{ICO("xmark")}</button>')
    return pwa.phone(body, top_html=top, composer_html="")


def files_b():
    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
  <div style="display:flex;gap:4px;padding:8px 12px 6px;box-shadow:inset 0 -1px 0 var(--line-soft)">
    <span class="tag" style="height:26px;background:var(--accent-soft);color:var(--accent-ink)">源码</span>
    <span class="tag" style="height:26px">差异</span>
    <span class="tag" style="height:26px">预览</span>
  </div>
  <div style="flex:1;overflow:hidden;padding:10px 12px;font-family:var(--mono);font-size:11px;line-height:1.75">
    <div><span style="color:var(--ink-4)">10</span>  <span class="tok-kw">export</span> <span class="tok-kw">function</span> <span class="tok-fn">AppShell</span>({{ children }}) {{</div>
    <div><span style="color:var(--ink-4)">11</span>    <span class="tok-kw">const</span> [rightOpen, setRightOpen] = <span class="tok-fn">useState</span>(<span class="tok-num">false</span>);</div>
    <div><span style="color:var(--ink-4)">12</span>    <span class="tok-kw">const</span> {{ groups, pinned }} = <span class="tok-fn">useSessionTree</span>();</div>
    <div><span style="color:var(--ink-4)">13</span>    <span class="tok-kw">const</span> archived = groups.<span class="tok-fn">filter</span>((g) =&gt; g.archived);</div>
    <div><span style="color:var(--ink-4)">14</span></div>
    <div><span style="color:var(--ink-4)">15</span>    <span class="tok-kw">return</span> (</div>
  </div>
</div>'''
    top = pwa.top(title="AppShell.tsx", sub="components · 已修改", right=f'<button class="cbtn">{ICO("xmark")}</button>')
    return pwa.phone(body, top_html=top, composer_html="")


def files_c():
    keys = ["esc", "tab", "⌃", "↑", "↓", "←", "→", "↵", "⌫", "|", "~", "/", "-", "$"]
    pad = "".join(
        f'<button style="width:36px;height:36px;border-radius:8px;background:var(--fill-2);font-family:var(--mono);font-size:11px;position:relative">{k}'
        f'<i style="position:absolute;inset:-4px;border-radius:10px;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 26%,transparent)"></i></button>'
        for k in keys)
    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
  <div style="flex:1;overflow:hidden;padding:10px 12px;font-family:var(--mono);font-size:11px;line-height:1.8;background:#0b0d10;color:#d6dae0">
    <div><span style="color:#7fb2e5">~/pi-web $</span> npm run dev</div>
    <div style="color:#7dd3a0">  ✓ Ready in 1.2s</div>
    <div style="color:#e2b25c">  ⚠ Slow filesystem (10.2s)</div>
    <div><span style="color:#7fb2e5">~/pi-web $</span> <span style="display:inline-block;width:7px;height:13px;background:#d6dae0;vertical-align:-2px"></span></div>
  </div>
  <div style="display:flex;gap:6px;padding:8px 10px;overflow:hidden;box-shadow:inset 0 1px 0 var(--line-soft)">{pad}</div>
  <div style="padding:6px 12px 10px;font-size:10px;color:var(--ink-3)">键帽 36px，命中区 44px（外扩 4px）</div>
</div>'''
    top = pwa.top(title="终端 · dev", sub="运行 4m 12s · fork/v3-boards", right=f'<button class="cbtn">{ICO("xmark")}</button>')
    return pwa.phone(body, top_html=top, composer_html="")


def files_d():
    rows = [
        ("terminal", "npm run typecheck", "done", "0 error · 7.2s"),
        ("doc-text", "读取 AppShell.tsx", "done", "1 284 行"),
        ("pencil", "编辑 3 个文件", "done", "+134 −36"),
        ("terminal", "npm run test:unit", "fail", "1 条失败 · 点开看重试"),
        ("pencil", "编辑 sidebar.css", "run", "正在写…"),
    ]
    tone = {"done": "var(--success)", "fail": "var(--danger)", "run": "var(--accent)"}
    items = "".join(
        f'''<div style="display:flex;gap:10px;padding:9px 12px">
  <span style="flex:none;width:14px;display:grid;place-items:center;color:{tone[s]};margin-top:1px">{ICO(i, "ic ic-sm")}</span>
  <div style="flex:1;min-width:0"><div style="font-size:11.5px">{t}</div>
    <div style="margin-top:2px;font-size:10px;color:var(--ink-3)">{m}</div></div>
</div>''' for i, t, s, m in rows)
    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
  <div class="m-navrail"><button class="is-on">轨迹</button><button>审查</button><button>文件</button><button>终端</button><button>Git</button></div>
  <div style="flex:1;overflow:hidden;padding:8px 0">{items}</div>
  <div style="padding:8px 12px;font-size:10px;color:var(--ink-3);box-shadow:inset 0 1px 0 var(--line-soft)">轨迹全局只有一条：文件、终端、浏览器的动作都汇到这里</div>
</div>'''
    top = pwa.top(title="轨迹", sub="本轮 5 个动作", right=f'<button class="cbtn">{ICO("xmark")}</button>')
    return pwa.phone(body, top_html=top, composer_html="")


def files_e():
    files = [("AppShell.tsx", 48, 12), ("SessionTree.tsx", 64, 18), ("sidebar.css", 22, 6)]
    agent = "".join(
        f'<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:11.5px">'
        f'{ICO("file-diff", "ic ic-sm")}<span class="mono" style="flex:1;font-size:10.5px">{p}</span>'
        f'<span class="dfile__stat">{add(a)}{dele(d)}</span></div>' for p, a, d in files)
    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
  <div class="m-navrail"><button>轨迹</button><button class="is-on">审查</button><button>文件</button><button>终端</button><button>Git</button></div>
  <div style="flex:1;overflow:hidden;padding:10px 0">
    <div class="sec-head" style="padding:0 12px 4px">工作区改动<span class="count">4</span></div>
    {agent}
    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:11.5px;opacity:.7">{ICO("file", "ic ic-sm")}<span class="mono" style="flex:1;font-size:10.5px">README.md</span><span class="dfile__stat">{add(2)}</span></div>
    <div class="sec-head" style="padding:10px 12px 4px">本轮 pi 写过<span class="count">3</span></div>
    {agent}
  </div>
  <div style="padding:8px 12px;font-size:10px;line-height:1.6;color:var(--ink-3);box-shadow:inset 0 1px 0 var(--line-soft)">两份来源分开列，只读，不做 Keep / Reject</div>
</div>'''
    top = pwa.top(title="审查", sub="工作区 4 · 本轮 3", right=f'<button class="cbtn">{ICO("xmark")}</button>')
    return pwa.phone(body, top_html=top, composer_html="")


def files_f():
    body = f'''<div style="flex:1;overflow:hidden;padding:12px;display:flex;flex-direction:column;gap:10px">
  <div class="m-card">
    <div class="m-card__head">{ICO("file")}preview.psd</div>
    <div class="m-card__body" style="padding-bottom:12px">
      二进制格式，没有渲染器。可以下载，或在系统应用里打开。
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn--sm">下载</button><button class="btn btn--sm">用其他应用打开</button></div>
    </div>
  </div>
  <div class="m-card">
    <div class="m-card__head">{ICO("file")}legacy.txt</div>
    <div class="m-card__body" style="padding-bottom:12px">
      不知道是什么类型。先按文本读一次试试？读坏了不影响原文件。
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn--sm">按文本打开</button></div>
    </div>
  </div>
</div>'''
    top = pwa.top(title="preview.psd", sub="48.2 MB · 不支持", right=f'<button class="cbtn">{ICO("xmark")}</button>')
    return pwa.phone(body, top_html=top, composer_html="")


# ---------------------------------------------------------------- M-07 搜索

def search_a():
    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
  <div style="padding:8px 12px 10px"><label class="field" style="flex:none">{ICO("search")}<input placeholder="搜会话、文件、命令" aria-label="搜索"></label></div>
  <div style="flex:1;overflow:hidden;padding:0 12px">
    <div class="sec-head" style="padding:0 0 6px">最近搜索</div>
    <button class="srow"><span class="srow__badge">{ICO("history", "ic ic-sm")}</span><span class="srow__title">右栏宽度</span><span class="srow__trail">昨天</span></button>
    <button class="srow"><span class="srow__badge">{ICO("history", "ic ic-sm")}</span><span class="srow__title">typecheck</span><span class="srow__trail">2 天前</span></button>
    <div class="sec-head" style="padding:12px 0 6px">快捷</div>
    <button class="srow"><span class="srow__badge">{ICO("file-code", "ic ic-sm")}</span><span class="srow__title">跳到文件</span><span class="srow__trail">@</span></button>
    <button class="srow"><span class="srow__badge">{ICO("terminal", "ic ic-sm")}</span><span class="srow__title">跑一条命令</span><span class="srow__trail">/</span></button>
    <button class="srow"><span class="srow__badge">{ICO("git-fork", "ic ic-sm")}</span><span class="srow__title">切 worktree</span><span class="srow__trail">⌘⇧M</span></button>
  </div>
</div>'''
    top = pwa.top(title="搜索", sub="", right=f'<button class="cbtn">{ICO("xmark")}</button>')
    return pwa.phone(body, top_html=top, composer_html="")


def search_b():
    hit = '<mark style="background:var(--accent-soft);color:var(--accent-ink);border-radius:3px;padding:0 1px">右栏</mark>'
    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
  <div style="padding:8px 12px 8px"><label class="field" style="flex:none">{ICO("search")}<input value="右栏" aria-label="搜索"></label></div>
  <div style="display:flex;gap:6px;padding:0 12px 8px">
    <span class="tag" style="height:26px;background:var(--accent-soft);color:var(--accent-ink)">{ICO("text-bubble")}会话</span>
    <span class="tag" style="height:26px">{ICO("file-code")}文件</span>
    <span class="tag" style="height:26px">{ICO("terminal")}命令</span>
  </div>
  <div style="flex:1;overflow:hidden;padding:0 12px">
    <button class="srow is-sel" style="height:44px;align-items:flex-start;padding:8px"><span class="srow__badge">{ICO("pi", "ic ic-sm pi-mark")}</span>
      <span class="srow__title" style="white-space:normal;line-height:1.4">把{hit}的默认收起也一起改了<span style="display:block;font-size:10.5px;color:var(--ink-3)">刚刚 · 14 条</span></span></button>
    <button class="srow" style="height:44px;align-items:flex-start;padding:8px"><span class="srow__badge">{ICO("pi", "ic ic-sm pi-mark")}</span>
      <span class="srow__title" style="white-space:normal;line-height:1.4">{hit}现在默认是开的<span style="display:block;font-size:10.5px;color:var(--ink-3)">2h · 41 条</span></span></button>
    <button class="srow" style="height:44px;align-items:flex-start;padding:8px"><span class="srow__badge">{ICO("text-bubble", "ic ic-sm")}</span>
      <span class="srow__title" style="white-space:normal;line-height:1.4">{hit}宽度到底该写死还是跟着窗口算<span style="display:block;font-size:10.5px;color:var(--ink-3)">昨天 · 6 条</span></span></button>
  </div>
  <div style="padding:8px 12px;font-size:10px;color:var(--ink-3);box-shadow:inset 0 1px 0 var(--line-soft)">三个前缀是同一套行的三种筛选，行结构完全一致</div>
</div>'''
    top = pwa.top(title="搜索", sub="3 条命中", right=f'<button class="cbtn">{ICO("xmark")}</button>')
    return pwa.phone(body, top_html=top, composer_html="")


def search_c():
    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
  <div style="padding:8px 12px 8px"><label class="field" style="flex:none">{ICO("search")}<input value="zzz" aria-label="搜索"></label></div>
  <div class="m-empty" style="padding-top:20px">
    {ICO("search")}
    <b>没有匹配「zzz」的会话</b>
    <span>搜的是标题与首条消息，不搜正文。手机索引只覆盖最近 30 天、且打开过的会话。</span>
    <div style="display:flex;gap:6px;margin-top:8px">
      <span class="tag" style="height:26px">搜文件</span><span class="tag" style="height:26px">问 pi 一句</span>
    </div>
  </div>
  <div class="m-card" style="margin:0 12px 12px">
    <div class="m-card__head">{ICO("info")}为什么搜不到</div>
    <div class="m-card__body" style="padding-bottom:12px;font-size:10.5px;line-height:1.7">
      · 真没有 → 上面这一屏<br>
      · 太旧 → 超出 30 天，去桌面端搜<br>
      · 索引没建好 → 底部会有一行「索引补到第几批」
    </div>
  </div>
</div>'''
    top = pwa.top(title="搜索", sub="0 条命中", right=f'<button class="cbtn">{ICO("xmark")}</button>')
    return pwa.phone(body, top_html=top, composer_html="")


# ---------------------------------------------------------------- M-08 安装/更新/信任

def install_a():
    steps_html = "".join(
        f'''<div style="display:flex;gap:10px;padding:9px 12px">
  <span style="flex:none;width:18px;height:18px;border-radius:50%;background:var(--fill-2);display:grid;place-items:center;font-size:10px">{i}</span>
  <div style="font-size:11.5px;line-height:1.6">{t}</div>
</div>''' for i, t in [
            (1, '点底部的「分享」——方块里一个向上的箭头'),
            (2, '往下滚，选「添加到主屏幕」'),
            (3, '点右上「添加」。之后从主屏图标打开，就是全屏的'),
        ])
    body = f'''<div style="flex:1;overflow:hidden;padding:12px;display:flex;flex-direction:column;gap:10px">
  <div class="m-card">
    <div class="m-card__head">{ICO("smartphone")}装到主屏幕</div>
    <div class="m-card__body" style="padding-bottom:6px;font-size:11px">Safari 没有一键安装的接口，唯一诚实的写法就是这三步。</div>
    {steps_html}
    <div style="padding:4px 12px 12px;font-size:10px;color:var(--ink-3)">装完能离线打开、能收推送；不装也能用，只是每次都要输地址。</div>
  </div>
  <div class="m-banner">{ICO("info")}<span>在 Android Chrome 上这里会变成一条主按钮，不用三步。</span></div>
</div>'''
    top = pwa.top(title="装到主屏幕", sub="iOS · Safari", right=f'<button class="cbtn">{ICO("xmark")}</button>')
    return pwa.phone(body, top_html=top, composer_html="")


def install_b():
    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
  <div class="m-update">{ICO("refresh")}<span style="flex:1">有新版本 · 3.2 MB</span><button class="btn btn--sm">现在更新</button><button class="btn btn--sm">稍后</button></div>
  <div class="m-offline">{ICO("wifi")}<span style="flex:1">断网了 · 你发的消息会排队，恢复后自动发</span></div>
  <div style="flex:1;overflow:hidden;padding:0 12px">
    <div class="m-card" style="margin-top:10px">
      <div class="m-card__head">{ICO("doc-text")}草稿还在</div>
      <div class="m-card__body" style="padding-bottom:12px;font-size:11px;line-height:1.7">
        「顺手把右栏的默认收起也改了」<br>
        <span style="color:var(--ink-3);font-size:10px">更新不会丢掉正在输入的草稿——一个字都不丢。</span>
      </div>
    </div>
    <div class="m-card" style="margin-top:10px">
      <div class="m-card__head">{ICO("clock")}「稍后」是什么时候</div>
      <div class="m-card__body" style="padding-bottom:12px;font-size:10.5px;line-height:1.7">
        下一次回到前台、且不在输入中时，再提一次。不是 4 小时后。
      </div>
    </div>
  </div>
</div>'''
    top = pwa.top(title="更新与断网", sub="草稿不丢 · 发送进队列")
    return pwa.phone(body, top_html=top, composer_html="")


def install_c():
    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
  <div class="m-trust" style="margin-top:8px">
    <div style="display:flex;align-items:center;gap:6px;font-weight:600">{ICO("shield")}要在这个目录里跑命令</div>
    <div style="margin-top:4px;color:var(--ink-2)">/Users/lin/pi-web · 信任后不再逐条问</div>
    <div class="m-trust__acts">
      <span class="tag" style="height:26px;flex:1;justify-content:center">信任一次</span>
      <span class="tag" style="height:26px;flex:1;justify-content:center;background:var(--accent-soft);color:var(--accent-ink)">本次会话</span>
      <span class="tag" style="height:26px;flex:1;justify-content:center">永不</span>
    </div>
  </div>
  <div style="flex:1;overflow:hidden;padding:0 12px">
    <div class="m-card" style="margin-top:10px">
      <div class="m-card__head">{ICO("lock")}这三类永远不放行</div>
      <div class="m-card__body" style="padding-bottom:12px;font-size:10.5px;line-height:1.8">
        · 删目录（rm -rf）<br>
        · 改 <span class="mono">.git/config</span> 与远端地址<br>
        · 联网装包（npm i / pip install）
      </div>
    </div>
    <div style="margin-top:10px;font-size:10px;line-height:1.6;color:var(--ink-3)">
      这张卡常驻在顶上直到处理为止，不是一次性的弹窗。
    </div>
  </div>
</div>'''
    top = pwa.top(title="重做工作区外壳", sub="等你决定信任")
    return pwa.phone(body, top_html=top, composer_html=pwa.composer('<span class="ph">先处理上面的信任再继续…</span>'))


def install_d():
    def row(icon, title, sub, on=True):
        sw = '<span class="switch is-on" role="switch"><i></i></span>' if on else '<span class="switch" role="switch"><i></i></span>'
        return (f'<div class="m-setrow">{ICO(icon)}<span class="m-setrow__text">{title}'
                f'<span class="m-setrow__sub">{sub}</span></span>{sw}</div>')
    body = f'''<div style="flex:1;overflow:hidden;padding:12px;display:flex;flex-direction:column;gap:12px">
  <div style="text-align:center;padding:8px 0 2px">
    <div style="font-size:17px;font-weight:600;letter-spacing:-.02em">PI NEXT 已经在主屏上了</div>
    <div style="margin-top:4px;font-size:11px;color:var(--ink-3)">三步，各带一个开关，说完就动手</div>
  </div>
  <div class="m-card">
    {row("bell", "推送提醒", "只在需要你处理时响：授权、提问、失败")}
    {row("wifi", "离线可用", "断网时能看最近 30 天的会话")}
    {row("shield", "记住这个目录的信任", "下次打开不用再选一次")}
  </div>
  <div style="display:flex;gap:8px;margin-top:auto;padding-bottom:4px">
    <button class="btn" style="flex:1;justify-content:center">先这样</button>
    <button class="btn" style="flex:1;justify-content:center;background:var(--accent);color:var(--on-accent)">开始用</button>
  </div>
</div>'''
    top = pwa.top(title="", sub="", left='<span style="width:28px"></span>', right='<span style="width:28px"></span>')
    return pwa.phone(body, top_html=top, composer_html="")


# ---------------------------------------------------------------- M-09 手势与状态

def gest_a():
    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
  <div class="m-pull" style="margin-top:8px">
    {ICO("arrow-down")}
    <b style="font-size:11.5px">松手刷新</b>
    <span>列表顶端往下拖：先出现这一条，松手后变成「正在同步…」</span>
  </div>
  <div style="flex:1;overflow:hidden;padding:12px">
    <div class="m-card">
      <div class="m-card__head">{ICO("info")}一句话规则</div>
      <div class="m-card__body" style="padding-bottom:12px;font-size:11px;line-height:1.7">
        下拉只刷新「会话列表与状态」，不刷新正在跑的回合——那个由 pi 自己推。
      </div>
    </div>
    <div class="m-card" style="margin-top:10px">
      <div class="m-card__head">{ICO("arrow-left")}侧滑返回</div>
      <div class="m-card__body" style="padding-bottom:12px;font-size:11px;line-height:1.7">
        只占左缘 28px：从最左边往右划才生效，正文里横滑表格不会误触。
      </div>
    </div>
  </div>
</div>'''
    over = '<div class="m-swipe"></div>'
    top = pwa.top(title="会话", sub="9 个")
    return pwa.phone(body, top_html=top, composer_html="", overlays=over)


def gest_b():
    items = [
        ("pin", "置顶会话", ""), ("pen-line", "重命名", ""), ("wand-sparkles", "生成标题", ""),
        "---",
        ("git-fork", "复制这条分支", ""), ("download", "导出 Markdown", ""), ("plusminus", "查看这一轮的变更", ""),
        "---",
        ("archive", "归档", ""), ("trash-2", "删除会话…", True),
    ]
    over = sheet_menu(ME, items, hint="长按会话行 0.4s 打开")
    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
  <div style="padding:10px 12px 6px"><label class="field" style="flex:none">{ICO("search")}<input placeholder="搜索会话" aria-label="搜索"></label></div>
  <div style="flex:1;overflow:hidden;padding:0 8px">
    {srow("text-bubble", "重做工作区外壳", "刚刚", on=True)}
    {srow("text-bubble", "令牌只写一次：running.css", "2h")}
    {srow("text-bubble", "V5 落地清单跑到第几批了", "3h")}
  </div>
</div>'''
    top = pwa.top(title="会话", sub="长按任一行为打开菜单")
    return pwa.phone(body, top_html=top, composer_html="", overlays=over)


def gest_c():
    body = f'''<div style="flex:1;overflow:hidden;padding:12px;display:flex;flex-direction:column;gap:12px">
  <div class="m-card">
    <div class="m-card__head">{ICO("hand-raised")}三档，44 是硬下限</div>
    <div style="padding:6px 14px 14px;display:flex;align-items:flex-end;gap:16px">
      <div style="text-align:center"><div class="m-hit" style="width:44px;height:44px">44</div><div style="margin-top:6px;font-size:10px;color:var(--ink-3)">行内图标钮</div></div>
      <div style="text-align:center"><div class="m-hit" style="width:48px;height:48px">48</div><div style="margin-top:6px;font-size:10px;color:var(--ink-3)">主操作</div></div>
      <div style="text-align:center"><div class="m-hit" style="width:56px;height:56px">56</div><div style="margin-top:6px;font-size:10px;color:var(--ink-3)">发送 / 停止</div></div>
    </div>
  </div>
  <div class="m-card">
    <div class="m-card__head">{ICO("info")}为什么 44</div>
    <div class="m-card__body" style="padding-bottom:12px;font-size:11px;line-height:1.7">
      手指触点直径约 9mm。44 是能稳定命中的下限，不是建议值——键帽可以画 36，命中区必须 44。
    </div>
  </div>
  <div style="font-size:10px;color:var(--ink-3)">方块按真实像素画：这一屏缩放 100% 时，它们和真机一样大。</div>
</div>'''
    top = pwa.top(title="触控目标", sub="规格表")
    return pwa.phone(body, top_html=top, composer_html="")


def gest_d():
    cells = [
        ("wifi", "断网", "PWA 特有", "发送进队列"),
        ("bell", "通知", "PWA 特有", "只在要你处理时"),
        ("download", "安装", "PWA 特有", "三步或一键"),
        ("hand-raised", "等授权", "与 Web 同", "三档等权重"),
        ("text-bubble", "等你回答", "与 Web 同", "选项可点"),
        ("circle-alert", "出错", "与 Web 同", "给重试"),
        ("shield", "目录信任", "与 Web 同", "常驻卡"),
        ("clock", "限流", "与 Web 同", "倒计时"),
        ("xmark", "空态", "与 Web 同", "给去处"),
    ]
    grid = "".join(
        f'''<div class="m-card" style="padding:10px">
  <div style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600">{ICO(i, "ic ic-sm")}{t}</div>
  <div style="margin-top:3px;font-size:9.5px;color:var(--ink-3)">{s}</div>
  <div style="margin-top:2px;font-size:10px;color:var(--ink-2)">{a}</div>
</div>''' for i, t, s, a in cells)
    body = f'''<div style="flex:1;overflow:hidden;padding:10px 12px;display:flex;flex-direction:column;gap:8px">
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">{grid}</div>
  <div style="font-size:10px;line-height:1.6;color:var(--ink-3)">每一格写清：它是什么 / 现在能干什么 / 什么时候会消失。标「PWA 特有」的是登记过的豁免。</div>
</div>'''
    top = pwa.top(title="系统态清单", sub="9 格 + 3 豁免")
    return pwa.phone(body, top_html=top, composer_html="")


def gest_e():
    body = f'''<div style="flex:1;overflow:hidden;padding:12px;display:flex;flex-direction:column;gap:10px">
  <div class="m-banner">{ICO("check-circle")}<span style="flex:1">已经发生：文件已保存</span><span class="m-banner__x">{ICO("xmark")}</span></div>
  <div class="m-perm">{ICO("hand-raised")}<span style="flex:1">要你选：允许跑这条命令？</span><button class="btn btn--sm">选</button></div>
  <div class="m-run"><span class="spin spin--sm" data-spin="grid"></span><span style="flex:1">正在做：写 sidebar.css</span><span style="font-size:10px;color:var(--ink-3)">12s</span></div>
  <div class="m-toast">{ICO("check")}<span style="flex:1">4 秒确认：已复制路径</span></div>
  <div class="m-card">
    <div class="m-card__head">{ICO("info")}「正在做」的四种图案</div>
    <div class="m-think-grid" style="padding:0 14px 14px">
      <div class="m-think"><span class="spin spin--md" data-spin="grid"></span></div>
      <div class="m-think"><span class="spin spin--sm" data-spin="grid"></span></div>
      <div class="m-think"><div class="m-bar" style="width:60%"><i style="width:42%"></i></div></div>
      <div class="m-think"><span class="shimmer" data-text="思考中">思考中</span></div>
    </div>
  </div>
  <div style="font-size:10px;line-height:1.6;color:var(--ink-3)">用错一个，用户就会把「进行中」读成「卡住了」。</div>
</div>'''
    top = pwa.top(title="四种反馈", sub="已经发生 / 要你选 / 正在做 / 4 秒确认")
    return pwa.phone(body, top_html=top, composer_html="")


def gest_f():
    body = f'''<div style="flex:1;overflow:hidden;padding:12px;display:flex;flex-direction:column;gap:12px">
  <div class="m-empty" style="padding-top:36px">
    {ICO("circle-alert")}
    <b>这一页打不开了</b>
    <span>段级 error.tsx 接住了错误：主题 token 还在，所以它长得还像这个应用。</span>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn--sm">重试</button><button class="btn btn--sm">回到会话</button>
    </div>
  </div>
  <div class="m-card" style="margin-top:auto">
    <div class="m-card__head">{ICO("info")}两级错误页</div>
    <div class="m-card__body" style="padding-bottom:12px;font-size:10.5px;line-height:1.8">
      段级 <span class="mono">app/error.tsx</span>：带主题 token，长得像应用<br>
      根级 <span class="mono">app/global-error.tsx</span>：无 token，跟系统色<br>
      两级都必须给「重试」。
    </div>
  </div>
</div>'''
    top = pwa.top(title="出错", sub="段级 error.tsx")
    return pwa.phone(body, top_html=top, composer_html="")


# ---------------------------------------------------------------- M-10 右栏

def rp_a():
    items = [
        ("file-code", "文件", "12 个文件 · 3 个已改"),
        ("terminal", "终端", "dev 在前台 · 4m 12s"),
        ("list-tree", "轨迹", "本轮 5 个动作"),
        ("plusminus", "审查", "工作区 4 · 本轮 3"),
        ("git-fork", "Git", "fork/v3-boards · 7 个提交"),
        ("globe", "浏览器", "没开过"),
    ]
    rows = "".join(
        f'<button class="srow" style="height:46px;align-items:flex-start;padding:8px 10px">{ICO(i, "ic ic-sm")}'
        f'<span class="srow__title" style="white-space:normal;line-height:1.35">{t}'
        f'<span style="display:block;font-size:10.5px;font-weight:400;color:var(--ink-3)">{s}</span></span>'
        f'{ICO("chevron-right", "ic ic-sm")}</button>' for i, t, s in items)
    over = f'''    <div class="m-scrim"></div>
    <div class="sheet-menu">
      <div class="sheet-menu__group">
        <div class="sheet-menu__head">右栏面板</div>
        <div class="sheet-menu__body">{rows}</div>
      </div>
      <button class="sheet-menu__cancel">取消</button>
    </div>'''
    return pwa.phone(pwa.thread("\n".join([grp("用时 1m 18s", closed=True), prose("顶栏那颗「右栏」跟桌面同义：点开是六项底部列表，每行一句现状。")])),
                     overlays=over)


def rp_b():
    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
  <div class="m-navrail"><button>文件</button><button>终端</button><button>轨迹</button><button class="is-on">审查</button><button>Git</button><button>浏览器</button></div>
  <div style="flex:1;overflow:hidden;padding:10px 12px">
    <div class="m-card">
      <div class="m-card__head">{ICO("plusminus")}工作区改动<span style="flex:1"></span><span class="dfile__stat">{add(136)}{dele(36)}</span></div>
      <div class="m-card__body" style="padding:0 0 6px">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 14px;font-size:11.5px">{ICO("file-diff", "ic ic-sm")}<span class="mono" style="flex:1;font-size:10.5px">AppShell.tsx</span><span class="dfile__stat">{add(48)}{dele(12)}</span></div>
        <div style="display:flex;align-items:center;gap:8px;padding:8px 14px;font-size:11.5px">{ICO("file-diff", "ic ic-sm")}<span class="mono" style="flex:1;font-size:10.5px">SessionTree.tsx</span><span class="dfile__stat">{add(64)}{dele(18)}</span></div>
        <div style="display:flex;align-items:center;gap:8px;padding:8px 14px;font-size:11.5px">{ICO("file-diff", "ic ic-sm")}<span class="mono" style="flex:1;font-size:10.5px">sidebar.css</span><span class="dfile__stat">{add(22)}{dele(6)}</span></div>
      </div>
    </div>
    <div style="margin-top:10px;font-size:10px;line-height:1.6;color:var(--ink-3)">审查只给移动形态：桌面端这块在右栏，手机上是全屏层。</div>
  </div>
</div>'''
    top = pwa.top(title="审查", sub="", right=f'<button class="cbtn">{ICO("xmark")}</button>')
    return pwa.phone(body, top_html=top, composer_html="")


def rp_c():
    rows = [
        ("terminal", "npm run typecheck", "done", "0 error · 7.2s"),
        ("doc-text", "读取 AppShell.tsx", "done", "1 284 行"),
        ("pencil", "编辑 3 个文件", "done", "+134 −36"),
        ("terminal", "npm run test:unit", "fail", "1 条失败"),
        ("pencil", "编辑 sidebar.css", "run", "正在写…"),
    ]
    tone = {"done": "var(--success)", "fail": "var(--danger)", "run": "var(--accent)"}
    items = "".join(
        f'''<div style="display:flex;gap:10px;padding:9px 14px">
  <span style="flex:none;width:14px;display:grid;place-items:center;color:{tone[s]};margin-top:1px">{ICO(i, "ic ic-sm")}</span>
  <div style="flex:1"><div style="font-size:11.5px">{t}</div><div style="margin-top:2px;font-size:10px;color:var(--ink-3)">{m}</div></div>
</div>''' for i, t, s, m in rows)
    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
  <div class="m-navrail"><button>文件</button><button>终端</button><button class="is-on">轨迹</button><button>审查</button><button>Git</button><button>浏览器</button></div>
  <div style="flex:1;overflow:hidden;padding:8px 0">{items}</div>
  <div style="padding:8px 14px;font-size:10px;color:var(--ink-3);box-shadow:inset 0 1px 0 var(--line-soft)">done / run / fail 三态，结构与审查面板同</div>
</div>'''
    top = pwa.top(title="轨迹", sub="本轮 5 个动作", right=f'<button class="cbtn">{ICO("xmark")}</button>')
    return pwa.phone(body, top_html=top, composer_html="")


def rp_d():
    lanes = "".join(
        f'<div style="display:flex;align-items:center;gap:8px;padding:6px 14px;font-size:11px">'
        f'<span class="mono" style="width:96px;font-size:10px;color:var(--ink-2)">{b}</span>'
        f'<span style="flex:1;height:2px;border-radius:1px;background:{c};opacity:.5"></span>'
        f'<span style="font-size:10px;color:var(--ink-3)">{n}</span></div>'
        for b, n, c in [("fork/v3-boards", "7 个提交", "var(--accent)"), ("main", "领先 0", "var(--success)"), ("feat/pwa-shell", "落后 2", "var(--warning)")])
    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
  <div class="m-navrail"><button>文件</button><button>终端</button><button>轨迹</button><button>审查</button><button class="is-on">Git</button><button>浏览器</button></div>
  <div style="flex:1;overflow:hidden;padding:8px 0">
    <div class="sec-head" style="padding:4px 14px">分支关系<span class="count">3</span></div>
    {lanes}
    <div class="sec-head" style="padding:10px 14px 4px">未提交<span class="count">4</span></div>
    <div style="display:flex;align-items:center;gap:8px;padding:6px 14px;font-size:11.5px">{ICO("file-diff", "ic ic-sm")}<span class="mono" style="flex:1;font-size:10.5px">AppShell.tsx</span><span class="dfile__stat">{add(48)}{dele(12)}</span></div>
    <div style="display:flex;align-items:center;gap:8px;padding:6px 14px;font-size:11.5px">{ICO("file-diff", "ic ic-sm")}<span class="mono" style="flex:1;font-size:10.5px">SessionTree.tsx</span><span class="dfile__stat">{add(64)}{dele(18)}</span></div>
  </div>
  <div style="padding:8px 14px;font-size:10px;color:var(--ink-3);box-shadow:inset 0 1px 0 var(--line-soft)">只做「看」：不提交、不切分支</div>
</div>'''
    top = pwa.top(title="Git", sub="fork/v3-boards", right=f'<button class="cbtn">{ICO("xmark")}</button>')
    return pwa.phone(body, top_html=top, composer_html="")


FRAMES = {
    "pwa-transcript": [("A", tx_a), ("B", tx_b), ("C", tx_c)],
    "pwa-composer-sheet": [("A", cp_a), ("B", cp_b), ("C", cp_c), ("D", cp_d)],
    "pwa-settings": [("A", set_a), ("B", set_b), ("C", set_c), ("D", set_d)],
    "pwa-files": [("A", files_a), ("B", files_b), ("C", files_c), ("D", files_d), ("E", files_e), ("F", files_f)],
    "pwa-search": [("A", search_a), ("B", search_b), ("C", search_c)],
    "pwa-install-update-trust": [("A", install_a), ("B", install_b), ("C", install_c), ("D", install_d)],
    "pwa-gestures-states": [("A", gest_a), ("B", gest_b), ("C", gest_c), ("D", gest_d), ("E", gest_e), ("F", gest_f)],
    "pwa-right-panels": [("A", rp_a), ("B", rp_b), ("C", rp_c), ("D", rp_d)],
}
