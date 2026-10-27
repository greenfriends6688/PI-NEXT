# -*- coding: utf-8 -*-
import sys, os, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shell
from specs_transcript import FRAMES

mod = sys.argv[1] if len(sys.argv) > 1 else "specs_transcript"
if mod != "specs_transcript":
    FRAMES = importlib.import_module(mod).FRAMES

n = 0
for board, frames in FRAMES.items():
    path = os.path.join(shell.BOARDS, board + ".html")
    if "data-fill=" not in open(path, encoding="utf-8").read():
        print(f"{board}: 已满，跳过")
        continue
    for letter, builder in frames:
        shell.fill(board, letter, builder())
        n += 1
    left = open(os.path.join(shell.BOARDS, board + ".html"), encoding="utf-8").read().count("data-fill=")
    print(f"{board}: 补 {len(frames)} 帧 · 剩 {left} 槽")
print("共", n, "帧")
