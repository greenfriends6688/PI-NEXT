#!/usr/bin/env python3
"""Generate every brand asset from the owner's logo.

Requires Pillow (python3 -m pip install Pillow). Not part of the build: the generated
files are committed, so this only runs when the artwork itself changes.

One source of truth: the artwork at PI NEXT品牌/pinext的logo.png (gradient N-mark on a
transparent field). Everything below is derived from it so the mark cannot drift between
the desktop icon, the renderer chrome, the boot loader, the Flutter launcher icons and the
splash screens.

The artwork is used **as drawn** — the whole file, contained (not filled, not cropped,
no background added) and centred, with its own transparency preserved. The only place the
alpha is flattened is the iOS app icon, because iOS refuses an icon with an alpha channel.
"""
from PIL import Image

SRC = "/Users/yingjing/Desktop/PI NEXT/PI NEXT品牌/pinext的logo.png"
ROOT = "/Users/yingjing/Desktop/pinext"
TILE = (255, 255, 255, 255)

src = Image.open(SRC).convert("RGBA")


def composed(size: int, opaque: bool = False) -> Image.Image:
    """The artwork scaled to fit `size`, centred, nothing added and nothing cropped."""
    scale = min(size / src.width, size / src.height)
    art = src.resize((round(src.width * scale), round(src.height * scale)), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), TILE if opaque else (0, 0, 0, 0))
    out.paste(art, ((size - art.width) // 2, (size - art.height) // 2), art)
    return out


def write(rel: str, image: Image.Image) -> None:
    path = f"{ROOT}/{rel}"
    image.save(path)
    print(f"  {rel:72s} {image.size[0]}x{image.size[1]}")


def write_many(rel: str, size: int, opaque: bool = False) -> None:
    write(rel, composed(size, opaque))


print("desktop / app icon")
write_many("resources/icon.png", 1024)

# macOS .icns — iconutil wants an .iconset directory of exact names.
# The mark keeps its own transparency: the owner asked for the logo alone, not the
# logo on a white tile, so no background is composited in here.
iconset = "/tmp/pinext.iconset"
import os
import shutil
import subprocess

shutil.rmtree(iconset, ignore_errors=True)
os.makedirs(iconset)
for px in (16, 32, 64, 128, 256, 512):
    composed(px).save(f"{iconset}/icon_{px}x{px}.png")
for px in (32, 64, 128, 256, 512, 1024):
    composed(px).save(f"{iconset}/icon_{px // 2}x{px // 2}@2x.png")
subprocess.run(["iconutil", "-c", "icns", iconset, "-o", f"{ROOT}/resources/icon.icns"], check=True)
print(f"  {'resources/icon.icns':72s} (from {iconset})")

print("renderer chrome (transparent: it sits on the app's own surfaces)")
write_many("src/renderer/src/assets/app-icon-light.png", 256)
write_many("src/renderer/src/assets/app-icon-dark.png", 256)
write_many("src/renderer/src/assets/pinext-mark.png", 256)

print("renderer favicons (what a browser tab shows)")
# `public/` is copied verbatim into the build and served at the site root; these are the
# three files `index.html` / `web.html` name as the tab icon.
write_many("src/renderer/public/icon-light.png", 256)
write_many("src/renderer/public/icon-dark.png", 256)
write_many("src/renderer/public/icon.png", 256)
# Browsers ask for `/favicon.ico` on their own whenever a page has no icon link they can
# use, and a JSON 404 in that slot is the kind of thing that shows up as a broken tab.
composed(64).save(f"{ROOT}/src/renderer/public/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print(f"  {'src/renderer/public/favicon.ico':72s} multi-size")

print("mobile sources")
write_many("apps/mobile_flutter/assets/brand/icon.png", 1024)
write_many("apps/mobile_flutter/assets/ios/icon.png", 1024)
write_many("apps/mobile_flutter/assets/icon.png", 256)
write_many("apps/mobile_flutter/assets/brand/splash.png", 1024)
write_many("apps/mobile_flutter/assets/android/foreground.png", 1024)
# The adaptive background is a flat field, not artwork: Android masks the foreground
# over it, so anything drawn here fights the mark. White matches the artwork's own field.
write("apps/mobile_flutter/assets/android/background.png", Image.new("RGBA", (1024, 1024), TILE))
monochrome = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
glyph = composed(1024)
white = Image.new("RGBA", glyph.size, (255, 255, 255, 255))
monochrome.paste(white, (0, 0), glyph.split()[3])
write("apps/mobile_flutter/assets/android/monochrome.png", monochrome)

print("android generated launcher assets")
for density, launcher, adaptive in (("mdpi", 48, 108), ("hdpi", 72, 162), ("xhdpi", 96, 216), ("xxhdpi", 144, 324), ("xxxhdpi", 192, 432)):
    res = f"apps/mobile_flutter/android/app/src/main/res"
    write(f"{res}/mipmap-{density}/ic_launcher.png", composed(launcher))
    write(f"{res}/drawable-{density}/ic_launcher_foreground.png", composed(adaptive))
    write(f"{res}/drawable-{density}/ic_launcher_background.png", Image.new("RGBA", (adaptive, adaptive), TILE))
    mono = Image.new("RGBA", (adaptive, adaptive), (0, 0, 0, 0))
    g = composed(adaptive)
    mono.paste(white.resize(g.size), (0, 0), g.split()[3])
    mono.save(f"{ROOT}/{res}/drawable-{density}/ic_launcher_monochrome.png")

print("android splash drawables (mark only; the colour comes from flutter_native_splash)")
for density, size in (("mdpi", 256), ("hdpi", 384), ("xhdpi", 512), ("xxhdpi", 768), ("xxxhdpi", 1024)):
    res = f"apps/mobile_flutter/android/app/src/main/res"
    splash = composed(size)
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
    write(f"{appicon}/{name}", composed(round(point * scale), True))

print("done")
