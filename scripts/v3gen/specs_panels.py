# -*- coding: utf-8 -*-
"""输入区 / 右栏面板 / 文件查看器：web-composer、web-right-panels、web-file-viewer-modes。"""
from transcript import (
    ICO, step, steps, bubble, grp, prose, stat, filecard, out, raw, code, dfile,
    unread, todo, phase, tag, add, dele, esc,
)
import shell

TICKS = [
    ("右栏现在默认是开的", "有点挤。"),
    ("先读一下现在的外壳", "别急着改。"),
    ("侧栏的三段怎么分", "置顶 / 项目 / 归档，行模型要不要一起动？"),
]


def _win(detail, ticks=None):
    return shell.win((shell.rail(ticks or TICKS) + "\n") + detail)


def _th(inner):
    """右栏 / 查看器跟顶栏同屏：转录不再需要自己的 72 上边距，交给外层让。"""
    return shell.thread(inner).replace('<div class="thread">', '<div class="thread" style="padding-top:0">')


def _thread():
    return "\n".join([
        bubble("把右栏的默认收起也一起改了。"),
        grp("用时 1m 18s", closed=True),
        steps(
            step("doc-text", "读取", "components/AppShell.tsx", d=0.02),
            step("pencil", "编辑", "components/AppShell.tsx", stat=stat(12, 4), last=True, d=0.12),
        ),
        prose("右栏默认收起了，<code>⌘B</code> 留给侧栏，右栏改成 <code>⌘⇧B</code>。"),
    ])


def _panel(inner, w=400):
    return f'<aside style="width:{w}px;flex:none;display:flex;flex-direction:column;background:color-mix(in srgb,var(--surface) 34%,transparent);box-shadow:inset 1px 0 0 var(--line-soft)">{inner}</aside>'


def _phead(title, extra=""):
    return f'''<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;box-shadow:inset 0 -1px 0 var(--line-soft)">
  <span style="font-size:11.5px;font-weight:600">{title}</span>
  <span style="flex:1"></span>{extra}
</div>'''


# ---------------------------------------------------------------- 输入区

def composer_a():
    models = [
        ("Claude Sonnet 4.6", "日常默认 · 中推理", True),
        ("Claude Opus 4.6", "重活 · 高推理 · 慢", False),
        ("Claude Haiku 4.5", "改文案 · 快 · 便宜", False),
    ]
    rows = "".join(
        f'''<button class="prow{" is-on" if on else ""}">
  <span style="flex:none;width:16px;display:grid;place-items:center"><img src="../assets/providers/claude.svg" alt="" style="width:14px;height:14px"></span>
  <span class="prow__text"><span class="prow__title">{n}</span><span class="prow__sub">{s}</span></span>
  {'<span class="prow__meta">' + ICO("check", "ic ic-sm") + '</span>' if on else '<span class="prow__meta">⌘1</span>'}
</button>''' for n, s, on in models)
    pop = f'''<div class="pop" style="left:786px;bottom:74px;width:300px">
  <div class="pop__head"><span class="pop__title">模型</span><span class="tag">3 个可用</span></div>
  <div class="pop__body is-flush">{rows}
    <div class="menu-sep"></div>
    <button class="prow"><span style="flex:none;width:16px"></span><span class="prow__text"><span class="prow__title">推理强度</span><span class="prow__sub">低 / 中 / 高 · 当前「中」</span></span><span class="prow__meta">{ICO("chevron-right", "ic ic-sm")}</span></button>
  </div>
  <div class="pop__foot">{ICO("info")}浮层左缘锚在 chip 上，不越出输入框</div>
</div>'''
    detail = (
        _th(_thread()) + "\n" + pop + "\n"
        + shell.composer(
            '<span class="ph">让 pi 构建、修复或解释… <span style="color:var(--ink-4)">@ 文件，/ 命令</span></span><i class="caret"></i>',
            tab="",
        )
    )
    return _win(detail)


