# assets/sky · 真实星空素材

| 网页文件（`web/public/sky/`，入库） | 来源（`assets/sky/raw/`，gitignore） | 授权 / 署名 |
|---|---|---|
| `milkyway_4k.jpg`（4096×2048，2.0 MB） | NASA SVS [Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851) 的「仅银河」图层 `milkyway_2020_4k.exr`（celestial 坐标，34.7 MB） | 署名：NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC. |
| `stars.bin`（5044 颗，≤ 6 等，81 kB） | [d3-celestial](https://github.com/ofrohn/d3-celestial) `data/stars.6.json`（Hipparcos） | BSD-3-Clause（`raw/d3-celestial-LICENSE`） |

重生成：
```bash
curl -L -o assets/sky/raw/milkyway_2020_4k.exr https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_4k.exr
curl -L -o assets/sky/raw/stars.6.json https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/stars.6.json
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/sky/exr_to_npy.py -- assets/sky/raw/milkyway_2020_4k.exr assets/sky/raw/milkyway_2020_4k.npy
python3 tools/sky/make_sky_textures.py
```

**贴图坐标**（2026-09-26 用大小麦哲伦云和银心的位置实测）：`u = fract(0.5 - RA/360°)`，赤经向左增加，0h 在正中；`v = (90° - Dec)/180°`。
存的是 `pow(亮度 / 0.6, 1/2.2)`；原图的背景雾偏灰，着色器里减黑位、调对比、调色（参数在 `web/moon/params.ts` 的 `sky` 一节）。
