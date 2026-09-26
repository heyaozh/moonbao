// 天文小算法：太阳 / 月亮位置、真实月相与亮边方向、恒星时、地平 ↔ 赤道 ↔ 银道坐标。
// 精度目标是「看起来对」：太阳约 0.01°，月亮约 0.3°（Astronomical Almanac 低精度公式），足够画月相和星空朝向。
// 约定：角度一律弧度；赤经 ra ∈ [0, 2π)，赤纬 dec ∈ [-π/2, π/2]；方位角 az 从北向东量；东经为正。

const D2R = Math.PI / 180;
const TAU = Math.PI * 2;

export type Vec3 = [number, number, number];

export interface Equatorial {
  ra: number;
  dec: number;
}

export interface Horizontal {
  alt: number;
  az: number;
}

export interface MoonPhase {
  /** 相位角（太阳-月亮-观察者的夹角）：0 = 满月，π = 新月 */
  phaseAngle: number;
  /** 亮面比例 0..1 */
  illuminated: number;
  /** 上半月（渐盈）为 true */
  waxing: boolean;
  /** 亮边方向在观察者眼里的角度：从「头顶方向」逆时针量（朝东为正），弧度。 */
  brightLimbAngle: number;
  /** 月龄的位置 0..1（0 新月 → 0.5 满月 → 1 新月），画 UI 用 */
  cycle: number;
}

const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

/** 儒略日 */
export function julianDate(date: Date) {
  return date.getTime() / 86_400_000 + 2440587.5;
}

/** 格林尼治平恒星时（弧度） */
export function gmst(date: Date) {
  const d = julianDate(date) - 2451545.0;
  return wrap((280.46061837 + 360.98564736629 * d) * D2R);
}

/** 地方恒星时（弧度），lon 东经为正（弧度） */
export function lst(date: Date, lon: number) {
  return wrap(gmst(date) + lon);
}

function obliquity(d: number) {
  return (23.439 - 0.0000004 * d) * D2R;
}

function eclipticToEquatorial(lambda: number, beta: number, eps: number): Equatorial {
  const sl = Math.sin(lambda);
  const cl = Math.cos(lambda);
  const sb = Math.sin(beta);
  const cb = Math.cos(beta);
  const se = Math.sin(eps);
  const ce = Math.cos(eps);
  const ra = Math.atan2(sl * ce - (sb / cb) * se, cl);
  const dec = Math.asin(sb * ce + cb * se * sl);
  return { ra: wrap(ra), dec };
}

/** 太阳的地心赤道坐标 + 黄经 */
export function sunPosition(date: Date): Equatorial & { lambda: number } {
  const d = julianDate(date) - 2451545.0;
  const L = (280.46 + 0.9856474 * d) * D2R;
  const g = (357.528 + 0.9856003 * d) * D2R;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  return { ...eclipticToEquatorial(lambda, 0, obliquity(d)), lambda: wrap(lambda) };
}

/** 月亮的地心赤道坐标 + 黄经（低精度，约 0.3°） */
export function moonPosition(date: Date): Equatorial & { lambda: number } {
  const d = julianDate(date) - 2451545.0;
  const T = d / 36525;
  const s = (a: number, b: number) => Math.sin((a + b * T) * D2R);
  const lambdaDeg =
    218.32 +
    481267.881 * T +
    6.29 * s(134.9, 477198.85) -
    1.27 * s(259.2, -413335.38) +
    0.66 * s(235.7, 890534.23) +
    0.21 * s(269.9, 954397.7) -
    0.19 * s(357.5, 35999.05) -
    0.11 * s(186.6, 966404.05);
  const betaDeg = 5.13 * s(93.3, 483202.03) + 0.28 * s(228.2, 960400.87) - 0.28 * s(318.3, 6003.18) - 0.17 * s(217.6, -407332.2);
  const lambda = lambdaDeg * D2R;
  return { ...eclipticToEquatorial(lambda, betaDeg * D2R, obliquity(d)), lambda: wrap(lambda) };
}

/** 赤道 → 地平。lat、lon 弧度（东经为正）。 */
export function toHorizontal(eq: Equatorial, date: Date, lat: number, lon: number): Horizontal {
  const H = lst(date, lon) - eq.ra;
  const sinAlt = Math.sin(lat) * Math.sin(eq.dec) + Math.cos(lat) * Math.cos(eq.dec) * Math.cos(H);
  const alt = Math.asin(sinAlt);
  // 方位角从北向东
  const az = Math.atan2(-Math.cos(eq.dec) * Math.sin(H), Math.cos(lat) * Math.sin(eq.dec) - Math.sin(lat) * Math.cos(eq.dec) * Math.cos(H));
  return { alt, az: wrap(az) };
}

/** 视差角：天体上「北」和「天顶」方向的夹角（从北向东量）。 */
export function parallacticAngle(eq: Equatorial, date: Date, lat: number, lon: number) {
  const H = lst(date, lon) - eq.ra;
  return Math.atan2(Math.sin(H), Math.tan(lat) * Math.cos(eq.dec) - Math.sin(eq.dec) * Math.cos(H));
}