def composer_b():
    items = [
        ("file-code", "components/AppShell.tsx", "文件 · 3 分钟前改过", ""),
        ("file-code", "components/SessionTree.tsx", "文件 · 昨天改过", ""),
        ("file-code", "components/sidebar.css", "文件 · 刚刚改过", "on"),
        ("file-code", "lib/rpc-manager.ts", "文件 · 2 天前改过", ""),
    ]
    file_rows = "".join(
        f'''<button class="prow{" is-on" if on else ""}">
  <span style="flex:none;width:16px;display:grid;place-items:center;color:var(--ink-2)">{ICO(i)}</span>
  <span class="prow__text"><span class="prow__title mono" style="font-size:11.5px">{p}</span><span class="prow__sub">{s}</span></span>
</button>''' for i, p, s, on in items)
    cmd_rows = "".join(
        f'''<button class="prow">
  <span style="flex:none;width:16px;display:grid;place-items:center;color:var(--ink-2)">{ICO(i)}</span>
  <span class="prow__text"><span class="prow__title">{p}</span><span class="prow__sub">{s}</span></span>
  <span class="prow__meta">{k}</span>
</button>''' for i, p, s, k in [
            ("terminal", "/typecheck", "跑 tsc --noEmit", ""),
            ("play", "/test", "跑单测，可带文件名", ""),
            ("git-fork", "/branch", "切 worktree", ""),
        ])
    pop = f'''<div class="pop" style="left:180px;bottom:74px;width:340px">
  <div class="pop__head">{ICO("at-sign")}<span class="pop__title">引用文件</span><span class="tag">4 个命中</span></div>
  <div class="pop__body is-flush">{file_rows}
    <div class="menu-sep"></div>
    <div class="menu-label">命令 · 打 / 开头</div>{cmd_rows}
  </div>
  <div class="pop__foot">{ICO("info")}前缀即语法：@ 提文件、/ 提命令、贴一行代码就是行内引用</div>
</div>'''
    detail = (
        _th(_thread()) + "\n" + pop + "\n"
        + shell.composer(
            '<span><span class="chip" style="height:20px;background:var(--accent-soft);color:var(--accent-ink)">'
            + ICO("file-code") + 'sidebar.css</span> 这个文件的 268 是写死的吗？</span><i class="caret"></i>',
            tab="",
        )
    )
    return _win(detail)


def composer_c():
    q = f'''<div class="pop" style="left:220px;bottom:78px;width:360px">
  <div class="pop__head">{ICO("list-todo")}<span class="pop__title">队列 · 2 条</span>
    <button class="btn btn--sm">{ICO("pause")}暂停</button></div>
  <div class="pop__body is-flush">
    <div class="prow is-on">
      <span style="flex:none;width:16px;display:grid;place-items:center;color:var(--ink-3)">1</span>
      <span class="prow__text"><span class="prow__title">把 ⌘⇧B 也写进快捷键地图</span><span class="prow__sub">自动接续 · 当前这条跑完就发</span></span>
    </div>
    <div class="prow">
      <span style="flex:none;width:16px;display:grid;place-items:center;color:var(--ink-3)">2</span>
      <span class="prow__text"><span class="prow__title">跑一遍 typecheck</span><span class="prow__sub">排队中</span></span>
    </div>
    <div class="menu-sep"></div>
    <div style="padding:8px 12px;font-size:10.5px;line-height:1.6;color:var(--ink-3)">
      暂停是一等公民：暂停后新输入直接插到队首，不会被静默吞掉。
    </div>
  </div>
</div>'''
    detail = (
        _th(_thread()) + "\n" + q + "\n"
        + shell.composer(
            '<span class="ph">队列暂停中 · 输入会插到队首</span><i class="caret"></i>',
            tab=f'<button class="tab">{ICO("list-todo")}2 条排队 <span class="del">已暂停</span></button>',
        )
    )
    return _win(detail)


# ---------------------------------------------------------------- 右栏面板

