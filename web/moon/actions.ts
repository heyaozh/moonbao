// 12 个动作原语的时间线。每个动作是一个纯函数：(t, intensity, ctx) → 姿态目标。
// 弹簧去追这些目标，过冲和回弹是弹簧给的，这里只写「想去哪」。
// 主动运动先反向蓄力（anticipation）：lean_in 先往后缩一点再冲过来。

import type { Action } from "../../shared/protocol";
import type { EyeShape } from "./eyes";
import type { MouthShape } from "./face";
import { deg, easeInOut, easeOut } from "./math";
import { params } from "./params";

export interface Pose {
  /** 位置偏移（世界单位；+z = 朝观察者） */
  dx: number;
  dy: number;
  dz: number;
  /** 脸的额外转动（弧度） */
  yaw: number;
  pitch: number;
  roll: number;
  /** 本体（球）自己的转动（弧度），眼睛不跟 */
  bodyYaw: number;
  /** 光：null = 不管，否则 glow 目标 */
  glow: number | null;
  /** 视线目标（-1..1） */
  gazeX: number;
  gazeY: number;
  /** 眼睛形态强制（null = 交给眨眼系统） */
  shape: EyeShape | null;
  /** 眼皮上限（dim 时半睁） */
  lidCap: number;
  /** 另一只眼的不透明度（特写） */
  secondEye: number;
  /** 本帧要触发一次压扁脉冲 */
  squashPulse: boolean;
  /** 嘴形强制（null = 由情绪决定） */
  mouth: MouthShape | null;
  /** 腮红加深量 0..1（null = 由情绪决定） */
  blush: number | null;
  done: boolean;
}

export interface ActionCtx {
  /** 窗的半宽（躲边边要知道边在哪） */
  halfW: number;
  radius: number;
  moonDepth: number;
  eyeDistance: number;
  /** hide_edge 抽到的方向 */
  side: 1 | -1;
}

export const IDLE_POSE: Pose = {
  dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, roll: 0, bodyYaw: 0,
  glow: null, gazeX: 0, gazeY: 0, shape: null, lidCap: 1, secondEye: 1, squashPulse: false, mouth: null, blush: null, done: false,
};

type ActionFn = (t: number, k: number, ctx: ActionCtx, pose: Pose) => void;

const A = params.actions;

/** 三段式：进（in）→ 停（hold）→ 回（out）。返回 0..1 的「在位程度」和是否结束。 */
function envelope(t: number, tIn: number, hold: number, tOut: number) {
  if (t < tIn) return { w: easeOut(t / tIn), done: false };
  if (t < tIn + hold) return { w: 1, done: false };
  const u = (t - tIn - hold) / tOut;
  return { w: 1 - easeInOut(Math.min(1, u)), done: u >= 1 };
}

