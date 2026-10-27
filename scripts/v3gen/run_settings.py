# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from settings import modal, section, fill
from specs_settings import FRAMES

n = 0
for board, frames in FRAMES.items():
    for letter, active, title, sub, sections in frames:
        body = "".join(section(t, b) for t, b in sections)
        fill(board, letter, modal(active, title, sub, body))
        n += 1
    left = open(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "design/v3/boards", board + ".html"), encoding="utf-8").read().count("data-fill=")
    print(f"{board}: 补 {len(frames)} 帧 · 剩 {left} 槽")
print("共", n, "帧")
