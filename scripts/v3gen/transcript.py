# -*- coding: utf-8 -*-
"""V3 画板补帧生成器：转录家族的原语。

外壳（侧栏 / 顶栏 / 输入区）从 `shell.py` 抽，这里只提供转录列里的小件：
步骤树、工具输出、diff、代码块、结构化卡片。
"""
import html as _html

ICO = lambda n, cls="ic": f'<svg class="{cls}"><use href="#i-{n}"></use></svg>'

BRANCH = (
    '<svg class="step__branch" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">'
    '<path pathLength="1" d="M12.5 0V10Q12.5 16 18.5 16H28"/></svg>'
)
CONT = (
    '<svg class="step__cont" viewBox="0 0 32 100" preserveAspectRatio="none" aria-hidden="true">'
    '<path pathLength="1" d="M12.5 0V100"/></svg>'
)


def esc(t: str) -> str:
    return _html.escape(t, quote=False)


def step(icon, verb, subj="", stat="", body="", live=False, last=False,
         err=False, cancelled=False, chev=False, d=0.02, cls="", shimmer=False):
    """步骤树的一行。`last=True` 时不画继续向下的树干（竖线只连中间的行）。"""
    classes = ["step"]
    if live:
        classes.append("is-live")
    if err:
        classes.append("is-err")
    if cancelled:
        classes.append("is-cancelled")
    if cls:
        classes.append(cls)
    if chev and not body:
        classes.append("has-more")
    out = [f'<div class="{" ".join(classes)}" style="--d:{d}s">', f"  {BRANCH}"]
    if not last:
        out.append(f"  {CONT}")
    out.append('  <div class="step__line">')
    if live:
        out.append('    <span class="step__icon"><span class="spin spin--md" data-spin="grid" aria-label="运行中"></span></span>')
    else:
        out.append(f'    <span class="step__icon">{ICO(icon)}</span>')
    if shimmer:
        out.append(f'    <span class="step__verb shimmer" data-text="{verb}">{verb}</span>')
    else:
        out.append(f'    <span class="step__verb">{verb}</span>')
    if subj:
        out.append(f'    <span class="step__subj">{subj}</span>')
    if stat:
        out.append(f'    <span class="step__stat">{stat}</span>')
    if chev:
        out.append(f'    <span class="step__chev">{ICO("chevron-down")}</span>')
    out.append("  </div>")
    if body:
        out.append(f'  <div class="step__body">{body}</div>')
    out.append("</div>")
    return "\n".join(out)


def steps(*items) -> str:
    return '<div class="steps">\n' + "\n".join(items) + "\n</div>"


def bubble(text: str) -> str:
    return f'<div class="bubble-row"><div class="bubble">{text}</div></div>'


def grp(label: str, closed=False, shimmer=False) -> str:
    cls = "grp-head is-closed" if closed else "grp-head"
    lab = f'<span class="grp-head__label shimmer" data-text="{label}">{label}</span>' if shimmer \
        else f'<span class="grp-head__label">{label}</span>'
    return (
        f'<button class="{cls}">'
        f'<span class="grp-head__chev">{ICO("chevron-down")}</span>{lab}</button>'
    )


def prose(text: str) -> str:
    return f'<div class="prose">{text}</div>'


def add(v) -> str:
    return f'<span class="add">+{v}</span>'


def dele(v) -> str:
    return f'<span class="del">−{v}</span>'


def stat(adds=None, dels=None) -> str:
    out = ""
    if adds is not None:
        out += add(adds)
    if dels is not None:
        out += dele(dels)
    return f'<span class="step__stat">{out}</span>'


def filecard(n, adds=None, dels=None) -> str:
    st = ""
    if adds is not None or dels is not None:
        st = f'<span class="filecard__stat">{add(adds or 0)}{dele(dels or 0)}</span>'
    return f'''<div class="filecard">
  <button class="filecard__main">
    {ICO("badge-edit")}
    <span class="filecard__title">编辑 {n} 个文件</span>
    {st}
    {ICO("chevron-right", "ic ic-xs")}
  </button>
  <span class="filecard__gap"></span>
  <button class="filecard__btn" title="回退这一轮">{ICO("uturn-back")}</button>
  <button class="filecard__btn" title="查看变更">{ICO("plusminus")}</button>
</div>'''


def out(lines, err=False, more=None, maxh=None) -> str:
    cls = "out out--err" if err else "out"
    style = f' style="max-height:{maxh}px"' if maxh else ""
    body = "\n".join(esc(l) for l in lines)
    if more:
        body += f'\n<span class="out__more">{ICO("chevron-down")}{more}</span>'
    return f'<div class="{cls}"{style}>{body}</div>'


def raw(pairs) -> str:
    """原始入参：字段名淡、值深。"""
    lines = []
    for k, v in pairs:
        lines.append(f"  <b>{k}</b>: {esc(v)}")
    return '<div class="raw">{\n' + ",\n".join(lines) + "\n}</div>"


def code(rows, head=None) -> str:
    """源码块：`.code > .code-head + .cline`，行号右对齐。"""
    out = ['<div class="code">']
    if head:
        out.append(f'  <div class="code-head">{head}</div>')
    for no, text in rows:
        out.append(f'  <div class="cline"><span class="cline__no">{no}</span><span>{text}</span></div>')
    out.append("</div>")
    return "\n".join(out)


def dfile(name, rows, adds=0, dels=0, icon="file-diff") -> str:
    """一个文件的 diff：`.dfile > .dfile__head + .dcode > .dline`。"""
    body = []
    for kind, no, sign, text in rows:
        cls = "dline" + (f" {kind}" if kind else "")
        body.append(
            f'  <div class="{cls}"><span class="dline__no">{no}</span>'
            f'<span class="dline__sign">{sign}</span><span>{text}</span></div>'
        )
    return f'''<div class="dfile">
  <div class="dfile__head">
    {ICO(icon)}
    <span class="dfile__name">{name}</span>
    <span class="dfile__stat">{add(adds)}{dele(dels)}</span>
  </div>
  <div class="dcode">
{chr(10).join(body)}
  </div>
</div>'''


def unread(word="未读 3 条 · 你离开后新跑的") -> str:
    return f'<div class="unread">{word}</div>'


def todo(items, head="待办 · 3 项") -> str:
    """只读的待办卡：一项一行，状态在图标上。"""
    rows = []
    for state, text in items:
        cls = {"done": "todo__row is-done", "doing": "todo__row", "pending": "todo__row is-pending"}[state]
        icon = {"done": "check", "doing": "circle-dotted", "pending": "circle"}[state]
        rows.append(f'  <div class="{cls}">{ICO(icon)}<span>{text}</span></div>')
    return f'''<div class="todo" style="width:100%">
  <div class="todo__head">{ICO("checklist")}{head}</div>
{chr(10).join(rows)}
</div>'''


def phase(word, state="on", meta="") -> str:
    cls = "phase" + (f" is-{state}" if state else "")
    return (
        f'<div class="{cls}"><span class="phase__dot"></span>'
        f'<span class="phase__word">{word}</span>'
        + (f'<span class="phase__meta">{meta}</span>' if meta else "")
        + "</div>"
    )


def tag(text, icon=None) -> str:
    ico = ICO(icon) if icon else ""
    return f'<span class="tag">{ico}{text}</span>'
