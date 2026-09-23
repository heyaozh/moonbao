"""
月亮 look-dev：生成 / 读取月面贴图，用 Blender Cycles 渲染四个标准机位。

来源（--source）：
  procedural  不下载任何数据。月海与 40 余个命名环形山按真实月面经纬度 / 直径刻上去，
              深度与环壁高度用 Pike (1977) 直径经验公式；随机小坑、辐射纹、月壤噪声。
  nasa        NASA SVS CGI Moon Kit（assets/moon/nasa/raw/，公有领域）：LROC WAC 颜色图 +
              LOLA 高程图（ldem_4，4 像素/度，小于 ~50 km 的坑只在颜色里、不在高程里）。
柔和（--soft 0..1）：颜色与高程做高斯模糊、压缩对比与色差，坑洞之间的过渡更均匀。

输出到 --out：
  height_16bit.png  等距柱状高程，16-bit 灰度，0..65535 ↔ meta.json 的 hmin..hmax（km）
  albedo.png        等距柱状反照率，8-bit sRGB
  meta.json         hmin / hmax / 来源 / 参数（three.js 用 displacement 时按这个还原尺度）
  renders/          四张渲染：满月 / 盈凸月晨昏线 / Copernicus 特写 / 蛾眉月带地照
用法：
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/moon_lookdev.py -- \
      --source procedural --out assets/moon/procedural [--soft 0.7] [--res 4096] [--exag 3] [--samples 48]
经纬约定：列 = 经度 -180(西)→+180(东)，行 = 纬度 +90(北)→-90(南)；渲染时东经在画面右侧（地球北半球肉眼视角）。
这份脚本只服务 look-dev；app 的渲染层是 three.js（见 PLAN.md）。
"""
import sys, os, math, time, argparse, json, struct, zlib
import numpy as np

# ---------------------------------------------------------------- 参数
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--source", choices=["procedural", "nasa"], default="procedural")
ap.add_argument("--out", required=True)
ap.add_argument("--soft", type=float, default=0.0)    # 0 = 原样；1 = 最柔
ap.add_argument("--res", type=int, default=4096)      # 贴图宽度，高度为一半
ap.add_argument("--exag", type=float, default=3.0)    # 地形夸张倍数（真实 = 1.0，肉眼几乎看不出坑）
ap.add_argument("--samples", type=int, default=48)
ap.add_argument("--size", type=int, default=1200)     # 渲染分辨率
ap.add_argument("--seed", type=int, default=7)
ap.add_argument("--n_random", type=int, default=4000) # 程序化：随机小坑数量
ap.add_argument("--nasa_color", default="assets/moon/nasa/raw/lroc_color_poles_4k.tif")
ap.add_argument("--nasa_dem", default="assets/moon/nasa/raw/ldem_4.tif")
ap.add_argument("--maps_only", action="store_true")
ap.add_argument("--eyes", action="store_true")            # 加两颗豆眼
ap.add_argument("--eye_y", type=float, default=-0.10)        # 眼睛高度：相对半径，0 = 球心，负 = 偏下（婴儿图式）
ap.add_argument("--eye_gap", type=float, default=0.8)        # 两眼中心距，相对半径（0.8 = 0.4 个月亮宽；设定写 0.5，试渲时 0.5 已贴边）
ap.add_argument("--eye_w", type=float, default=0.15)         # 眼宽 / 眼高，相对半径
ap.add_argument("--eye_h", type=float, default=0.22)
ap.add_argument("--glow_levels", default="")                 # 逗号分隔，如 "0,0.3,0.6,1"：表面自发光 + bloom 光晕
ap.add_argument("--glow_mode", choices=["surface", "halo", "soft"], default="surface")  # surface = 表面自发光为主；halo = 外圈光晕为主，保住月相；soft = 暖白发光 + 大而柔的光晕（参考图那种）
ap.add_argument("--face", action="store_true")            # 参考图比例的脸：小圆点眼 + 微笑弧 + 腮红（覆盖 --eyes 的豆眼默认值）
ap.add_argument("--mouth_y", type=float, default=-0.20)      # 嘴中心高度（相对半径，相对眼睛高度往下）
ap.add_argument("--mouth_w", type=float, default=0.20)       # 嘴宽
ap.add_argument("--mouth_curve", type=float, default=0.045)  # 嘴角上翘量（参考图 ≈ 嘴宽的 1/5）
ap.add_argument("--blush_x", type=float, default=0.46)       # 腮红中心离中轴（相对半径）
ap.add_argument("--blush_y", type=float, default=-0.14)      # 腮红中心高度（相对眼睛高度）
ap.add_argument("--blush_r", type=float, default=0.085)      # 腮红半径
ap.add_argument("--bg", default="0,0,0")                     # 世界背景色（线性 RGB）
ap.add_argument("--shots", default="")                       # 逗号分隔机位名子串过滤，如 "full,crescent"
args = ap.parse_args(argv)
if args.face:
    args.eyes = True
    if args.eye_gap == 0.8: args.eye_gap = 0.54
    if args.eye_w == 0.15: args.eye_w = 0.12
    if args.eye_h == 0.22: args.eye_h = 0.14
    if args.eye_y == -0.10: args.eye_y = -0.02
