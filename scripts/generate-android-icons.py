#!/usr/bin/env python3
"""Regenerates the Android launcher icons and splash screens from public/logo.png (needs Pillow).

    python3 scripts/generate-android-icons.py

Adaptive icon: the logo sits inside the 66 % safe zone of a 108 dp canvas on a white background.
Legacy icons (Android < 8) and the splash images use the same artwork.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android/app/src/main/res"
BG = (255, 255, 255, 255)
SPLASH_BG = (251, 250, 248, 255)  # matches capacitor.config.ts backgroundColor #fbfaf8

logo = Image.open(ROOT / "public/logo.png").convert("RGBA")
# Trim the near-white margin so scaling is predictable.
px = logo.load()
w, h = logo.size
xs = [x for x in range(w) for y in range(0, h, 4) if sum(px[x, y][:3]) < 700]
ys = [y for y in range(h) for x in range(0, w, 4) if sum(px[x, y][:3]) < 700]
logo = logo.crop((min(xs), min(ys), max(xs) + 1, max(ys) + 1))
# The scan has a white background: make it transparent so it sits on any colour.
data = []
for r, g, b, a in logo.getdata():
    lum = (r + g + b) / 3
    alpha = 0 if lum > 245 else (int((245 - lum) / 245 * 255 * 1.6) if lum > 200 else 255)
    data.append((r, g, b, min(255, alpha)))
logo.putdata(data)


def fit(img, box, canvas, bg, scale):
    c = Image.new("RGBA", canvas, bg)
    side = int(min(canvas) * scale)
    r = min(side / img.width, side / img.height)
    im = img.resize((max(1, int(img.width * r)), max(1, int(img.height * r))), Image.LANCZOS)
    c.alpha_composite(im, ((canvas[0] - im.width) // 2, (canvas[1] - im.height) // 2))
    return c


legacy = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
for d, px_ in legacy.items():
    out = RES / f"mipmap-{d}"
    out.mkdir(parents=True, exist_ok=True)
    fit(logo, None, (px_, px_), BG, 0.70).save(out / "ic_launcher.png")
    fit(logo, None, (px_, px_), BG, 0.70).save(out / "ic_launcher_round.png")
    fg = int(px_ * 108 / 48)
    fit(logo, None, (fg, fg), (0, 0, 0, 0), 0.50).save(out / "ic_launcher_foreground.png")

port = {"mdpi": (320, 480), "hdpi": (480, 800), "xhdpi": (720, 1280), "xxhdpi": (960, 1600), "xxxhdpi": (1280, 1920)}
for d, (pw, ph) in port.items():
    for orient, size in (("port", (pw, ph)), ("land", (ph, pw))):
        out = RES / f"drawable-{orient}-{d}"
        out.mkdir(parents=True, exist_ok=True)
        fit(logo, None, size, SPLASH_BG, 0.28 if orient == "port" else 0.30).save(out / "splash.png")
fit(logo, None, (480, 320), SPLASH_BG, 0.40).save(RES / "drawable/splash.png")
print("icons and splash images written to", RES)
