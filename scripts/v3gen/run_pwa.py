# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pwa
from specs_pwa import FRAMES

n = 0
for board, frames in FRAMES.items():
    path = os.path.join(pwa.BOARDS, board + ".html")
    if "data-fill=" not in open(path, encoding="utf-8").read():
        print(f"{board}: 已满，跳过")
        continue
    for letter, builder in frames:
        pwa.fill(board, letter, builder())
        n += 1
    left = open(path, encoding="utf-8").read().count("data-fill=")
    print(f"{board}: 补 {len(frames)} 帧 · 剩 {left} 槽")
print("共", n, "帧")
