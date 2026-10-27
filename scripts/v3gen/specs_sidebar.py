# -*- coding: utf-8 -*-
"""侧栏细节：web-sidebar-detail（5 帧）。"""
from transcript import ICO, step, steps, bubble, grp, prose, tag
import shell

PROJ = "PI NEXT"


def tools(search=False, activity=False):
    """侧栏工具行。默认态没有搜索格——搜索格只在搜索态出现（帧 E）。"""
    out = ['<div class="side__tools">']
    out.append(f'<button class="ghost-btn" title="新建会话">{ICO("square-pencil", "ic ic-sm")}</button>')
    out.append(f'<button class="ghost-btn" data-side-search title="搜索会话（⌘K）">{ICO("search", "ic ic-sm")}</button>')
    out.append('<span class="spacer"></span>')
    out.append(f'<button class="ghost-btn{" is-on" if activity else ""}" title="活动视图">{ICO("bell", "ic ic-sm")}</button>')
    if search:
        out.append(f'<label class="field">{ICO("search")}<input placeholder="搜索会话" aria-label="搜索会话" value="右栏"></label>')
    out.append("</div>")
    return "\n".join(out)


def row(icon, title, trail="", cls="srow", sub=False, tag_html="", extra=""):
    if icon.startswith("<"):
        ico = icon
    elif icon == "pi":
        ico = ICO("pi", "ic ic-sm pi-mark")
    else:
        ico = ICO(icon, "ic ic-sm")
    tcls = "srow__title srow__sub" if sub else "srow__title"
    tr = f'<span class="srow__trail">{trail}</span>' if trail else ""
    return (f'<button class="{cls}"><span class="srow__badge">{ico}</span>'
            f'<span class="{tcls}">{title}</span>{tr}{tag_html}</button>')


def proj_row(name, n, open_=True, hover=False):
    chev = "chevron-down" if open_ else "chevron-right"
    acts = (f'<button class="sec-add is-on" title="项目选项">{ICO("ellipsis")}</button>'
            f'<button class="sec-add" title="新建会话">{ICO("plus")}</button>') if hover else \
           (f'<span class="srow__trail">{n}</span>' if not open_ else "")
    return (f'<div class="srow"><span class="srow__badge">{ICO(chev, "ic ic-sm")}</span>'
            f'<span class="srow__title">{name}</span>{acts}</div>')


def spec(title, intro, rows, note="", shift=0):
    body = "".join(f'<div class="ax__label">{a}</div><div>{b}</div>' for a, b in rows)
    n = f'<div style="margin-top:12px;font-size:10.5px;line-height:1.65;color:var(--ink-3)">{note}</div>' if note else ""
    return f'''<div style="flex:1;min-height:0;overflow:hidden;padding:84px 26px 20px {26 + shift}px;display:flex;flex-direction:column">
  <div style="font-size:15px;font-weight:600;letter-spacing:-.01em">{title}</div>
  <div style="margin-top:6px;font-size:11.5px;line-height:1.7;color:var(--ink-2);max-width:820px">{intro}</div>
  <div class="card" style="margin-top:16px;padding:14px 16px;max-width:900px"><div class="ax" style="gap:11px 16px">{body}</div></div>
  {n}
</div>'''


# ---------------------------------------------------------------- A 两层骨架

