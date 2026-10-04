#!/usr/bin/env python3
"""把一批彩蛋片拼成集锦（PLAN V9 验收夹具）：每段左上角写「编号 · 名字」和触发方式，段尾补 0.35 秒黑场。

用法：python3 scripts/reel.py --out snaps/v9/reel-A.mp4 secret "秘密彩蛋|输入暗号" zzz "睡觉冒 zzz|它打瞌睡时" ...
片子在 snaps/v9/<name>.mp4（scripts/record-eggs.ts 出的）。
字幕用 PIL 画成透明 PNG 再 overlay（brew 的 ffmpeg 没带 drawtext）；没有 PIL 就不写字、只拼接。
"""
import argparse
import os
import subprocess
import sys
import tempfile

FONTS = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
]

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--width", type=int, default=540, help="片子的宽（字幕图按它画）")
ap.add_argument("items", nargs="+", help="name 'label|how' 成对")
a = ap.parse_args()
if len(a.items) % 2:
    sys.exit("items 要成对：name 'label|how'")
items = list(zip(a.items[0::2], a.items[1::2]))

try:
    from PIL import Image, ImageDraw, ImageFont
    font_path = next((f for f in FONTS if os.path.exists(f)), None)
    FONT = ImageFont.truetype(font_path, 22) if font_path else ImageFont.load_default()
    SMALL = ImageFont.truetype(font_path, 16) if font_path else ImageFont.load_default()
except Exception as e:  # noqa: BLE001
    Image = None
    print(f"（没有 PIL 或字体：{e}；集锦不带字幕）", file=sys.stderr)


def caption_png(path, title, sub, width):
    img = Image.new("RGBA", (width, 92), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 半透明暗底，压在亮星空上也读得清
    d.rounded_rectangle((10, 10, width - 10, 82 if sub else 54), radius=12, fill=(0, 0, 0, 110))
    d.text((22, 17), title, font=FONT, fill=(255, 255, 255, 240))
    if sub:
        d.text((22, 50), sub, font=SMALL, fill=(220, 226, 245, 220))
    img.save(path)


tmp = tempfile.mkdtemp()
inputs, filters, concat_in = [], [], ""
n_in = 0
for i, (name, text) in enumerate(items):
    f = os.path.join("snaps", "v9", f"{name}.mp4")
    if not os.path.exists(f):
        sys.exit(f"没有片子：{f}")
    label, _, how = text.partition("|")
    vin = n_in
    inputs += ["-i", f]
    n_in += 1
    chain = f"[{vin}:v]"
    if Image is not None:
        png = os.path.join(tmp, f"{i}.png")
        caption_png(png, f"{i + 1:02d} · {label}", how[:34] + ("…" if len(how) > 34 else ""), a.width)
        inputs += ["-i", png]
        chain = f"[{vin}:v][{n_in}:v]overlay=0:0:format=auto"
        n_in += 1
    filters.append(f"{chain},tpad=stop_mode=add:stop_duration=0.35:color=black[v{i}]")
    concat_in += f"[v{i}]"
fc = ";".join(filters) + f";{concat_in}concat=n={len(items)}:v=1:a=0[out]"
os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
cmd = ["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", fc, "-map", "[out]",
       "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", a.out]
subprocess.run(cmd, check=True)
print(f"{a.out}  {os.path.getsize(a.out) / 1024:.0f} KB · {len(items)} 段")
