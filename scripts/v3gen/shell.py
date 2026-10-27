# -*- coding: utf-8 -*-
"""V3 画板补帧生成器：Web 外壳（侧栏 + 顶栏 + 输入区）。

外壳不手写 —— 直接从 `design/v3/boards/web-running.html` 的帧 A 里**原样抽**：
`aside.side`、`div.chrome`、`div.composer-area`。这样 57 张 web 板共用同一份
外壳，改一处就全对，也不会出现「某个板自己发明一个侧栏」。

每张板只写 `.detail` 里该帧要演的那一段（转录 / 面板 / 浮层），其余照抄。
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BOARDS = os.path.join(ROOT, "design", "v3", "boards")
SOURCE = os.path.join(BOARDS, "web-running.html")

ICO = lambda n, cls="ic": f'<svg class="{cls}"><use href="#i-{n}"></use></svg>'


def _balanced(text: str, start: int, tag: str = "div") -> int:
    """从 start 处的 `<tag` 起，返回与之配对的 `</tag>` 结束位置。"""
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
_A = _src[_src.index('data-v5="D-02-sidebar-topbar/A"') :]
_A = _A[: _A.index("</section>")]

SIDE = _grab(_A, '<aside class="side">', "aside")
# 转录家族的样例项目名统一成 PI NEXT（`web-transcript-content` 已按这个名字出过图）
SIDE = SIDE.replace(">pi-web<", ">PI NEXT<")
CHROME = _grab(_A, '<div class="chrome">')
COMPOSER_AREA = _grab(_A, '<div class="composer-area">')
RAIL = _grab(_A, '<div class="rail" aria-label="会话大纲">')

# 帧 A 的转录内容：`thread__inner` 里从 `.earlier` 到最后一个 `.turn` 结束
_ti = _A.index('<div class="thread__inner">')
THREAD_OPEN = _A[_ti : _A.index(">", _ti) + 1]


def chrome(title: str = None, right: str = None) -> str:
    """顶栏。`title` 换会话名；`right` 换右侧两组胶囊（默认照抄帧 A）。"""
    out = CHROME
    if title:
        out = re.sub(
            r'(<h1 class="chrome__title">)[^<]*(</h1>)',
            lambda m: m.group(1) + title + m.group(2),
            out,
            count=1,
        )
    if right is not None:
        out = re.sub(r'<div class="chrome__right">.*?</div>\s*</div>', right, out, count=1, flags=re.S)
    return out


def side(list_html: str = None, tools: str = None) -> str:
    """侧栏。`list_html` 换 `.side__list` 的内容；`tools` 换 `.side__tools`。"""
    out = SIDE
    if tools is not None:
        i = out.index('<div class="side__tools">')
        j = _balanced(out, i)
        out = out[:i] + tools + out[j:]
    if list_html is not None:
        i = out.index('<div class="side__list">')
        j = _balanced(out, i)
        out = out[:i] + '<div class="side__list">\n' + list_html + "\n      </div>" + out[j:]
    return out


def rail(ticks) -> str:
    """左缘 minimap。`ticks` 是 [(标题, 摘要, 是否当前)]，一条消息一个刻度。"""
    out = ['<div class="rail" aria-label="会话大纲">', '        <div class="rail__stack">']
    for i, item in enumerate(ticks):
        t, sub = item[0], item[1]
        now = len(item) > 2 and item[2]
        cls = "tick is-now" if now else "tick"
        out.append(f'          <button class="{cls}" aria-label="跳到第{i + 1}条">')
        out.append(f'            <span class="tick__card"><b>{t}</b><span>{sub}</span></span>')
        out.append("          </button>")
    out += ["        </div>", "      </div>"]
    return "\n".join(out)


def thread(inner: str, extra_cls: str = "") -> str:
    """转录列。`inner` 是 `.thread__inner` 里从 `.earlier` 开始的内容。"""
    return (
        f'<div class="thread{(" " + extra_cls) if extra_cls else ""}">\n'
        f'        <div class="thread__inner">\n{inner}\n        </div>\n      </div>'
    )


def composer(text: str = None, tab: str = "", bar: str = None) -> str:
    """输入区。`tab` 换上方那颗页签（空字符串则去掉）；`bar` 换工具条。"""
    out = COMPOSER_AREA
    if tab is not None:
        out = re.sub(r'<button class="tab">.*?</button>\s*', tab, out, count=1, flags=re.S)
    if text is not None:
        out = re.sub(
            r'(<div class="composer__text">).*?(</div>)',
            lambda m: m.group(1) + text + m.group(2),
            out,
            count=1,
            flags=re.S,
        )
    if bar is not None:
        out = re.sub(r'<div class="composer__bar">.*?</div>\s*</div>\s*</div>\s*</div>', bar, out, count=1, flags=re.S)
    return out


def composer_area_with(dock: str, composer_html: str = None) -> str:
    """输入区 + 贴在它上面的停靠条 / 授权卡。"""
    return dock + "\n" + (composer_html or COMPOSER_AREA)


def win(detail_inner: str, side_html: str = None, chrome_html: str = None) -> str:
    """整窗：`.win > .win__tint + aside.side + section.detail`。"""
    return (
        '<div class="win">\n    <div class="win__tint"></div>\n\n'
        + (side_html or SIDE)
        + '\n\n    <section class="detail">\n      <div class="veil"></div>\n\n'
        + (chrome_html or CHROME)
        + "\n\n"
        + detail_inner
        + "\n    </section>\n  </div>"
    )


def fill(board: str, letter: str, inner: str):
    """把生成好的 DOM 写进画板对应空槽（win / phone 都认）。"""
    path = os.path.join(BOARDS, board + ".html")
    s = open(path, encoding="utf-8").read()
    key = None
    for m in re.finditer(r'data-fill="([^"]+)"', s):
        if m.group(1).endswith("/" + letter):
            key = m.group(1)
            break
    if not key:
        raise SystemExit(f"{board} 帧 {letter} 没有空槽")
    slot = f'<div class="win" data-fill="{key}"><!-- FILL {key} --></div>'
    if slot not in s:
        slot = f'<div class="phone" data-fill="{key}"><!-- FILL {key} --></div>'
    if slot not in s:
        raise SystemExit(f"{board} 帧 {letter} 的槽格式不认识：{key}")
    if 'class="win"' in slot:
        # win() 自己就带外层 `.win`，别再套一层（套了会得到两个叠在一起的窗口）
        if inner.lstrip().startswith('<div class="win">'):
            new = inner
        else:
            new = '<div class="win">\n    <div class="win__tint"></div>\n' + inner + "\n  </div>"
    else:
        new = '<div class="phone">\n' + inner + "\n  </div>"
    s = s.replace(slot, new, 1)
    open(path, "w", encoding="utf-8").write(s)
    return key
