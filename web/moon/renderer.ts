// MoonRenderer：月亮这个角色的控制器，实现 CharacterRenderer（运行时只喂它 情绪 / 动作 / 在听 / 在说）。
// 负责：情绪惯性 → 默认表情；动作原语 → 姿态目标；弹簧运动（位置 / 转身看你）；眨眼；压扁；光。
// 画面由 MoonBody（moon.ts）画；物理与手势（V3）在 motion.ts 里接进来。

import * as THREE from "three";
import type { Action } from "../../shared/protocol";
import type { ActionSource, CharacterRenderer } from "../runtime/renderer";
import type { WindowCamera } from "../world/camera";
import type { WorldState } from "../world/world";
import { ActionRunner } from "./actions";
import { Blinker } from "./blink";
import { EXPRESSIONS, exprForEmotion, exprParams, FaceState, NEUTRAL, type ExprName, type FaceParams } from "./expressions";
import { Spring, Spring3, approach, clamp, deg, drift } from "./math";
import { MoonBody } from "./moon";
import { params } from "./params";

const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** 四元数弹簧：角速度 ω（世界坐标），力矩 = k·误差角 - c·ω。 */
class QuatSpring {
  q = new THREE.Quaternion();
  w = new THREE.Vector3();
  target = new THREE.Quaternion();
  omega = 6;
  zeta = 0.6;
  /** 0..1：「自己想转回来」的力度（被甩得翻滚时暂时放松） */
  hold = 1;
  private tq = new THREE.Quaternion();
  private axis = new THREE.Vector3();
  step(dt: number) {
    const n = Math.max(1, Math.ceil(dt * this.omega / 0.4));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      // 误差：target · q⁻¹，取最短路径
      this.tq.copy(this.target).multiply(this.tmpInv.copy(this.q).invert());
      if (this.tq.w < 0) this.tq.set(-this.tq.x, -this.tq.y, -this.tq.z, -this.tq.w);
      const s = Math.sqrt(Math.max(0, 1 - this.tq.w * this.tq.w));
      const ang = 2 * Math.acos(clamp(this.tq.w, -1, 1));
      if (s > 1e-6) this.axis.set(this.tq.x / s, this.tq.y / s, this.tq.z / s);
      else this.axis.set(0, 0, 0);
      const k = this.omega * this.omega * this.hold;
      const c = 2 * this.zeta * this.omega * (0.35 + 0.65 * this.hold);
      this.w.addScaledVector(this.axis, k * ang * h).addScaledVector(this.w, -c * h);
      const wl = this.w.length();
      if (wl > 1e-7) {
        this.dq.setFromAxisAngle(this.tmpAxis.copy(this.w).divideScalar(wl), wl * h);
        this.q.premultiply(this.dq).normalize();
      }
    }
  }
  private tmpInv = new THREE.Quaternion();
  private dq = new THREE.Quaternion();
  private tmpAxis = new THREE.Vector3();
}

export interface MoonCtx {
  cam: WindowCamera;
  world: WorldState;
}

export class MoonRenderer implements CharacterRenderer {
  readonly body = new MoonBody();
  readonly actions = new ActionRunner();
  readonly blinker = new Blinker();
  readonly face = new FaceState();
  /** 面板 / 剧本强制的表情（null = 由情绪和动作决定） */
  exprOverride: ExprName | null = null;
  /** 聊天模式：月亮飘到 chatHome 给字让位 */
  chatMode = false;
  /** 额外的注视目标（世界坐标）：看流星、看黑洞气泡、看手指；null = 看你 */
  lookTarget: THREE.Vector3 | null = null;
  lookWeight = 0;

  private target = { valence: 0.2, arousal: 0.5 };
  private cur = { valence: 0.2, arousal: 0.5 };
  private listening = false;
  private speaking = false;
  private glow = params.light.glowDefault;
  readonly pos = new Spring3(0, 0, -1, params.motion.posOmega, params.motion.posZeta);
  readonly rot = new QuatSpring();
  private squash = new Spring(0, params.motion.scaleOmega, params.motion.scaleZeta);
  private swayX = new Spring(0, params.motion.swayOmega, params.motion.swayZeta);
  private swayY = new Spring(0, params.motion.swayOmega, params.motion.swayZeta);
  private t = 0;
  private seed = Math.random() * 1000;
  private glance = { x: 0, y: 0, next: 2 };
  private glanceS = new Spring3(0, 0, 0, 7, 0.75);
  /** 外部（手势 / 物理，V3）叠加的位置偏移与压扁 */
  readonly extra = { pos: new THREE.Vector3(), squashAxis: new THREE.Vector3(0, 1, 0), squash: 0 };

