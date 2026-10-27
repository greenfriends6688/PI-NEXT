# -*- coding: utf-8 -*-
"""菜单与浮层家族：web-topbar-popovers / web-menus-atlas。"""
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


def mi(icon, text, kbd="", on=False, danger=False):
    cls = "menu-item"
    if on:
        cls += " is-on"
    if danger:
        cls += " is-danger"
    k = f'<span class="menu-item__kbd">{kbd}</span>' if kbd else ""
    return f'<button class="{cls}">{ICO(icon)}{text}{k}</button>'


def prow(icon, title, sub="", meta="", on=False, check=False):
    cls = "prow is-on" if on else "prow"
    s = f'<span class="prow__sub">{sub}</span>' if sub else ""
    m = f'<span class="prow__meta">{meta}</span>' if meta else ""
    tail = ICO("check", "ic ic-sm") if check else m
    return f'''<button class="{cls}">
  <span style="flex:none;width:16px;display:grid;place-items:center;color:var(--ink-2)">{ICO(icon)}</span>
  <span class="prow__text"><span class="prow__title">{title}</span>{s}</span>
  {tail}
</button>'''


def pop(title, body, x, y, w, foot=None, flush=False, icon=None, extra=""):
    lead = ICO(icon) if icon else ""
    f = f'<div class="pop__foot">{foot}</div>' if foot else ""
    return f'''<div class="pop" style="left:{x}px;top:{y}px;width:{w}px;{extra}">
  <div class="pop__head">{lead}<span class="pop__title">{title}</span><button class="cbtn cbtn--sm" title="关闭">{ICO("xmark")}</button></div>
  <div class="pop__body{(' is-flush' if flush else '')}">{body}</div>
  {f}
</div>'''


# ---------------------------------------------------------------- 顶栏浮层

def top_a():
    prompt = '''<div class="pre"><b>你是 Pi，一个跑在本地的工作区助手。</b>
工具调用要短、要能回滚；改文件前先说清改哪几处。
回答用中文，代码与路径保持原样。
&lt;env&gt;cwd=/Users/lin/pi-web  shell=zsh  os=darwin&lt;/env&gt;</div>'''
    tools = '''<div class="pre"><b>read_file</b>(path) · 只读，返回全文或前 2000 行
<b>edit_file</b>(path, old, new) · 单处替换，失败会回滚
<b>run</b>(cmd, cwd?) · 120s 超时，需要授权
<b>apply_patch</b>(patch) · 多文件，整体成功或整体失败</div>'''
    body = f'''<div class="seg" style="margin-bottom:10px">
  <button class="is-on">系统提示词</button>
  <button>工具定义</button>
</div>
{prompt}
<div style="margin-top:8px;font-size:10.5px;color:var(--ink-3)">1 842 字符 · 每次请求都会带上，改它请去设置 → 通用。</div>'''
    p = pop("只读诊断", body, 736, 58, 420,
            foot=f'{ICO("lock")}只读 · 这里改不了任何东西', icon="info")

    inner = [
        bubble("这次请求到底带了什么？"),
        grp("用时 12s", closed=True),
        prose("顶栏那颗 ⓘ 打开的就是这张卡：系统提示词与工具定义，原样可读，一个字都不能编辑。"),
        steps(step("info", "查看诊断", "系统提示词 · 4 个工具", last=True, d=0.02)),
    ]
    chrome = shell.chrome(right=f'''<div class="chrome__right">
          <div class="ccap">
            <button class="cbtn is-on" title="只读诊断">{ICO("info")}</button>
            <i class="cdiv"></i>
            <button class="cbtn" title="文件">{ICO("folder-fill")}</button>
          </div>
          <div class="ccap">
            <button class="cbtn" title="终端">{ICO("terminal")}</button>
            <i class="cdiv"></i>
            <button class="cbtn" title="变更">{ICO("plusminus")}</button>
          </div>
        </div>''')
    return shell.win(shell.thread("\n".join(inner)) + "\n" + p + "\n" + shell.composer(), chrome_html=chrome)