def sb_a():
    lst = f'''        <div class="sec-head">置顶<span class="count">1</span></div>
{row('<span class="spin spin--mini" data-spin="mini" aria-label="运行中"></span>', "重做工作区外壳", "刚刚 · 14 条", "srow is-sel")}

        <div class="sec-head">项目<span class="count">3</span>
          <button class="sec-add" title="全部展开 / 收起">{ICO("ellipsis")}</button>
        </div>

{proj_row(PROJ, 4)}
{row("branch", "fork/v3-boards", "3", "srow is-sub", sub=True, tag_html='<span class="srow__chev">' + ICO("chevron-down") + "</span>")}
{row("pi", "令牌只写一次：running.css", "2h · 41 条", "srow is-sub")}
{row("pi", "V5 落地清单跑到第几批了", "3h · 12 条", "srow is-sub")}
{row("pi", "窗口切在回合中间时的渲染修复", "", "srow is-sub", tag_html='<span class="srow__trail"><span class="tag">' + ICO("hand-raised") + "待授权</span></span>")}

{proj_row("tivano", 2, open_=False)}
{proj_row("pi-web-design", 4, open_=False)}

        <div class="sec-head">{ICO("chevron-right")}已归档<span class="count">4</span></div>'''

    detail = spec(
        "侧栏是两层，不是三块",
        "第一层是「范围」（置顶 / 项目 / 归档），第二层是「这个范围里的会话」。搜索态才在工具行里长出搜索格——"
        "默认态没有它，因为 ⌘K 已经够了，常驻输入框只是噪音。",
        [
            ("第一层 · 范围", "置顶（跨项目，最多 5 条）· 项目（可折叠）· 已归档（默认收起，只留计数）"),
            ("第二层 · 会话", "项目行下面挂 worktree 子行，再挂会话行；行模型只有 `.srow` 一种"),
            ("默认态", "工具行 = 新建 / 搜索 / 留白 / 活动。**没有搜索格**"),
            ("搜索态", "搜索格从工具行右端长出来，占满剩余宽度（见帧 E）"),
            ("下拉刷新", "在列表顶端：往下拖出现「松手刷新」，松手后变成一行「正在同步…」，不弹窗"),
            ("全部展开 / 收起", "项目分区头右侧一枚 ⋯，一次把三个项目全展开或全收起"),
            ("高度", "工具行 40 · 分区头 24 · 行 25（子行 25）· 脚 40"),
        ],
        "两层骨架的好处：折叠项目时只影响第二层，第一层的顺序永远是「置顶 → 项目 → 归档」。",
    )
    return shell.win(detail, side_html=shell.side(list_html=lst, tools=tools()))


# ---------------------------------------------------------------- B 自定义分组

def sb_b():
    lst = f'''        <div class="sec-head">置顶<span class="count">1</span></div>
{row('<span class="spin spin--mini" data-spin="mini" aria-label="运行中"></span>', "重做工作区外壳", "刚刚 · 14 条", "srow is-sel")}

        <div class="sec-head">分组<span class="count">4</span>
          <button class="sec-add" title="新建分组">{ICO("plus")}</button>
        </div>

        <div class="srow"><span class="srow__badge">{ICO("chevron-down", "ic ic-sm")}</span>
          <span class="srow__title">设计稿</span><span class="srow__trail">2</span>
          <button class="sec-add" title="分组选项">{ICO("ellipsis")}</button></div>
{row("pi", "V5 画板的栅格与间距", "昨天", "srow is-sub")}
{row("pi", "26 套主题的取色规则", "3d", "srow is-sub")}

        <div class="srow"><span class="srow__badge">{ICO("chevron-right", "ic ic-sm")}</span>
          <span class="srow__title">重构中</span><span class="srow__trail">5</span></div>

        <div class="srow" style="background:color-mix(in srgb,var(--accent) 10%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 40%,transparent)">
          <span class="srow__badge">{ICO("chevron-down", "ic ic-sm")}</span>
          <span class="srow__title" style="color:var(--accent-ink)">空分组 · 松手放到这里</span>
          <span class="srow__trail" style="color:var(--accent-ink)">0</span></div>

        <div class="srow"><span class="srow__badge">{ICO("chevron-down", "ic ic-sm")}</span>
          <span class="srow__title">已收口</span><span class="srow__trail">3</span>
          <button class="sec-add" title="分组选项">{ICO("ellipsis")}</button></div>
{row("pi", "令牌只写一次：running.css", "2h", "srow is-sub")}
{row("pi", "文件面板的 diff 视图", "昨天", "srow is-sub")}

        <div class="sec-head">项目<span class="count">2</span></div>
{proj_row(PROJ, 4, hover=True)}
{proj_row("tivano", 2, open_=False)}

        <div class="sec-head">{ICO("chevron-right")}已归档<span class="count">4</span></div>'''

    detail = spec(
        "自定义分组：四态 + 一个落点",
        "分组是用户自己划的筐，跟「项目」并列但互不干扰：项目按目录自动来，分组按人手动来。"
        "四态之外还有第五个形态——**空分组**，它不是错误状态，它是拖拽的落点。",
        [
            ("① 展开有内容", "chevron-down + 名称 + 条数，下面挂会话行"),
            ("② 折叠", "chevron-right + 名称 + 条数，不占高度"),
            ("③ 空分组", "保留、显示「0」；拖动会话经过时整行高亮成落点"),
            ("④ 拖拽中", "被拖的那行降透明度，落点行描边 + 浅底（本帧就是这一态）"),
            ("移出落点", "拖到分组外 → 出现一条虚线「移出分组」；松手即回到项目下"),
            ("项目行动作", "默认只显示计数；悬停才长出 ⋯ 与 +（两态互斥，不同时出现）"),
            ("为什么空分组不自动删", "自动删会让「我刚清空、还想再放回去」变成不可逆"),
        ],
        "分组不是文件夹：一个会话可以同时在项目里、又在一个分组里，两处都显示，删分组不删会话。",
    )
    return shell.win(detail, side_html=shell.side(list_html=lst, tools=tools()))


