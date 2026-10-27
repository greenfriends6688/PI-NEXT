# -*- coding: utf-8 -*-
"""转录家族第三批：web-transcript-nav（导航 / 阶段行 / 芯片浮层 / 重试与分支）。"""
from transcript import (
    ICO, step, steps, bubble, grp, prose, stat, filecard, out, raw, code, dfile,
    unread, todo, phase, tag, add, dele, esc,
)
import shell

TICKS = [
    ("右栏现在默认是开的", "有点挤。"),
    ("先读一下现在的外壳", "别急着改。"),
    ("侧栏的三段怎么分", "置顶 / 项目 / 归档，行模型要不要一起动？"),
    ("把工作区外壳重做一下", "侧栏改成三区，右栏默认收起。"),
    ("重构之后的 typecheck", "通过了，但右栏还有 3 处写死宽度。"),
    ("把右栏的默认收起也一起改了", "顺便把 ⌘B 留给右栏。"),
]


def _win(detail):
    return shell.win(detail)


def _row(no, title, sub, tools, now=False):
    cls = "map-row is-now" if now else "map-row"
    badge = f'<span class="map-row__tools">{tools}</span>' if tools else ""
    return f'''<button class="{cls}">
  <span class="map-row__no">{no}{badge}</span>
  <span class="map-row__text"><span class="map-row__title">{title}</span><span class="map-row__sub">{sub}</span></span>
</button>'''


def nav_a():
    panel = f'''<aside class="map-panel" style="margin-top:72px">
  <div class="map-panel__head">{ICO("list-tree")}会话大纲 · 18 条<span style="flex:1"></span><button class="cbtn cbtn--sm" title="收起">{ICO("xmark")}</button></div>
  <div style="flex:1;overflow:hidden">
{_row("01", "右栏现在默认是开的", "你 · 有点挤。", "1")}
{_row("02", "先读一下现在的外壳", "pi · 读了 AppShell.tsx", "3")}
{_row("03", "侧栏的三段怎么分", "你 · 置顶 / 项目 / 归档", "1")}
{_row("04", "把工作区外壳重做一下", "pi · 编辑 2 个文件", "7", now=True)}
{_row("05", "重构之后的 typecheck", "pi · 0 error", "2")}
{_row("06", "把右栏的默认收起也一起改了", "你 · 顺便把 ⌘B 留给右栏", "1")}
{_row("07", "等 typecheck 跑完", "pi · 运行中", "")}
  </div>
  <div style="padding:10px 14px;font-size:10.5px;color:var(--ink-3);border-top:1px solid var(--line-soft)">
    编号是消息序号，徽章是这一条里的工具调用数。
  </div>
</aside>'''
    inner = [
        bubble("把工作区外壳重做一下：侧栏改成三区，右栏默认收起。"),
        grp("用时 1m 18s", closed=True),
        steps(
            step("doc-text", "读取", "components/AppShell.tsx", d=0.02),
            step("search", "搜索", "pinnedSection | groupOrder", d=0.12),
            step("pencil", "编辑", "components/AppShell.tsx", stat=stat(48, 12), last=True, d=0.22),
        ),
        prose("外壳拆完了，行模型没动。"),
    ]
    rail = shell.rail(TICKS).replace('<div class="rail"', '<div class="rail" style="width:36px"')
    detail = (
        rail + "\n"
        + f'<div style="flex:1;min-height:0;display:flex">\n{shell.thread(chr(10).join(inner))}\n{panel}\n</div>\n'
        + shell.composer()
    )
    return _win(detail)