  constructor() {
    const H = params.moon.home;
    this.pos.set(H.x, H.y, -H.depth);
  }

  // ---------- CharacterRenderer ----------
  setEmotion(valence: number, arousal: number) {
    this.target.valence = clamp(valence, -1, 1);
    this.target.arousal = clamp(arousal, 0, 1);
  }
  playAction(name: Action, intensity: number, source: ActionSource = "brain") {
    if (!this.actions.play(name, intensity, source)) return;
    if (name === "bounce" || name === "spin") this.blinker.blinkNow(false);
    if (name === "shiver" || name === "hide_edge") this.blinker.blinkNow(true);
  }
  setListening(on: boolean) {
    this.listening = on;
  }
  setSpeaking(on: boolean) {
    this.speaking = on;
  }
  update(_dt: number) {
    /* 由 App 用 tick(dt, ctx) 驱动（需要相机与世界状态） */
  }

  get emotion() {
    return { ...this.cur };
  }
  get radius() {
    return params.moon.radius;
  }
  /** 月心世界坐标 */
  get center() {
    return this.body.root.position;
  }

  tick(dt: number, ctx: MoonCtx) {
    const P = params;
    this.t += dt;
    const cam = ctx.cam;

    // 情绪惯性
    const k = 1 - Math.exp(-dt / P.motion.emotionTau);
    this.cur.valence += (this.target.valence - this.cur.valence) * k;
    this.cur.arousal += (this.target.arousal - this.cur.arousal) * k;
    const arousal = clamp(this.cur.arousal + (this.speaking ? 0.1 : 0), 0, 1);

    // 家：待机 / 聊天
    const home = this.chatMode ? P.moon.chatHome : P.moon.home;
    const R = P.moon.radius;
    const pose = this.actions.update(dt, { halfW: cam.halfW, radius: R, moonDepth: home.depth, eyeDistance: cam.eyeZ });

    // 待机漂浮（噪声，不是正弦）
    const ag = 1 + arousal * P.motion.driftArousalGain;
    const tt = (this.t / P.motion.driftPeriod) * ag;
    const driftX = drift(tt, this.seed) * P.motion.driftAmpX * ag;
    const driftY = drift(tt + 31.7, this.seed + 1) * P.motion.driftAmpY * ag;
    const driftRoll = drift(tt * 0.7 + 63.1, this.seed + 2) * deg(P.motion.driftRollDeg);

    // 有重量：相机横移时慢半拍地跟一点
    for (const s of [this.swayX, this.swayY]) {
      s.omega = P.motion.swayOmega;
      s.zeta = P.motion.swayZeta;
    }
    this.swayX.target = cam.eye.x * P.motion.swayGain;
    this.swayY.target = cam.eye.y * P.motion.swayGain;
    this.swayX.step(dt);
    this.swayY.step(dt);

    this.pos.tune(P.motion.posOmega, P.motion.posZeta);
    this.pos.setTarget(home.x + driftX + pose.dx + this.swayX.x, home.y + driftY + pose.dy + this.swayY.x, -home.depth + pose.dz);
    this.pos.step(dt);
    // 手势 / 物理的位移直接叠加（不走弹簧：弹墙的反弹要干脆）
    this.body.root.position.set(this.pos.x + this.extra.pos.x, this.pos.y + this.extra.pos.y, this.pos.z + this.extra.pos.z);

    // ---- 转身看你：脸（物体 +z）对准观察者的眼睛；偶尔扫一眼别处 ----
    this.glance.next -= dt;
    if (this.glance.next <= 0) {
      const g = deg(P.motion.glanceDeg);
      const away = Math.random() < 0.35;
      this.glance.x = away ? (Math.random() * 2 - 1) * g : 0;
      this.glance.y = away ? (Math.random() * 2 - 1) * g * 0.6 : 0;
      this.glance.next = away ? 0.6 + Math.random() * 0.8 : 2 + Math.random() * 4;
    }
    this.glanceS.setTarget(this.glance.x, this.glance.y, 0);
    this.glanceS.step(dt);
    const viewer = cam.camera.position;
    const center = this.body.root.position;
    const toViewer = this.tmpA.copy(viewer).sub(center).normalize();
    if (this.lookTarget && this.lookWeight > 0) {
      const toT = this.tmpB.copy(this.lookTarget).sub(center).normalize();
      toViewer.lerp(toT, clamp(this.lookWeight, 0, 1)).normalize();
    }
    const qLook = lookRotation(toViewer, this.tmpQ);
    const qPose = this.tmpQ2.setFromEuler(this.tmpE.set(-pose.pitch + this.glanceS.y, this.glanceS.x, pose.roll + driftRoll, "YXZ"));
    this.rot.target.copy(qLook).multiply(qPose);
    this.rot.omega = P.motion.rotOmega;
    this.rot.zeta = P.motion.rotZeta;
    this.rot.step(dt);
    // 大角度的转（翻滚、转圈）由动作自己缓动，直接叠在最外层：脸会真的转到背面再转回来
    const qYaw = this.tmpQ3.setFromAxisAngle(Y, pose.yaw);
    this.body.mesh.quaternion.copy(this.rot.q).multiply(qYaw);

    // ---- 压扁：速度拉伸 + 落地脉冲 + 外部（撞墙 / 被戳） ----
    this.squash.omega = P.motion.scaleOmega;
    this.squash.zeta = P.motion.scaleZeta;
    if (pose.squashPulse) this.squash.kick(-P.squash.landPulse * 40);
    this.squash.target = 0;
    this.squash.step(dt);
    const stretch = clamp(this.pos.vy * P.squash.velocityGain + this.squash.x, -P.squash.max, P.squash.max);
    if (Math.abs(this.extra.squash) > Math.abs(stretch)) this.body.setSquash(this.extra.squashAxis, this.extra.squash, R);
    else this.body.setSquash(Y, -stretch, R);

    // ---- 光 ----
    const glowTarget = pose.glow ?? P.light.glowDefault * (this.listening ? 1.12 : 1);
    this.glow = approach(this.glow, glowTarget, P.light.glowTau, dt);

    // ---- 表情：手势的瞬时表情 > 剧本 / 面板 > 动作 > 情绪 ----
    if (this.flash && this.t > this.flash.until) this.flash = null;
    const name: ExprName = this.flash?.name ?? this.exprOverride ?? pose.expr ?? exprForEmotion(this.cur.valence, arousal);
    const fp: FaceParams = exprParams(name);
    // 在听：视线稍微前倾、专注一点
    if (this.listening && !pose.expr && !this.exprOverride) fp.eyeScale *= 1.04;
    fp.gazeX += pose.gazeX;
    fp.gazeY -= pose.gazeY;
    this.face.setTarget(fp);
    const face = this.face.update(dt);
    // 眨眼：只作用在「睁着的圆眼」上；^ ^ / >< / @ 不眨
    this.blinker.lidCap = pose.lidCap;
    this.blinker.update(dt, this.cur.valence, arousal);
    const blinkable = 1 - clamp(face.happy + face.squeeze + face.dizzy, 0, 1);
    const open = 1 - (1 - this.blinker.openness) * blinkable;
    const daze = this.blinker.daze;
    const squint = this.blinker.shape === "squint" && name !== "sad" ? 1 : 0;
    const out: FaceParams = {
      ...face,
      openL: face.openL * open,
      openR: face.openR * open,
      happy: Math.max(face.happy, squint * 0.9),
      eyeScale: face.eyeScale * daze,
    };
    const blush = clamp(face.blush + Math.max(0, this.cur.valence) * 0.3 + (pose.blush ?? 0), 0, 1);

    this.body.update({
      sunDir: ctx.world.sunDir,
      earthshine: ctx.world.earthshine,
      glow: this.glow,
      face: out,
      blush,
      time: this.t,
      night: ctx.world.night,
      radius: R,
      illuminated: ctx.world.phase.illuminated,
    });
  }