# ---------------------------------------------------------------- C worktree

def sb_c():
    lst = f'''        <div class="sec-head">项目<span class="count">2</span></div>
{proj_row(PROJ, 4)}
        <div class="srow is-sub" style="background:var(--fill-1)">
          <span class="srow__badge">{ICO("branch", "ic ic-sm")}</span>
          <span class="srow__title srow__sub">fork/v3-boards</span>
          <span class="srow__trail">3</span>
          <span class="srow__chev">{ICO("chevron-down")}</span></div>
{row("pi", "令牌只写一次：running.css", "2h", "srow is-sub")}
{row("pi", "V5 落地清单跑到第几批了", "3h", "srow is-sub")}
        <div class="srow is-sub">
          <span class="srow__badge">{ICO("branch", "ic ic-sm")}</span>
          <span class="srow__title srow__sub">main</span>
          <span class="srow__trail">1</span>
          <span class="srow__chev">{ICO("chevron-right")}</span></div>
        <div class="srow is-sub">
          <span class="srow__badge">{ICO("branch", "ic ic-sm")}</span>
          <span class="srow__title srow__sub">feat/pwa-shell</span>
          <span class="srow__trail">2</span>
          <span class="srow__chev">{ICO("chevron-right")}</span></div>
{proj_row("tivano", 2, open_=False)}
        <div class="sec-head">{ICO("chevron-right")}已归档<span class="count">4</span></div>'''

    chip = '''<div class="pop" style="left:20px;top:56px;width:330px">
  <div class="pop__head"><span class="pop__title">切换 worktree</span><span class="tag">3 个</span></div>
  <div class="pop__body is-flush">
    <button class="prow"><span style="flex:none;width:16px;display:grid;place-items:center;color:var(--ink-2)">''' + ICO("branch") + '''</span>
      <span class="prow__text"><span class="prow__title mono" style="font-size:11.5px">main</span><span class="prow__sub">~/pi-web · 1 个会话</span></span>
      <span class="prow__meta">2h 前</span></button>
    <button class="prow is-on"><span style="flex:none;width:16px;display:grid;place-items:center;color:var(--ink-2)">''' + ICO("branch") + '''</span>
      <span class="prow__text"><span class="prow__title mono" style="font-size:11.5px">fork/v3-boards</span><span class="prow__sub">~/pi-web/.worktrees/v3-boards · 3 个会话 · 当前</span></span>
      <span class="prow__meta">''' + ICO("check", "ic ic-sm") + '''</span></button>
    <button class="prow"><span style="flex:none;width:16px;display:grid;place-items:center;color:var(--ink-2)">''' + ICO("branch") + '''</span>
      <span class="prow__text"><span class="prow__title mono" style="font-size:11.5px">feat/pwa-shell</span><span class="prow__sub">~/pi-web/.worktrees/pwa-shell · 2 个会话</span></span>
      <span class="prow__meta">昨天</span></button>
    <div class="menu-sep"></div>
    <button class="prow"><span style="flex:none;width:16px;display:grid;place-items:center;color:var(--ink-2)">''' + ICO("plus") + '''</span>
      <span class="prow__text"><span class="prow__title">新建 worktree…</span><span class="prow__sub">从 main 拉一条新分支，目录自动建</span></span></button>
  </div>
  <div class="pop__foot">''' + ICO("info") + '''同一个动作，两处入口：这里和侧栏的项目行下面。</div>
</div>'''

    detail = spec(
        "worktree：一个动作，两个高度",
        "顶栏的 BranchChip 与侧栏项目行下的 worktree 行是**同一个动作**的两个入口：前者给你「当前在哪」，"
        "后者给你「这个项目有几条线」。两处列表、顺序、图标完全一致，只有高度不同（chip 26 / 行 25）。",
        [
            ("顶栏 BranchChip", "26 高胶囊：分支图标 + 分支名 + ⌄。点开是浮层，列出所有 worktree"),
            ("侧栏 worktree 行", "25 高子行：分支图标 + 等宽分支名 + 会话数 + ⌄。点开在原位展开会话"),
            ("两处必须一致", "同一组 worktree、同一个顺序（当前在最上）、同一个「领先 / 落后」口径"),
            ("当前态", "顶栏 chip 显示当前分支名；侧栏那行浅底 + 展开"),
            ("切过去", "切 worktree = 换 cwd，不 stash。有未提交改动会先问一句"),
            ("新建", "两处最后一项都是「新建 worktree…」，从一个干净分支拉"),
        ],
        "不做第三个入口（比如文件面板里再来一个）：两处已经够，第三处只会让人怀疑它们不同步。",
        shift=370,
    )
    chrome = shell.chrome(right=f'''<div class="chrome__right">
          <div class="ccap">
            <button class="cbtn" title="文件">{ICO("folder-fill")}</button>
            <i class="cdiv"></i>
            <button class="cbtn" title="变更">{ICO("plusminus")}</button>
          </div>
        </div>''')
    return shell.win(detail + "\n" + chip, side_html=shell.side(list_html=lst, tools=tools()), chrome_html=chrome)