def top_b():
    agents = f'''{prow("pi", "主线", "当前会话", meta="3 轮")}
{prow("git-fork", "子代理 · 探查 42 个组件", "已收口 · 用时 1m 12s", meta="只读", on=True, check=True)}
{prow("git-fork", "子代理 · 找写死宽度", "运行中 · 读了 18 个文件", meta="")}
{prow("square-pencil", "新建子代理…", "让它单独去查一件事", meta="⌘⇧A")}'''
    p1 = pop("切换子代理", agents, 558, 58, 340, flush=True, foot=f'{ICO("info")}子代理有自己的上下文，切过去只看它那段。')
    recent = f'''<div class="menu" style="left:906px;top:58px;min-width:250px">
  <div class="menu-label">最近会话</div>
  {mi("text-bubble", "把右栏的默认收起也一起改了", "刚刚", on=True)}
  {mi("text-bubble", "令牌只写一次：running.css", "2h")}
  {mi("text-bubble", "V5 落地清单跑到第几批了", "3h")}
  {mi("text-bubble", "文件面板的 diff 视图", "昨天")}
  <div class="menu-sep"></div>
  {mi("search", "搜全部会话", "⌘K")}
</div>'''
    inner = [
        bubble("把子代理和最近会话都叫出来。"),
        grp("用时 8s", closed=True),
        prose("两个浮层同时开着也不打架：左边是层级（主线 → 子代理），右边是时间（最近打开）。"),
    ]
    chrome = shell.chrome(right=f'''<div class="chrome__right">
          <div class="ccap">
            <button class="cbtn is-on" title="切换子代理">{ICO("git-fork")}</button>
            <i class="cdiv"></i>
            <button class="cbtn is-on" title="最近会话">{ICO("history")}</button>
          </div>
          <div class="ccap">
            <button class="cbtn" title="终端">{ICO("terminal")}</button>
            <i class="cdiv"></i>
            <button class="cbtn" title="变更">{ICO("plusminus")}</button>
          </div>
        </div>''')
    return shell.win(shell.thread("\n".join(inner)) + "\n" + p1 + "\n" + recent + "\n" + shell.composer(), chrome_html=chrome)


def top_c():
    branches = f'''{prow("branch", "main", "上游 · 3 天前拉过", meta="")}
{prow("branch", "fork/v3-boards", "领先 main 7 个提交 · 当前", meta="", on=True, check=True)}
{prow("branch", "feat/pwa-shell", "落后 2 个提交", meta="")}
{prow("branch", "fix/sidebar-268", "已合并到 main", meta="")}'''
    p1 = pop("已有分支", branches, 498, 58, 330, flush=True,
             foot=f'{ICO("info")}只切分支，不 stash。有未提交改动时会先问。')
    plugins = f'''{prow("puzzle", "filesystem", "MCP · 读本地文件", meta="已连接")}
{prow("puzzle", "github", "MCP · PR 与 issue", meta="掉线", on=True)}
{prow("sparkle", "frontend-design", "技能 · 版式与配色", meta="启用")}
{prow("sparkle", "code-review", "技能 · 按仓库规矩评审", meta="启用")}
{prow("sparkle", "changelog", "技能 · 生成发布说明", meta="停用")}'''
    p2 = pop("插件", plugins, 836, 58, 320, flush=True,
             foot=f'{ICO("refresh")}github 重连 2 次失败 · 点开看日志')
    inner = [
        bubble("分支和插件都在顶栏，点开就是只读列表。"),
        grp("用时 6s", closed=True),
        prose("两枚都是「看」不是「管」：切分支、看连接状态，改配置还是回设置里。"),
    ]
    chrome = shell.chrome(right=f'''<div class="chrome__right">
          <div class="ccap">
            <button class="cbtn is-on" title="分支">{ICO("branch")}</button>
            <i class="cdiv"></i>
            <button class="cbtn is-on" title="插件">{ICO("puzzle")}</button>
          </div>
          <div class="ccap">
            <button class="cbtn" title="终端">{ICO("terminal")}</button>
            <i class="cdiv"></i>
            <button class="cbtn" title="变更">{ICO("plusminus")}</button>
          </div>
        </div>''')
    return shell.win(shell.thread("\n".join(inner)) + "\n" + p1 + "\n" + p2 + "\n" + shell.composer(), chrome_html=chrome)