  /** 手势 / 小日子给的瞬时表情（秒），优先级最高。 */
  flashExpr(name: ExprName, seconds: number) {
    this.flash = { name, until: this.t + seconds };
  }
  private flash: { name: ExprName; until: number } | null = null;
  /** 现在是不是在做瞬时表情 */
  get flashing() {
    return this.flash != null && this.t <= this.flash.until;
  }
  get time() {
    return this.t;
  }
  /** 当前正在做的动作（小日子要避开） */
  get busy() {
    return this.actions.current != null;
  }
  /** 月心在「家 + 漂浮 + 动作」上的位置（不含手势位移） */
  get springPos() {
    return this.tmpS.set(this.pos.x, this.pos.y, this.pos.z);
  }
  private tmpS = new THREE.Vector3();

  /** 录制 / 切场景：直接把表情跳过去 */
  snapFace(name: ExprName) {
    this.face.snap(exprParams(name));
  }

  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpQ3 = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
/** 让物体 +z 指向 dir、+y 尽量朝上的旋转。 */
export function lookRotation(dir: THREE.Vector3, out: THREE.Quaternion) {
  const z = dir;
  _x.copy(Y).cross(z);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0);
  _x.normalize();
  _y.copy(z).cross(_x).normalize();
  _m.makeBasis(_x, _y, z);
  return out.setFromRotationMatrix(_m);
}

export { EXPRESSIONS, NEUTRAL, Z };