# ---------------------------------------------------------------- D 会话行五态

def sb_d():
    lst = f'''        <div class="sec-head">项目<span class="count">1</span></div>
{proj_row(PROJ, 5)}
        <div class="srow is-sub">
          <span class="srow__badge">{ICO("branch", "ic ic-sm")}</span>
          <span class="srow__title srow__sub">fork/v3-boards</span>
          <span class="srow__trail">5</span>
          <span class="srow__chev">{ICO("chevron-down")}</span></div>

{row("pi", "① 默认 · 有内容", "2h · 41 条", "srow is-sub")}
{row("pi", "② 当前打开", "刚刚 · 14 条", "srow is-sub is-sel")}
{row('<span class="spin spin--mini" data-spin="mini" aria-label="运行中"></span>', "③ 运行中", "3h · 12 条", "srow is-sub")}
{row("pi", "④ 等你授权", "", "srow is-sub", tag_html='<span class="srow__trail"><span class="tag">' + ICO("hand-raised") + "待授权</span></span>")}
{row("pi", "⑤ 未读", "昨天 · 23 条", "srow is-sub", tag_html='<span class="dot"></span>')}

        <div class="sec-head">{ICO("chevron-right")}已归档<span class="count">4</span></div>'''

    menu_items = [
        ("pin", "置顶会话", ""), ("pen-line", "重命名", ""), ("wand-sparkles", "生成标题", ""),
        None,
        ("git-fork", "复制这条分支", ""), ("download", "导出 Markdown", ""),
        ("plusminus", "查看这一轮的变更", ""), ("copy", "复制会话 ID", ""),
        None,
        ("archive", "归档", ""), ("pin-off", "取消置顶", ""), ("trash-2", "删除会话…", "danger"),
    ]
    rows = []
    for it in menu_items:
        if it is None:
            rows.append('<div class="menu-sep"></div>')
            continue
        icon, text, danger = it
        cls = "menu-item is-danger" if danger else "menu-item"
        rows.append(f'<button class="{cls}">{ICO(icon)}{text}</button>')
    menu = ('<div class="menu" style="left:186px;top:262px;min-width:214px">'
            '<div class="menu-label">② 当前打开</div>' + "".join(rows) + "</div>")

    detail = spec(
        "会话行五态互斥",
        "一行会话在任何时刻只处于一个状态，五个状态共用同一行、同一高度、同一左对齐：换的只有徽标、行尾和底色。"
        "这样扫一遍侧栏，视线不会因为行高跳动而丢位置。",
        [
            ("① 默认", "π 徽标 + 标题 + 「时间 · 条数」。没有底色"),
            ("② 当前打开", "同 ①，加浅底（`is-sel`）。同一时刻只有一行"),
            ("③ 运行中", "徽标换成 3×3 点阵，行尾仍是时间；不加底色、不加动画文字"),
            ("④ 等你授权", "行尾换成 `待授权` 徽章（握手图标 + 一个词），标题不变"),
            ("⑤ 未读", "行尾加一颗 5px 绿点，不带数字——数字留给「条数」"),
            ("互斥规则", "运行中与待授权不会同时出现；未读只对「不是你正在看的会话」生效"),
            ("会话动作菜单", "⋯ 12 项，四段：改这条 → 复制/导出 → 归档/置顶 → 删除。危险项永远沉底"),
        ],
        "行高固定 25 是硬约束：五个状态里任何一个都不能让这一行变高，否则整个列表会跳。",
        shift=380,
    )
    return shell.win(detail + "\n" + menu, side_html=shell.side(list_html=lst, tools=tools()))