def _tree():
    def r(name, depth=0, icon="file", on=False, badge=""):
        ind = f'<span class="tree-indent" style="width:{depth * 12}px"></span>' if depth else ""
        cls = "tree-row is-on" if on else "tree-row"
        b = f'<span class="tree-row__badge">{badge}</span>' if badge else ""
        return f'<button class="{cls}">{ind}{ICO(icon)}{b}<span class="tree-row__name">{name}</span></button>'
    return f'''<aside class="filetree" style="width:250px">
  <div class="filetree__head">{ICO("folder-fill")}<span style="font-size:11.5px;font-weight:600">PI NEXT</span>
    <span style="flex:1"></span><button class="cbtn cbtn--sm" title="收起">{ICO("xmark")}</button></div>
  <div style="padding:0 8px;display:flex;gap:4px;margin-bottom:6px">
    <span class="tag" style="height:20px">全部</span><span class="tag" style="height:20px">已改 M</span><span class="tag" style="height:20px">未跟踪 U</span>
  </div>
  <div style="flex:1;overflow:hidden;padding:0 6px">
{r("components", 0, "chevron-down", True)}
{r("AppShell.tsx", 1, "file-diff", False, "M")}
{r("SessionTree.tsx", 1, "file-diff", False, "M")}
{r("sidebar.css", 1, "file", False, "M")}
{r("ChatWindow.tsx", 1, "file")}
{r("lib", 0, "chevron-down")}
{r("rpc-manager.ts", 1, "file")}
{r("design", 0, "chevron-right")}
  </div>
</aside>'''


def _tabbar(items, on=0):
    out = ['<div class="tabbar">']
    for i, (icon, name, dirty) in enumerate(items):
        cls = "ftab is-on" if i == on else "ftab"
        out.append(f'<button class="{cls}">{ICO(icon)}{name}{"<span class=\"ftab__x\">×</span>" if dirty else ""}</button>')
    out.append("</div>")
    return "".join(out)


def panels_a():
    viewer = f'''<section class="viewer">
  {_tabbar([("file-diff", "AppShell.tsx", True), ("file-diff", "SessionTree.tsx", True), ("doc-text", "README.md", True)])}
  <div class="code-head" style="gap:10px"><span>components/AppShell.tsx</span><span>·</span><span>21 行</span>
    <span>·</span><span style="color:var(--warning)">已修改</span><span style="flex:1"></span>
    <button class="btn btn--sm">{ICO("plusminus")}差异</button></div>
  <div class="code">
{chr(10).join(f'<div class="cline"><span class="cline__no">{n}</span><span>{t}</span></div>' for n, t in [
    (9, '<span class="tok-com"> * 外壳：侧栏 + 转录 + 右栏</span>'),
    (10, '<span class="tok-kw">export</span> <span class="tok-kw">function</span> <span class="tok-fn">AppShell</span>({ children }: Props) {'),
    (11, '  <span class="tok-kw">const</span> [rightOpen, setRightOpen] = <span class="tok-fn">useState</span>(<span class="tok-num">false</span>);'),
    (12, '  <span class="tok-kw">const</span> { groups, pinned } = <span class="tok-fn">useSessionTree</span>();'),
    (13, '  <span class="tok-kw">const</span> archived = groups.<span class="tok-fn">filter</span>((g) =&gt; g.archived);'),
])}
  </div>
</section>'''
    detail = (
        '<div style="flex:1;min-height:0;display:flex;padding-top:72px">'
        + '<div style="flex:1;min-width:0;display:flex;flex-direction:column">'
        + _th(_thread()) + "\n" + shell.composer() + "</div>\n"
        + _tree() + "\n" + viewer + "</div>"
    )
    return _win(detail)


def panels_b():
    term = f'''<section class="viewer" style="padding:0 12px 12px">
  {_phead("终端 · 2 个会话", f'<span class="tag">dev 在前台</span><button class="cbtn cbtn--sm">{ICO("plus")}</button>')}
  <div class="term" style="margin:10px 0 0">
    <div class="term__tabs">
      <button class="term-tab is-on">{ICO("terminal")}dev</button>
      <button class="term-tab">{ICO("terminal")}build<span style="opacity:.5;margin-left:2px">×</span></button>
      <button class="term-tab" title="新开">{ICO("plus")}</button>
      <span style="flex:1"></span>
      <button class="term-tab" title="收起">{ICO("chevron-down")}</button>
    </div>
    <div class="term__body">
      <div class="dim"># 来源：pi 执行 npm run dev · 分支 fork/v3-boards</div>
      <div><span class="pr">~/pi-web $</span> npm run dev</div>
      <div class="ok">  ✓ Ready in 1.2s</div>
      <div class="warn">  ⚠ Slow filesystem detected (10.2s)</div>
      <div><span class="pr">~/pi-web $</span> <span class="cur"></span></div>
    </div>
  </div>
  <div style="margin-top:10px;font-size:10.5px;line-height:1.7;color:var(--ink-3)">
    面板头写清「谁的 shell」，页脚写清「跑多久、在哪个分支」——这样切回来不用猜。
  </div>
</section>'''
    detail = (
        '<div style="flex:1;min-height:0;display:flex;padding-top:72px">'
        + '<div style="flex:1;min-width:0;display:flex;flex-direction:column">'
        + _th(_thread()) + "\n" + shell.composer() + "</div>\n"
        + term + "</div>"
    )
    return _win(detail)


