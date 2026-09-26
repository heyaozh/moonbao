"""
把 look-dev 的全尺寸月面贴图缩成网页用的副本（web/public/moon/）。

输入：moon_lookdev.py 输出目录里的 albedo.png（4096×2048 sRGB）与 height_16bit.png（4096×2048，16-bit）。
输出：
  <prefix>_albedo_2k.jpg   2048×1024 JPEG（sips 转码，macOS）
  <prefix>_height_1k.png   1024×512 8-bit 灰度，按该图自身 min..max 线性拉满 0..255
缩小用整数倍面积平均（4096 → 2048 / 1024），没有插值振铃。
用法（在仓库根目录；需要先按 assets/moon/README.md 生成或保留全尺寸贴图）：
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/make_web_textures.py -- \
      --src assets/moon/nasa_face_softglow --out web/public/moon --prefix nasa_soft05 [--jpeg_q 80]
"""
import sys, os, argparse, struct, zlib, subprocess, tempfile
import numpy as np
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--prefix", required=True)
ap.add_argument("--albedo_w", type=int, default=2048)
ap.add_argument("--height_w", type=int, default=1024)
ap.add_argument("--jpeg_q", type=int, default=80)
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True)

def load(path, non_color):
    im = bpy.data.images.load(os.path.abspath(path), check_existing=False)
    if non_color:
        im.colorspace_settings.name = "Non-Color"; im.reload()
    w, h = im.size
    px = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(px)
    bpy.data.images.remove(im)
    return px.reshape(h, w, 4)[::-1]          # 北在上

def downscale(a, out_w):
    h, w = a.shape[:2]
    f = w // out_w
    assert w % out_w == 0 and h % f == 0, f"{w}×{h} 不能整数倍缩到宽 {out_w}"
    return a.reshape(h // f, f, w // f, f, *a.shape[2:]).mean(axis=(1, 3))

def write_png(path, arr):
    h, w = arr.shape[:2]
    color_type = 0 if arr.ndim == 2 else 2
    raw = b"".join(b"\x00" + row.tobytes() for row in arr.astype("u1"))
    def chunk(tag, body):
        c = tag + body
        return struct.pack(">I", len(body)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, color_type, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))

# 反照率：像素值保持 sRGB 编码（不做线性化），和源图一致
alb = downscale(load(os.path.join(args.src, "albedo.png"), False)[..., :3], args.albedo_w)
tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False).name
write_png(tmp, np.round(np.clip(alb, 0, 1) * 255))
out_a = os.path.join(args.out, f"{args.prefix}_albedo_{args.albedo_w // 1024}k.jpg")
subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(args.jpeg_q), tmp, "--out", out_a],
               check=True, stdout=subprocess.DEVNULL)
os.remove(tmp)

# 高程：16-bit → 8-bit，按自身范围拉满
hgt = downscale(load(os.path.join(args.src, "height_16bit.png"), True)[..., 0], args.height_w)
hgt = (hgt - hgt.min()) / max(float(hgt.max() - hgt.min()), 1e-6)
out_h = os.path.join(args.out, f"{args.prefix}_height_{args.height_w // 1024}k.png")
write_png(out_h, np.round(hgt * 255))

for p in (out_a, out_h):
    print(f"[web-tex] {p}  {os.path.getsize(p) / 1024:.0f} KB", flush=True)
