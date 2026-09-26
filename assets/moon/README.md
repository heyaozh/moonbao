# assets/moon · 月面素材库

look-dev 产物，2026-09-23 起。**不一定用**，留着以后也许有用。生成脚本：`tools/blender/moon_lookdev.py`。

| 目录 | 来源 | 风格 | 生成命令（在仓库根目录） |
|---|---|---|---|
| `procedural/` | 程序化：真实月海 / 55 个命名环形山（Pike 1977 深度公式）+ 4000 随机坑 + 辐射纹 | 原样 | `Blender -b -P tools/blender/moon_lookdev.py -- --source procedural --out assets/moon/procedural --exag 3` |
| `procedural_soft/` | 同上 | 柔和：高程与颜色高斯模糊、对比压半、色差减 60% | `… --source procedural --out assets/moon/procedural_soft --exag 3 --soft 0.7` |
| `nasa/` | NASA LRO：LROC WAC 颜色 + LOLA 高程（`nasa/raw/`，见 `SOURCE.md`） | 原样 | `… --source nasa --out assets/moon/nasa --exag 2` |
| `nasa_soft/` | 同上 | 柔和 0.7 | `… --source nasa --out assets/moon/nasa_soft --exag 2 --soft 0.7` |
| `nasa_eyes_glow/` | NASA + 两颗豆眼 | 表面自发光 4 档（0 / 0.33 / 0.66 / 1），满月 + 蛾眉月 | `… --source nasa --out assets/moon/nasa_eyes_glow --exag 2 --eyes --glow_levels 0,0.33,0.66,1 --shots full,crescent` |
| `nasa_face_softglow/` | NASA 柔和 0.5 + 参考图比例的脸（圆点眼 + 微笑 + 腮红） | 暖白发光 + 大而柔的光晕 3 档（0.6 / 1 / 1.4），深蓝背景 | `… --source nasa --soft 0.5 --out assets/moon/nasa_face_softglow --exag 2 --face --glow_mode soft --glow_levels 0.6,1,1.4 --shots full,crescent --bg 0.02,0.02,0.05` |
| `nasa_eyes_glow_halo/` | NASA + 豆眼 | 光晕为主 2 档（0.5 / 1），表面几乎不自发光，月相保得住 | `… --source nasa --out assets/moon/nasa_eyes_glow_halo --exag 2 --eyes --glow_mode halo --glow_levels 0.5,1 --shots full,crescent` |

`Blender` = `/Applications/Blender.app/Contents/MacOS/Blender`（5.1）。每个版本约 1 分钟（M1 Pro，Metal）。

每个目录里：
- `height_16bit.png` 4096×2048 等距柱状高程，16-bit 灰度；`0..65535` 线性对应 `meta.json` 的 `hmin_km..hmax_km`。
- `albedo.png` 4096×2048 反照率，8-bit sRGB。
- `meta.json` 尺度与参数。three.js：`displacementScale = (hmax-hmin)/1737.4 × 夸张倍数`，`displacementBias = hmin/1737.4 × 夸张倍数`（贴图 0 对应 hmin）。
- `renders/` 四张 Cycles 渲染：满月 / 盈凸月晨昏线 / Copernicus 特写 / 蛾眉月带地照。带 `_glowX.XX` 后缀的是发光档位。
- 脸参数（`--face`，按用户参考图量的比例）：眼距 0.54 R、眼 0.12×0.14 R 哑光、眼高球心下 0.02 R；嘴宽 0.20 R、眼下 0.20 R、翘 0.045 R；腮红半径 0.085 R、离中轴 0.46 R、眼下 0.14 R。
- 豆眼参数（`--eye_y` 高度、`--eye_gap` 间距、`--eye_w/--eye_h` 大小）默认：高度球心下 0.10 R、间距 0.8 R（0.4 个月亮宽）、0.15 × 0.22 R。设定写的间距 0.5 个月亮宽试渲时已贴到边缘，所以默认收到 0.4。

**保留的全尺寸 3D 素材（用户偏好，2026-09-26）**：只保留 `nasa_face_softglow/` 那一套——NASA 柔和 0.5 月面 + 参考图比例的脸 + 发光 1.0，也就是用户选定的样板。`albedo.png`（5 MB）与 `height_16bit.png`（15 MB）放在主检出 `~/Development/moonbao/assets/moon/nasa_face_softglow/`，被 `.gitignore` 排除、不在 GitHub 上。NASA 原始数据 `nasa/raw/*.tif`（16 MB）也保留在主检出，它是重生成任何 NASA 版本的源头。其它版本只留渲染图与 meta，需要时用上表命令一分钟重生成。
注意：网页里实际加载的是 `web/public/moon/` 的 2k 副本，取自 `nasa_soft`（柔和 0.7），和偏好样板的 0.5 略有不同；要对齐就从 `nasa_face_softglow/albedo.png` 重新缩一份。

**参考图**：`reference/face_reference.jpg`，用户 2026-09-23 给的插画，脸的比例（眼距、嘴、腮红）按它量得，见 docs/design.md §2。

**Git**：入库的渲染图是 JPEG（q88，原 PNG 37 MB → 约 5 MB）；两张大贴图（每版约 20 MB）和 NASA 原始 tif 不入库（`.gitignore`），用上表命令重生成；渲染图、meta、本文件入库。
经纬约定：列 = 经度 -180(西)→+180(东)，行 = 纬度 +90(北)→-90(南)；东经在画面右侧（北半球肉眼视角）。

已知短板：
- 程序化版月海是「圆盘 + 噪声边缘」拼的，细看有拼图感；环形山只有位置与直径真实。
- NASA 版高程是 4 像素/度（`ldem_4`），50 km 以下的坑只在颜色里没有起伏；要更细拉 `ldem_16.tif`（66 MB）换 `--nasa_dem`。
- 与设定的张力见 PLAN.md 未决问题 11（真实月面 vs 光面 + 豆眼）。
