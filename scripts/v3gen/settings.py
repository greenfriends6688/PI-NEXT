# -*- coding: utf-8 -*-
"""V3 画板补帧生成器：设置家族。

设置板共用一套壳（`design/v3/boards/web-settings-mcp.html` 的 `.settings-modal`）：
左边 `.set-nav-col`，右边 `.set-content > .set-content__inner`。
每帧只换「哪个 nav 项高亮 + 右边这一页的内容」。

用法：在 specs.py 里给每张板写 FRAMES，然后 `python scripts/v3gen/run_settings.py`。
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BOARDS = os.path.join(ROOT, "design", "v3", "boards")

ICO = lambda n, cls="ic": f'<svg class="{cls}"><use href="#i-{n}"></use></svg>'

# 设置左侧导航（画板里那张表，顺序不动）
NAV = [
    ("通用", "gear", "settings.general"),
    ("外观", "sun", "settings.appearance"),
    ("模型", "circle-dotted", "settings.models"),
    ("提供方", "key", "settings.providers"),
    ("MCP 服务器", "puzzle", "settings.mcp"),
    ("技能", "sparkle", "settings.skills"),
    ("子代理", "person-2", "settings.agents"),
    ("插件", "puzzle", "settings.plugins"),
    ("记忆", "book-open", "settings.memory"),
    ("联网搜索", "globe", "settings.websearch"),
    ("定时任务", "clock", "settings.automation"),
    ("用量", "chart-column", "settings.usage"),
    ("归档与导入", "archive", "settings.archive"),
    ("手机与推送", "smartphone", "settings.phone"),
    ("快捷键", "command", "settings.keys"),
    ("关于", "info", "settings.about"),
]


def nav(active: str) -> str:
    out = []
    for label, icon, _ in NAV:
        cls = "set-row is-on" if label == active else "set-row"
        out.append(f'          <button class="{cls}">{ICO(icon)}{label}</button>')
    return "\n".join(out)


def modal(active: str, title: str, sub: str, body: str, search: str = "搜索设置", width: int = 1060) -> str:
    return f'''    <div class="modal-scrim"></div>

    <div class="settings-modal" role="dialog" aria-label="设置" style="width:{width}px">
      <aside class="set-nav-col">
        <div class="set-modal-head">
          <span class="set-modal-title">设置</span>
          <button class="cbtn cbtn--sm" title="关闭">{ICO("xmark")}</button>
        </div>

        <div class="set-search">
          <label class="field">
            {ICO("search")}
            <input placeholder="{search}" aria-label="{search}">
          </label>
        </div>

        <nav class="set-nav">
{nav(active)}
        </nav>
      </aside>

      <section class="set-content">
        <div class="set-content__inner" style="max-height:100%;overflow-y:auto;padding-bottom:28px">
          <h1 class="set-h1">{title}</h1>
          <p class="set-sub">{sub}</p>
{body}
        </div>
      </section>
    </div>'''


def section(title: str, body: str) -> str:
    return f'''
          <section class="set-section">
            <h2 class="set-section__title">{title}</h2>
{body}
          </section>'''


def card(rows: str, style: str = "") -> str:
    extra = f' style="{style}"' if style else ""
    # 最后一行后面不留分隔线
    rows = rows.rstrip()
    if rows.endswith('<div class="cdivider"></div>'):
        rows = rows[: -len('<div class="cdivider"></div>')].rstrip()
    return f'''            <div class="card"{extra}>
{rows}
            </div>'''


def row(title: str, desc: str = "", control: str = "", icon: str = "") -> str:
    """画板 web-settings-mcp 的 .crow：图标 control + .crow__text + 右侧 control。"""
    lead = f'<div class="crow__control"><span class="rowicon">{ICO(icon)}</span></div>' if icon else ""
    detail = f'\n                  <div class="crow__detail">{desc}</div>' if desc else ""
    return f'''              <div class="crow">
                {lead}<div class="crow__text">
                  <div class="crow__title">{title}</div>{detail}
                </div>
                <div class="crow__control">{control}</div>
              </div>
              <div class="cdivider"></div>'''


def sw(on: bool) -> str:
    return f'<span class="switch{" is-on" if on else ""}" role="switch" aria-checked="{str(on).lower()}"><i></i></span>'


def seg(items, on: int = 0) -> str:
    cells = "".join(f'<button class="{"is-on" if i == on else ""}">{x}</button>' for i, x in enumerate(items))
    return f'<span class="seg">{cells}</span>'


def btn(label: str, kind: str = "") -> str:
    cls = f"btn {kind}".strip()
    return f'<button class="{cls}">{label}</button>'


def tag(label: str, on: bool = False) -> str:
    return f'<span class="tag{" is-on" if on else ""}">{label}</span>'


def mono(text: str) -> str:
    return f'<span class="mono">{text}</span>'


def kv(pairs) -> str:
    rows = "".join(f'<div class="kv-row"><span>{k}</span><span>{v}</span></div>' for k, v in pairs)
    return f'            <div class="card" style="padding:10px 14px">{rows}</div>'


def table(headers, rows) -> str:
    head = "".join(f"<th>{h}</th>" for h in headers)
    body = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'''            <table class="spec-table">
              <tr>{head}</tr>
              {body}
            </table>'''


def fill(board: str, letter: str, inner: str):
    """把生成好的 DOM 写进画板对应空槽。"""
    path = os.path.join(BOARDS, board + ".html")
    s = open(path, encoding="utf-8").read()
    key = None
    for m in __import__("re").finditer(r'data-fill="([^"]+)"', s):
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
    tag = "win" if 'class="win"' in slot else "phone"
    s = s.replace(slot, f'<div class="{tag}">\n    <div class="win__tint"></div>\n{inner}\n  </div>' if tag == "win" else f'<div class="phone">\n{inner}\n  </div>', 1)
    open(path, "w", encoding="utf-8").write(s)
    return key