os.makedirs(os.path.join(args.out, "renders"), exist_ok=True)
rng = np.random.default_rng(args.seed)

R = 1737.4  # km
W = args.res
H = W // 2
t0 = time.time()
def log(*a):
    print(f"[moon +{time.time()-t0:6.1f}s]", *a, flush=True)

# ---------------------------------------------------------------- 通用工具
def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def box_blur_axis(a, w, axis, wrap):
    """宽度 w（奇数）的盒滤波；wrap=True 时按经度环绕，否则边缘复制。"""
    if w <= 1:
        return a
    r = w // 2
    pad = [(0, 0)] * a.ndim; pad[axis] = (r, r)
    ap_ = np.pad(a, pad, mode="wrap" if wrap else "edge")
    c = np.cumsum(ap_, axis=axis, dtype=np.float64)
    c = np.concatenate([np.zeros_like(np.take(c, [0], axis=axis)), c], axis=axis)
    n = a.shape[axis]
    hi = np.take(c, np.arange(w, w + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / w).astype(np.float32)

def gaussian_blur(a, sigma):
    """三次盒滤波近似高斯；经度方向环绕。sigma 单位：像素。"""
    if sigma <= 0.3:
        return a
    w = int(math.sqrt(4 * sigma * sigma / 3 + 1)) | 1
    for _ in range(3):
        a = box_blur_axis(a, w, axis=1, wrap=True)
        a = box_blur_axis(a, w, axis=0, wrap=False)
    return a

def resample_bilinear(a, out_h, out_w):
    """等距柱状图双线性重采样（经度环绕）。a: (h, w) 或 (h, w, c)。"""
    h, w = a.shape[:2]
    ys = (np.arange(out_h) + 0.5) * h / out_h - 0.5
    xs = (np.arange(out_w) + 0.5) * w / out_w - 0.5
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 1); y1 = np.clip(y0 + 1, 0, h - 1); fy = (ys - y0).astype(np.float32)
    x0 = np.floor(xs).astype(int) % w; x1 = (x0 + 1) % w; fx = (xs - np.floor(xs)).astype(np.float32)
    if a.ndim == 2:
        fy = fy[:, None]; fx = fx[None, :]
    else:
        fy = fy[:, None, None]; fx = fx[None, :, None]
    top = a[y0][:, x0] * (1 - fx) + a[y0][:, x1] * fx
    bot = a[y1][:, x0] * (1 - fx) + a[y1][:, x1] * fx
    return (top * (1 - fy) + bot * fy).astype(np.float32)

def write_png(path, arr):
    """自写 PNG：arr 为 (H,W) uint16 灰度 或 (H,W,3) uint8。"""
    h, w = arr.shape[:2]
    if arr.ndim == 2:
        color_type, depth, data = 0, 16, arr.astype(">u2")
    else:
        color_type, depth, data = 2, 8, arr.astype("u1")
    raw = b"".join(b"\x00" + row.tobytes() for row in data)
    def chunk(tag, body):
        c = tag + body
        return struct.pack(">I", len(body)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, depth, color_type, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 6)))
        f.write(chunk(b"IEND", b""))

