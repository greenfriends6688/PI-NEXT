# -*- coding: utf-8 -*-
"""转录家族第二批：shell / process / nav。"""
from transcript import (
    ICO, step, steps, bubble, grp, prose, stat, filecard, out, raw, code, dfile,
    unread, todo, phase, tag, add, dele, esc,
)
import shell

TICKS = [
    ("右栏现在默认是开的", "有点挤。"),
    ("先读一下现在的外壳", "别急着改。"),
    ("侧栏的三段怎么分", "置顶 / 项目 / 归档，行模型要不要一起动？"),
    ("把工作区外壳重做一下", "侧栏改成三区（置顶 / 项目 / 归档），右栏默认收起。"),
]


def _win(detail, ticks=None):
    return shell.win((shell.rail(ticks or TICKS) + "\n") + detail)


def _dock(html, w=820):
    """贴在输入区上方的停靠条 / 授权卡：与转录同宽，居中。"""
    return f'<div style="width:{w}px;max-width:100%;margin:0 auto 12px">{html}</div>'


# ---------------------------------------------------------------- D-03c 外壳

def shell_a():
    approval = f'''<div class="approval">
  <div class="approval__head">{ICO("hand-raised")}需要你确认：跑一条会改数据的命令</div>
  <div class="approval__cmd">npm run db:migrate -- --env production</div>
  <div class="approval__note" style="display:flex;align-items:center;gap:6px">
    范围
    <button class="chip" style="height:22px;background:var(--fill-3)">
      {ICO("shield")}受监督 · 本次会话
      {ICO("chevron-down")}
    </button>
    <span style="color:var(--ink-3)">改完这个选择只影响本会话，不改全局权限档。</span>
  </div>
  <div class="approval__actions">
    <button class="btn">允许一次</button>
    <button class="btn">本会话都允许</button>
    <button class="btn">拒绝</button>
  </div>
</div>'''

    inner = [
        bubble("把 dev 的 schema 推到生产，先跑迁移。"),
        grp("用时 26s", closed=True),
        prose("迁移脚本会先做一次 dry-run，再落库。这一步要写生产库，所以停下来问你。"),
        f'<div class="compact">{ICO("check")}已允许一次 · npm run db:migrate <span class="compact__undo">撤销</span></div>',
        f'<div class="compact is-err">{ICO("xmark")}已拒绝 · git push --force origin main<span class="compact__undo">查看原因</span></div>',
        steps(
            step("terminal", "运行", "npm run db:migrate -- --dry-run", chev=True, d=0.02,
                 body=out([
                     "→ 3 张表会新增 2 列，删除 0 列",
                     "→ 2 条索引会重建（锁表约 1.4s）",
                     "dry-run 通过，没有不可逆操作。",
                 ])),
            step("terminal", "等待授权", "npm run db:migrate -- --env production", last=True, d=0.14,
                 body=f'<div class="raw">{{\n  <b>command</b>: "npm run db:migrate -- --env production"\n  <b>cwd</b>: /Users/lin/pi-web\n  <b>scope</b>: "supervised"\n  <b>timeout</b>: 120000\n}}</div>'),
        ),
    ]
    detail = shell.thread("\n".join(inner)) + "\n" + shell.composer_area_with(_dock(approval))
    return _win(detail)


def shell_b():
    inner = [
        bubble("上下文快满了，先压一下再继续。"),
        grp("同一个位置，只换一行字", closed=True),
        f'<div class="compact"><span class="spin spin--sm" data-spin="grid" aria-hidden="true"></span>正在压缩 42 条消息…<span class="compact__undo" style="color:var(--ink-3)">可继续输入</span></div>',
        f'<div class="compact">{ICO("archive")}已压缩 <b>42</b> 条为 <b>1</b> 条 · 上下文 <b>92%</b> → <b>31%</b><span class="compact__undo">撤销</span></div>',
        f'<div class="compact is-err">{ICO("circle-alert")}压缩失败 · 摘要把工具输出里的二进制也读了进来<span class="compact__undo">重试</span></div>',
        grp("压缩后继续", closed=True),
        prose("压缩只留结论：三区怎么分、行模型不动、右栏默认收起。原始的工具输出留在归档里，点开还能看。"),
        steps(
            step("pencil", "编辑", "components/SessionTree.tsx", stat=stat(18, 6), last=True, d=0.02),
        ),
        filecard(1, 18, 6),
    ]
    detail = shell.thread("\n".join(inner)) + "\n" + shell.composer()
    return _win(detail)