def panels_c():
    def row(name, task, state, meta, tone):
        return f'''<div style="display:flex;gap:9px;padding:9px 12px;align-items:flex-start">
  <span style="flex:none;width:16px;display:grid;place-items:center;color:{tone};margin-top:1px">{ICO("git-fork")}</span>
  <div style="flex:1;min-width:0">
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:11.5px;font-weight:600">{name}</span>
      <span class="tag" style="height:16px;font-size:9.5px;color:{tone}">{state}</span>
    </div>
    <div style="margin-top:2px;font-size:10.5px;line-height:1.6;color:var(--ink-2)">{task}</div>
    <div style="margin-top:2px;font-size:10px;color:var(--ink-3)">{meta}</div>
  </div>
</div>'''
    body = (
        _phead("子代理 · 3 个", f'<button class="cbtn cbtn--sm" title="新建">{ICO("plus")}</button>')
        + row("探查 42 个组件", "找所有写死宽度的容器，只读", "已收口", "读 42 个文件 · 1m 12s", "var(--success)")
        + row("找写死宽度", "同上，但只扫 components/", "运行中", "读了 18 个文件 · 42s", "var(--accent)")
        + row("查 typecheck 报错", "tsc 的 3 条 error 逐条定位", "失败", "退出码 2 · 点开看日志", "var(--danger)")
        + '<div style="padding:10px 12px;font-size:10.5px;line-height:1.6;color:var(--ink-3);box-shadow:inset 0 1px 0 var(--line-soft)">'
          '每个子代理有自己的上下文；这里只看状态与结论，切过去才进它的转录。</div>'
    )
    detail = (
        '<div style="flex:1;min-height:0;display:flex;padding-top:72px">'
        + '<div style="flex:1;min-width:0;display:flex;flex-direction:column">'
        + _th(_thread()) + "\n" + shell.composer() + "</div>\n"
        + _panel(body) + "</div>"
    )
    return _win(detail)


def panels_d():
    body = (
        _phead("系统提示词", f'<span class="tag">{ICO("lock")}只读</span><button class="cbtn cbtn--sm">{ICO("copy")}</button>')
        + '<div class="seg" style="margin:10px 12px 0"><button class="is-on">系统提示词</button><button>工具定义</button></div>'
        + '''<div class="pre" style="margin:10px 12px">你是 Pi，一个跑在本地的工作区助手。
工具调用要短、要能回滚；改文件前先说清改哪几处。
回答用中文，代码与路径保持原样。

&lt;env&gt;cwd=/Users/lin/pi-web
shell=zsh  os=darwin&lt;/env&gt;

&lt;rules&gt;
- 不猜文件内容，先读
- 一次只改一处，改完报行号
&lt;/rules&gt;</div>'''
        + '<div style="padding:0 12px 10px;font-size:10.5px;color:var(--ink-3)">1 842 字符 · 每次请求都会带上</div>'
        + '<div style="box-shadow:inset 0 1px 0 var(--line-soft);padding:10px 12px 0;font-size:10.5px;color:var(--ink-3)">工具定义 · 4 个</div>'
        + '''<div class="pre" style="margin:8px 12px 12px"><b>read_file</b>(path)
  只读，返回全文或前 2000 行
<b>edit_file</b>(path, old, new)
  单处替换，失败回滚
<b>run</b>(cmd, cwd?)
  120s 超时，需要授权
<b>apply_patch</b>(patch)
  多文件，整体成功或整体失败</div>'''
    )
    detail = (
        '<div style="flex:1;min-height:0;display:flex;padding-top:72px">'
        + '<div style="flex:1;min-width:0;display:flex;flex-direction:column">'
        + _th(_thread()) + "\n" + shell.composer() + "</div>\n"
        + _panel(body) + "</div>"
    )
    return _win(detail)