# ---------------------------------------------------------------- 程序化来源
def procedural_maps():
    lat = np.deg2rad(np.linspace(90, -90, H, dtype=np.float32))
    lon = np.deg2rad(np.linspace(-180, 180, W, endpoint=False, dtype=np.float32))
    cosLAT = np.cos(lat)[:, None]; sinLAT = np.sin(lat)[:, None]
    X3 = (cosLAT * np.cos(lon)[None, :]).astype(np.float32)
    Y3 = (cosLAT * np.sin(lon)[None, :]).astype(np.float32)
    Z3 = np.broadcast_to(sinLAT, (H, W)).astype(np.float32)
    height = np.zeros((H, W), np.float32)
    albedo = np.zeros((H, W), np.float32)

    def _hash3(ix, iy, iz, seed):
        h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1013904223) & 0xFFFFFFFF
        h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
        h = h ^ (h >> 16)
        return (h & 0xFFFF).astype(np.float32) / 65535.0

    def value_noise3(x, y, z, seed=0):
        ix = np.floor(x).astype(np.int64); iy = np.floor(y).astype(np.int64); iz = np.floor(z).astype(np.int64)
        fx = x - ix; fy = y - iy; fz = z - iz
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz)
        out = np.zeros_like(x, dtype=np.float32)
        for dz in (0, 1):
            wz = fz if dz else 1 - fz
            for dy in (0, 1):
                wy = fy if dy else 1 - fy
                for dx in (0, 1):
                    wx = fx if dx else 1 - fx
                    out += _hash3(ix + dx, iy + dy, iz + dz, seed) * (wx * wy * wz)
        return out

    def fbm(freq, octaves, seed=0, gain=0.5, lac=2.0):
        acc = np.zeros((H, W), np.float32); amp = 1.0; norm = 0.0; f = freq
        for o in range(octaves):
            acc += amp * (value_noise3(X3 * f + 31.7, Y3 * f + 17.3, Z3 * f + 5.1, seed + o) * 2 - 1)
            norm += amp; amp *= gain; f *= lac
        return acc / norm

    log("fbm 噪声…")
    n_low = fbm(3.0, 3, seed=1); n_mid = fbm(24.0, 4, seed=2); n_fine = fbm(140.0, 4, seed=3); n_ray = fbm(60.0, 3, seed=4)

    def window(lat0_deg, lon0_deg, reach):
        lat0 = math.radians(lat0_deg); lon0 = math.radians(lon0_deg)
        r0 = int(np.clip((math.pi / 2 - (lat0 + reach)) / math.pi * H, 0, H - 1))
        r1 = int(np.clip((math.pi / 2 - (lat0 - reach)) / math.pi * H + 1, 0, H))
        c = max(math.cos(lat0), 1e-3); dlon = min(reach / c, math.pi)
        if dlon >= math.pi * 0.999:
            cols = np.arange(W)
        else:
            c0 = int(np.floor((lon0 - dlon + math.pi) / (2 * math.pi) * W)); c1 = int(np.ceil((lon0 + dlon + math.pi) / (2 * math.pi) * W)) + 1
            cols = np.arange(c0, c1) % W
        rows = slice(r0, r1)
        la = lat[rows][:, None]; lo = lon[cols][None, :]
        a = np.sin((la - lat0) / 2) ** 2 + math.cos(lat0) * np.cos(la) * np.sin((lo - lon0) / 2) ** 2
        dist = 2 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))
        brg = np.arctan2(np.sin(lo - lon0) * np.cos(la), math.cos(lat0) * np.sin(la) - math.sin(lat0) * np.cos(la) * np.cos(lo - lon0))
        return rows, cols, dist.astype(np.float32), brg.astype(np.float32)

    # (名字, lat, lon, 半径 km, 下沉 km)
    MARIA = [
        ("Imbrium", 33.0, -16.0, 590, 2.2), ("Procellarum-N", 36.0, -58.0, 520, 1.0), ("Procellarum-C", 20.0, -57.0, 560, 1.0),
        ("Procellarum-S", 3.0, -55.0, 520, 1.0), ("Procellarum-E", 17.0, -38.0, 330, 0.9), ("Insularum", 7.5, -31.0, 260, 0.9),
        ("Cognitum", -10.0, -23.0, 200, 1.0), ("Nubium", -21.0, -16.0, 360, 1.2), ("Humorum", -24.4, -38.6, 210, 2.0),
        ("Iridum", 44.5, -31.5, 130, 1.5), ("Frigoris-W", 57.5, -28.0, 230, 0.8), ("Frigoris-C", 56.5, 0.0, 270, 0.8),
        ("Frigoris-E", 55.5, 26.0, 210, 0.8), ("Vaporum", 13.3, 3.6, 130, 1.2), ("Medii", 1.5, 1.5, 120, 0.8), ("Grimaldi", -5.2, -68.3, 90, 2.5),
        ("Serenitatis", 28.0, 17.5, 360, 1.8), ("Tranquillitatis", 8.5, 31.4, 450, 1.4), ("Tranq-Fecund", -1.0, 44.0, 250, 1.0),
        ("Fecunditatis", -7.8, 51.3, 430, 1.2), ("Nectaris", -15.2, 35.5, 180, 1.8), ("Crisium", 17.0, 59.1, 280, 2.5),
        ("Humboldtianum", 56.8, 81.5, 140, 2.0), ("Marginis", 13.3, 86.1, 180, 1.0), ("Smythii", -1.3, 87.5, 190, 1.5), ("Australe", -38.9, 93.0, 300, 0.8),
    ]
    mare_mask = np.zeros((H, W), np.float32)
    log("月海…")
    for name, la0, lo0, rad_km, sink in MARIA:
        ang = rad_km / R
        rows, cols, dist, brg = window(la0, lo0, ang * 1.7)
        f = 1.3 / ang
        xs, ys, zs = X3[rows, cols], Y3[rows, cols], Z3[rows, cols]
        loc = np.zeros_like(dist); amp = 1.0; norm = 0.0; ff = f
        for o in range(2):
            loc += amp * (value_noise3(xs * ff + 7.1, ys * ff + 3.3, zs * ff + 11.9, 40 + o) * 2 - 1); norm += amp; amp *= 0.5; ff *= 2.1
        loc /= norm
        edge_noise = 1.0 + 0.30 * loc + 0.05 * n_mid[rows, cols]
        x = dist / (ang * edge_noise)
        mare_mask[rows, cols] = np.maximum(mare_mask[rows, cols], 1 - smoothstep(0.88, 1.04, x))
        height[rows, cols] += -sink * (1 - smoothstep(0.3, 1.15, x))

    def crater_profile(D):
        if D < 15:
            return 0.196 * D ** 1.010, 0.036 * D ** 1.014, False
        return 1.044 * D ** 0.301, 0.236 * D ** 0.399, D > 22

    def stamp_crater(la0, lo0, D, age=1.0, floor_fill=0.0):
        depth, rim, peak = crater_profile(D)
        depth *= (1 - 0.55 * age); rim *= (1 - 0.5 * age)
        ang = (D / 2) / R
        rows, cols, dist, brg = window(la0, lo0, ang * 3.2)
        x = dist / ang / (1 + 0.06 * n_mid[rows, cols] * (0.5 + age))
        if peak:
            floor_r = 0.55 + 0.1 * (D > 80)
            inner = -depth * (1 - smoothstep(floor_r, 1.0, x))
            terrace = -0.08 * depth * np.sin(np.clip((x - floor_r) / (1 - floor_r), 0, 1) * math.pi * 3) * (x > floor_r) * (x < 1)
            inner = inner + terrace + depth * (0.25 + 0.15 * (1 - age)) * np.exp(-(x / 0.16) ** 2) * (1 - floor_fill)
        else:
            inner = -depth * np.clip(1 - x ** 2, 0, 1) ** 1.2
        inner = inner * (1 - floor_fill) + (-depth * 0.25) * floor_fill * (x < 1)
        rim_b = rim * np.exp(-((x - 1.0) / (0.10 + 0.10 * age)) ** 2)
        ej = rim * 0.35 * np.exp(-(x - 1.0) / 0.9) * (x > 1.0) * (1 + 0.6 * n_mid[rows, cols]) * (1 - 0.6 * age)
        w = 1 - smoothstep(1.0, 1.35, x)
        old = height[rows, cols]
        sel = (x > 1.2) & (x < 1.6)
        ref = old[sel].mean() if np.any(sel) else old.mean()
        height[rows, cols] = (ref + inner + rim_b) * w + old * (1 - w) + ej * (1 - w)
        if age < 0.5:
            albedo[rows, cols] += (0.35 * (1 - age)) * (np.exp(-((x - 1.0) / 0.25) ** 2) + 0.5 * (x < 1))

    # (名字, lat, lon, D km, age 0 新→1 老, 坑底熔岩填平 0..1)
    NAMED = [
        ("Tycho", -43.3, -11.4, 85, 0.05, 0.0), ("Copernicus", 9.6, -20.1, 93, 0.15, 0.0), ("Kepler", 8.1, -38.0, 32, 0.15, 0.0),
        ("Aristarchus", 23.7, -47.4, 40, 0.05, 0.0), ("Plato", 51.6, -9.4, 101, 0.6, 0.95), ("Clavius", -58.6, -14.6, 225, 0.7, 0.2),
        ("Grimaldi-c", -5.2, -68.3, 173, 0.8, 0.9), ("Langrenus", -8.9, 61.0, 132, 0.4, 0.0), ("Theophilus", -11.4, 26.4, 100, 0.3, 0.0),
        ("Cyrillus", -13.2, 24.0, 98, 0.7, 0.2), ("Catharina", -18.0, 23.6, 100, 0.8, 0.3), ("Petavius", -25.1, 60.4, 177, 0.5, 0.1),
        ("Ptolemaeus", -9.3, -1.9, 153, 0.75, 0.8), ("Alphonsus", -13.4, -2.8, 119, 0.65, 0.6), ("Arzachel", -18.2, -1.9, 97, 0.4, 0.1),
        ("Eratosthenes", 14.5, -11.3, 59, 0.3, 0.0), ("Archimedes", 29.7, -4.0, 83, 0.6, 0.95), ("Aristillus", 33.9, 1.2, 55, 0.3, 0.0),
        ("Autolycus", 30.7, 1.5, 39, 0.3, 0.0), ("Aristoteles", 50.2, 17.4, 87, 0.4, 0.1), ("Eudoxus", 44.3, 16.3, 67, 0.4, 0.0),
        ("Posidonius", 31.8, 29.9, 95, 0.7, 0.8), ("Cleomedes", 27.7, 55.5, 126, 0.6, 0.5), ("Endymion", 53.6, 56.5, 125, 0.6, 0.9),
        ("Schickard", -44.4, -54.6, 227, 0.8, 0.8), ("Bailly", -66.8, -69.1, 303, 0.85, 0.3), ("Gassendi", -17.6, -40.0, 110, 0.6, 0.6),
        ("Bullialdus", -20.7, -22.2, 61, 0.25, 0.0), ("Longomontanus", -49.6, -21.8, 145, 0.75, 0.3), ("Maginus", -50.5, -6.3, 163, 0.8, 0.3),
        ("Stofler", -41.1, 6.0, 126, 0.75, 0.4), ("Fracastorius", -21.5, 33.2, 124, 0.8, 0.9), ("Piccolomini", -29.7, 32.2, 88, 0.4, 0.0),
        ("Hipparchus", -5.1, 4.8, 150, 0.85, 0.7), ("Albategnius", -11.2, 4.1, 131, 0.7, 0.4), ("Manilius", 14.5, 9.1, 38, 0.2, 0.0),
        ("Menelaus", 16.3, 15.9, 27, 0.2, 0.0), ("Proclus", 16.1, 46.8, 28, 0.05, 0.0), ("Taruntius", 5.6, 46.5, 56, 0.4, 0.3),
        ("Burg", 45.0, 28.2, 40, 0.3, 0.0), ("Cassini", 40.2, 4.6, 57, 0.6, 0.8), ("Herschel", -5.7, -2.1, 41, 0.3, 0.0),
        ("Timocharis", 26.7, -13.1, 34, 0.3, 0.0), ("Lambert", 25.8, -21.0, 30, 0.4, 0.0), ("Pythagoras", 63.5, -63.0, 130, 0.4, 0.0),
        ("Moretus", -70.6, -5.8, 114, 0.4, 0.0), ("Vlacq", -53.3, 38.8, 89, 0.7, 0.2), ("Janssen", -44.9, 40.8, 190, 0.9, 0.3),
        ("Humboldt", -27.2, 80.9, 207, 0.6, 0.3), ("Tsiolkovskiy", -20.4, 129.1, 185, 0.4, 0.9), ("Hertzsprung", 2.0, -129.2, 570, 0.9, 0.1),
        ("Korolev", -4.0, -157.4, 437, 0.9, 0.1), ("Apollo", -36.1, -151.8, 537, 0.9, 0.2), ("Mendeleev", 5.7, 140.9, 313, 0.85, 0.2),
        ("Orientale", -19.4, -92.8, 930, 0.95, 0.3),
    ]
    log("随机小坑…")
    n_rand = args.n_random
    D_rand = np.clip(4.0 * (1 - rng.random(n_rand)) ** (-1 / 1.7), 4, 90)
    ages = rng.random(n_rand) ** 0.5
    for i in np.argsort(-ages):
        for _ in range(6):
            la0 = math.degrees(math.asin(rng.uniform(-1, 1))); lo0 = rng.uniform(-180, 180)
            row = int((90 - la0) / 180 * (H - 1)); col = int((lo0 + 180) / 360 * (W - 1))
            if rng.random() < (1 - 0.8 * mare_mask[row, col]):
                break
        stamp_crater(la0, lo0, float(D_rand[i]), age=float(ages[i]))
    log("命名环形山…")
    for name, la0, lo0, D, age, fill in sorted(NAMED, key=lambda c: -c[4]):
        stamp_crater(la0, lo0, D, age=age, floor_fill=fill)

    log("地形噪声 + 反照率…")
    highland = 1 - mare_mask
    height += (0.9 * n_mid + 0.25 * n_fine) * (0.25 + 0.75 * highland) + 1.2 * n_low
    height = gaussian_blur(height, 0.7)
    base = 0.60 * highland + 0.37 * mare_mask
    base += (0.06 * highland + 0.035 * mare_mask) * n_mid + 0.03 * n_fine + 0.03 * n_low * mare_mask
    RAYS = [(-43.3, -11.4, 1700, 14, 1.0), (9.6, -20.1, 800, 12, 0.7), (8.1, -38.0, 300, 9, 0.5), (23.7, -47.4, 200, 8, 0.5), (16.1, 46.8, 300, 6, 0.6)]
    for la0, lo0, reach_km, nrays, strength in RAYS:
        ang = reach_km / R
        rows, cols, dist, brg = window(la0, lo0, ang)
        x = dist / ang
        dirs = rng.uniform(-math.pi, math.pi, nrays); widths = rng.uniform(0.03, 0.09, nrays); amps = rng.uniform(0.5, 1.0, nrays)
        ray = np.zeros_like(x)
        for d, wdt, a in zip(dirs, widths, amps):
            ray += a * np.exp(-(np.angle(np.exp(1j * (brg - d))) / wdt) ** 2)
        ray *= np.exp(-x * 2.2) * (x > 0.03) * (0.6 + 0.6 * n_ray[rows, cols])
        base[rows, cols] += strength * 0.45 * np.clip(ray, 0, 1.5)
    albedo = np.clip(base + albedo, 0, 1)
    height -= height.mean()
    tint = np.array([1.0, 0.97, 0.92], np.float32)
    return height, albedo[..., None] * tint

