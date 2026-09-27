# Blender 无头脚本：把 EXR 读成 float32 numpy（H×W×3，行序从上到下），给 make_sky_textures.py 用。
# 用法：Blender -b --factory-startup -P tools/sky/exr_to_npy.py -- <in.exr> <out.npy>
import sys
import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
img = bpy.data.images.load(src)
w, h = img.size
buf = np.empty(w * h * 4, dtype=np.float32)
img.pixels.foreach_get(buf)
arr = buf.reshape(h, w, 4)[::-1, :, :3]  # Blender 行序从下到上 → 翻成从上到下
np.save(dst, np.ascontiguousarray(arr))
print(f"exr_to_npy: {w}x{h} min={arr.min():.4g} max={arr.max():.4g} mean={arr.mean():.4g} → {dst}")
