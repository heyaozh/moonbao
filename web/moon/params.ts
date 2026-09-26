// moonbao 的全部可调数值都在这里（画面、月亮、动作、对话、声音）。改这个文件不需要懂 three.js。
// 约定：长度单位 = 「屏幕短边的一半」（屏幕短边从 -1 到 1）；角度单位 = 度；时间单位 = 秒；颜色是 CSS 十六进制。
// 调试面板上的滑杆直接改这个对象（运行时可变）；面板「存为默认」会把改过的值写进 web/params.overrides.json，
// 启动时合并进来。满意的值请抄回这里当默认（overrides 文件只是暂存）。

import { deepMerge } from "./merge";

const defaults = {
  // ───────────── 空间：窗、相机、深度 ─────────────
  space: {
    /** 眼睛（观察者）到屏幕的距离。越大越像远远地看一张画，越小透视越夸张。 */
    eyeDistance: 2.0,
    /** 手机倾斜 20° 时，观察者横移多少（屏幕半宽 = 1）。拍板值（2026-09-23）：1/4 屏宽 = 0.5 半宽。 */
    shiftAt20deg: 0.5,
    /** 倾斜输入的最大值（度），超过就饱和。 */
    tiltClampDeg: 35,
    /** 倾斜输入的低通滤波时间常数（秒）：陀螺仪抖动靠它压，越大越稳越迟钝。 */
    tiltSmoothing: 0.12,
    /** 桌面端：鼠标从屏幕中心移到边缘等价于倾斜多少度（模拟重力感应）。 */
    mouseTiltDeg: 22,
    /** 视差总强度（0 = 不跟倾斜动，1 = 按上面的数值）。设置里的「视差强度」改的是它，防晕。 */
    parallaxStrength: 1,
  },

  // ───────────── 天空：底色、真实银河、星表、补星 ─────────────
  sky: {
    /** 永远是夜晚（设置里的开关；白天的美术是 agent 自己发挥的，未决 15）。 */
    alwaysNight: false,
    /** 左右镜像。false = 真实朝向（上北时东在左）；true = 用户说的「上北下南左西右东」（星座会是镜像的，未决 13）。 */
    mirrorEastWest: false,
    /** 画面中心对准银河此刻最高的一段；但不低于这个高度（度），免得画面对着地平线。 */
    minViewAltDeg: 28,
    /** 天空底色按太阳高度角（度）插值：夜 → 天文晨昏 → 航海晨昏 → 民用晨昏 → 金色时刻 → 白天。
     *  top / mid / bottom 是屏幕上、中、下三处的颜色。 */
    gradient: [
      { alt: -18, top: "#010208", mid: "#030817", bottom: "#081230" },
      { alt: -12, top: "#02050f", mid: "#070f29", bottom: "#141c47" },
      { alt: -7, top: "#081033", mid: "#1d2458", bottom: "#5b3f6d" },
      { alt: -3, top: "#15285e", mid: "#4f5690", bottom: "#d48466" },
      { alt: 3, top: "#2b5ba3", mid: "#86a3d4", bottom: "#f2c08e" },
      { alt: 12, top: "#2d67be", mid: "#6aa0df", bottom: "#c9def2" },
      { alt: 40, top: "#2562b8", mid: "#5e98dc", bottom: "#b7d4f0" },
    ],
    /** 白天星星和银河还剩多少（0 = 看不见）。 */
    dayStarVisibility: 0.0,
    milkyWay: {
      /** 整体亮度增益（线性）。 */
      gain: 1.8,
      /** 黑位：原图的背景雾偏灰，先减掉这么多再放大（线性）。 */
      black: 0.035,
      /** 对比（伽马）：>1 让暗处更暗、银河带更突出。 */
      contrast: 1.45,
      /** 饱和度：0 = 灰，1 = 原色。原图偏棕，调色主要靠下面三个色。 */
      saturation: 0.35,
      /** 按亮度分三段上色：暗处 / 中间 / 亮处（照概念图：蓝白银河、紫粉淡彩、暖白核心）。 */
      tintLow: "#2a4ed0",
      tintMid: "#a9b8ee",
      tintHigh: "#fff4e6",
      /** 淡彩星云：沿银河叠一层低频噪声的彩色（0 = 关）。 */
      nebula: 0.25,
      nebulaA: "#6b4fd8",
      nebulaB: "#e07fb4",
      /** 这一层随倾斜的移动量（0 = 钉住不动，1 = 按真实深度）。2026-09-23 用户：远处的星空「不太动」。 */
      parallax: 0.06,
    },
    /** 星表里的真实恒星（≤ 6 等，约 5000 颗）。 */
    stars: {
      /** 最暗画到几等。 */
      magLimit: 6.0,
      /** 点的大小（像素，1 倍屏）：最亮的星与最暗的星。 */
      sizeBright: 7.5,
      sizeFaint: 1.1,
      /** 亮度：最亮 / 最暗。 */
      brightBright: 5.0,
      brightFaint: 0.28,
      /** 颜色饱和（按 B-V 色指数上色的程度）。 */
      colorSaturation: 0.55,
      twinkle: 0.35,
      twinkleSpeed: 1.4,
      parallax: 0.06,
    },
    /** 程序化补星：让画面像概念图那样密。depth = 屏幕后方距离；parallax 同上；warm = 暖金色星的比例。 */
    fill: [
      { count: 2600, depth: 12, size: 1.0, brightness: 0.45, warm: 0.12, parallax: 0.12 },
      { count: 900, depth: 6, size: 1.7, brightness: 0.7, warm: 0.35, parallax: 0.3 },
      { count: 140, depth: 3, size: 3.2, brightness: 1.1, warm: 0.55, parallax: 0.55 },
    ],
    fillTwinkle: 0.45,
    fillTwinkleSpeed: 1.2,
    /** 补星散布的范围（相对于该深度处可见范围的倍数，>1 保证倾斜时不露边）。 */
    fillSpread: 1.8,
    /** 暖金色星与冷白色星的颜色。 */
    warmColor: "#ffc98a",
    coolColor: "#cfdcff",
  },

  // ───────────── 流星（背景里偶尔划过） ─────────────
  meteors: {
    /** 平均间隔（秒），指数分布抽样。 */
    interval: 9,
    /** 一颗流星的寿命（秒）、速度（单位/秒）、尾巴长度（单位）。 */
    life: 0.9,
    speed: 4.5,
    trail: 1.3,
    /** 深度范围（屏幕后方）。 */
    depthMin: 4,
    depthMax: 10,
    /** 头的亮度（HDR，>1 会被辉光吃到）、宽度（像素）。 */
    brightness: 3.0,
    width: 2.2,
    color: "#fff4df",
  },

  // ───────────── 最近处的虚化光斑（景深） ─────────────
  bokeh: {
    count: 20,
    /** 深度：负 = 屏幕后方，正 = 玻璃前面（离你更近，倾斜时反向移动）。 */
    depthMin: -0.25,
    depthMax: 0.55,
    /** 大小（单位）与不透明度范围。 */
    sizeMin: 0.05,
    sizeMax: 0.2,
    opacityMin: 0.06,
    opacityMax: 0.2,
    color: "#ffcf88",
    /** 光斑边缘的一圈亮环（真实镜头的 bokeh 有）：0 = 纯软圆。 */
    ring: 0.12,
    /** 漂浮速度。 */
    drift: 0.025,
    /** 画面中间留空的半径（屏幕短边一半的倍数），光斑少挡脸。 */
    centerClear: 0.55,
  },

  // ───────────── 地照微光（屏幕下方，似是地球发出的，看不到地球） ─────────────
  earthglow: {
    strength: 0.55,
    inner: "#ffcf96",
    outer: "#3f6fd6",
    /** 光在屏幕底下多远（单位）、多宽、多高。 */
    depth: 6,
    width: 9,
    height: 3.2,
    /** 夜晚的强度倍数与白天的倍数。 */
    night: 1.0,
    day: 0.25,
  },

  // ───────────── 白天的云 ─────────────
  clouds: {
    coverage: 0.42,
    speed: 0.012,
    opacity: 0.85,
    color: "#ffffff",
    shade: "#b9c6de",
    /** 晨昏时云底的暖色。 */
    sunsetColor: "#ffb48a",
  },

  // ───────────── 后期 ─────────────
  post: {
    /** 曝光（线性倍数）。 */
    exposure: 1.0,
    /** 辉光：强度 / 半径 / 阈值（HDR 亮度超过阈值才发光）。 */
    bloomStrength: 0.5,
    bloomRadius: 0.55,
    bloomThreshold: 1.0,
    /** 暗角强度（0..1）。 */
    vignette: 0.32,
    /** 胶片颗粒（0..0.05）。 */
    grain: 0.018,
  },

  // ───────────── 月亮本体 ─────────────
  moon: {
    /** 半径。 */
    radius: 0.82,
    /** 「家」的位置：没人理它时待在哪（x, y 相对屏幕中心，depth = 屏幕后方多深）。
     *  聊天时它会飘到 chatHome 给字让位（照概念图：月亮缩到上角）。 */
    home: { x: 0, y: 0.82, depth: 1.3 },
    chatHome: { x: -0.36, y: 0.98, depth: 2.2 },
    /** 月面亮部颜色 / 暗部（地照）颜色。 */
    litColor: "#ffd2a0",
    shadeColor: "#8d8ca3",
    /** 明暗交界的柔和度（0 = 刀切，0.4 = 很柔）。用户：月相的分界线要柔和。 */
    terminatorSoftness: 0.26,
    /** 包裹光：让亮面更平、更「软」（0 = 物理，0.5 = 很软）。 */
    wrap: 0.16,
    /** 交界线附近的暖色透光（类次表面散射），软糯感的来源之一。 */
    sss: 0.35,
    sssColor: "#ff9a6b",
    /** 亮面的 HDR 亮度（>1 会被辉光轻轻吃到，像自己在发光）。 */
    brightness: 0.78,
    /** 边缘泛光（fresnel）强度与颜色。 */
    rim: 0.38,
    /** 边缘暗角（月面靠边稍暗，更有球的体积感）。 */
    limbDarkening: 0.28,
    /** 体积感：不管月相，额外一盏很弱的「左上方」主光，让球有立体感（概念图右下边缘更暗）。0 = 关。 */
    volume: 0.5,
    volumeDir: { x: -0.55, y: 0.6, z: 0.6 },
    rimColor: "#ffe2a8",
    /** 表面自发光（暖白）。2026-09-23 拍板：发光靠光晕 + 地照，表面自发光封顶 0.2。 */
    selfGlow: 0.035,
    selfGlowMax: 0.2,
    selfGlowColor: "#fff1d6",
    /** 真实月面贴图混入程度（0 = 光面，1 = NASA 柔和贴图，用户偏好样板）。 */
    surfaceRealism: 1,
    albedoUrl: "/moon/nasa_soft05_albedo_2k.jpg",
    heightUrl: "/moon/nasa_soft05_height_1k.png",
    /** 贴图对比（1 = 原样，<1 更柔）。贴图按近侧平均反照率 0.22 归一化（2026-09-26 实测）。 */
    textureContrast: 1.15,
    /** 高程转法线的凹凸强度（0 = 只有颜色没有起伏）。 */
    bumpStrength: 0.5,
    /** 程序化小坑的强度（0 = 纯 NASA 柔和样板；概念图里的月亮坑更清楚）。 */
    craterDetail: 0.7,
    /** 脸在月面上的位置（月面经纬度，度）：挑一块月海不打架的地方。 */
    faceLon: 12,
    faceLat: -6,
  },

  // ───────────── 月相与光 ─────────────
  light: {
    /** 月相：-1 = 真实月相（按日期和所在地）；0..360 = 手动（0 满月，90 上弦，180 新月，270 下弦）。 */
    phaseDeg: -1,
    /** 手动月相时亮边的方向（度，从头顶逆时针量）。真实月相时自动算。 */
    limbDeg: -60,
    /** 地照强度：满月时的下限 / 新月时的上限（暗部永远不会完全看不见）。 */
    earthshineMin: 0.05,
    earthshineMax: 0.11,
    /** 光晕：大小（半径的倍数）、不透明度、颜色；glow 状态（dim / brighten）会乘上去。 */
    haloScale: 2.3,
    haloOpacity: 0.5,
    haloColor: "#ffe9c8",
    glowDefault: 1.0,
    glowMin: 0.35,
    glowMax: 1.6,
    glowTau: 0.6,
  },

  // ───────────── 脸（画在球面上，跟着月亮一起转） ─────────────
  // 所有长度都是半径的倍数；比例按用户参考图（docs/design.md §2）。
  face: {
    eyeSpacing: 0.66,
    /** 眼睛中心的高度（相对球心，负 = 偏下）。 */
    eyeY: 0.0,
    /** 眼睛半宽 / 半高。 */
    eyeW: 0.068,
    eyeH: 0.078,
    eyeColor: "#17141d",
    /** 眼睛高光（小白点）：位置（相对眼睛半径）、大小、亮度。参考图是哑光的，概念图有小高光。 */
    highlightX: -0.32,
    highlightY: 0.38,
    highlightSize: 0.26,
    highlight: 0.85,
    /** 视线偏移幅度（眼睛在脸上滑多远）。 */
    gazeRange: 0.06,
    /** 嘴：中心在眼睛下方多远、宽、线粗、微笑弧的深度。 */
    mouthBelow: 0.17,
    mouthWidth: 0.145,
    mouthThickness: 0.021,
    smileDepth: 0.05,
    mouthColor: "#2a1618",
    mouthInner: "#7a2c33",
    tongueColor: "#ee8a92",
    /** 腮红：离中轴、在眼下多远、半径、颜色、底值与上限、羽化。 */
    blushX: 0.44,
    blushBelow: 0.12,
    blushRadius: 0.13,
    blushColor: "#ff7488",
    blushBase: 0.62,
    blushMax: 0.85,
    blushFeather: 0.92,
    /** 表情之间过渡的弹簧（频率 / 阻尼）。 */
    morphOmega: 11,
    morphZeta: 0.72,
  },

  // ───────────── 眨眼 ─────────────
  blink: {
    meanCalm: 5.5,
    meanExcited: 2.6,
    minGap: 0.9,
    closeDur: 0.07,
    openDur: 0.12,
    slowFactor: 2.6,
    slowHold: 0.18,
    doubleGap: 0.16,
    pDouble: 0.1,
    pSlow: 0.12,
    squintValence: 0.55,
    pSquint: 0.35,
    squintHold: 1.4,
    dazeArousal: 0.18,
    dazeScale: 0.55,
  },

  // ───────────── 运动：弹簧与漂浮 ─────────────
  motion: {
    /** 位置弹簧：频率 / 阻尼比。ζ=0.5 会过冲一点再回来，这是「活着」的关键。 */
    posOmega: 5.0,
    posZeta: 0.5,
    /** 转身（看向你）的弹簧。 */
    rotOmega: 6.5,
    rotZeta: 0.62,
    /** 缩放弹簧（squash 用）。 */
    scaleOmega: 14.0,
    scaleZeta: 0.45,
    /** 待机漂浮：幅度（x / y）和周期（秒）。 */
    driftAmpX: 0.05,
    driftAmpY: 0.07,
    driftPeriod: 7.0,
    driftRollDeg: 3.0,
    driftArousalGain: 0.8,
    /** 情绪惯性（秒）。 */
    emotionTau: 1.4,
    /** 月亮「有重量」：相机横移时它慢半拍地跟一点。 */
    swayGain: 0.12,
    swayOmega: 3.0,
    swayZeta: 0.45,
    /** 看你时的小扫视（度）：偶尔看别处一下再看回来。 */
    glanceDeg: 7,
  },

  // ───────────── squash & stretch ─────────────
  squash: {
    max: 0.07,
    velocityGain: 0.05,
    landPulse: 0.04,
  },

  // ───────────── 动作原语（时长、幅度） ─────────────
  actions: {
    lean_in: {
      anticipate: 0.18,
      anticipateDist: 0.1,
      dist: 0.45,
      hold: 1.6,
      closeupAt: 0.85,
      closeupEyeDistance: 1.25,
      closeupYawDeg: 34,
      closeupOffsetX: -0.35,
      closeupHold: 2.2,
    },
    drift_away: { dist: 1.2, hold: 2.5 },
    think_tilt: { rollDeg: 14, gazeX: 0.7, gazeY: -0.6, hold: 1.8 },
    bounce: { height: 0.22, count: 2, period: 0.42 },
    roll: { dur: 1.6 },
    spin: { dur: 0.8, turns: 2 },
    hide_edge: { out: 0.75, peek: 0.4, hold: 1.4, side: "auto" as "auto" | "left" | "right" },
    nod: { pitchDeg: 12, count: 2, period: 0.45 },
    dim: { sink: 0.12, hold: 2.5 },
    brighten: { rise: 0.12, hold: 2.0 },
    shiver: { amp: 0.025, dur: 0.6, freq: 22 },
  },

  // ───────────── 性能 ─────────────
  perf: {
    fpsDesktop: 60,
    fpsMobile: 30,
    /** devicePixelRatio 上限。 */
    maxPixelRatio: 2,
    /** 多重采样抗锯齿（0 / 2 / 4）。 */
    msaa: 4,
    maxFrameDt: 0.1,
  },
};

export type Params = typeof defaults;

// 面板「存为默认」写出的覆盖值（没有这个文件也没关系）
const overrides = import.meta.glob("../params.overrides.json", { eager: true, import: "default" }) as Record<string, unknown>;
const ov = Object.values(overrides)[0];

/** 出厂默认（深拷贝，面板用来算「改了哪些」）。 */
export const factoryParams: Params = JSON.parse(JSON.stringify(defaults));
export const params: Params = ov ? deepMerge(defaults, ov) : defaults;