# ---------------------------------------------------------------- NASA 来源
def nasa_maps():
    import bpy
    def load(path, non_color):
        im = bpy.data.images.load(os.path.abspath(path), check_existing=False)
        if non_color:
            im.colorspace_settings.name = "Non-Color"; im.reload()   # 不重载会被当 sRGB 解码
        w, h = im.size
        px = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(px)
        px = px.reshape(h, w, 4)[::-1]           # Blender 像素原点在左下 → 翻成北在上
        bpy.data.images.remove(im)
        return px
    log("读 NASA 高程…")
    dem = load(args.nasa_dem, True)[..., 0]     # km
    log(f"  {dem.shape[1]}×{dem.shape[0]}，范围 {dem.min():.2f} .. {dem.max():.2f} km")
    if dem.shape != (H, W):
        dem = resample_bilinear(dem, H, W)
    log("读 NASA 颜色…")
    col = load(args.nasa_color, False)[..., :3]  # sRGB 编码 0..1
    if col.shape[:2] != (H, W):
        col = resample_bilinear(col, H, W)
    return dem.astype(np.float32), col.astype(np.float32)

# ---------------------------------------------------------------- 柔和处理
def soften(height, albedo_rgb, amount):
    """amount 0..1：模糊高程与颜色，压缩色差。像素尺度按 4096 宽换算。"""
    if amount <= 0:
        return height, albedo_rgb
    s = W / 4096
    log(f"柔和 {amount:.2f}…")
    height = gaussian_blur(height, 5.0 * amount * s)
    a = albedo_rgb.copy()
    for c in range(3):
        a[..., c] = gaussian_blur(a[..., c], 9.0 * amount * s)
    lum = a.mean(axis=2, keepdims=True)
    a = lum + (a - lum) * (1 - 0.6 * amount)            # 去一点色彩差异
    m = a.mean()
    a = m + (a - m) * (1 - 0.5 * amount)                 # 压对比：月海与高地差距缩小
    return height, np.clip(a, 0, 1)