def shell_c():
    rows = [
        ("end_turn", "正常说完了", "12 348 in · 1 284 out · $0.21"),
        ("max_tokens", "撞到输出上限，被截断", "32 000 out · $0.94"),
        ("tool_use", "停下来等你批准工具", "8 102 in · 402 out"),
        ("stop_sequence", "命中停止词 <code class=\"mono\">###</code>", "6 480 in · 96 out"),
        ("pause_turn", "长任务暂停，可以继续", "18 204 in · 2 106 out"),
        ("refusal", "模型拒绝回答", "3 012 in · 0 out"),
        ("aborted", "你按了停止", "9 744 in · 318 out"),
    ]
    stops = "\n".join(
        f'<div class="stoprow"><span class="mono">{k}</span><span>{human}</span>'
        f'<span class="stoprow__dash"></span><span class="stoprow__usage">{u}</span></div>'
        for k, human, u in rows
    )
    inner = [
        bubble("这个回合结束了，把结束原因列一下。"),
        grp("用时 42s", closed=True),
        prose("七种结束原因都在这里。左边是机器词（日志里就是它），右边一句人话——两种人同时要看这一行。"),
        stops,
        f'<div class="stoprow" style="margin-top:8px"><span class="mono">合计</span><span>本会话 6 个回合</span>'
        f'<span class="stoprow__dash"></span><span class="stoprow__usage">68 402 in · 4 206 out · $1.42</span></div>',
    ]
    dock = f'''<div class="retry">{ICO("hand-raised")}还有 <b>1</b> 件事等你处理：批准 <code class="mono">git push</code><span class="retry__meta">↵ 打开</span></div>'''
    detail = shell.thread("\n".join(inner)) + "\n" + shell.composer_area_with(_dock(dock))
    return _win(detail)


def shell_d():
    skel = f'''<div class="skeleton">
  <i class="is-bubble"></i>
  <i></i><i></i><i></i>
  <i style="width:74%"></i>
  <i class="is-bubble" style="width:38%"></i>
  <i></i><i style="width:52%"></i>
</div>'''
    findbar = f'''<div class="findbar">
  {ICO("search")}
  <input value="右栏" aria-label="会话内查找">
  <span class="findbar__count">3 / 12</span>
  <button class="cbtn cbtn--sm" title="上一个">{ICO("chevron-up")}</button>
  <button class="cbtn cbtn--sm" title="下一个">{ICO("chevron-down")}</button>
  <i class="cdiv"></i>
  <button class="cbtn cbtn--sm" title="关闭">{ICO("xmark")}</button>
</div>'''

    def card(tone, icon, title, body):
        color = {"info": "var(--accent)", "ok": "var(--success)", "err": "var(--danger)"}[tone]
        return f'''<div class="notify-card" style="width:328px;padding:12px 14px;gap:6px">
  <div style="display:flex;align-items:center;gap:8px">
    <span style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:color-mix(in srgb,{color} 16%,transparent);color:{color}">{ICO(icon, "ic ic-sm")}</span>
    <span style="flex:1;font-size:12px;font-weight:600">{title}</span>
    <button class="cbtn cbtn--sm" title="关闭">{ICO("xmark")}</button>
  </div>
  <div style="font-size:11px;line-height:1.6;color:var(--ink-2);padding-left:28px">{body}</div>
</div>'''

    rack = '<div style="position:absolute;right:16px;top:96px;z-index:41;display:flex;flex-direction:column;gap:8px">' + \
        card("info", "info", "已连上手机", "推送会发到 iPhone · 只发「需要你」的三类。") + \
        card("ok", "check-circle", "构建通过", "typecheck 与 62 条单测都过了。") + \
        card("err", "circle-alert", "MCP 服务器掉线", "filesystem 重连 2 次失败，点开看日志。") + \
        '</div>'

    detail = (
        findbar + "\n"
        + shell.thread(skel, extra_cls="")
        + "\n"
        + f'<div class="jumpnew">{ICO("arrow-down")}回到最新<b>3</b></div>\n'
        + rack + "\n"
        + shell.composer()
    )
    return _win(detail, [("右栏现在默认是开的", "有点挤。"), ("先读一下现在的外壳", "别急着改。")])


# ---------------------------------------------------------------- D-03p 过程

def process_a():
    inner = [
        bubble("把右栏收起来，顺便看看过程树怎么排。"),
        grp("思考 · 4 种状态", closed=False),
        steps(
            step("bubble-left", "思考过程", "折叠 · 只留一行", chev=True, d=0.02),
            step("bubble-left", "思考过程", "展开 · 6 行推理", chev=True, d=0.12,
                 body="先确认右栏宽度是写死还是跟着窗口算。写死的话，1440 下转录只剩 750，低于 820 的理想列宽，"
                      "所以默认收起是唯一不牺牲正文的选择。<br>再看快捷键：<code>⌘B</code> 已经绑了侧栏，"
                      "右栏需要一个不同的键。"),
            step("bubble-left", "思考过程", "运行中 · 光在扫", shimmer=True, chev=True, d=0.22),
            step("bubble-left", "思考了 3s，没有可展开的内容", last=True, d=0.32),
        ),
        grp("时间轴三态", closed=True),
        phase("探索 · 读 4 个文件", "done", "42s"),
        phase("实现 · 编辑 3 个文件", "on", "1m 08s"),
        phase("验证 · typecheck + 单测", "", "待开始"),
        prose("时间轴是唯一的过程形态：阶段行只占一行，高度永远不变；步骤树挂在阶段下面，收起来就是一行字。"),
    ]
    detail = shell.thread("\n".join(inner)) + "\n" + shell.composer()
    return _win(detail)


