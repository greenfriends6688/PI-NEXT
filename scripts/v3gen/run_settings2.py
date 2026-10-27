# -*- coding: utf-8 -*-
import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from settings import modal, section, fill
from specs_settings2 import FRAMES
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

n = 0
for board, frames in FRAMES.items():
    path = os.path.join(ROOT, "design/v3/boards", board + ".html")
    s = open(path, encoding="utf-8").read()
    for letter, active, title, sub, sections in frames:
        key = next((k for k in re.findall(r'data-fill="([^"]+)"', s) if k.endswith("/" + letter)), None)
        if not key:
            print(f"  skip {board}/{letter}（无空槽）")
            continue
        body = "".join(section(t, b) for t, b in sections)
        fill(board, letter, modal(active, title, sub, body))
        n += 1
        s = open(path, encoding="utf-8").read()
    left = s.count("data-fill=")
    print(f"{board}: 剩 {left} 槽")
print("共", n, "帧")