def top_d():
    findbar = f'''<div class="findbar">
  {ICO("search")}
  <input value="右栏" aria-label="会话内查找">
  <span class="findbar__count">3 / 12</span>
  <button class="cbtn cbtn--sm" title="上一个">{ICO("chevron-up")}</button>
  <button class="cbtn cbtn--sm" title="下一个">{ICO("chevron-down")}</button>
  <i class="cdiv"></i>
  <button class="cbtn cbtn--sm" title="关闭">{ICO("xmark")}</button>
</div>'''
    naming = f'''{prow("check", "已自动命名", "「把右栏的默认收起也一起改了」", meta="刚刚", on=True, check=True)}
{prow("circle-dotted", "正在生成标题…", "读前 2 轮，约 3s", meta="")}
{prow("circle-alert", "命名失败", "模型返回空，可以重播", meta="")}
{prow("refresh", "重播一次", "不覆盖你手改过的名字", meta="⌘⇧N")}'''
    p1 = pop("自动命名 · 三态", naming, 556, 100, 356, flush=True,
             foot=f'{ICO("info")}命名只在没手动改过标题时生效。')
    export = f'''<div class="menu" style="left:920px;top:100px;min-width:236px">
  <div class="menu-label">导出 Markdown</div>
  {mi("download", "整条会话", "⌘⇧E")}
  {mi("download", "只导这一轮")}
  {mi("download", "只导工具输出")}
  <div class="menu-sep"></div>
  {mi("copy", "复制到剪贴板")}
  {mi("folder-fill", "导出到…")}
</div>'''
    inner = [
        bubble("查找条、自动命名、导出，这三件都在原地发生。"),
        grp("用时 5s", closed=True),
        prose("查找条压在顶栏下面一行，不挤走任何内容；命名与导出都是浮层，关掉就回到原样。"),
    ]
    return shell.win(findbar + "\n" + shell.thread("\n".join(inner)) + "\n" + p1 + "\n" + export + "\n" + shell.composer())


# ---------------------------------------------------------------- 菜单原子表

def atlas_a():
    def row(label, sample):
        return f'<div class="ax__label">{label}</div><div>{sample}</div>'

    states = "".join([
        row("默认", f'<div class="menu" style="position:relative;left:auto;top:auto;width:212px;min-width:0">{mi("pencil", "重命名")}</div>'),
        row("悬停", f'<div class="menu" style="position:relative;left:auto;top:auto;width:212px;min-width:0"><button class="menu-item" style="background:var(--fill-1)">{ICO("pencil")}重命名</button></div>'),
        row("选中 / 当前", f'<div class="menu" style="position:relative;left:auto;top:auto;width:212px;min-width:0">{mi("check", "受监督", "", on=True)}</div>'),
        row("带快捷键", f'<div class="menu" style="position:relative;left:auto;top:auto;width:212px;min-width:0">{mi("arrow-up", "推送", "⌘⇧P")}</div>'),
        row("带勾选", f'<div class="menu" style="position:relative;left:auto;top:auto;width:212px;min-width:0">{mi("check", "跟随系统", "")}</div>'),
        row("禁用", f'<div class="menu" style="position:relative;left:auto;top:auto;width:212px;min-width:0"><button class="menu-item" style="opacity:.42">{ICO("download")}导出（无变更）</button></div>'),
        row("危险", f'<div class="menu" style="position:relative;left:auto;top:auto;width:212px;min-width:0">{mi("trash-2", "删除会话…", "", danger=True)}</div>'),
        row("分组标签 / 分隔线", f'<div class="menu" style="position:relative;left:auto;top:auto;width:212px;min-width:0"><div class="menu-label">会话</div><div class="menu-sep"></div>{mi("archive", "归档")}</div>'),
    ])
    inner = [
        prose("后面每一个菜单都是这三块的拼装：<b>行八态</b>（默认 / 悬停 / 选中 / 快捷键 / 勾选 / 禁用 / 危险 / 标签与分隔线）、"
              "<b>结构件</b>（标签、分隔线、搜索头、页脚）、<b>尺寸口径</b>（行 28、图标 13、圆角 7、面板内边距 6）。"),
        f'<div class="card" style="padding:14px 16px"><div class="ax" style="gap:8px 14px">{states}</div></div>',
        prose("危险项永远沉底并单独成组；禁用项不隐藏——它告诉你「这里本来能做什么」。"),
    ]
    detail = shell.thread("\n".join(inner)) + "\n" + shell.composer()
    return shell.win(detail)