def process_b():
    inner = [
        bubble("四个工具调用的形态都摆一下。"),
        steps(
            step("terminal", "运行", "npm run typecheck", chev=True, d=0.02,
                 body=out([
                     "> tsc --noEmit",
                     "✓ 0 errors in 1 284 files (7.2s)",
                 ]) + f'<div class="step__foot">{ICO("chevron-up")}收起输出</div>'),
            step("terminal", "运行", "npm run test:unit", err=True, chev=True, d=0.12,
                 body=out([
                     "✖ SessionTree › groups pinned sessions separately",
                     "  AssertionError: expected 2 to equal 3",
                     "    at components/SessionTree.test.mjs:88:12",
                 ], err=True) + f'<div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn--sm">{ICO("refresh")}重试</button><button class="btn btn--sm">{ICO("doc-text")}看完整日志</button></div>'),
            step("terminal", "运行", "npm run build", cancelled=True, chev=True, d=0.22,
                 body=out(["^C 收到中断信号，已停止。"])),
            step("pencil", "编辑", "components/AppShell.tsx", last=True, d=0.32,
                 body=raw([("file_path", "/Users/lin/pi-web/components/AppShell.tsx"),
                           ("old_string", "const [rightOpen, setRightOpen] = useState(true);"),
                           ("new_string", "const [rightOpen, setRightOpen] = useState(false);")])),
        ),
        prose("失败只换图标与输出底色，卡框、缩进、行高都不动——这样连续几个工具调用排下来，视线不会跳。"),
    ]
    detail = shell.thread("\n".join(inner)) + "\n" + shell.composer()
    return _win(detail)


def process_c():
    unified = dfile(
        "components/AppShell.tsx",
        [
            ("hunk", "", "", "@@ -10,4 +10,6 @@"),
            ("", "10", "", '  <span class="tok-kw">export</span> <span class="tok-kw">function</span> <span class="tok-fn">AppShell</span>({ children }: Props) {'),
            ("del", "11", "−", '    <span class="tok-kw">const</span> [rightOpen, setRightOpen] = <span class="tok-fn">useState</span>(<span class="tok-num">true</span>);'),
            ("add", "11", "+", '    <span class="tok-kw">const</span> [rightOpen, setRightOpen] = <span class="tok-fn">useState</span>(<span class="tok-num">false</span>);'),
            ("add", "12", "+", '    <span class="tok-kw">const</span> archived = groups.<span class="tok-fn">filter</span>((g) =&gt; g.archived);'),
            ("", "13", "", "    <span class=\"tok-kw\">return</span> ("),
        ],
        adds=2, dels=1,
    )
    split = f'''<div class="dfile">
  <div class="dfile__head">{ICO("columns-2")}<span class="dfile__name">components/AppShell.tsx · 分栏</span>
    <span class="dfile__stat">{add(2)}{dele(1)}</span></div>
  <div class="dcode" style="display:flex;gap:0">
    <div style="flex:1;min-width:0;border-right:1px solid var(--line-soft)">
      <div class="dline del"><span class="dline__no">11</span><span class="dline__sign">−</span><span>  [rightOpen, setRightOpen] = useState(<b class="tok-num">true</b>);</span></div>
      <div class="dline"><span class="dline__no">12</span><span class="dline__sign"></span><span>  {{ groups, pinned }} = useSessionTree();</span></div>
    </div>
    <div style="flex:1;min-width:0">
      <div class="dline add"><span class="dline__no">11</span><span class="dline__sign">+</span><span>  [rightOpen, setRightOpen] = useState(<b class="tok-num">false</b>);</span></div>
      <div class="dline add"><span class="dline__no">12</span><span class="dline__sign">+</span><span>  archived = groups.filter((g) =&gt; g.archived);</span></div>
    </div>
  </div>
</div>'''
    readonly = f'''<div class="dfile">
  <div class="dfile__head">{ICO("history")}<span class="dfile__name">对比上一次提交 · 3 天前</span>
    <span class="dfile__stat">{add(64)}{dele(18)}</span></div>
  <div class="dcode">
    <div class="dline hunk"><span class="dline__no"></span><span class="dline__sign"></span>@@ 整个文件 3 处改动 @@</div>
    <div class="dline"><span class="dline__no">44</span><span class="dline__sign"></span><span>  &lt;Sidebar pinned={{pinned}} groups={{groups}} /&gt;</span></div>
    <div class="dline add"><span class="dline__no">45</span><span class="dline__sign">+</span><span>  &lt;ArchiveHint count={{archived.length}} /&gt;</span></div>
  </div>
</div>'''
    inner = [
        bubble("diff 的三种视图都给我看一眼。"),
        f'''<div class="diff-head">
  <span class="mono" style="font-size:11px">components/AppShell.tsx</span>
  <span class="diff-head__count">{add(2)} {dele(1)}</span>
  <span class="spacer"></span>
  <span class="tag" style="background:var(--accent-soft);color:var(--accent-ink)">行内</span>
  <span class="tag">分栏</span>
  <span class="tag">对比上次提交</span>
</div>''',
        unified,
        split,
        readonly,
        prose("三视图共用一套词级高亮：<code>true</code> 是数值色、<code>useState</code> 是函数色。只有排布不同，颜色语义不变。"),
    ]
    detail = shell.thread("\n".join(inner)) + "\n" + shell.composer()
    return _win(detail)


