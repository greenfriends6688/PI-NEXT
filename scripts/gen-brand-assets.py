#!/usr/bin/env python3
"""Generate every brand asset from the owner's logo.

Requires Pillow (python3 -m pip install Pillow). Not part of the build: the generated
files are committed, so this only runs when the artwork itself changes.

One source of truth: the artwork at PI NEXT品牌/pinext的logo.png (gradient N-mark on a
transparent field). Everything below is derived from it so the mark cannot drift between
the desktop icon, the renderer chrome, the boot loader, the Flutter launcher icons and the
splash screens.

Composition rules, each chosen from what the file it replaces was doing:
  tile(p)     opaque white square, mark at p of the side   — app/launcher icons
  mark(p)     transparent square,     mark at p of the side — in-app chrome, splash, loader
The mark is first cropped to its own alpha bounding box and re-centred, so a change to the
source artwork's padding does not move the mark inside the icons.
"""
from PIL import Image

SRC = "/Users/yingjing/Desktop/PI NEXT/PI NEXT品牌/pinext的logo.png"
ROOT = "/Users/yingjing/Desktop/pinext"
TILE = (255, 255, 255, 255)

src = Image.open(SRC).convert("RGBA")
mark = src.crop(src.split()[3].getbbox())


def composed(size: int, fraction: float, opaque: bool) -> Image.Image:
    side = max(mark.size)
    canvas = round(side / fraction)
    canvas += canvas % 2
    out = Image.new("RGBA", (canvas, canvas), TILE if opaque else (0, 0, 0, 0))
    x = (canvas - mark.width) // 2
    y = (canvas - mark.height) // 2
    # Premultiplied-safe paste: the mark's own alpha is kept.
    out.paste(mark, (x, y), mark)
    return out.resize((size, size), Image.LANCZOS)


def write(rel: str, image: Image.Image) -> None:
    path = f"{ROOT}/{rel}"
    image.save(path)
    print(f"  {rel:72s} {image.size[0]}x{image.size[1]}")


def write_many(rel: str, size: int, fraction: float, opaque: bool) -> None:
    write(rel, composed(size, fraction, opaque))


print("desktop / app icon")
write_many("resources/icon.png", 1024, 0.72, True)

# macOS .icns — iconutil wants an .iconset directory of exact names.
iconset = "/tmp/pinext.iconset"
import os
import shutil
import subprocess

shutil.rmtree(iconset, ignore_errors=True)
os.makedirs(iconset)
for px in (16, 32, 64, 128, 256, 512):
    composed(px, 0.72, True).save(f"{iconset}/icon_{px}x{px}.png")
for px in (32, 64, 128, 256, 512, 1024):
    composed(px, 0.72, True).save(f"{iconset}/icon_{px // 2}x{px // 2}@2x.png")
subprocess.run(["iconutil", "-c", "icns", iconset, "-o", f"{ROOT}/resources/icon.icns"], check=True)
print(f"  {'resources/icon.icns':72s} (from {iconset})")

print("renderer chrome (transparent: it sits on the app's own surfaces)")
write_many("src/renderer/src/assets/app-icon-light.png", 256, 0.92, False)
write_many("src/renderer/src/assets/app-icon-dark.png", 256, 0.92, False)
write_many("src/renderer/src/assets/pinext-mark.png", 256, 0.92, False)

print("mobile sources")
write_many("apps/mobile_flutter/assets/brand/icon.png", 1024, 0.72, True)
write_many("apps/mobile_flutter/assets/ios/icon.png", 1024, 0.72, True)
write_many("apps/mobile_flutter/assets/icon.png", 256, 0.92, False)
write_many("apps/mobile_flutter/assets/brand/splash.png", 1024, 0.33, False)
write_many("apps/mobile_flutter/assets/android/foreground.png", 1024, 0.52, False)
write_many("apps/mobile_flutter/assets/android/background.png", 1024, 0.72, True)
monochrome = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
glyph = composed(1024, 0.52, False)
white = Image.new("RGBA", glyph.size, (255, 255, 255, 255))
monochrome.paste(white, (0, 0), glyph.split()[3])
write("apps/mobile_flutter/assets/android/monochrome.png", monochrome)

print("android generated launcher assets")
for density, launcher, adaptive in (("mdpi", 48, 108), ("hdpi", 72, 162), ("xhdpi", 96, 216), ("xxhdpi", 144, 324), ("xxxhdpi", 192, 432)):
    res = f"apps/mobile_flutter/android/app/src/main/res"
    write(f"{res}/mipmap-{density}/ic_launcher.png", composed(launcher, 0.72, True))
    write(f"{res}/drawable-{density}/ic_launcher_foreground.png", composed(adaptive, 0.52, False))
    write(f"{res}/drawable-{density}/ic_launcher_background.png", composed(adaptive, 0.72, True))
    mono = Image.new("RGBA", (adaptive, adaptive), (0, 0, 0, 0))
    g = composed(adaptive, 0.52, False)
    mono.paste(white.resize(g.size), (0, 0), g.split()[3])
    mono.save(f"{ROOT}/{res}/drawable-{density}/ic_launcher_monochrome.png")

print("android splash drawables (mark only; the colour comes from flutter_native_splash)")
for density, size in (("mdpi", 256), ("hdpi", 384), ("xhdpi", 512), ("xxhdpi", 768), ("xxxhdpi", 1024)):
    res = f"apps/mobile_flutter/android/app/src/main/res"
    splash = composed(size, 0.33, False)
    for folder in (f"drawable-{density}", f"drawable-night-{density}"):
        splash.save(f"{ROOT}/{res}/{folder}/splash.png")
        splash.save(f"{ROOT}/{res}/{folder}/android12splash.png")

print("ios app icon set")
import json

appicon = "apps/mobile_flutter/ios/Runner/Assets.xcassets/AppIcon.appiconset"
contents = json.load(open(f"{ROOT}/{appicon}/Contents.json"))
seen = set()
for entry in contents["images"]:
    name = entry.get("filename")
    if not name or name in seen:
        continue
    seen.add(name)
    point = float(entry["size"].split("x")[0])
    scale = int(entry["scale"].rstrip("x"))
    write(f"{appicon}/{name}", composed(round(point * scale), 0.72, True))

print("done")
