"""agent 自查用：把截图缩成半尺寸 + 一块放大的局部，左右拼成一张。
python3 scripts/side.py <截图> <x0> <y0> <x1> <y1> <输出> [参考图]
有参考图时三张并排（参考图缩到同高）。"""
import sys
from PIL import Image
src, x0, y0, x1, y1, out = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6]
ref = sys.argv[7] if len(sys.argv) > 7 else None
im = Image.open(src)
W, H = im.size
full = im.resize((W // 2, H // 2), Image.LANCZOS)
crop = im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)))
s = full.height / crop.height
if crop.width * s > full.width * 1.3:
    s = full.width * 1.3 / crop.width
crop = crop.resize((int(crop.width * s), int(crop.height * s)), Image.LANCZOS)
parts = [full, crop]
if ref:
    r = Image.open(ref)
    r = r.resize((int(r.width * full.height / r.height), full.height), Image.LANCZOS)
    parts.append(r)
Wt = sum(p.width for p in parts)
c = Image.new("RGB", (Wt, full.height))
x = 0
for p in parts:
    c.paste(p, (x, 0))
    x += p.width
c.save(out, quality=88)
print(out, c.size)