# ---------------------------------------------------------------- 主流程
if args.source == "procedural":
    height, albedo_rgb = procedural_maps()
else:
    height, albedo_rgb = nasa_maps()
height, albedo_rgb = soften(height, albedo_rgb, args.soft)
hmin, hmax = float(height.min()), float(height.max())
log(f"高程范围 {hmin:.2f} .. {hmax:.2f} km")

h16 = np.round((height - hmin) / (hmax - hmin) * 65535).astype(np.uint16)
write_png(os.path.join(args.out, "height_16bit.png"), h16)
write_png(os.path.join(args.out, "albedo.png"), np.round(albedo_rgb * 255).astype(np.uint8))
meta = {"source": args.source, "soft": args.soft, "width": W, "height": H, "hmin_km": hmin, "hmax_km": hmax,
        "radius_km": R, "lon_range": [-180, 180], "lat_range": [90, -90], "seed": args.seed,
        "note": "height_16bit.png 的 0..65535 线性对应 hmin_km..hmax_km；three.js displacementScale = (hmax-hmin)/radius * 夸张倍数，displacementBias 按 hmin 换算。"}
json.dump(meta, open(os.path.join(args.out, "meta.json"), "w"), ensure_ascii=False, indent=2)
log("贴图已写出")
if args.maps_only:
    sys.exit(0)

