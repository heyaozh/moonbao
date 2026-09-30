#!/usr/bin/env python3
"""形象对比表：把 snaps/look/ 里各个形象的截图裁出月亮、排成一张带标题的对比图。

用法：
  python3 scripts/look-sheet.py <spec.json> <out.jpg>
spec.json：{"title": "...", "cols": 3, "cells": [{"img": "snaps/look/lk-face-baby.jpg", "sx": 425, "sy": 690, "r": 214,
             "label": "婴儿比例", "key": "?look=baby", "note": "..."}]}
（sx / sy / r = 月亮在截图里的中心和半径，由页面里算好传进来。）
"""
import json
import sys
import textwrap

from PIL import Image, ImageDraw, ImageFont

FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"


def font(size):
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:
        return ImageFont.load_default()


spec = json.load(open(sys.argv[1]))
out = sys.argv[2]
cols = spec.get("cols", 3)
cells = spec["cells"]
CELL = 460  # 月亮裁图的边长
PAD = 22
TEXT_H = 150
rows = (len(cells) + cols - 1) // cols
TITLE_H = 90 if spec.get("title") else 0
W = cols * CELL + (cols + 1) * PAD
H = TITLE_H + rows * (CELL + TEXT_H) + (rows + 1) * PAD
sheet = Image.new("RGB", (W, H), (8, 10, 22))
d = ImageDraw.Draw(sheet)
if TITLE_H:
    d.text((PAD, 26), spec["title"], fill=(236, 240, 255), font=font(40))

f_label, f_key, f_note = font(30), font(20), font(19)
for i, c in enumerate(cells):
    r, col = divmod(i, cols)
    x = PAD + col * (CELL + PAD)
    y = TITLE_H + PAD + r * (CELL + TEXT_H + PAD)
    im = Image.open(c["img"]).convert("RGB")
    half = c["r"] * 1.32
    box = (int(c["sx"] - half), int(c["sy"] - half), int(c["sx"] + half), int(c["sy"] + half))
    crop = im.crop(box).resize((CELL, CELL), Image.LANCZOS)
    sheet.paste(crop, (x, y))
    ty = y + CELL + 12
    d.text((x, ty), c["label"], fill=(255, 226, 170), font=f_label)
    lw = d.textlength(c["label"], font=f_label)
    d.text((x + lw + 12, ty + 9), c.get("key", ""), fill=(150, 165, 210), font=f_key)
    note = c.get("note", "")
    lines = textwrap.wrap(note, width=22)[:4]
    for j, ln in enumerate(lines):
        d.text((x, ty + 44 + j * 25), ln, fill=(205, 212, 235), font=f_note)
sheet.save(out, quality=90)
print(out, sheet.size)