def process_d():
    term = f'''<div class="term">
  <div class="term__tabs">
    <button class="term-tab is-on">{ICO("terminal")}dev</button>
    <button class="term-tab">{ICO("terminal")}build<span style="opacity:.5;margin-left:2px">×</span></button>
    <button class="term-tab" title="新开">{ICO("plus")}</button>
    <span style="flex:1"></span>
    <button class="term-tab" title="收起">{ICO("chevron-down")}</button>
  </div>
  <div class="term__body">
    <div><span class="pr">~/pi-web $</span> npm run dev</div>
    <div class="dim">  ▲ Next.js 15.4.2  (turbo)</div>
    <div class="ok">  ✓ Ready in 1.2s</div>
    <div class="warn">  ⚠ Slow filesystem detected (10.2s)</div>
    <div><span class="pr">~/pi-web $</span> <span class="cur"></span></div>
  </div>
</div>'''
    agent = f'''<div class="card" style="padding:12px 14px;display:flex;flex-direction:column;gap:8px">
  <div style="display:flex;align-items:center;gap:8px">
    <span class="agent-glyph">{ICO("git-fork")}</span>
    <span style="flex:1;font-size:12.5px;font-weight:600">子代理 · 探查 42 个组件</span>
    <span class="tag"><span class="spin spin--mini" data-spin="mini"></span>运行中</span>
  </div>
  <div style="font-size:11.5px;line-height:1.65;color:var(--ink-2)">
    在 <code class="mono">components/</code> 里找所有写死宽度的容器，只读、不改。找到 7 处，其中 3 处会把转录挤到 820 以下。
  </div>
  <div style="display:flex;align-items:center;gap:8px;font-size:10.5px;color:var(--ink-3)">
    <span>已读 42 / 42 个文件</span><span>·</span><span>用时 1m 12s</span>
    <span style="margin-left:auto;color:var(--accent-ink)">看完整结论</span>
  </div>
</div>'''
    codemode = f'''<div class="card" style="padding:0;overflow:hidden">
  <div class="code-head" style="gap:8px;background:var(--fill-1)">
    {ICO("code")}<span>codemode · 一次跑完 7 个文件</span>
    <span style="flex:1"></span><span class="tag">只读</span>
  </div>
  <div class="dcode" style="padding:10px 14px;font-size:11px">
    <div><span class="tok-kw">const</span> hits = <span class="tok-kw">await</span> <span class="tok-fn">grep</span>(<span class="tok-str">"width: \\d+px"</span>, <span class="tok-str">"components/**/*.tsx"</span>);</div>
    <div><span class="tok-kw">return</span> hits.<span class="tok-fn">map</span>((h) =&gt; ({{h.file}}: {{h.line}}));</div>
    <div style="margin-top:8px;color:var(--ink-3)">→ 7 条结果，3 条命中 820 以下</div>
  </div>
</div>'''
    inner = [
        bubble("把「不是普通工具调用」的三种形态也画一下。"),
        steps(
            step("terminal", "嵌入式终端", "npm run dev", chev=True, d=0.02, body=term),
            step("git-fork", "子代理", "探查 42 个组件", last=True, chev=True, d=0.14, body=agent),
        ),
        codemode,
        prose("三种都不是普通调用：终端是活的（能继续输），子代理有独立上下文，codemode 一次跑完一段代码只回结果。"),
    ]
    detail = shell.thread("\n".join(inner)) + "\n" + shell.composer()
    return _win(detail)


FRAMES = {
    "web-transcript-shell": [("A", shell_a), ("B", shell_b), ("C", shell_c), ("D", shell_d)],
    "web-transcript-process": [("A", process_a), ("B", process_b), ("C", process_c), ("D", process_d)],
}