def panels_e():
    files = [
        ("components/AppShell.tsx", 12, 4),
        ("components/SessionTree.tsx", 18, 6),
        ("components/sidebar.css", 22, 6),
    ]
    rows = "".join(
        f'''<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:11.5px">
  {ICO("file-diff")}<span class="mono" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">{p}</span>
  <span class="dfile__stat">{add(a)}{dele(d)}</span>
</div>''' for p, a, d in files)
    body = (
        _phead("这一轮的变更", f'<span class="dfile__stat">{add(52)}{dele(16)}</span>')
        + rows
        + '<div class="menu-sep" style="margin:6px 12px"></div>'
        + '''<div style="padding:4px 12px 10px;font-size:10.5px;line-height:1.7;color:var(--ink-3)">
只看不改：这里能看差异、能回退整轮，但不在面板里编辑——编辑去文件面板。</div>'''
        + dfile("components/AppShell.tsx", [
            ("hunk", "", "", "@@ -10,4 +10,6 @@"),
            ("del", "11", "−", '  <span class="tok-kw">const</span> [rightOpen, setRightOpen] = useState(<b class="tok-num">true</b>);'),
            ("add", "11", "+", '  <span class="tok-kw">const</span> [rightOpen, setRightOpen] = useState(<b class="tok-num">false</b>);'),
            ("add", "12", "+", '  <span class="tok-kw">const</span> archived = groups.filter((g) =&gt; g.archived);'),
        ], 2, 1)
    )
    detail = (
        '<div style="flex:1;min-height:0;display:flex;padding-top:72px">'
        + '<div style="flex:1;min-width:0;display:flex;flex-direction:column">'
        + _th(_thread()) + "\n" + shell.composer() + "</div>\n"
        + _panel(body, 380) + "</div>"
    )
    return _win(detail)


# ---------------------------------------------------------------- 文件查看器

def viewer_a():
    def badge(text, tone="var(--warning)"):
        return f'<span class="tag" style="color:{tone}">{text}</span>'
    viewer = f'''<section class="viewer">
  {_tabbar([("file-diff", "AppShell.tsx", True), ("doc-text", "README.md", True)])}
  <div class="code-head" style="gap:10px"><span>components/AppShell.tsx</span><span>·</span><span>可编辑</span>
    <span style="flex:1"></span>
    {badge("未保存")}
    <button class="btn btn--sm">{ICO("uturn-back")}撤销</button>
    <button class="btn btn--sm" style="background:var(--accent);color:var(--on-accent)">保存 ⌘S</button></div>
  <div class="code">
{chr(10).join(f'<div class="cline"><span class="cline__no">{n}</span><span>{t}</span></div>' for n, t in [
    (10, '<span class="tok-kw">export</span> <span class="tok-kw">function</span> <span class="tok-fn">AppShell</span>({ children }: Props) {'),
    (11, '  <span class="tok-kw">const</span> [rightOpen, setRightOpen] = <span class="tok-fn">useState</span>(<span class="tok-num">false</span>);'),
    (12, '  <span class="tok-kw">const</span> { groups, pinned } = <span class="tok-fn">useSessionTree</span>();'),
    (13, '  <span class="tok-kw">const</span> archived = groups.<span class="tok-fn">filter</span>((g) =&gt; g.archived);'),
    (14, ''),
    (15, '  <span class="tok-kw">return</span> ('),
])}
    <div class="cline is-mark"><span class="cline__no">16</span><span>    &lt;div className="shell"&gt;<i class="caret"></i></span></div>
  </div>
  <div style="padding:8px 14px;box-shadow:inset 0 1px 0 var(--line-soft);display:flex;gap:8px;align-items:center;font-size:10.5px;color:var(--ink-3)">
    {ICO("circle-alert")}保存失败：磁盘上的文件已经被外部改动，先选「用磁盘版本」或「覆盖」
    <span style="flex:1"></span><button class="btn btn--sm">用磁盘版本</button><button class="btn btn--sm">覆盖</button>
  </div>
</section>'''
    detail = '<div style="flex:1;min-height:0;display:flex;padding-top:72px">' + _tree() + "\n" + viewer + "</div>"
    return _win(detail)