def nav_b():
    files = [
        ("components/AppShell.tsx", 48, 12, "file-diff"),
        ("components/SessionTree.tsx", 64, 18, "file-diff"),
        ("components/sidebar.css", 22, 6, "doc-text"),
        ("lib/session-groups.ts", 8, 0, "file-diff"),
    ]
    rows = "\n".join(
        f'''<div class="crow">
  <div class="crow__control"><span class="rowicon">{ICO(icon)}</span></div>
  <div class="crow__text"><div class="crow__title mono" style="font-size:11.5px">{p}</div></div>
  <div class="crow__control"><span class="dfile__stat">{add(a)}{dele(d)}</span></div>
</div>
<div class="cdivider"></div>'''
        for p, a, d, icon in files
    )
    inner = [
        bubble("阶段行、改过的文件、用到的技能都摆一下。"),
        phase("探索 · 读 4 个文件", "done", "42s"),
        phase("实现 · 编辑 3 个文件", "on", "1m 08s"),
        phase("验证 · typecheck + 62 条单测", "", "待开始"),
        phase("收口 · 写总结", "", "待开始"),
        prose("阶段行只占一行，高度永远不变——四个相位切换时，下面的步骤树不会跳。"),
        f'''<div class="card" style="padding:0 14px">
  <div class="sec-head" style="padding:10px 0 6px">这一轮改了 4 个文件<span class="count">+142 −36</span></div>
{rows.rstrip()}
</div>''',
        f'''<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
  <span style="font-size:11px;color:var(--ink-3)">用到的技能</span>
  {tag("frontend-design", "sparkle")}
  {tag("code-review", "shield-check")}
  {tag("changelog", "doc-text")}
</div>''',
    ]
    detail = shell.thread("\n".join(inner)) + "\n" + shell.composer()
    return _win(detail)


def nav_c():
    proj_menu = f'''<div class="menu" style="left:284px;top:104px;min-width:232px">
  <div class="menu-label">PI NEXT · 4 个会话</div>
  <button class="menu-item">{ICO("folder-fill")}在访达里显示</button>
  <button class="menu-item">{ICO("terminal")}在这里开终端</button>
  <button class="menu-item">{ICO("square-pencil")}新建会话</button>
  <div class="menu-sep"></div>
  <button class="menu-item">{ICO("archive")}归档这个项目</button>
  <button class="menu-item is-danger">{ICO("trash-2")}移除项目…</button>
</div>'''
    git_menu = f'''<div class="menu" style="left:556px;top:104px;min-width:246px">
  <div class="menu-label">fork/v3-boards · 领先 main 7 个提交</div>
  <button class="menu-item">{ICO("git-fork")}切换到 main<span class="menu-item__kbd">⌘⇧M</span></button>
  <button class="menu-item">{ICO("branch")}新建分支…</button>
  <div class="menu-sep"></div>
  <button class="menu-item">{ICO("download")}拉取远端</button>
  <button class="menu-item">{ICO("arrow-up")}推送 7 个提交</button>
  <div class="menu-sep"></div>
  <button class="menu-item">{ICO("plusminus")}与 main 对比</button>
</div>'''
    todo_pop = f'''<div class="card" style="position:absolute;right:16px;top:170px;width:262px;padding:12px 14px;z-index:42;box-shadow:inset 0 0 0 1px var(--line),0 20px 40px -28px rgba(0,0,0,.4)">
  <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ink-3)">{ICO("checklist")}待办 · 只读</div>
  <div class="todo__row" style="padding:5px 0">{ICO("check")}<span>读 AppShell 与 SessionTree</span></div>
  <div class="todo__row" style="padding:5px 0">{ICO("circle-dotted")}<span>拆三区</span></div>
  <div class="todo__row is-pending" style="padding:5px 0">{ICO("circle")}<span>右栏默认收起</span></div>
  <div style="margin-top:6px;font-size:10.5px;color:var(--ink-3)">待办由 pi 维护，你只能看——改它请直接说。</div>
</div>'''
    path_menu = f'''<div class="menu" style="left:356px;top:452px;min-width:212px">
  <div class="menu-label">components/AppShell.tsx</div>
  <button class="menu-item">{ICO("doc-text")}在文件面板打开</button>
  <button class="menu-item">{ICO("open-in")}在编辑器里打开</button>
  <div class="menu-sep"></div>
  <button class="menu-item">{ICO("copy")}复制相对路径</button>
  <button class="menu-item">{ICO("copy")}复制绝对路径</button>
</div>'''

    inner = [
        bubble("项目芯片、待办芯片、分支芯片，点开都是真的。"),
        grp("用时 52s", closed=True),
        steps(
            step("doc-text", "读取", '<span style="border-bottom:1px dashed var(--ink-4)">components/AppShell.tsx</span>', d=0.02),
            step("pencil", "编辑", "components/AppShell.tsx", stat=stat(48, 12), last=True, d=0.12),
        ),
        prose("路径上的动作不在行尾堆图标：点路径本身才开，三件事都在菜单里。"),
    ]
    chrome = shell.chrome(
        right=f'''<div class="chrome__right">
          <div class="ccap">
            <button class="cbtn" title="项目">{ICO("folder-fill")}</button>
            <i class="cdiv"></i>
            <button class="cbtn" title="待办">{ICO("checklist")}</button>
          </div>
          <div class="ccap">
            <button class="cbtn" title="终端">{ICO("terminal")}</button>
            <i class="cdiv"></i>
            <button class="cbtn is-on" title="变更">{ICO("plusminus")}</button>
          </div>
        </div>''',
    )
    detail = (
        shell.thread("\n".join(inner)) + "\n"
        + proj_menu + "\n" + git_menu + "\n" + todo_pop + "\n" + path_menu + "\n"
        + shell.composer()
    )
    return _win(detail)


