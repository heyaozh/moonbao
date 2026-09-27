"""agent 自查用：几张截图缩小后横向拼成一张。python3 scripts/grid.py <输出> <图1> <图2> ... [--h 高度]"""
import sys
from PIL import Image
args = sys.argv[1:]
h = 720
if "--h" in args:
    i = args.index("--h")
    h = int(args[i + 1])
    del args[i : i + 2]
out, files = args[0], args[1:]
ims = [Image.open(f).convert("RGB") for f in files]
ims = [im.resize((int(im.width * h / im.height), h), Image.LANCZOS) for im in ims]
c = Image.new("RGB", (sum(i.width for i in ims) + 6 * (len(ims) - 1), h), (40, 40, 40))
x = 0
for im in ims:
    c.paste(im, (x, 0))
    x += im.width + 6
c.save(out, quality=86)
print(out, c.size)
