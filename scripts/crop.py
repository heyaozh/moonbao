"""看截图的局部（agent 自查画面用）：python3 scripts/crop.py <图> <x0> <y0> <x1> <y1> [输出] [放大倍数]
坐标是 0..1 的相对位置。"""
import sys
from PIL import Image
src = sys.argv[1]
x0, y0, x1, y1 = map(float, sys.argv[2:6])
out = sys.argv[6] if len(sys.argv) > 6 else "/tmp/crop.jpg"
scale = float(sys.argv[7]) if len(sys.argv) > 7 else 1.0
im = Image.open(src)
W, H = im.size
c = im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)))
if scale != 1.0:
    c = c.resize((int(c.width * scale), int(c.height * scale)), Image.LANCZOS)
c.save(out, quality=90)
print(out, c.size)
