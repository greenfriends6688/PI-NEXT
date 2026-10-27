# -*- coding: utf-8 -*-
"""转录家族（web-transcript / -shell / -process / -nav）的帧规格。"""
from transcript import (
    ICO, step, steps, bubble, grp, prose, stat, filecard, out, raw, code, dfile,
    unread, todo, phase, tag, add, dele,
)
import shell


# ---------------------------------------------------------------- D-03 转录全集

def _ticks_5(now=4):
    return [
        ("右栏现在默认是开的", "有点挤。"),
        ("先读一下现在的外壳", "别急着改。"),
        ("侧栏的三段怎么分", "置顶 / 项目 / 归档，行模型要不要一起动？"),
        ("把工作区外壳重做一下", "侧栏改成三区（置顶 / 项目 / 归档），右栏默认收起。"),
        ("重构之后的 typecheck", "通过了，但右栏还有 3 处写死宽度。"),
    ][: now + 1]


def transcript_a():
    inner = [
        bubble("把工作区外壳重做一下：侧栏改成三区（置顶 / 项目 / 归档），右栏默认收起。"),
        grp("用时 1m 18s", closed=True),
        steps(
            step("bubble-left", "思考过程", chev=True,
                 body="先看 <code>AppShell.tsx</code> 的布局常量，再确认行模型有没有把置顶与项目分组分开。分开的话，外壳只负责渲染。",
                 d=0.02),
            step("doc-text", "读取", "components/AppShell.tsx", d=0.14),
            step("search", "搜索", "pinnedSection | groupOrder", d=0.24),
            step("terminal", "运行", "npm run typecheck", d=0.34),
            step("pencil", "编辑", "components/AppShell.tsx", stat=stat(48, 12), last=True, d=0.44),
        ),
        prose("三区拆好了：置顶跨项目、项目行下面挂 worktree 与会话、归档默认收起只留计数。行模型没动，"
              "所以 <code>srow</code> 的选中、子行、收口三态都还是原来那套。"),
        code(
            [
                (10, '<span class="tok-kw">export</span> <span class="tok-kw">function</span> <span class="tok-fn">AppShell</span>({ children }: Props) {'),
                (11, '  <span class="tok-kw">const</span> [rightOpen, setRightOpen] = <span class="tok-fn">useState</span>(<span class="tok-num">false</span>);'),
                (12, '  <span class="tok-kw">const</span> { groups, pinned } = <span class="tok-fn">useSessionTree</span>();'),
                (13, '  <span class="tok-kw">const</span> archived = groups.<span class="tok-fn">filter</span>((g) =&gt; g.archived);'),
            ],
            head='<span class="mono" style="color:var(--ink-2)">components/AppShell.tsx</span> · 11–13 行',
        ),
        filecard(2, 48, 12),
    ]
    return shell.win(
        shell.rail(_ticks_5()) + "\n" + shell.thread("\n".join(inner)) + "\n" + shell.composer(),
    )


def transcript_b():
    inner = [
        bubble("跑一下构建，顺手把 lint 也跑了。"),
        grp("运行 3 条命令 · 1 条失败", shimmer=True),
        steps(
            step("terminal", "运行", "npm run build", chev=True, d=0.02),
            step("terminal", "运行", "npm run lint", err=True, chev=True, d=0.12,
                 body=out(
                     [
                         "components/SessionTree.tsx",
                         "  42:7  error  Unexpected any. Specify a type.  @typescript-eslint/no-explicit-any",
                         "  88:3  error  React Hook useEffect has a missing dependency: 'groups'.",
                         "",
                         "✖ 2 problems (2 errors, 0 warnings)",
                     ],
                     err=True,
                 ) + f'''
  <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
    <button class="btn btn--sm">{ICO("refresh")}重试</button>
    <span style="font-size:10.5px;color:var(--ink-3)">重试会带上 <code class="mono">--fix</code>，只改能自动修的两条</span>
  </div>'''),
            step("doc-text", "读取", "build.log", chev=True, last=True, d=0.22,
                 body=out(
                     [
                         "vite v6.3.5 building for production...",
                         "transforming (1284) src/components/...",
                         "✓ 1284 modules transformed.",
                         "dist/index.html                 0.61 kB │ gzip:  0.36 kB",
                         "dist/assets/index-Ck2f.css    102.44 kB │ gzip: 14.82 kB",
                         "dist/assets/index-Bd9a.js   1,284.02 kB │ gzip: 412.77 kB",
                     ],
                     more="只显示最后 200 行，全文 1 847 行 · 打开完整日志",
                 )),
        ),
        '<div class="status"><span class="spin spin--sm" data-spin="grid" aria-hidden="true"></span>'
        '<span class="status__word">等你决定要不要重试…</span>'
        '<span class="status__time" data-elapsed="18">18s</span></div>',
    ]
    return shell.win(
        shell.rail(_ticks_5(4)) + "\n" + shell.thread("\n".join(inner)) + "\n"
        + shell.composer('<span style="color:var(--ink-3)">构建挂了，先看看能不能自动修</span><i class="caret"></i>'),
    )


def transcript_c():
    plan_rows = "\n".join(
        f'  <div class="todo__row"><span class="mono" style="width:13px;flex:none;font-size:10px;color:var(--ink-3)">{i}</span>'
        f'<span>{t}</span></div>'
        for i, t in [
            (1, "拆三区，行模型不动"),
            (2, "右栏默认收起，⌘B 叫回来"),
            (3, "补 typecheck 与快照"),
        ]
    )
    inner = [
        bubble("照这个计划走，右栏先别删。"),
        unread("未读 3 条 · 你离开后跑完了"),
        todo([
            ("done", "读 AppShell 与 SessionTree"),
            ("doing", "把侧栏拆成置顶 / 项目 / 归档"),
            ("pending", "右栏默认收起 + 快捷键"),
        ], head="待办 · 3 项 · 1 项进行中"),
        f'''<div class="todo" style="width:100%">
  <div class="todo__head">{ICO("list-todo")}计划 · 三步，不新建组件</div>
{plan_rows}
</div>''',
        grp("用时 2m 04s", closed=True),
        steps(
            step("pencil", "编辑", "components/SessionTree.tsx", stat=stat(64, 18), d=0.02),
            step("pencil", "编辑", "components/AppShell.tsx", stat=stat(12, 4), last=True, d=0.12),
        ),
        filecard(3, 76, 22),
    ]
    return shell.win(
        shell.rail(_ticks_5(3)) + "\n" + shell.thread("\n".join(inner)) + "\n" + shell.composer(),
    )


FRAMES = {
    "web-transcript": [("A", transcript_a), ("B", transcript_b), ("C", transcript_c)],
}
