// 运动学小工具：阻尼弹簧、平滑噪声、缓动。渲染层里所有「活着」的感觉都从这里来。

/** 二阶阻尼弹簧（半隐式欧拉）。omega = 自然频率（rad/s），zeta = 阻尼比（<1 过冲，=1 临界，>1 迟钝）。 */
export class Spring {
  x: number;
  v = 0;
  target: number;
  constructor(x0 = 0, public omega = 5, public zeta = 0.5) {
    this.x = x0;
    this.target = x0;
  }
  /** 直接放到某个值（无过冲），用于初始化或瞬移。 */
  set(x: number) {
    this.x = this.target = x;
    this.v = 0;
  }
  /** 给一个瞬时速度（戳一下、落地反弹）。 */
  kick(dv: number) {
    this.v += dv;
  }
  step(dt: number) {
    // 大 dt 拆小步：弹簧刚度高时半隐式欧拉会炸
    const n = Math.max(1, Math.ceil(dt * this.omega / 0.5));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = this.omega * this.omega * (this.target - this.x) - 2 * this.zeta * this.omega * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

/** 三个弹簧打包（位置 / 旋转 / 缩放都用它）。 */
export class Spring3 {
  readonly s: [Spring, Spring, Spring];
  constructor(x = 0, y = 0, z = 0, omega = 5, zeta = 0.5) {
    this.s = [new Spring(x, omega, zeta), new Spring(y, omega, zeta), new Spring(z, omega, zeta)];
  }
  get x() { return this.s[0].x; }
  get y() { return this.s[1].x; }
  get z() { return this.s[2].x; }
  get vx() { return this.s[0].v; }
  get vy() { return this.s[1].v; }
  get vz() { return this.s[2].v; }
  setTarget(x: number, y: number, z: number) {
    this.s[0].target = x;
    this.s[1].target = y;
    this.s[2].target = z;
  }
  set(x: number, y: number, z: number) {
    this.s[0].set(x);
    this.s[1].set(y);
    this.s[2].set(z);
  }
  tune(omega: number, zeta: number) {
    for (const sp of this.s) {
      sp.omega = omega;
      sp.zeta = zeta;
    }
  }
  step(dt: number) {
    for (const sp of this.s) sp.step(dt);
  }
}

/** 一阶低通（指数趋近）。tau = 时间常数（秒）。 */
export function approach(cur: number, target: number, tau: number, dt: number) {
  if (tau <= 0) return target;
  return cur + (target - cur) * (1 - Math.exp(-dt / tau));
}

// ---------- 一维平滑噪声（value noise，三次插值），待机漂浮用。周期由调用方缩放 t 决定。 ----------
function hash(i: number, seed: number) {
  let h = (i * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function noise1(t: number, seed = 0) {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hash(i, seed) * 2 - 1;
  const b = hash(i + 1, seed) * 2 - 1;
  return a + (b - a) * u;
}
/** 两个八度叠加，更像风。 */
export function drift(t: number, seed = 0) {
  return noise1(t, seed) * 0.7 + noise1(t * 2.3 + 17.1, seed + 99) * 0.3;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const deg = (d: number) => (d * Math.PI) / 180;
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** 指数分布抽样（眨眼间隔）。 */
export const expRandom = (mean: number) => -Math.log(1 - Math.random()) * mean;