def viewer_b():
    viewer = f'''<section class="viewer">
  {_tabbar([("doc-text", "README.md", True), ("file-diff", "AppShell.tsx", True)])}
  <div class="code-head" style="gap:10px"><span>design/v3/README.md</span><span>·</span><span>Markdown</span>
    <span style="flex:1"></span>
    <span class="tag">源码</span><span class="tag" style="background:var(--accent-soft);color:var(--accent-ink)">预览</span><span class="tag">差异</span></div>
  <div style="flex:1;overflow:hidden;padding:16px 22px;position:relative">
    <div style="font-size:18px;font-weight:600;letter-spacing:-.015em">Pi Web · V3 设计体系</div>
    <div style="margin-top:6px;font-size:12px;color:var(--ink-3)">外壳、转录、右栏三块，按 droppy 的元素重画。</div>
    <div class="card" style="margin-top:14px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;font-family:var(--mono);font-size:10.5px;color:var(--ink-2)">
      <div><span style="color:var(--ink-3)">title:</span> Pi Web · V3 设计体系</div>
      <div><span style="color:var(--ink-3)">status:</span> draft　<span style="color:var(--ink-3)">updated:</span> 2026-10-25</div>
      <div><span style="color:var(--ink-3)">tags:</span> [shell, transcript, rail]</div>
    </div>
    <div class="prose" style="margin-top:14px">
      <p>这一版不再自己发明控件：窗口、侧栏、chrome row、时间线、树、输入区全部照参考实现重画。</p>
      <h2 style="font-size:14px;margin:12px 0 6px">三区侧栏</h2>
      <p>置顶 / 项目 / 归档，行模型只有一种：<code>srow</code>。</p>
    </div>
    <div style="position:absolute;left:0;right:0;top:0;bottom:0;background:color-mix(in srgb,var(--success) 6%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--success) 24%,transparent);pointer-events:none"></div>
    <div style="position:absolute;right:16px;top:14px;display:flex;gap:6px;align-items:center;padding:6px 10px;border-radius:999px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)">
      <span style="font-size:10.5px">与 HEAD 对比 · 覆盖层</span><button class="btn btn--sm">关闭</button>
    </div>
  </div>
</section>'''
    detail = '<div style="flex:1;min-height:0;display:flex;padding-top:72px">' + _tree() + "\n" + viewer + "</div>"
    return _win(detail)


def viewer_c():
    viewer = f'''<section class="viewer">
  {_tabbar([("image", "shot-2x.png", False), ("file-diff", "AppShell.tsx", True)])}
  <div class="code-head" style="gap:10px"><span>design/v3/.shots/shot-2x.png</span><span>·</span><span>2860 × 1800</span>
    <span style="flex:1"></span>
    <span style="font-size:10.5px;color:var(--ink-2)">缩放</span>
    <span class="seg"><button>适应</button><button class="is-on">100%</button><button>200%</button></span>
    <span class="mono" style="font-size:10.5px">100%</span></div>
  <div style="flex:1;overflow:hidden;display:grid;place-items:center;background:repeating-conic-gradient(var(--fill-1) 0 25%,transparent 0 50%) 0 0/16px 16px">
    <div style="width:420px;height:264px;border-radius:12px;background:linear-gradient(135deg,#e8eee9,#cfd9d2);box-shadow:0 20px 40px -28px rgba(0,0,0,.5);display:grid;place-items:center">
      <span style="font-size:11px;color:#4a5b52">图片本体 · 100% 时按原像素显示</span>
    </div>
  </div>
  <div style="padding:8px 14px;box-shadow:inset 0 1px 0 var(--line-soft);display:flex;gap:10px;align-items:center;font-size:10.5px;color:var(--ink-3)">
    {ICO("info")}缩放值写在工具栏，不盖一层浮层：它是个设置，不是内容
    <span style="flex:1"></span><span>拖到边缘可平移</span>
  </div>
</section>'''
    detail = '<div style="flex:1;min-height:0;display:flex;padding-top:72px">' + _tree() + "\n" + viewer + "</div>"
    return _win(detail)