/** 真实月相：亮面比例、渐盈渐亏、以及从观察者看亮边朝哪（相对头顶方向）。 */
export function moonPhase(date: Date, lat: number, lon: number): MoonPhase {
  const sun = sunPosition(date);
  const moon = moonPosition(date);
  const cosPsi =
    Math.sin(sun.dec) * Math.sin(moon.dec) + Math.cos(sun.dec) * Math.cos(moon.dec) * Math.cos(sun.ra - moon.ra);
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi))); // 距角
  // 日地距离 ≈ 1 AU ≫ 地月距离：相位角 ≈ π - 距角（误差 < 0.2°）
  const R = 1.496e8;
  const Delta = 384400;
  const phaseAngle = Math.atan2(R * Math.sin(psi), Delta - R * Math.cos(psi));
  const illuminated = (1 + Math.cos(phaseAngle)) / 2;
  const elong = wrap(moon.lambda - sun.lambda);
  const waxing = elong < Math.PI;
  // 亮边位置角（从北向东）
  const chi = Math.atan2(
    Math.cos(sun.dec) * Math.sin(sun.ra - moon.ra),
    Math.sin(sun.dec) * Math.cos(moon.dec) - Math.cos(sun.dec) * Math.sin(moon.dec) * Math.cos(sun.ra - moon.ra)
  );
  const q = parallacticAngle(moon, date, lat, lon);
  return { phaseAngle, illuminated, waxing, brightLimbAngle: chi - q, cycle: elong / TAU };
}

// ---------- 坐标框架 ----------

/** 赤道单位向量：x → (0h, 0°)，y → (6h, 0°)，z → 北天极 */
export function equatorialVector(ra: number, dec: number): Vec3 {
  const c = Math.cos(dec);
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
}

/** 地平单位向量（ENU：x 东、y 北、z 天顶） */
export function horizontalVector(alt: number, az: number): Vec3 {
  const c = Math.cos(alt);
  return [c * Math.sin(az), c * Math.cos(az), Math.sin(alt)];
}

/**
 * ENU → 赤道 的 3×3 矩阵（行主序，m[r*3+c]），v_eq = M · v_enu。
 * 推导：时角坐标系 X = 子午圈上的赤道点 (0, -sinφ, cosφ)，Y = 东 (1,0,0)，Z = 北天极 (0, cosφ, sinφ)；
 * v_eq = Rz(LST) · (v·X, v·Y, v·Z)。
 */
export function enuToEquatorialMatrix(date: Date, lat: number, lon: number): number[] {
  const theta = lst(date, lon);
  const sp = Math.sin(lat);
  const cp = Math.cos(lat);
  // 时角系的三行
  const X = [0, -sp, cp];
  const Y = [1, 0, 0];
  const Z = [0, cp, sp];
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  // Rz(θ) · [X; Y; Z]
  return [
    ct * X[0] - st * Y[0], ct * X[1] - st * Y[1], ct * X[2] - st * Y[2],
    st * X[0] + ct * Y[0], st * X[1] + ct * Y[1], st * X[2] + ct * Y[2],
    Z[0], Z[1], Z[2],
  ];
}

/** 赤道 → 银道（J2000），v_gal = G · v_eq；反向用转置。 */
export const EQ_TO_GAL = [
  -0.0548755604, -0.8734370902, -0.4838350155,
  0.4941094279, -0.44482963, 0.7469822445,
  -0.867666149, -0.1980763734, 0.4559837762,
];

export function mul3(m: number[], v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

export function mul3T(m: number[], v: Vec3): Vec3 {
  return [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
}

/** 银道坐标（l, b）→ 地平（alt, az） */
export function galacticToHorizontal(l: number, b: number, date: Date, lat: number, lon: number): Horizontal {
  const cb = Math.cos(b);
  const g: Vec3 = [cb * Math.cos(l), cb * Math.sin(l), Math.sin(b)];
  const eq = mul3T(EQ_TO_GAL, g);
  const M = enuToEquatorialMatrix(date, lat, lon);
  const enu = mul3T(M, eq);
  return { alt: Math.asin(Math.max(-1, Math.min(1, enu[2]))), az: wrap(Math.atan2(enu[0], enu[1])) };
}

/**
 * 银河此刻「最好看的一段」在哪：沿银道每 5° 取一点，按高度打分（银心附近更亮，加一点权），
 * 返回得分最高点的地平坐标。画面中心对准它（用户 2026-09-26：银河按真实方位放进屏幕，不用举手机）。
 */
export function bestMilkyWayDirection(date: Date, lat: number, lon: number): Horizontal & { l: number } {
  let best = { alt: -Infinity, az: 0, l: 0, score: -Infinity };
  for (let deg = 0; deg < 360; deg += 5) {
    const l = deg * D2R;
    const h = galacticToHorizontal(l, 0, date, lat, lon);
    // 银心（l=0）附近亮：±60° 内加分
    const core = Math.max(0, Math.cos(l)) ** 2;
    const score = Math.sin(h.alt) + 0.35 * core * (h.alt > 0.2 ? 1 : 0);
    if (score > best.score) best = { alt: h.alt, az: h.az, l, score };
  }
  return { alt: best.alt, az: best.az, l: best.l };
}

/** 太阳高度角（弧度）：天空颜色的唯一输入 */
export function sunAltitude(date: Date, lat: number, lon: number) {
  return toHorizontal(sunPosition(date), date, lat, lon).alt;
}
