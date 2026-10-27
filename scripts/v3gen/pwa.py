# -*- coding: utf-8 -*-
"""V3 画板补帧生成器：PWA 外壳。

手机壳从 `design/v3/boards/pwa-running.html` 帧 A 原样抽：`.statusbar` / `.m-top` /
`.m-composer-area` / `.m-home`。每帧只换中间那一层。
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BOARDS = os.path.join(ROOT, "design", "v3", "boards")
SOURCE = os.path.join(BOARDS, "pwa-running.html")

ICO = lambda n, cls="ic": f'<svg class="{cls}"><use href="#i-{n}"></use></svg>'


def _balanced(text: str, start: int, tag: str = "div") -> int:
    depth = 0
    for m in re.finditer(r"<%s\b|</%s>" % (tag, tag), text[start:]):
        depth += -1 if m.group(0).startswith("</") else 1
        if depth == 0:
            return start + m.end()
    raise SystemExit("unbalanced <%s> at %d" % (tag, start))


def _grab(text: str, opener: str, tag: str = "div") -> str:
    i = text.index(opener)
    return text[i:_balanced(text, i, tag)]


_src = open(SOURCE, encoding="utf-8").read()
_A = _src[_src.index('data-v5="M-01-conversation-drawer/A"') :]
_A = _A[: _A.index("</section>")]

STATUSBAR = _grab(_A, '<div class="statusbar">')
MTOP = _grab(_A, '<div class="m-top">')
COMPOSER = _grab(_A, '<div class="m-composer-area">')
HOME = '<div class="m-home"><i></i></div>'


def top(title: str = None, sub: str = None, left: str = None, right: str = None) -> str:
    """顶栏：默认「返回 + 标题 + ⋯」。"""
    out = MTOP
    if title:
        out = re.sub(r"<b>[^<]*</b>", f"<b>{title}</b>", out, count=1)
    if sub is not None:
        out = re.sub(r'<span class="m-top__sub">.*?</span>\s*</div>', f'<span class="m-top__sub">{sub}</span></div>', out, count=1, flags=re.S)
    if left is not None:
        out = re.sub(r'<button class="cbtn" title="返回">.*?</button>', left, out, count=1, flags=re.S)
    if right is not None:
        out = re.sub(r'<button class="cbtn" title="更多">.*?</button>', right, out, count=1, flags=re.S)
    return out


def composer(text: str = None, tab: str = None, bar: str = None, running=False, plus=None) -> str:
    """输入卡。`running=True` 时底部加一道光带。"""
    out = COMPOSER
    if tab is not None:
        out = re.sub(r'<div class="m-tab">.*?</div>\s*(?=<div class="m-composer">)', tab, out, count=1, flags=re.S)
    if text is not None:
        out = re.sub(r'(<div class="composer__text">).*?(</div>)', lambda m: m.group(1) + text + m.group(2), out, count=1, flags=re.S)
    if bar is not None:
        out = re.sub(r'<div class="composer__bar">.*?</div>\s*</div>\s*</div>', bar, out, count=1, flags=re.S)
    if plus is not None:
        out = re.sub(r'<button class="composer__plus".*?</button>', plus, out, count=1, flags=re.S)
    if running:
        out = out.replace('<div class="m-composer">', '<div class="m-composer" style="position:relative"><div class="m-loader"><i></i></div>', 1)
    return out


def phone(body: str, top_html: str = None, composer_html: str = None, overlays: str = "", veil=True) -> str:
    """整机：状态栏 + 顶栏 + 中间层 + 输入区 + home 条。"""
    return (
        '<div class="phone">\n'
        "    " + STATUSBAR + "\n"
        + ('    <div class="m-veil"></div>\n' if veil else "")
        + "    " + (top_html or MTOP) + "\n"
        + body + "\n"
        + (composer_html if composer_html is not None else COMPOSER) + "\n"
        + "    " + HOME + "\n"
        + (overlays + "\n" if overlays else "")
        + "  </div>"
    )


def thread(inner: str) -> str:
    return f'<div class="m-thread">\n      <div class="m-thread__inner">\n{inner}\n      </div>\n    </div>'


def fill(board: str, letter: str, inner: str):
    path = os.path.join(BOARDS, board + ".html")
    s = open(path, encoding="utf-8").read()
    key = None
    for m in re.finditer(r'data-fill="([^"]+)"', s):
        if m.group(1).endswith("/" + letter):
            key = m.group(1)
            break
    if not key:
        raise SystemExit(f"{board} 帧 {letter} 没有空槽")
    slot = f'<div class="phone" data-fill="{key}"><!-- FILL {key} --></div>'
    if slot not in s:
        slot = f'<div class="win" data-fill="{key}"><!-- FILL {key} --></div>'
    if slot not in s:
        raise SystemExit(f"{board} 帧 {letter} 的槽格式不认识：{key}")
    if 'class="phone"' in slot:
        new = '<div class="phone">\n' + inner.replace('<div class="phone">\n', "", 1).rstrip()
        if not new.rstrip().endswith("</div>"):
            new += "\n  </div>"
    else:
        new = '<div class="win">\n    <div class="win__tint"></div>\n' + inner + "\n  </div>"
    s = s.replace(slot, new, 1)
    open(path, "w", encoding="utf-8").write(s)
    return key