def viewer_d():
    viewer = f'''<section class="viewer">
  {_tabbar([("globe", "preview.html", False), ("file-diff", "AppShell.tsx", True)])}
  <div class="code-head" style="gap:10px"><span>public/preview.html</span><span>·</span><span>HTML 沙箱</span>
    <span style="flex:1"></span>
    <span class="tag" style="color:var(--warning)">{ICO("shield")}sandbox="allow-scripts" · 无同源</span>
    <button class="btn btn--sm">在浏览器打开</button></div>
  <div style="flex:1;overflow:hidden;padding:0 14px 14px">
    <div style="height:100%;border-radius:12px;box-shadow:inset 0 0 0 1px var(--line);background:var(--surface);display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:8px 12px;box-shadow:inset 0 -1px 0 var(--line-soft);display:flex;gap:6px;align-items:center;font-size:10.5px;color:var(--ink-3)">
        {ICO("lock")}沙箱内文档 · 拿不到父页面的 cookie 与 localStorage
      </div>
      <div style="flex:1;display:grid;place-items:center">
        <div style="text-align:center">
          <div style="font-size:13px;font-weight:600">预览页</div>
          <div style="margin-top:4px;font-size:11px;color:var(--ink-3)">这一层是 iframe，样式与脚本都跑在沙箱里</div>
        </div>
      </div>
    </div>
  </div>
  <div style="padding:8px 14px;box-shadow:inset 0 1px 0 var(--line-soft);display:flex;gap:8px;align-items:center;font-size:10.5px;color:var(--ink-3)">
    三种 iframe 三种权限：HTML 沙箱 · PDF 内置阅读器 · docx 同源
    <span style="flex:1"></span><span class="mono">#page=3</span>
  </div>
</section>'''
    detail = '<div style="flex:1;min-height:0;display:flex;padding-top:72px">' + _tree() + "\n" + viewer + "</div>"
    return _win(detail)


def viewer_e():
    viewer = f'''<section class="viewer">
  {_tabbar([("file", "preview.psd", False), ("file-diff", "AppShell.tsx", True)])}
  <div class="code-head" style="gap:10px"><span>assets/preview.psd</span><span>·</span><span>48.2 MB</span>
    <span style="flex:1"></span>
    <button class="cbtn cbtn--sm" title="文件动作">{ICO("ellipsis")}</button></div>
  <div style="flex:1;overflow:hidden;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
    <div class="card" style="padding:14px 16px;display:flex;gap:12px;align-items:flex-start">
      {ICO("file", "ic ic-lg")}
      <div style="flex:1">
        <div style="font-size:12.5px;font-weight:600">这个格式没法预览</div>
        <div style="margin-top:3px;font-size:11px;line-height:1.65;color:var(--ink-2)">
          二进制格式，预览器只认文本、图片、Markdown、CSV、PDF 与 docx。可以下载，或在访达里用系统应用打开。
        </div>
      </div>
      <button class="btn btn--sm">下载</button>
    </div>
    <div class="card" style="padding:14px 16px;display:flex;gap:12px;align-items:flex-start">
      {ICO("file-diff", "ic ic-lg")}
      <div style="flex:1">
        <div style="font-size:12.5px;font-weight:600">文件已从磁盘删除</div>
        <div style="margin-top:3px;font-size:11px;line-height:1.65;color:var(--ink-2)">
          标签页还在，内容还在内存里。保存会把它写回去；关掉就没了。
        </div>
      </div>
      <button class="btn btn--sm">写回磁盘</button>
    </div>
  </div>
</section>'''
    menu = f'''<div class="menu" style="right:64px;top:96px;min-width:212px">
  <div class="menu-label">assets/preview.psd</div>
  <button class="menu-item">{ICO("download")}下载</button>
  <button class="menu-item">{ICO("open-in")}用系统应用打开</button>
  <div class="menu-sep"></div>
  <button class="menu-item" style="opacity:.42">{ICO("doc-text")}在编辑器里打开</button>
  <button class="menu-item">{ICO("copy")}复制路径</button>
  <div class="menu-sep"></div>
  <button class="menu-item is-danger">{ICO("trash-2")}删除文件…</button>
</div>'''
    detail = '<div style="flex:1;min-height:0;display:flex;padding-top:72px">' + _tree() + "\n" + viewer + "</div>\n" + menu
    return _win(detail)


FRAMES = {
    "web-composer": [("A", composer_a), ("B", composer_b), ("C", composer_c)],
    "web-right-panels": [("A", panels_a), ("B", panels_b), ("C", panels_c), ("D", panels_d), ("E", panels_e)],
    "web-file-viewer-modes": [("A", viewer_a), ("B", viewer_b), ("C", viewer_c), ("D", viewer_d), ("E", viewer_e)],
}