def atlas_b():
    overflow = f'''<div class="menu" style="position:relative;left:auto;top:auto;min-width:236px">
  <div class="menu-label">更多</div>
  {mi("info", "只读诊断")}
  {mi("history", "最近会话", "⌘E")}
  {mi("puzzle", "插件")}
  <div class="menu-sep"></div>
  {mi("doc-text", "导出 Markdown")}
  {mi("keyboard", "快捷键", "⌘/")}
</div>'''
    session = f'''<div class="menu" style="position:relative;left:auto;top:auto;min-width:236px">
  <div class="menu-label">V5 落地清单跑到第几批了</div>
  {mi("pin", "置顶会话")}
  {mi("pen-line", "重命名")}
  {mi("wand-sparkles", "生成标题")}
  <div class="menu-sep"></div>
  {mi("git-fork", "复制这条分支")}
  {mi("download", "导出 Markdown")}
  <div class="menu-sep"></div>
  {mi("archive", "归档")}
  {mi("trash-2", "删除会话…", "", danger=True)}
</div>'''
    filemenu = f'''<div class="menu" style="position:relative;left:auto;top:auto;min-width:236px">
  <div class="menu-label">components/AppShell.tsx</div>
  {mi("doc-text", "打开")}
  {mi("open-in", "在编辑器里打开")}
  {mi("plusminus", "查看变更")}
  <div class="menu-sep"></div>
  {mi("copy", "复制相对路径")}
  {mi("copy", "复制绝对路径")}
  <div class="menu-sep"></div>
  {mi("trash-2", "删除文件…", "", danger=True)}
</div>'''
    dirmenu = f'''<div class="menu" style="position:relative;left:auto;top:auto;min-width:236px">
  <div class="menu-label">components</div>
  {mi("folder-fill", "折叠")}
  {mi("square-pencil", "新建文件…")}
  {mi("square-pencil", "新建文件夹…")}
  <div class="menu-sep"></div>
  {mi("copy", "复制路径")}
  {mi("terminal", "在这里开终端")}
  <div class="menu-sep"></div>
  {mi("trash-2", "删除文件夹…", "", danger=True)}
</div>'''
    def col(title, note, menu):
        return f'''<div style="display:flex;flex-direction:column;gap:8px;flex:1;min-width:0">
  <div style="font-size:11px;font-weight:600">{title}</div>
  {menu}
  <div style="font-size:10.5px;line-height:1.6;color:var(--ink-3)">{note}</div>
</div>'''
    rules = f'''<div class="card" style="margin-top:16px;padding:12px 16px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px 18px">
  <div style="font-size:10.5px;color:var(--ink-3)">危险项</div><div style="font-size:11.5px">永远沉底，前面加一条分隔线，单独成组</div>
  <div style="font-size:10.5px;color:var(--ink-3)">快捷键</div><div style="font-size:11.5px">右对齐、10.5px、不加底色</div>
  <div style="font-size:10.5px;color:var(--ink-3)">标题</div><div style="font-size:11.5px">用被操作对象的原名，不加「文件 / 会话」</div>
  <div style="font-size:10.5px;color:var(--ink-3)">禁用项</div><div style="font-size:11.5px">保留、降透明度，不隐藏——它说明这里本来能做什么</div>
</div>'''
    body = f'''<div style="flex:1;min-height:0;overflow:hidden;padding:60px 20px 20px;display:flex;flex-direction:column;justify-content:center">
<div style="display:flex;gap:16px;align-items:flex-start">
{col("顶栏溢出", "触发钮在最右，所以菜单右对齐。", overflow)}
{col("会话行右键", "危险项单独成组，中间空一行。", session)}
{col("文件树右键（文件）", "路径当标题，不放「文件」两个字。", filemenu)}
{col("文件树右键（目录）", "目录多「在这里开终端」。", dirmenu)}
</div>
{rules}
</div>'''
    return shell.win(body)


