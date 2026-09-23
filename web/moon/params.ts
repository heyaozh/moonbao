// 月亮的全部可调数值都在这里。改这个文件不需要懂 three.js。
// 约定：长度单位 = 「屏幕短边的一半」（屏幕短边从 -1 到 1）；角度单位 = 度；时间单位 = 秒。
// 调试面板上的滑杆直接改这个对象（运行时可变），改完把满意的值抄回来当默认。

export const params = {
  // ───────────── 空间：窗、相机、深度 ─────────────
  space: {
    /** 眼睛（观察者）到屏幕的距离。越大越像远远地看一张画，越小透视越夸张。 */
    eyeDistance: 2.0,
    /** 手机倾斜 20° 时，观察者横移多少（屏幕半宽 = 1）。拍板值：1/4 屏宽 = 0.5 半宽。 */
    shiftAt20deg: 0.5,
    /** 倾斜输入的最大值（度），超过就饱和；防止把手机放平时看穿盒子。 */
    tiltClampDeg: 35,
    /** 倾斜输入的低通滤波时间常数（秒）：陀螺仪抖动靠它压，越大越稳越迟钝。 */
    tiltSmoothing: 0.12,
    /** 桌面端：鼠标从屏幕中心移到边缘等价于倾斜多少度（模拟重力感应）。 */
    mouseTiltDeg: 25,
    /** 月亮在屏幕后面多深（「一臂远」）。0 = 贴着玻璃，越大越像挂在天上。 */
    moonDepth: 1.2,
    /** 月亮「有重量」：相机移动时月亮跟着晃的比例（0 = 钉死在空间里，1 = 完全跟手）。 */
    moonSwayGain: 0.15,
    /** 月亮晃动弹簧：频率（越大越快回位）与阻尼比（<1 会过冲，0.4~0.6 有生命感）。 */
    moonSwayOmega: 3.0,
    moonSwayZeta: 0.45,
  },

  // ───────────── 月亮本体 ─────────────
  moon: {
    /** 半径。0.42 ≈ 在默认深度下占屏幕短边的一半左右。 */
    radius: 0.42,
    /** 月面亮部颜色 / 暗部（地照）颜色。 */
    litColor: "#fff3d2",
    shadeColor: "#7d8fb8",
    /** 明暗交界的柔和度（0 = 刀切，0.3 = 很柔）。 */
    terminatorSoftness: 0.22,
    /** 表面细微斑驳的强度（0 = 完全光滑的球）。陨石坑在 P5 才有。 */
    mottle: 0.1,
    /** 边缘泛光（fresnel）强度：让它在夜空里「发光」而不是被照亮。 */
    rim: 0.35,
    rimColor: "#ffe6a8",
  },

  // ───────────── 月相与光 ─────────────
  light: {
    /** 月相角（度）：0 = 满月（光从观察者背后来），90 = 上弦，180 = 新月，270 = 下弦。 */
    phaseDeg: 40,
    /** 太阳光相对于水平的倾角（度）：让明暗交界线稍微斜一点更好看。 */
    sunElevationDeg: 18,
    /** 地照强度：满月时的下限 / 新月时的上限（暗部永远不会完全看不见）。 */
    earthshineMin: 0.1,
    earthshineMax: 0.2,
    /** 光晕 sprite 的大小（半径的倍数）和基础不透明度；glow 状态（dim / brighten）会乘上去。 */
    haloScale: 3.2,
    haloOpacity: 0.55,
    haloColor: "#ffe9b8",
    /** 光的状态 glow 的默认值、下限、上限（dim → glowMin，brighten → glowMax）。 */
    glowDefault: 1.0,
    glowMin: 0.35,
    glowMax: 1.6,
    /** 光变化的时间常数（秒）。 */
    glowTau: 0.6,
  },

  // ───────────── 眼睛 ─────────────
  eyes: {
    /** 眼睛在月面上的高度：0 = 最底，0.5 = 正中，1 = 最顶。婴儿图式要偏低一点。 */
    height: 0.44,
    /** 两眼间距（半径的倍数）。0.5 个月亮宽 = 1.0 个半径。 */
    spacing: 0.95,
    /** 单只眼的大小（半径的倍数）。 */
    size: 0.19,
    /** 眼睛的宽高比（>1 横着扁一点，<1 竖着长一点）。 */
    aspect: 0.92,
    color: "#1b1a22",
    /** 高光点：相对眼睛的位置（-1..1）和大小（眼睛的倍数）。没有它眼睛是死的。 */
    highlightX: -0.35,
    highlightY: -0.35,
    highlightSize: 0.22,
    /** 眼睛在暗部时的微弱自发光（让它永远看得见）。 */
    emissiveInShade: 0.3,
    /** 视线偏移的最大幅度（眼睛在月面上滑动的距离，半径的倍数）。 */
    gazeRange: 0.12,
    /** 视线偏移的弹簧（看向别处再看回来）。 */
    gazeOmega: 6.0,
    gazeZeta: 0.7,
  },

  // ───────────── 眨眼 ─────────────
  blink: {
    /** 眨眼间隔（秒）：从指数分布抽，均值在 [meanCalm, meanExcited] 之间按活力插值。 */
    meanCalm: 5.5,
    meanExcited: 2.6,
    /** 最短间隔（秒），防止连眨成机关枪。 */
    minGap: 0.9,
    /** 一次眨眼闭上 / 睁开的时长（秒）。 */
    closeDur: 0.07,
    openDur: 0.12,
    /** 慢眨（信任 / 困）：整体时长倍数，闭眼停留（秒）。 */
    slowFactor: 2.6,
    slowHold: 0.18,
    /** 双眨（惊讶）的两次之间的间隔（秒）。 */
    doubleGap: 0.16,
    /** 形态概率（按情绪偏置前的基础值）：normal 之外的三种。 */
    pDouble: 0.1,
    pSlow: 0.12,
    /** 眯眼 ^ ^ 的触发：心情 ≥ 这个值时，眨眼后有 pSquint 概率停在眯眼 squintHold 秒。 */
    squintValence: 0.55,
    pSquint: 0.35,
    squintHold: 1.4,
    /** 呆眼 · ·：活力 ≤ 这个值时眼睛缩小成点。 */
    dazeArousal: 0.18,
    dazeScale: 0.55,
  },

  // ───────────── 运动：弹簧与漂浮 ─────────────
  motion: {
    /** 位置弹簧：频率 / 阻尼比。ζ=0.5 会过冲一点再回来，这是「活着」的关键。 */
    posOmega: 5.0,
    posZeta: 0.5,
    /** 旋转弹簧。 */
    rotOmega: 6.0,
    rotZeta: 0.55,
    /** 缩放弹簧（squash 用，阻尼稍高避免抖）。 */
    scaleOmega: 14.0,
    scaleZeta: 0.45,
    /** 待机漂浮：幅度（x / y，长度单位）和周期（秒）。用 Perlin 噪声，不是正弦。 */
    driftAmpX: 0.06,
    driftAmpY: 0.08,
    driftPeriod: 7.0,
    /** 待机时的微微摇头（度）。 */
    driftRollDeg: 3.0,
    /** 活力对漂浮幅度与速度的影响（1 = 活力满时翻倍）。 */
    driftArousalGain: 0.8,
    /** 情绪目标的惯性（秒）：LLM 说难过，它要这么久才「变」难过。 */
    emotionTau: 1.4,
  },

  // ───────────── squash & stretch ─────────────
  squash: {
    /** 最大形变（0.04 = ±4%）。 */
    max: 0.04,
    /** 速度→拉伸的系数：运动方向拉长、垂直方向压扁。 */
    velocityGain: 0.05,
    /** 急停 / 落地时的压扁脉冲幅度。 */
    landPulse: 0.04,
  },

  // ───────────── 动作原语（时长、幅度） ─────────────
  actions: {
    lean_in: {
      /** 蓄力：先往后缩这么久、这么远，再冲过来（anticipation）。 */
      anticipate: 0.18,
      anticipateDist: 0.1,
      /** 飘近的距离（intensity 满时）与停留。 */
      dist: 0.45,
      hold: 1.6,
      /** 高档特写：intensity ≥ 此值就飞到最近，只剩一只眼盯着你。 */
      closeupAt: 0.85,
      /** 特写时月心离观察者眼睛的距离（眼距 2.0 时，1.1 = 月亮已经穿过玻璃、占满屏幕）。 */
      closeupEyeDistance: 1.1,
      /** 特写时头转多少度（让一只眼正对你，另一只滑到边缘）、横移多少（半径倍数）。 */
      closeupYawDeg: 38,
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

  // ───────────── 星空与前景尘埃 ─────────────
  stars: {
    /** 三层远星：数量、深度（屏幕后方距离）、点大小、颜色、亮度。越远越暗越冷（空气透视）。 */
    layers: [
      { count: 260, depth: 3.5, size: 0.02, color: "#ffffff", brightness: 0.85 },
      { count: 420, depth: 7.0, size: 0.014, color: "#dfe8ff", brightness: 0.55 },
      { count: 700, depth: 14.0, size: 0.01, color: "#b9c8f2", brightness: 0.35 },
    ],
    /** 星星散布的范围（相对于该深度处可见范围的倍数，>1 保证倾斜时不露边）。 */
    spread: 2.2,
    /** 闪烁：幅度（0..1）与速度。 */
    twinkle: 0.35,
    twinkleSpeed: 1.6,
    /** 前景尘埃：在月亮前面缓慢飘的虚化光斑。 */
    dust: { count: 18, depthMin: 0.15, depthMax: 0.7, size: 0.09, color: "#ffe9c4", opacity: 0.18, driftSpeed: 0.03 },
  },

  // ───────────── 背景（占位；真正的太阳高度角在 P5） ─────────────
  sky: {
    /** 按小时的三个关键色（顶、中、底），P0 只按钟点线性插值。 */
    stops: [
      { hour: 0, top: "#050916", mid: "#0c1530", bottom: "#182448" },
      { hour: 6, top: "#1b2140", mid: "#4a3d5c", bottom: "#c48a6a" },
      { hour: 12, top: "#3b6fb5", mid: "#7fb0e0", bottom: "#d6e6f5" },
      { hour: 18, top: "#22284f", mid: "#6a4a6b", bottom: "#e0895a" },
      { hour: 21, top: "#070c1c", mid: "#101b3a", bottom: "#2a2a55" },
      { hour: 24, top: "#050916", mid: "#0c1530", bottom: "#182448" },
    ],
    /** 白天星星的可见度（0 = 白天完全看不见）。 */
    dayStarVisibility: 0.15,
    /** 边缘：极淡暗角强度（0..1）和随倾斜滑动的玻璃反光强度。 */
    vignette: 0.28,
    glassGlint: 0.06,
  },

  // ───────────── 性能 ─────────────
  perf: {
    /** 帧率上限：桌面 / 触屏设备。 */
    fpsDesktop: 60,
    fpsMobile: 30,
    /** devicePixelRatio 上限（Retina 手机 3 倍太贵）。 */
    maxPixelRatio: 2,
    /** 标签页不可见时暂停渲染。 */
    pauseWhenHidden: true,
  },
};

export type Params = typeof params;