import bpy
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
img_h = bpy.data.images.load(os.path.abspath(os.path.join(args.out, "height_16bit.png"))); img_h.colorspace_settings.name = "Non-Color"
img_a = bpy.data.images.load(os.path.abspath(os.path.join(args.out, "albedo.png")))

log("建球…")
# 直接造 1024 段的 UV 球要 110 秒；128 段 + Catmull-Clark 细分 3 级到同样密度只要几秒
bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, radius=1.0)
moon = bpy.context.active_object; moon.name = "Moon"; me = moon.data
me.shade_smooth()
sub = moon.modifiers.new("Subdiv", "SUBSURF"); sub.levels = 3; sub.render_levels = 3
# UV 校准：u=0.5 处（lon 0）转到 -Y 朝相机；u=0.75（东经 90）应落在 +X（画面右）
n_loops = len(me.loops)
uv = np.empty(n_loops * 2, np.float32); me.uv_layers.active.data.foreach_get("uv", uv); uv = uv.reshape(-1, 2)
lv = np.empty(n_loops, np.int64); me.loops.foreach_get("vertex_index", lv)
co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
p0 = co[lv[np.argmin(np.abs(uv[:, 0] - 0.5) + np.abs(uv[:, 1] - 0.5))]]
pE = co[lv[np.argmin(np.abs(uv[:, 0] - 0.75) + np.abs(uv[:, 1] - 0.5))]]
angZ = math.atan2(-1, 0) - math.atan2(p0[1], p0[0])
moon.rotation_euler = (0, 0, angZ)
pE_x = math.cos(angZ) * pE[0] - math.sin(angZ) * pE[1]
if pE_x < 0:
    log("警告：UV 经度方向反了，画面会左右镜像；需要在贴图写出前翻转")
log(f"UV 校准：东侧 x={pE_x:.2f}")

