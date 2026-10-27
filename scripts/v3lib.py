# -*- coding: utf-8 -*-
"""补帧小工具：从一张 V3 画板的帧 A 里取零件，拼出 B/C/D。

用法：
    from v3lib import Board
    b = Board("web-new-thread")
    side, detail = b.parts("A")          # 帧 A 的 aside.side / section.detail
    b.fill("B", side + detail2)          # 写进空槽
    b.save()
"""
import re, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARDS = os.path.join(ROOT, "design", "v3", "boards")


def _balanced(text, start, tag):
    depth = 0
    for m in re.finditer(r"<%s\b|</%s>" % (tag, tag), text[start:]):
        depth += -1 if m.group(0).startswith("</") else 1
        if depth == 0:
            return start + m.end()
    return len(text)


class Board:
    def __init__(self, target):
        self.target = target
        self.path = os.path.join(BOARDS, target + ".html")
        self.text = open(self.path, encoding="utf-8").read()

    # ---------- 读 ----------
    def frame(self, letter):
        key = 'data-v5="%s/%s"' % (self.v5, letter)
        i = self.text.index(key)
        start = self.text.rindex("<section", 0, i)
        end = _balanced(self.text, start, "section")
        return self.text[start:end]

    @property
    def v5(self):
        m = re.search(r'data-v5="([^/]+)/', self.text)
        return m.group(1)

    def parts(self, letter="A"):
        f = self.frame(letter)
        out = {}
        for tag, cls in (("aside", "side"), ("section", "detail"), ("div", "phone")):
            i = f.find('<%s class="%s"' % (tag, cls))
            if i < 0:
                continue
            end = _balanced(f, i, tag)
            out[cls] = f[i:end]
        return out

    # ---------- 写 ----------
    def fill(self, letter, inner):
        key = "%s/%s" % (self.v5, letter)
        pat = '<div class="win" data-fill="%s"><!-- FILL %s --></div>' % (key, key)
        if pat in self.text:
            self.text = self.text.replace(
                pat, '<div class="win">\n    <div class="win__tint"></div>\n%s\n  </div>' % inner, 1)
            return True
        pat = '<div class="phone" data-fill="%s"><!-- FILL %s --></div>' % (key, key)
        if pat in self.text:
            self.text = self.text.replace(pat, '<div class="phone">\n%s\n  </div>' % inner, 1)
            return True
        raise SystemExit("找不到空槽：" + key)

    def refill(self, letter, inner):
        """替换已填帧里 .win / .phone 的内容（保留外壳）。"""
        key = "%s/%s" % (self.v5, letter)
        i = self.text.index('data-v5="%s"' % key)
        start = self.text.rindex("<section", 0, i)
        end = _balanced(self.text, start, "section")
        block = self.text[start:end]
        j = block.find('<div class="win">')
        tag = "div"
        if j < 0:
            j = block.find('<div class="phone">')
        k = block.index(">", j) + 1
        e = _balanced(block, j, tag)
        block2 = block[:k] + "\n" + inner + "\n  " + block[e-len("</div>"):]
        self.text = self.text[:start] + block2 + self.text[end:]

    def save(self):
        open(self.path, "w", encoding="utf-8").write(self.text)
        left = self.text.count("data-fill")
        print("%s: 剩 %d 槽" % (self.target, left))


def replace_once(text, old, new):
    assert old in text, "找不到要替换的片段：" + old[:60]
    return text.replace(old, new, 1)