def nav_d():
    forkbar = f'''<div class="forkbar">{ICO("git-fork")}<span>这是从「把工作区外壳重做一下」分出来的<b>探索分支</b> · 只读</span><span class="forkbar__back">回到主线</span></div>'''
    retry = f'''<div class="retry">{ICO("refresh")}上游 529，已自动重试 2 次<span class="retry__meta">4s 后重试 · 点此立刻重试</span></div>'''
    panes = f'''<aside style="width:420px;flex:none;display:flex;flex-direction:column;gap:10px;padding:72px 14px 12px;box-shadow:inset 1px 0 0 var(--line-soft)">
  <div style="display:flex;align-items:center;gap:8px">
    <span style="font-size:11px;color:var(--ink-3)">两个模型并排，只读</span>
    <span style="flex:1"></span>
    <button class="btn btn--sm">{ICO("uturn-back")}带回结论</button>
  </div>
  <div style="display:flex;gap:10px;align-items:flex-start">
    <div class="ro-pane" style="flex:1">
      <div class="ro-pane__head">{ICO("pi")}Claude Sonnet 4.6</div>
      <div>侧栏 268 是写死的，右栏 400 也是。1440 下转录只剩 750，低于 820 的理想列宽。</div>
      <div style="color:var(--ink-3)">建议：右栏默认收起，⌘B 叫回来。</div>
    </div>
    <div class="ro-pane" style="flex:1">
      <div class="ro-pane__head">{ICO("pi")}GPT-5.2</div>
      <div>先把右栏改成可拖拽宽度，再谈默认值——写死 400 才是根因。</div>
      <div style="color:var(--ink-3)">结论不同：它想先改宽度，不是先收起。</div>
    </div>
  </div>
  <div style="font-size:10.5px;line-height:1.6;color:var(--ink-3)">
    两边都不能输入：分支里的对话只在主线上写。「带回结论」把选中的那段追加到主线末尾。
  </div>
</aside>'''
    inner = [
        forkbar,
        bubble("试试让两个模型分别看一下右栏宽度的问题。"),
        retry,
        grp("用时 34s", closed=True),
        steps(
            step("search", "搜索", "width: 400 | width: 268", d=0.02),
            step("doc-text", "读取", "components/sidebar.css", last=True, d=0.12),
        ),
        prose("探索分支不改主线：这边看到的、选中的，只有「带回结论」那一下会写回主线。"),
    ]
    detail = (
        f'<div style="flex:1;min-height:0;display:flex">\n{shell.thread(chr(10).join(inner))}\n{panes}\n</div>\n'
        + shell.composer()
    )
    return _win(detail)


FRAMES = {"web-transcript-nav": [("A", nav_a), ("B", nav_b), ("C", nav_c), ("D", nav_d)]}