mat = bpy.data.materials.new("MoonMat"); mat.use_nodes = True
nodes = mat.node_tree.nodes; links = mat.node_tree.links
bsdf = nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.95
bsdf.inputs["Specular IOR Level"].default_value = 0.15
texA = nodes.new("ShaderNodeTexImage"); texA.image = img_a
texH = nodes.new("ShaderNodeTexImage"); texH.image = img_h
bump = nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = (0.5 if args.source == "procedural" else 0.3) * (1 - 0.6 * args.soft)
bump.inputs["Distance"].default_value = 0.02
links.new(texA.outputs["Color"], bsdf.inputs["Base Color"])
# 发光：自发光颜色 = 反照率往暖白拉，强度由 glow 档位驱动（渲染循环里设）
glow_mix = nodes.new("ShaderNodeMix"); glow_mix.data_type = "RGBA"; glow_mix.blend_type = "MIX"
glow_mix.inputs["Factor"].default_value = 0.0
glow_mix.inputs[7].default_value = (1.0, 0.93, 0.80, 1.0)   # B 端：暖白
links.new(texA.outputs["Color"], glow_mix.inputs[6])          # A 端：反照率
links.new(glow_mix.outputs[2], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 0.0
links.new(texH.outputs["Color"], bump.inputs["Height"])
links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
me.materials.append(mat)

tex = bpy.data.textures.new("MoonHeightTex", "IMAGE"); tex.image = img_h
mod = moon.modifiers.new("Displace", "DISPLACE")
mod.texture = tex; mod.texture_coords = "UV"; mod.direction = "NORMAL"
mod.mid_level = (0 - hmin) / (hmax - hmin)
mod.strength = (hmax - hmin) / R * args.exag

if args.eyes:
    eye_mat = bpy.data.materials.new("EyeMat"); eye_mat.use_nodes = True
    eb = eye_mat.node_tree.nodes["Principled BSDF"]
    eb.inputs["Base Color"].default_value = (0.01, 0.01, 0.012, 1); eb.inputs["Roughness"].default_value = 0.55 if args.face else 0.22
    eb.inputs["Specular IOR Level"].default_value = 0.6
    r_surf = 1.0 + (hmax / R) * args.exag + 0.01     # 眼睛底座在最高地形之上
    for sx in (-1, 1):
        ex = sx * args.eye_gap / 2; ey = args.eye_y
        n = Vector((ex, -math.sqrt(max(1 - ex * ex - ey * ey, 0.05)), ey)).normalized()
        bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1.0)
        eye = bpy.context.active_object; eye.name = f"Eye{'L' if sx < 0 else 'R'}"
        eye.data.shade_smooth(); eye.data.materials.append(eye_mat)
        eye.scale = (args.eye_w / 2, 0.035, args.eye_h / 2)     # 本地 Y 是深度，压扁成豆
        eye.rotation_euler = n.to_track_quat("Y", "Z").to_euler()
        eye.location = n * (r_surf + 0.012)
    log("豆眼已加")

def on_sphere(x, y, r):
    """把「正面平面坐标 (x 右, y 上)」贴到半径 r 的球面上，朝 -Y（相机）。"""
    n = Vector((x, -math.sqrt(max(1 - x * x - y * y, 0.05)), y)).normalized()
    return n * r, n

if args.face:
    r_surf = 1.0 + (hmax / R) * args.exag + 0.012
    # 嘴：球面上的一条微笑弧线（poly 曲线 + bevel 成细管）
    cu = bpy.data.curves.new("Mouth", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.009; cu.bevel_resolution = 4
    cu.use_fill_caps = True
    sp = cu.splines.new("NURBS"); n_pts = 13; sp.points.add(n_pts - 1)
    my = args.eye_y + args.mouth_y
    for i in range(n_pts):
        t = i / (n_pts - 1) - 0.5
        x = t * args.mouth_w
        y = my + args.mouth_curve * (4 * t * t)          # 两端上翘
        pos, _ = on_sphere(x, y, r_surf)
        sp.points[i].co = (pos.x, pos.y, pos.z, 1.0)
    sp.use_endpoint_u = True; sp.order_u = 4
    mouth = bpy.data.objects.new("Mouth", cu); scene.collection.objects.link(mouth)
    mouth.data.materials.append(eye_mat)
    # 腮红：贴在球面上的扁圆盘，径向羽化透明
    blush_mat = bpy.data.materials.new("BlushMat"); blush_mat.use_nodes = True
    bn = blush_mat.node_tree.nodes; bl = blush_mat.node_tree.links
    bb = bn["Principled BSDF"]
    bb.inputs["Base Color"].default_value = (1.0, 0.45, 0.55, 1); bb.inputs["Roughness"].default_value = 1.0
    bb.inputs["Emission Color"].default_value = (1.0, 0.45, 0.55, 1); bb.inputs["Emission Strength"].default_value = 0.25
    tc = bn.new("ShaderNodeTexCoord"); grad = bn.new("ShaderNodeTexGradient"); grad.gradient_type = "SPHERICAL"
    ramp = bn.new("ShaderNodeValToRGB"); ramp.color_ramp.elements[0].position = 0.15; ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1); ramp.color_ramp.elements[1].color = (0.55, 0.55, 0.55, 1)   # 中心最多 55% 不透明
    bl.new(tc.outputs["Object"], grad.inputs["Vector"]); bl.new(grad.outputs["Fac"], ramp.inputs["Fac"]); bl.new(ramp.outputs["Color"], bb.inputs["Alpha"])
    for sx in (-1, 1):
        pos, n = on_sphere(sx * args.blush_x, args.eye_y + args.blush_y, r_surf + 0.004)
        bpy.ops.mesh.primitive_circle_add(vertices=48, radius=1.0, fill_type="NGON")
        b = bpy.context.active_object; b.name = f"Blush{'L' if sx < 0 else 'R'}"
        b.data.materials.append(blush_mat)
        b.scale = (args.blush_r, args.blush_r, 1.0)
        b.rotation_euler = n.to_track_quat("Z", "Y").to_euler()     # 圆盘法线（本地 Z）对准球面法线
        b.location = pos
    log("嘴 + 腮红已加")

