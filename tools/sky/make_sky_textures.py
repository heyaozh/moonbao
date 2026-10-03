"""把 NASA SVS 银河图层与 d3-celestial 星表做成网页用的小文件。

输入（assets/sky/raw/，gitignore，重下见 assets/sky/README.md）：
  milkyway_2020_4k.npy   由 exr_to_npy.py 从 milkyway_2020_4k.exr 转出（float，0..1）
  stars.6.json           d3-celestial 星表（Hipparcos，≤ 6 等）
输出（web/public/sky/）：
  milkyway_4k.jpg        equirectangular，celestial 坐标：u = fract(0.5 - RA/360)（赤经向左增加，0h 在正中），v = (90 - Dec)/180
                         存的是 pow(v / WHITE, 1/2.2) 的 sRGB 编码；着色器解码后乘增益即可还原亮度
  stars.bin              Float32 小端 [ra_rad, dec_rad, mag, bv] × N，按星等从亮到暗
  stars.json             同样的数据（扁平数组），网页实际读这个（静态托管 / Artifact 都认 .json）
用法：python3 tools/sky/make_sky_textures.py
"""
import json
import pathlib
import struct

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/sky/raw"
OUT = ROOT / "web/public/sky"
OUT.mkdir(parents=True, exist_ok=True)

WHITE = 0.6  # 原图亮度到这里就算白；银心核球最亮处约 0.7，允许轻微过曝
Q = 84

a = np.load(RAW / "milkyway_2020_4k.npy").astype(np.float32)
v = np.clip(a / WHITE, 0, 1) ** (1 / 2.2)
img = Image.fromarray((v * 255 + 0.5).astype(np.uint8), "RGB")
p = OUT / "milkyway_4k.jpg"
img.save(p, quality=Q, optimize=True, progressive=True)
print(f"{p.relative_to(ROOT)}  {img.size}  {p.stat().st_size/1e6:.2f} MB")

d = json.loads((RAW / "stars.6.json").read_text())
rows = []
for f in d["features"]:
    lon, lat = f["geometry"]["coordinates"]
    ra = lon % 360.0
    mag = float(f["properties"]["mag"])
    try:
        bv = float(f["properties"].get("bv", "0.6") or 0.6)
    except ValueError:
        bv = 0.6
    rows.append((np.radians(ra), np.radians(lat), mag, bv))
rows.sort(key=lambda r: r[2])
buf = b"".join(struct.pack("<4f", *r) for r in rows)
p = OUT / "stars.bin"
p.write_bytes(buf)
# 网页读的是 JSON（静态托管、Artifact 都只认常见类型）
import json as _json
flat = [round(float(v), 5 if i % 4 < 2 else 2) for i, v in enumerate(np.frombuffer(buf, dtype="<f4"))]
(OUT / "stars.json").write_text(_json.dumps({"format": "flat [ra_rad, dec_rad, mag, bv] x N, brightest first (d3-celestial stars.6, Hipparcos)", "n": len(rows), "data": flat}, separators=(",", ":")))
mags = np.array([r[2] for r in rows])
print(f"{p.relative_to(ROOT)}  {len(rows)} stars  mag {mags.min():.2f}..{mags.max():.2f}  {len(buf)/1e3:.0f} kB")