def atlas_c():
    taskmenu = f'''<div class="pop" style="position:relative;left:auto;top:auto;width:280px">
  <div class="pop__head">{ICO("square-pencil")}<span class="pop__title">新建任务</span></div>
  <div class="pop__body is-flush">
{prow("panel-left", "重构侧栏", "把置顶 / 项目 / 归档拆成三段", meta="")}
{prow("bug", "查一个回归", "缓存提示在重连后不出现", meta="")}
{prow("book-open", "解释这段代码", "rpc-manager 里 lease 的作用", meta="")}
  </div>
  <div class="pop__foot">{ICO("command")}按 ⌘1–3 直接选</div>
</div>'''
    ws = f'''<div class="pop" style="position:relative;left:auto;top:auto;width:300px">
  <div class="pop__head">{ICO("folder-fill")}<span class="pop__title">切换工作区</span></div>
  <div class="pop__body is-flush">
{prow("folder-fill", "pi-web", "fork/v3-boards · 6 个会话", on=True, check=True)}
{prow("folder-fill", "tivano", "feat/pwa · 2 个会话", meta="")}
{prow("folder-fill", "pi-web-design", "main · 4 个会话", meta="")}
{prow("plus", "添加目录…", "支持多选，会记住上次的父目录", meta="")}
  </div>
</div>'''
    pathcluster = f'''<div class="card" style="padding:12px 14px;display:flex;flex-direction:column;gap:10px">
  <div style="font-size:10.5px;color:var(--ink-3)">默认 · 路径后跟一枚 ⌄</div>
  <div style="font-size:12px">components/AppShell.tsx <span style="color:var(--ink-4)">⌄</span></div>
  <div style="font-size:10.5px;color:var(--ink-3)">悬停 · 两枚动作挤进来</div>
  <div style="font-size:12px;display:flex;align-items:center;gap:6px">components/AppShell.tsx
    <button class="cbtn cbtn--sm">{ICO("copy")}</button><button class="cbtn cbtn--sm">{ICO("open-in")}</button></div>
  <div style="font-size:10.5px;color:var(--ink-3)">点开 · 菜单锚在路径上</div>
  <div class="menu" style="position:relative;left:auto;top:auto;width:212px;min-width:0">{mi("doc-text", "在文件面板打开")}{mi("open-in", "在编辑器里打开")}{mi("copy", "复制路径")}</div>
  <div style="font-size:10.5px;color:var(--ink-3)">不可用 · 路径已删</div>
  <div style="font-size:12px;opacity:.42;text-decoration:line-through">components/OldShell.tsx</div>
</div>'''
    tabs = f'''<div class="pop" style="position:relative;left:auto;top:auto;width:300px">
  <div class="pop__head">{ICO("columns-2")}<span class="pop__title">标签页总览</span><span class="tag">4 个</span></div>
  <div class="pop__body is-flush">
{prow("doc-text", "AppShell.tsx", "components · 已修改", meta="1")}
{prow("doc-text", "sidebar.css", "components · 已修改", meta="2")}
{prow("file-diff", "running.css", "design/v3/assets · 只读", meta="3")}
{prow("terminal", "dev", "终端 · 运行中", meta="4")}
  </div>
  <div class="pop__foot">{ICO("xmark")}⌘W 关当前 · ⌘⇧W 全关</div>
</div>'''
    def cell(title, node, note, w):
        return f'''<div style="display:flex;flex-direction:column;gap:10px">
  <div style="font-size:11px;font-weight:600">{title}</div>
  <div style="width:{w}px">{node}</div>
  <div style="font-size:10.5px;line-height:1.6;color:var(--ink-3);max-width:{w}px">{note}</div>
</div>'''
    body = f'''<div style="flex:1;min-height:0;overflow:hidden;padding:78px 22px 20px;display:grid;grid-template-columns:1fr 1fr;gap:22px 26px;align-content:start">
{cell("新建任务", taskmenu, "三个起步项，不是「历史记录」——空会话里给你一个开始的地方。", 300)}
{cell("工作区切换器", ws, "长菜单带搜索头：超过 8 项就在顶上钉一个搜索框，滚的时候不跟着走。", 320)}
{cell("路径动作簇四态", pathcluster, "默认只跟一枚 ⌄；悬停才挤进两枚动作；点开菜单锚在路径上；路径没了就划掉。", 420)}
{cell("标签页总览", tabs, "「我开了什么」的答案，编号对应 ⌘1–4。", 320)}
</div>'''
    return shell.win(body)