# ---------------------------------------------------------------- E 搜索态

def sb_e():
    lst = f'''        <div class="sec-head" style="display:block;font-weight:400;color:var(--ink-3);font-size:10.5px;line-height:1.6">在 12 个会话里找到 3 条<br>置顶与归档不参与搜索</div>

        <div class="sec-head">项目<span class="count">1</span></div>
{proj_row(PROJ, 2)}
{row("branch", "fork/v3-boards", "2", "srow is-sub", sub=True, tag_html='<span class="srow__chev">' + ICO("chevron-down") + "</span>")}
{row("pi", "<mark>右栏</mark>现在默认是开的", "2h · 41 条", "srow is-sub")}
{row("pi", "把<mark>右栏</mark>的默认收起也一起改了", "刚刚 · 14 条", "srow is-sub is-sel")}

        <div class="sec-head">聊天<span class="count">1</span></div>
{row("text-bubble", "<mark>右栏</mark>宽度到底该写死还是跟着窗口算", "昨天 · 6 条", "srow is-sub")}

        <div class="sec-head" style="display:block;font-weight:400;color:var(--ink-3);font-size:10.5px;line-height:1.6">按 ↵ 打开第一条 · 按 esc 退出搜索</div>'''

    detail = spec(
        "搜索格只在搜索态出现",
        "默认态侧栏里没有搜索框——工具行只有三个按钮。按 ⌘K 或点放大镜，搜索格才从工具行右端长出来，"
        "同时列表换成结果：命中片段用 <code>&amp;lt;mark&amp;gt;</code>，命中处不换行、不截断标题。",
        [
            ("触发", "⌘K / 点工具行的放大镜 / 直接打字（侧栏有焦点时）"),
            ("搜索格", "只在这一态存在：占满工具行剩余宽度，`esc` 清空并退出"),
            ("结果分组", "项目 / 聊天两段，段头带命中数；置顶与归档不参与"),
            ("命中高亮", "`<mark>` 用强调色淡底 + 强调色文字，不做加粗"),
            ("空态", "一行「没有匹配」+ 三枚台阶（搜文件 / 搜命令 / 问 pi 一句）"),
            ("退出", "`esc` 一次清空、两次退出；点结果即退出并跳过去"),
            ("为什么默认不显示", "常驻搜索框会让人以为「这里只能搜会话」，而 ⌘K 是全站搜索"),
        ],
        "搜索不改变树的形状：项目行还在，只是折叠成「命中所在的那些项目」，命中会话直接挂在下面。",
    )
    return shell.win(detail, side_html=shell.side(list_html=lst, tools=tools(search=True)))


FRAMES = {
    "web-sidebar-detail": [("A", sb_a), ("B", sb_b), ("C", sb_c), ("D", sb_d), ("E", sb_e)],
}