const fns: Record<Action, ActionFn> = {
  idle_drift: (_t, _k, _c, p) => {
    p.done = true;
  },

  lean_in: (t, k, ctx, p) => {
    const a = A.lean_in;
    if (k >= a.closeupAt) {
      // 特写：飞到离观察者 closeupEyeDistance 处（会穿过窗平面），头转一点让一只眼正对你
      // 月心最终在 z = eyeDistance - closeupEyeDistance（会穿过窗平面到观察者这一侧）
      const targetZ = ctx.moonDepth + ctx.eyeDistance - a.closeupEyeDistance;
      if (t < a.anticipate) {
        p.dz = -a.anticipateDist * (t / a.anticipate);
        return;
      }
      const e = envelope(t - a.anticipate, 0.7, a.closeupHold, 0.8);
      p.dz = targetZ * e.w;
      p.yaw = deg(-a.closeupYawDeg) * e.w;
      p.dx = ctx.radius * a.closeupOffsetX * e.w;
      p.gazeX = -0.3 * e.w;
      p.secondEye = 1 - 0.7 * e.w;
      p.shape = e.w > 0.9 ? "round" : null;
      p.mouth = e.w > 0.5 ? "o" : null;
      p.done = e.done;
      return;
    }
    if (t < a.anticipate) {
      p.dz = -a.anticipateDist * (t / a.anticipate);
      return;
    }
    const e = envelope(t - a.anticipate, 0.35, a.hold * (0.6 + 0.4 * k), 0.6);
    p.dz = a.dist * (0.5 + 0.5 * k) * e.w;
    p.gazeY = 0.15 * e.w;
    p.done = e.done;
  },

  drift_away: (t, k, _c, p) => {
    const a = A.drift_away;
    const e = envelope(t, 1.2, a.hold, 1.4);
    p.dz = -a.dist * (0.5 + 0.5 * k) * e.w;
    p.gazeY = -0.2 * e.w;
    p.done = e.done;
  },

  think_tilt: (t, k, _c, p) => {
    const a = A.think_tilt;
    const e = envelope(t, 0.4, a.hold, 0.5);
    p.roll = deg(a.rollDeg) * (0.6 + 0.4 * k) * e.w;
    p.gazeX = a.gazeX * e.w;
    p.gazeY = -a.gazeY * e.w; // 参数里 -0.6 表示往上看
    p.dy = 0.03 * e.w;
    p.mouth = e.w > 0.3 ? "flat" : null;
    p.done = e.done;
  },

  bounce: (t, k, _c, p) => {
    const a = A.bounce;
    const n = Math.max(1, Math.round(a.count * (0.5 + k)));
    const total = a.period * n;
    if (t >= total) {
      p.done = true;
      return;
    }
    const i = Math.floor(t / a.period);
    const u = (t - i * a.period) / a.period;
    const h = a.height * (0.6 + 0.4 * k) * (1 - i * 0.3);
    p.dy = h * Math.sin(Math.PI * u);
    p.shape = k > 0.5 ? "squint" : null;
    p.mouth = "smile";
    // 落地那一帧压扁
    p.squashPulse = u < 0.06 && i > 0;
  },

  roll: (t, _k, _c, p) => {
    const a = A.roll;
    const u = Math.min(1, t / a.dur);
    p.yaw = Math.PI * 2 * easeInOut(u);
    p.bodyYaw = p.yaw;
    p.dx = -0.06 * Math.sin(Math.PI * u);
    p.blush = 1; // 害羞地转过去
    p.mouth = "flat";
    p.done = u >= 1;
  },

  spin: (t, k, _c, p) => {
    const a = A.spin;
    const turns = Math.max(1, Math.round(a.turns * (0.5 + k)));
    const u = Math.min(1, t / a.dur);
    p.yaw = Math.PI * 2 * turns * easeInOut(u);
    p.bodyYaw = p.yaw;
    p.dy = 0.08 * Math.sin(Math.PI * u);
    p.shape = "squint";
    p.mouth = "smile";
    p.done = u >= 1;
  },

  hide_edge: (t, k, ctx, p) => {
    const a = A.hide_edge;
    const edge = ctx.halfW * ((ctx.eyeDistance + ctx.moonDepth) / ctx.eyeDistance); // 月亮深度处的屏幕边
    const outX = ctx.side * (edge + ctx.radius * a.out);
    const peekX = ctx.side * (edge - ctx.radius * a.peek);
    const tOut = 0.5, tHide = 0.5 + 0.3 * k, tPeek = 0.5, tBack = 0.6;
    if (t < tOut) {
      p.dx = outX * easeOut(t / tOut);
      p.shape = "dot";
      p.mouth = "o";
    } else if (t < tOut + tHide) {
      p.dx = outX;
    } else if (t < tOut + tHide + tPeek) {
      const u = (t - tOut - tHide) / tPeek;
      p.dx = outX + (peekX - outX) * easeOut(u);
      p.gazeX = -ctx.side * 0.8;
      p.shape = "round";
    } else if (t < tOut + tHide + tPeek + a.hold) {
      p.dx = peekX;
      p.gazeX = -ctx.side * 0.8;
    } else {
      const u = (t - tOut - tHide - tPeek - a.hold) / tBack;
      p.dx = peekX * (1 - easeInOut(Math.min(1, u)));
      p.done = u >= 1;
    }
  },

  nod: (t, k, _c, p) => {
    const a = A.nod;
    const n = Math.max(1, Math.round(a.count * (0.5 + k)));
    const total = a.period * n;
    if (t >= total) {
      p.done = true;
      return;
    }
    p.pitch = deg(a.pitchDeg) * Math.sin((2 * Math.PI * t) / a.period) * (0.6 + 0.4 * k);
    p.dy = -0.02 * Math.sin((2 * Math.PI * t) / a.period);
  },

  dim: (t, k, _c, p) => {
    const a = A.dim;
    const e = envelope(t, 0.8, a.hold * (0.6 + 0.6 * k), 1.2);
    p.glow = 1 + (params.light.glowMin - 1) * e.w * (0.6 + 0.4 * k);
    p.dy = -a.sink * e.w;
    p.lidCap = 1 - 0.45 * e.w;
    p.gazeY = -0.4 * e.w;
    p.mouth = e.w > 0.3 ? "flat" : null;
    p.done = e.done;
  },

  brighten: (t, k, _c, p) => {
    const a = A.brighten;
    const e = envelope(t, 0.3, a.hold * (0.6 + 0.6 * k), 1.0);
    p.glow = 1 + (params.light.glowMax - 1) * e.w * (0.6 + 0.4 * k);
    p.dy = a.rise * e.w;
    p.shape = e.w > 0.5 && k > 0.4 ? "squint" : null;
    p.mouth = "smile";
    p.blush = 0.5 * e.w;
    p.done = e.done;
  },

  shiver: (t, k, _c, p) => {
    const a = A.shiver;
    const u = t / a.dur;
    if (u >= 1) {
      p.done = true;
      return;
    }
    const env = 1 - u;
    p.dx = a.amp * (0.6 + 0.4 * k) * Math.sin(2 * Math.PI * a.freq * t) * env;
    p.roll = deg(1.5) * Math.sin(2 * Math.PI * a.freq * 0.7 * t) * env;
    p.shape = "dot";
    p.mouth = "o";
  },
};

export class ActionRunner {
  private cur: { name: Action; k: number; t: number; side: 1 | -1 } | null = null;
  readonly pose: Pose = { ...IDLE_POSE };

  get current(): Action | null {
    return this.cur?.name ?? null;
  }

  play(name: Action, intensity: number) {
    if (name === "idle_drift") {
      this.cur = null;
      return;
    }
    const cfgSide = params.actions.hide_edge.side;
    const side: 1 | -1 = cfgSide === "left" ? -1 : cfgSide === "right" ? 1 : Math.random() < 0.5 ? -1 : 1;
    this.cur = { name, k: Math.max(0, Math.min(1, intensity)), t: 0, side };
  }

  update(dt: number, ctx: Omit<ActionCtx, "side">): Pose {
    Object.assign(this.pose, IDLE_POSE);
    if (!this.cur) return this.pose;
    this.cur.t += dt;
    fns[this.cur.name](this.cur.t, this.cur.k, { ...ctx, side: this.cur.side }, this.pose);
    if (this.pose.done) this.cur = null;
    return this.pose;
  }
}