def atlas_d():
    groups = [
        ("会话行 ⋯ / 右键", [
            ("置顶会话", "pin"), ("取消置顶", "pin"), ("重命名", "pen-line"), ("生成标题", "wand-sparkles"),
            ("复制这条分支", "git-fork"), ("导出 Markdown", "download"), ("查看这一轮的变更", "plusminus"),
            ("归档", "archive"), ("删除会话…", "trash-2"),
        ]),
        ("项目行 ⋯", [
            ("在访达里显示", "folder-fill"), ("在这里开终端", "terminal"), ("新建会话", "square-pencil"),
            ("新建 worktree…", "branch"), ("项目设置", "gear"), ("移除项目…", "trash-2"),
        ]),
        ("文件树右键", [
            ("打开", "doc-text"), ("在编辑器里打开", "open-in"), ("查看变更", "plusminus"),
            ("复制相对路径", "copy"), ("复制绝对路径", "copy"), ("删除文件…", "trash-2"),
        ]),
        ("顶栏溢出", [
            ("只读诊断", "info"), ("最近会话", "history"), ("插件", "puzzle"),
            ("导出 Markdown", "doc-text"), ("快捷键", "keyboard"),
        ]),
        ("输入区 +", [
            ("照片", "image"), ("文件", "file"), ("终端输出", "terminal"), ("技能", "sparkle"),
        ]),
        ("模型 chip", [
            ("Claude Sonnet 4.6", "circle-dotted"), ("Claude Opus 4.6", "circle-dotted"),
            ("推理强度：低 / 中 / 高", "chart-column"), ("管理模型…", "gear"),
        ]),
    ]
    cols = []
    for title, items in groups:
        rows = "\n".join(
            f'<div style="display:flex;align-items:center;gap:7px;height:24px;font-size:11.5px;'
            f'{"color:var(--danger)" if "删除" in t or "移除" in t else ""}">{ICO(i, "ic ic-sm")}{t}</div>'
            for t, i in items
        )
        cols.append(f'''<div style="flex:1;min-width:0">
  <div style="font-size:10.5px;color:var(--ink-3);margin-bottom:6px">{title}<span style="color:var(--ink-4)"> · {len(items)} 项</span></div>
  {rows}
</div>''')
    body = f'''<div style="flex:1;min-height:0;overflow:hidden;padding:78px 22px 20px;display:flex;flex-direction:column;gap:16px">
  <div style="font-size:11.5px;line-height:1.65;color:var(--ink-2);max-width:900px">
    六组菜单的逐条清单，项与文案都来自源码。<b>不多不少</b>——画板上有的，产品里必须能点到；产品里有的，画板上必须画出来。
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:18px 26px">{''.join(cols)}</div>
  <div class="card" style="margin-top:auto;padding:12px 16px;display:grid;grid-template-columns:repeat(3,1fr);gap:6px 20px">
    <div style="font-size:10.5px;color:var(--ink-3)">合计</div><div style="font-size:11.5px;grid-column:span 2">6 组 38 项 · 其中危险项 5 项，全部沉底</div>
    <div style="font-size:10.5px;color:var(--ink-3)">验收方式</div><div style="font-size:11.5px;grid-column:span 2">对着这张表逐个点：少一项算漏，多一项算编</div>
  </div>
</div>'''
    return shell.win(body)


FRAMES = {
    "web-topbar-popovers": [("A", top_a), ("B", top_b), ("C", top_c), ("D", top_d)],
    "web-menus-atlas": [("A", atlas_a), ("B", atlas_b), ("C", atlas_c), ("D", atlas_d)],
}
