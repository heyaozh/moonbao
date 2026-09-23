#!/usr/bin/env python3
"""把 snaps/<seq>/frame-*.jpg 合成 GIF（CHECKPOINT 0 的「5 人 3 笑」夹具）。

用法：
  python3 scripts/make-gif.py <seq> [--fps 15] [--width 360] [--out snaps/<seq>.gif]
帧由页面里的 window.__recordGif("<seq>") 逐帧落盘（见 web/main.ts）。
有 ffmpeg 就用 ffmpeg（palettegen 两遍，质量好体积小）；没有就用 PIL。
"""
import argparse
import glob
import os
import shutil
import subprocess
import sys

ap = argparse.ArgumentParser()
ap.add_argument("seq")
ap.add_argument("--fps", type=int, default=15)
ap.add_argument("--width", type=int, default=360)
ap.add_argument("--out")
a = ap.parse_args()

d = os.path.join("snaps", a.seq)
frames = sorted(glob.glob(os.path.join(d, "frame-*.jpg")))
if not frames:
    sys.exit(f"没有帧：{d}")
out = a.out or os.path.join("snaps", f"{a.seq}.gif")

if shutil.which("ffmpeg"):
    pattern = os.path.join(d, "frame-%04d.jpg")
    vf = f"fps={a.fps},scale={a.width}:-1:flags=lanczos"
    palette = os.path.join(d, "palette.png")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(a.fps), "-i", pattern,
                    "-vf", f"{vf},palettegen=stats_mode=diff", palette], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(a.fps), "-i", pattern, "-i", palette,
                    "-lavfi", f"{vf} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
                    "-loop", "0", out], check=True)
else:
    from PIL import Image
    imgs = []
    for f in frames:
        im = Image.open(f).convert("RGB")
        im = im.resize((a.width, int(im.height * a.width / im.width)))
        imgs.append(im.quantize(colors=128, method=Image.Quantize.MEDIANCUT))
    imgs[0].save(out, save_all=True, append_images=imgs[1:], duration=int(1000 / a.fps), loop=0, optimize=True)

print(f"{out}  {len(frames)} 帧 · {os.path.getsize(out) / 1024:.0f} KB")
