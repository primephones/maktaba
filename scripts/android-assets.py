"""Writes the Android launcher icons and launch screens from the artwork in public/icons.

Run after scripts/make-icons.mjs:  python3 scripts/android-assets.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
icons = root / "public" / "icons"
res = root / "android" / "app" / "src" / "main" / "res"
LEATHER = (94, 27, 23)

icon = Image.open(icons / "icon-512.png").convert("RGBA")
square = Image.open(icons / "icon-maskable-512.png").convert("RGBA")
foreground = Image.open(icons / "android-foreground-432.png").convert("RGBA")

densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for name, scale in densities.items():
    folder = res / f"mipmap-{name}"
    size = round(48 * scale)
    icon.resize((size, size), Image.LANCZOS).save(folder / "ic_launcher.png")
    # Round icon: the full-bleed artwork cut to a circle.
    big = square.resize((size * 4, size * 4), Image.LANCZOS)
    mask = Image.new("L", big.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big.size[0] - 1, big.size[1] - 1), fill=255)
    big.putalpha(mask)
    big.resize((size, size), Image.LANCZOS).save(folder / "ic_launcher_round.png")
    fg = round(108 * scale)
    foreground.resize((fg, fg), Image.LANCZOS).save(folder / "ic_launcher_foreground.png")

# Launch screen: the gold word on plain leather, the same in every size and orientation.
for path in sorted(res.glob("drawable*/splash.png")):
    w, h = Image.open(path).size
    canvas = Image.new("RGB", (w, h), LEATHER)
    mark = round(min(w, h) * 0.62)
    word = foreground.resize((mark, mark), Image.LANCZOS)
    canvas.paste(word, ((w - mark) // 2, (h - mark) // 2), word)
    canvas.save(path)

(res / "values" / "ic_launcher_background.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#5E1B17</color>\n</resources>\n'
)
print("android assets written")