world = bpy.data.worlds.new("W"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = tuple(float(v) for v in args.bg.split(",")) + (1,)
sun_data = bpy.data.lights.new("Sun", "SUN"); sun_data.energy = 4.5; sun_data.angle = math.radians(0.53)
sun = bpy.data.objects.new("Sun", sun_data); scene.collection.objects.link(sun)
fill_data = bpy.data.lights.new("Earthshine", "SUN"); fill_data.energy = 0.035; fill_data.angle = math.radians(20)
fill = bpy.data.objects.new("Earthshine", fill_data); scene.collection.objects.link(fill)
cam_data = bpy.data.cameras.new("Cam"); cam_data.lens = 50
cam = bpy.data.objects.new("Cam", cam_data); scene.collection.objects.link(cam); scene.camera = cam

def aim(obj, pos, target):
    obj.location = Vector(pos)
    obj.rotation_euler = (Vector(target) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()

scene.render.engine = "CYCLES"; scene.cycles.samples = args.samples; scene.cycles.use_denoising = True
scene.render.resolution_x = scene.render.resolution_y = args.size
scene.render.image_settings.file_format = "PNG"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"; prefs.get_devices()
    for d in prefs.devices: d.use = True
    scene.cycles.device = "GPU"; log("Cycles: METAL GPU")
except Exception as e:
    log("Cycles: CPU", e)

glare = None
def setup_bloom():
    global glare
    try:
        ng = bpy.data.node_groups.new("Comp", "CompositorNodeTree")
        scene.compositing_node_group = ng
        rl = ng.nodes.new("CompositorNodeRLayers"); rl.scene = scene
        glare = ng.nodes.new("CompositorNodeGlare"); glare.inputs["Type"].default_value = "Bloom"   # 5.x：类型是 socket
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        out = ng.nodes.new("NodeGroupOutput")
        ng.links.new(rl.outputs["Image"], glare.inputs["Image"]); ng.links.new(glare.outputs["Image"], out.inputs[0])
        log("合成器：compositing_node_group (5.x)")
    except Exception as e:
        log("5.x 合成器接口失败，退回旧接口：", e)
        scene.use_nodes = True; nt = scene.node_tree
        for nd in list(nt.nodes): nt.nodes.remove(nd)
        rl = nt.nodes.new("CompositorNodeRLayers"); glare = nt.nodes.new("CompositorNodeGlare"); glare.glare_type = "BLOOM"
        comp = nt.nodes.new("CompositorNodeComposite")
        nt.links.new(rl.outputs["Image"], glare.inputs["Image"]); nt.links.new(glare.outputs["Image"], comp.inputs["Image"])
    scene.render.use_compositing = True

def set_glow(g):
    """g 0..1：自发光强度 + 暖白混合 + bloom 强度。"""
    halo = args.glow_mode == "halo"; soft = args.glow_mode == "soft"
    bsdf.inputs["Emission Strength"].default_value = (0.12 if halo else 0.7 if soft else 0.45) * g
    glow_mix.inputs["Factor"].default_value = (0.55 if soft else 0.4) * g
    if glare is not None:
        def setin(name, val):
            try:
                glare.inputs[name].default_value = val; return True
            except Exception:
                return False
        setin("Threshold", 0.45 if halo else 0.5 if soft else 0.7); setin("Size", 0.85 if halo else 0.92 if soft else 0.6)   # 5.x 的 Size 是 0..1
        setin("Smoothness", 0.5 if soft else 0.1)
        if not setin("Strength", (1.4 if halo else 1.0 if soft else 0.6) * g):
            try: glare.mix = -1 + 2 * min(g, 0.99)
            except Exception: pass
        try: glare.mute = (g <= 0)
        except Exception: pass

def lonlat_to_world(la, lo, r=1.0):
    la = math.radians(la); lo = math.radians(lo)
    return (r * math.cos(la) * math.sin(lo), -r * math.cos(la) * math.cos(lo), r * math.sin(la))

tgt = lonlat_to_world(2.0, -16.0)
shots = [
    ("01_full", (0, -4.2, 0), (0, 0, 0), (0.12, -1.0, 0.10)),
    ("02_gibbous_terminator", (0, -4.2, 0), (0, 0, 0), (0.85, -0.55, 0.15)),
    ("03_closeup_copernicus", (tgt[0] + 0.15, tgt[1] - 1.55, tgt[2] + 0.25), tgt, (0.85, -0.55, 0.15)),
    ("04_crescent", (0, -4.2, 0), (0, 0, 0), (-1.0, 0.45, 0.1)),
]
if args.shots:
    keys = [k.strip() for k in args.shots.split(",") if k.strip()]
    shots = [sh for sh in shots if any(k in sh[0] for k in keys)]
glow_levels = [float(x) for x in args.glow_levels.split(",")] if args.glow_levels else [None]
if glow_levels != [None]:
    setup_bloom()
for name, cpos, ctgt, sdir in shots:
    aim(cam, cpos, ctgt)
    aim(sun, tuple(6 * s for s in sdir), (0, 0, 0))
    aim(fill, (0.3, -6, 0.5), (0, 0, 0))
    for g in glow_levels:
        fname = f"{name}.png" if g is None else f"{name}_glow{g:.2f}.png"
        if g is not None:
            set_glow(g)
        scene.render.filepath = os.path.join(args.out, "renders", fname)
        log(f"渲染 {fname} …")
        bpy.ops.render.render(write_still=True)
log("完成")
