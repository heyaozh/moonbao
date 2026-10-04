// 不聊天也好玩：直接操作月亮（2026-09-26 用户第 3 点；V9-B 2026-10-04 加手势与传感器彩蛋）。
// 没人碰它时是零重力；你可以戳它、抓着它走、把它甩出去——屏幕四边是盒子的侧壁，撞上去整体压扁再弹回；
// 往深处甩没有墙，它会慢慢减速，再自己飘回来。偏心甩会让它翻滚，转太多圈就晕。
//   点 = 戳（>.< + 压扁 + 往后缩；戳到眼 / 嘴 / 腮各有反应）· 连戳 3 下 = 鼓脸委屈，两秒后原谅
//   拖 = 抓着走（抓着不动 3 秒 = 看你手指、看你、慢眨）· 抓着快速来回 = 挠痒痒 · 甩 = 飞出去 + 翻滚
//   长按 = 贴过来蹭你（再来回动 = 搓，搓久了困）· 双击 = 特写 · 点空白处 = 看过去 · 在星空上绕它一圈 = 抱抱
//   两根手指：捏 = 压扁 / 拉长，拧 = 转过去（拧多了害羞）· 摇手机 = 被晃晕 · 轻轻摇 = 摇篮 · 扣下手机 = 睡觉 · 吹气 = 被吹走
// 每条 V9 彩蛋的开关和手感在 params.eggs；录片用 sim*() 在 App 时钟上确定性地重放。

import * as THREE from "three";
import type { WindowCamera } from "../world/camera";
import { Spring, approach, clamp, easeInOut } from "./math";
import { params } from "./params";
import type { MoonRenderer } from "./renderer";

export type FaceZone = "eye" | "mouth" | "cheek";

export interface InteractEvents {
  onPoke?: (strength: number) => void;
  onBounce?: (speed: number) => void;
  onGrab?: () => void;
  onRelease?: (speed: number) => void;
  onDizzy?: () => void;
  onTapSky?: (nx: number, ny: number) => void;
  /** 在星空上上下拖（翻历史）：dy = 这次移动的像素（向下为正） */
  onSkyDrag?: (dy: number) => void;
  // ── V9-B ──
  onTickle?: () => void;
  onRub?: () => void;
  onHug?: () => void;
  onZone?: (zone: FaceZone) => void;
  /** 睡着 / 醒来（扣下手机、摇篮） */
  onSleep?: (on: boolean) => void;
  onWake?: () => void;
  onBlow?: (strength: number, from: THREE.Vector3) => void;
  /** 抓着不动够久：它信任地看你 */
  onTrust?: () => void;
  /** 在星空上拖出的轨迹（世界坐标，节流过） */
  onSkyTrail?: (p: THREE.Vector3) => void;
  // ── V9-C ──
  /** 连戳三下鼓脸（主入口接「鼓脸放气」） */
  onPout?: () => void;
  /** 翻滚够多圈后停稳（spin = 这段时间转过的弧度；主入口接「抖落星尘」） */
  onSettled?: (spin: number) => void;
  /** 被吹了之后（主入口按概率接「打喷嚏」） */
  onBlown?: () => void;
}

const TAP_MS = 260;
const TAP_MOVE_PX = 10;
const LONG_MS = 480;
const DOUBLE_MS = 320;
const Y = new THREE.Vector3(0, 1, 0);

interface Ptr {
  x: number;
  y: number;
  onMoon: boolean;
}
interface Down {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  t: number;
  onMoon: boolean;
  hit: THREE.Vector3 | null;
  moved: boolean;
  /** 绕月亮转过的角度（弧度，带方向） */
  wind: number;
  lastAng: number | null;
  hugged: boolean;
  /** 已经触发了挠痒痒：这次按下剩下的移动都不管 */
  ignore: boolean;
}
interface Two {
  d0: number;
  aPrev: number;
  amount: number;
  axis: THREE.Vector3;
  twist: number;
  sim: { t: number; dur: number; hold: number; to: number; twistDeg: number; done: number } | null;
}

export class MoonInteraction {
  /** 手势 / 物理的位移（相对「家」）与速度（世界单位 / 秒） */
  readonly offset = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  private grabbed = false;
  private grabDepthZ = 0;
  private grabLocal = new THREE.Vector3();
  private pointerTarget = new THREE.Vector3();
  private history: { t: number; p: THREE.Vector3 }[] = [];
  private lastY = 0;
  private down: Down | null = null;
  private longTimer: ReturnType<typeof setTimeout> | null = null;
  private nuzzling = false;
  private lastTapAt = 0;
  private pokes: number[] = [];
  private squash = new Spring(0, 16, 0.32);
  private squashAxis = new THREE.Vector3(1, 0, 0);
  private spinAcc = 0;
  private spinWindow: { t: number; a: number }[] = [];
  private dizzyUntil = 0;
  private dizzyPending = false;
  private holdRestoreAt = 0;
  private lookUntil = 0;
  private t = 0;
  private ray = new THREE.Ray();
  private sphere = new THREE.Sphere();
  enabled = true;
  // ── V9-B ──
  private pts = new Map<number, Ptr>();
  private two: Two | null = null;
  private ignoreUntilAllUp = false;
  private flips: number[] = [];
  private lastDx = 0;
  private lastDy = 0;
  private tickleUntil = 0;
  private tickleCool = 0;
  private rubAt = -1e9;
  private rubT = 0;
  private rubSimUntil = 0;
  private rubbedYawn = false;
  private stillT = 0;
  private trusted = false;
  private lastTarget = new THREE.Vector3();
  private faceDown = false;
  private faceDownT = 0;
  private asleep = false;
  private rockHit = -1e9;
  private rockEnergy = 0;
  private rockT = 0;
  private rockSimUntil = 0;
  private hugSim: { t: number; dur: number; d: Down } | null = null;
  private trailLast = new THREE.Vector3(1e9, 0, 0);
  private timeline: { at: number; fn: () => void }[] = [];
  private tmpQ = new THREE.Quaternion();

  constructor(
    private moon: MoonRenderer,
    private cam: WindowCamera,
    private canvas: HTMLCanvasElement,
    private ev: InteractEvents = {}
  ) {
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    addEventListener("pointermove", (e) => this.onMove(e));
    addEventListener("pointerup", (e) => this.onUp(e));
    addEventListener("pointercancel", (e) => this.onUp(e));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.ev.onSkyDrag?.(-e.deltaY * 0.6);
      },
      { passive: false }
    );
    // 摇手机：猛摇 = 晕；轻轻地、有节奏地摇 = 摇篮（V9-B）
    let lastA: number | null = null;
    addEventListener("devicemotion", (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const m = Math.hypot(a.x, a.y, a.z);
      if (lastA != null) {
        const dm = Math.abs(m - lastA);
        if (dm > 14) this.shake(Math.min(1, dm / 30));
        else if (dm > 1.5 && dm < 7 && params.eggs.rock.enabled) this.rockHit = this.t;
      }
      lastA = m;
    });
  }

  /** 屏幕像素 → 归一化坐标（-1..1，y 向上） */
  private ndc(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -(((e.clientY - r.top) / r.height) * 2 - 1) };
  }

  /** 射线打月亮：返回世界坐标的命中点（没打中 = null） */
  hitMoon(nx: number, ny: number): THREE.Vector3 | null {
    this.cam.ray(nx, ny, this.ray);
    this.sphere.set(this.moon.center, this.moon.radius * 1.08);
    return this.ray.intersectSphere(this.sphere, new THREE.Vector3());
  }

  /** 射线与 z = zPlane 平面的交点 */
  private onPlane(nx: number, ny: number, zPlane: number, out = new THREE.Vector3()) {
    this.cam.ray(nx, ny, this.ray);
    const t = (zPlane - this.ray.origin.z) / this.ray.direction.z;
    return out.copy(this.ray.origin).addScaledVector(this.ray.direction, t);
  }

  private onDown(e: PointerEvent) {
    if (!this.enabled) return;
    const n = this.ndc(e);
    const hit = this.hitMoon(n.x, n.y);
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, onMoon: !!hit });
    if (this.ignoreUntilAllUp) return;
    // 第二根手指（至少一根在月亮上）：捏 / 拧
    if (this.down && !this.two && this.pts.size === 2 && (params.eggs.pinch.enabled || params.eggs.twist.enabled)) {
      const [a, b] = [...this.pts.values()];
      if (a.onMoon || b.onMoon) {
        e.preventDefault();
        this.startTwo(a, b);
      }
      return;
    }
    if (this.down) return;
    this.down = { id: e.pointerId, x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, t: performance.now(), onMoon: !!hit, hit, moved: false, wind: 0, lastAng: null, hugged: false, ignore: false };
    if (hit) {
      e.preventDefault();
      this.canvas.setPointerCapture?.(e.pointerId);
      // 长按：贴过来蹭你
      this.longTimer = setTimeout(() => {
        if (this.down && !this.down.moved && this.down.onMoon) this.startNuzzle();
      }, LONG_MS);
    }
  }

  private onMove(e: PointerEvent) {
    const p = this.pts.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    if (this.two && !this.two.sim) {
      if (this.pts.size >= 2) {
        const [a, b] = [...this.pts.values()];
        this.twoMove(a, b);
      }
      return;
    }
    const d = this.down;
    if (!d || e.pointerId !== d.id || d.ignore) return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (!d.moved && moved > TAP_MOVE_PX) {
      d.moved = true;
      if (this.longTimer) clearTimeout(this.longTimer);
      if (d.onMoon && !this.nuzzling) this.startGrab(d.hit!);
      this.lastY = e.clientY;
    }
    const ddx = e.clientX - d.px;
    const ddy = e.clientY - d.py;
    d.px = e.clientX;
    d.py = e.clientY;
    // 蹭着的时候来回动 = 搓
    if (this.nuzzling && d.moved && Math.abs(ddx) + Math.abs(ddy) > 1.5) {
      if (this.t - this.rubAt > 0.5) this.ev.onRub?.();
      this.rubAt = this.t;
    }
    if (d.moved && !d.onMoon) {
      const n = this.ndc(e);
      this.skyDrag(n.x, n.y, e.clientY - this.lastY, d);
      this.lastY = e.clientY;
    }
    if (this.grabbed) {
      const n = this.ndc(e);
      const pp = this.onPlane(n.x, n.y, this.grabDepthZ);
      this.pointerTarget.copy(pp).sub(this.grabLocal);
      this.history.push({ t: performance.now(), p: this.pointerTarget.clone() });
      while (this.history.length > 8) this.history.shift();
      // 挠痒痒：抓着它快速来回（小幅度、多次反向）
      const E = params.eggs.tickle;
      if (E.enabled) {
        const now = this.t;
        if ((Math.abs(ddx) > 3 && Math.sign(ddx) !== Math.sign(this.lastDx)) || (Math.abs(ddy) > 3 && Math.sign(ddy) !== Math.sign(this.lastDy))) this.flips.push(now);
        if (ddx) this.lastDx = ddx;
        if (ddy) this.lastDy = ddy;
        this.flips = this.flips.filter((x) => now - x < E.window);
        if (this.flips.length >= E.reversals && moved < 110 && now > this.tickleCool) {
          this.tickle();
          d.ignore = true;
        }
      }
    }
  }

  private onUp(e: PointerEvent) {
    this.pts.delete(e.pointerId);
    if (this.two && !this.two.sim) {
      this.endTwo();
      this.down = null;
      this.ignoreUntilAllUp = this.pts.size > 0;
      return;
    }
    if (this.ignoreUntilAllUp) {
      if (this.pts.size === 0) this.ignoreUntilAllUp = false;
      return;
    }
    const d = this.down;
    if (!d || e.pointerId !== d.id) return;
    this.down = null;
    if (this.longTimer) clearTimeout(this.longTimer);
    const dt = performance.now() - d.t;
    if (this.nuzzling) {
      this.stopNuzzle();
      return;
    }
    if (this.grabbed) {
      this.release();
      return;
    }
    if (d.ignore) return;
    if (!d.moved && dt < TAP_MS) {
      const n = this.ndc(e);
      if (d.onMoon && d.hit) {
        const now = performance.now();
        if (now - this.lastTapAt < DOUBLE_MS) {
          this.lastTapAt = 0;
          this.moon.playAction("lean_in", 1, "manual");
          this.moon.flashExpr("surprised", 0.5);
        } else {
          this.lastTapAt = now;
          this.poke(d.hit);
        }
      } else {
        this.lookAtScreen(n.x, n.y);
        this.ev.onTapSky?.(n.x, n.y);
      }
    }
  }

  // ---------- 各种手势的反应 ----------

  /** 戳到脸的哪一块（眼 / 嘴 / 腮；没戳到脸 = null） */
  private zoneAt(hit: THREE.Vector3): { zone: FaceZone; side: number } | null {
    const R = this.moon.radius;
    const q = this.tmpQ.copy(this.moon.body.mesh.quaternion).invert();
    const l = hit.clone().sub(this.moon.center).applyQuaternion(q).divideScalar(R);
    if (l.z < 0.25) return null;
    const F = params.face;
    const Z = params.eggs.zonepoke;
    const d = (x: number, y: number) => Math.hypot(l.x - x, l.y - y);
    if (Math.min(d(F.eyeSpacing / 2, F.eyeY), d(-F.eyeSpacing / 2, F.eyeY)) < Z.eyeR) return { zone: "eye", side: Math.sign(l.x) || 1 };
    if (d(0, F.eyeY - F.mouthBelow) < Z.mouthR) return { zone: "mouth", side: 0 };
    if (Math.min(d(F.blushX, F.eyeY - F.blushBelow), d(-F.blushX, F.eyeY - F.blushBelow)) < Z.cheekR) return { zone: "cheek", side: Math.sign(l.x) || 1 };
    return null;
  }

  poke(hit: THREE.Vector3) {
    const wasAsleep = this.asleep;
    if (wasAsleep) this.wake();
    const n = hit.clone().sub(this.moon.center).normalize();
    // 往里压扁（沿命中点法线，偏向屏幕平面，正面戳也看得出来），再往后缩一点
    this.squashAxis.set(n.x, n.y, n.z * 0.5).normalize();
    this.squash.kick(-2.6);
    this.vel.addScaledVector(n, -0.9);
    this.vel.z -= 0.35;
    // 眨一下 + >.<，然后开心；连戳就委屈；戳到眼 / 嘴 / 腮各有反应
    const now = this.t;
    this.pokes = this.pokes.filter((x) => now - x < 1.6);
    this.pokes.push(now);
    const z = params.eggs.zonepoke.enabled ? this.zoneAt(hit) : null;
    if (this.pokes.length >= 3) {
      this.moon.flashExpr("pout", 2.0);
      this.pokes = [];
      setTimeout(() => this.moon.flashExpr("smile", 1.2), 2000);
      this.ev.onPout?.();
    } else if (wasAsleep) {
      /* 醒来的序列自己管表情 */
    } else if (z?.zone === "eye") {
      // 戳到眼睛：那只眼闭上躲一下
      this.moon.flashExpr(z.side > 0 ? "wink" : "winkL", 0.75);
      setTimeout(() => {
        if (!this.moon.flashing) this.moon.flashExpr("happy", 0.8);
      }, 760);
      this.ev.onZone?.("eye");
    } else if (z?.zone === "mouth") {
      // 戳到嘴：o 嘴惊讶，然后噗地笑出来（吐舌）
      this.moon.flashExpr("surprised", 0.3);
      setTimeout(() => this.moon.flashExpr("laugh", 0.9), 300);
      this.ev.onZone?.("mouth");
    } else if (z?.zone === "cheek") {
      // 戳到腮：害羞，腮红更深
      this.moon.flashExpr("shy", 1.1);
      this.moon.blushBoost = 0.6;
      this.ev.onZone?.("cheek");
    } else {
      this.moon.flashExpr("squeeze", 0.45);
      setTimeout(() => {
        if (!this.moon.flashing) this.moon.flashExpr("happy", 0.9);
      }, 460);
    }
    this.ev.onPoke?.(1);
  }

  private startGrab(hit: THREE.Vector3) {
    this.grabbed = true;
    this.grabDepthZ = this.moon.center.z;
    this.grabLocal.copy(hit).sub(this.moon.center);
    this.grabLocal.z = 0;
    this.pointerTarget.copy(this.moon.center);
    this.lastTarget.copy(this.pointerTarget);
    this.stillT = 0;
    this.trusted = false;
    this.flips = [];
    this.history = [{ t: performance.now(), p: this.pointerTarget.clone() }];
    this.moon.flashExpr("surprised", 0.35);
    this.ev.onGrab?.();
  }

  private release() {
    this.grabbed = false;
    this.moon.lookWeight = 0;
    // 松手的速度：看最近 ~80ms 的轨迹
    const h = this.history;
    let v = new THREE.Vector3();
    if (h.length >= 2) {
      const a = h[0];
      const b = h[h.length - 1];
      const dt = Math.max(0.016, (b.t - a.t) / 1000);
      v = b.p.clone().sub(a.p).divideScalar(dt);
    }
    this.fling(v, this.grabLocal);
  }

  /** 甩出去：速度 v（世界单位/秒），grab = 抓的位置（相对球心，决定翻滚）。松手和演示剧本共用。 */
  fling(v: THREE.Vector3, grab: THREE.Vector3 = new THREE.Vector3(0, this.moon.radius * 0.5, 0)) {
    const speed = v.length();
    this.vel.copy(v).clampLength(0, 9);
    // 偏心甩 → 翻滚：ω = r × v / R²（抓的位置越靠边转得越快）
    const R = this.moon.radius;
    const r = grab.clone().setZ(R * 0.6);
    const w = new THREE.Vector3().crossVectors(r, this.vel).divideScalar(R * R);
    this.moon.rot.w.add(w.multiplyScalar(1.4));
    if (speed > 1.2) {
      this.moon.rot.hold = 0.04; // 先放开让它自由转
      this.holdRestoreAt = this.t + 0.9 + Math.min(1.2, speed * 0.12);
      this.moon.flashExpr(speed > 4 ? "laugh" : "happy", 1.2);
    }
    this.ev.onRelease?.(speed);
  }

  private startNuzzle() {
    this.nuzzling = true;
    this.rubT = 0;
    this.rubbedYawn = false;
    this.moon.flashExpr("content", 30);
  }
  private stopNuzzle() {
    this.nuzzling = false;
    this.rubSimUntil = 0;
    this.moon.flashExpr("happy", 0.8);
  }

  /** 挠痒痒的结果：笑到抖（真手势和录片共用） */
  private tickle() {
    const E = params.eggs.tickle;
    this.grabbed = false;
    this.vel.set(0, 0, 0);
    this.flips = [];
    this.tickleCool = this.t + 2;
    this.tickleUntil = this.t + E.laugh;
    this.moon.lookWeight = 0;
    this.moon.flashExpr("laugh", E.laugh);
    this.moon.playAction("shiver", 1, "manual");
    this.moon.blushBoost = 0.5;
    // 笑到一抖一抖：几下小小的压扁；笑完吐舌头 :P
    for (let i = 0; i < 4; i++) this.at(0.12 + i * 0.22, () => this.squash.kick(-1.1));
    if (params.eggs.tongue.enabled) this.at(E.laugh, () => this.moon.flashExpr("tongue", 1.0));
    this.ev.onTickle?.();
  }

  /** 在星空上拖：翻历史 + 留一道星尘；绕着它转够一圈 = 抱抱 */
  private skyDrag(nx: number, ny: number, dyPx: number, d: Down) {
    const E = params.eggs.hug;
    const m = this.cam.project(this.moon.center);
    const ang = Math.atan2(ny - m.y, nx - m.x);
    if (d.lastAng != null) {
      let da = ang - d.lastAng;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      d.wind += da;
    }
    d.lastAng = ang;
    if (E.enabled) {
      const p = this.onPlane(nx, ny, -0.6);
      if (p.distanceTo(this.trailLast) > 0.03) {
        this.trailLast.copy(p);
        this.ev.onSkyTrail?.(p);
        this.ev.onSkyTrail?.(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08, 0)));
      }
    }
    const deg = (Math.abs(d.wind) * 180) / Math.PI;
    // 一旦看出来是在绕圈，就不再当成翻历史
    if (deg < 60) this.ev.onSkyDrag?.(dyPx);
    if (E.enabled && !d.hugged && deg >= E.degrees) {
      d.hugged = true;
      this.hug();
    }
  }

  private hug() {
    const E = params.eggs.hug;
    this.moon.flashExpr("content", 2.6);
    this.moon.blushBoost = 0.7;
    this.moon.glowBoost = E.glow;
    this.moon.playAction("brighten", 0.6, "manual");
    this.moon.blinker.blinkNow(false, true);
    this.ev.onHug?.();
  }

  // ---------- 两根手指：捏 / 拧 ----------

  private startTwo(a: Ptr, b: Ptr) {
    if (this.longTimer) clearTimeout(this.longTimer);
    if (this.grabbed) this.grabbed = false; // 位移留在原地
    if (this.nuzzling) this.stopNuzzle();
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    this.two = { d0: Math.max(20, Math.hypot(dx, dy)), aPrev: Math.atan2(-dy, dx), amount: 0, axis: new THREE.Vector3(dx, -dy, 0).normalize(), twist: 0, sim: null };
    this.moon.rot.hold = 0.15;
    this.holdRestoreAt = 0;
    this.squash.set(0);
    this.ev.onGrab?.();
  }

  private twoMove(a: Ptr, b: Ptr) {
    const two = this.two!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    const ang = Math.atan2(-dy, dx);
    let da = ang - two.aPrev;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    two.aPrev = ang;
    this.applyTwo(1 - d / two.d0, da, dx, -dy);
  }

  /** squeeze = 手指靠近的比例（>0 捏、<0 拉），da = 这一步拧的角度，axis = 两指连线（屏幕坐标，y 向上） */
  private applyTwo(squeeze: number, da: number, ax: number, ay: number) {
    const two = this.two!;
    const P = params.eggs.pinch;
    const T = params.eggs.twist;
    if (Math.hypot(ax, ay) > 1e-3) two.axis.set(ax, ay, 0).normalize();
    two.amount = P.enabled ? clamp(squeeze * P.gain, -P.max, P.max) : 0;
    if (T.enabled && da) {
      two.twist += da * T.gain;
      this.moon.rot.q.premultiply(this.tmpQ.setFromAxisAngle(Y, -da * T.gain));
      this.moon.rot.w.set(0, 0, 0);
    }
    if (Math.abs(two.twist) > (T.shyDeg * Math.PI) / 180) this.moon.flashExpr("shy", 0.4);
    else if (two.amount > 0.08) this.moon.flashExpr("squeeze", 0.3);
    else if (two.amount < -0.08) this.moon.flashExpr("surprised", 0.3);
  }

  private endTwo() {
    const two = this.two;
    if (!two) return;
    this.two = null;
    // 松手：从现在的形变弹回去（过冲）；拧过的转回来
    this.squashAxis.copy(two.axis);
    this.squash.x = -two.amount / params.squash.impact;
    this.squash.v = 0;
    this.holdRestoreAt = this.t + 0.25;
    if (Math.abs(two.amount) > 0.06) {
      this.moon.flashExpr(two.amount > 0 ? "laugh" : "surprised", 0.9);
      this.ev.onRelease?.(Math.abs(two.amount) * params.eggs.pinch.release * 3);
    } else if (Math.abs(two.twist) > 0.3) this.moon.flashExpr("shy", 1.0);
  }

  // ---------- 传感器：睡觉（扣下手机 / 摇篮）、吹气 ----------

  /** 手机扣在桌上（屏幕朝下）= 关灯睡觉；拿起来 = 醒来伸懒腰 */
  setFaceDown(on: boolean) {
    if (!params.eggs.facedown.enabled && on) return;
    if (this.faceDown === on) return;
    this.faceDown = on;
    this.faceDownT = 0;
    if (!on && this.asleep) this.wake();
  }

  private sleep() {
    if (this.asleep) return;
    this.asleep = true;
    this.rockT = 0;
    this.moon.lookWeight = 0;
    this.ev.onSleep?.(true);
  }

  private wake() {
    if (!this.asleep) return;
    this.asleep = false;
    this.ev.onSleep?.(false);
    // 惊讶眨眼 → 哈欠 → 伸懒腰（竖向拉长再晃回来）→ 开心弹一下
    this.moon.flashExpr("surprised", 0.5);
    this.moon.blinker.blinkNow(true);
    this.at(0.5, () => this.moon.flashExpr("sleepy", 1.1));
    this.at(1.6, () => {
      this.squashAxis.set(0, 1, 0);
      this.squash.x = params.eggs.facedown.stretch / params.squash.impact;
      this.squash.v = 0;
      this.moon.flashExpr("content", 0.9);
    });
    this.at(2.4, () => {
      this.moon.flashExpr("happy", 1.6);
      this.moon.playAction("bounce", 0.5, "manual");
      this.ev.onWake?.();
    });
  }

  /** 被吹了一口气：往后飘、打个滚、眯眼 */
  blow(k = 1) {
    const E = params.eggs.blow;
    if (!E.enabled) return;
    if (this.asleep) this.wake();
    const from = this.moon.center.clone().add(new THREE.Vector3(0, -0.2, 1.2));
    this.vel.z -= E.push * k;
    this.vel.y += 0.5 * k;
    this.vel.x += (Math.random() - 0.5) * 0.8 * k;
    this.moon.rot.w.add(new THREE.Vector3((Math.random() - 0.5) * 6 * k, (Math.random() - 0.5) * 8 * k, (Math.random() - 0.5) * 4 * k));
    this.moon.rot.hold = 0.3;
    this.holdRestoreAt = this.t + 0.8;
    this.moon.flashExpr("squeeze", 0.55);
    this.at(0.6, () => this.moon.flashExpr("surprised", 0.7));
    this.ev.onBlow?.(k, from);
    this.at(1.4, () => this.ev.onBlown?.());
  }

  /** 被你刚发的气泡轻轻拽一下（V9-D）：往气泡那边一带，再被「家」拉回来 */
  tug(target: THREE.Vector3) {
    const E = params.eggs.tug;
    if (!E.enabled) return;
    const d = target.clone().sub(this.moon.center);
    d.z = 0;
    if (d.lengthSq() < 1e-4) return;
    d.normalize();
    this.vel.addScaledVector(d, E.pull);
    this.moon.flashExpr("surprised", 0.4);
  }

  /** 看向屏幕上的某一点（点空白处） */
  lookAtScreen(nx: number, ny: number, seconds = 1.4) {
    this.moon.lookTarget = this.onPlane(nx, ny, -3.5, this.moon.lookTarget ?? new THREE.Vector3());
    this.moon.lookWeight = 0.75;
    this.lookUntil = this.t + seconds;
  }

  /** 转圈圈（演示剧本用：转够了会晕） */
  twirl(k = 1) {
    this.moon.rot.w.add(new THREE.Vector3(0.8 * k, 15 * k, 1.5 * k));
    this.moon.rot.hold = 0.04;
    this.holdRestoreAt = this.t + 2.4;
  }

  shake(k: number) {
    if (this.asleep) this.wake();
    const a = Math.random() * Math.PI * 2;
    this.vel.x += Math.cos(a) * 2.5 * k;
    this.vel.y += Math.sin(a) * 2.5 * k;
    this.moon.rot.w.add(new THREE.Vector3((Math.random() - 0.5) * 12 * k, (Math.random() - 0.5) * 18 * k, (Math.random() - 0.5) * 8 * k));
    this.moon.rot.hold = 0.1;
    this.holdRestoreAt = this.t + 1.2;
  }

  // ---------- 录片 / 面板用的模拟（App 时钟，确定性） ----------

  /** 双指捏：to < 1 捏（0.55 = 两指靠近到 55%），to > 1 拉；dur = 捏过去用几秒，hold = 停几秒再松手 */
  simPinch(to = 0.55, dur = 0.45, hold = 0.6, axisDeg = 25) {
    const r = (axisDeg * Math.PI) / 180;
    this.two = { d0: 1, aPrev: 0, amount: 0, axis: new THREE.Vector3(Math.cos(r), Math.sin(r), 0), twist: 0, sim: { t: 0, dur, hold, to, twistDeg: 0, done: 0 } };
    this.moon.rot.hold = 0.15;
    this.squash.set(0);
  }
  /** 两指拧：转 deg 度，用 dur 秒，停 hold 秒再松手 */
  simTwist(deg = 150, dur = 1.0, hold = 0.5) {
    this.two = { d0: 1, aPrev: 0, amount: 0, axis: new THREE.Vector3(1, 0, 0), twist: 0, sim: { t: 0, dur, hold, to: 1, twistDeg: deg, done: 0 } };
    this.moon.rot.hold = 0.15;
    this.squash.set(0);
  }
  simTickle() {
    this.tickle();
  }
  /** 蹭着搓 seconds 秒（搓够 rub.sleepyAfter 会打哈欠） */
  simRub(seconds = 5) {
    this.startNuzzle();
    this.rubSimUntil = this.t + seconds;
    this.at(seconds + 0.1, () => this.stopNuzzle());
  }
  /** 在星空上绕它画一圈（dur 秒） */
  simHug(dur = 1.9) {
    this.hugSim = { t: 0, dur, d: { id: -1, x: 0, y: 0, px: 0, py: 0, t: 0, onMoon: false, hit: null, moved: true, wind: 0, lastAng: null, hugged: false, ignore: false } };
  }
  /** 抓着不动 seconds 秒再松手 */
  simGrabHold(seconds = 3.4) {
    const R = this.moon.radius;
    const c = this.moon.center;
    this.startGrab(new THREE.Vector3(c.x + 0.2 * R, c.y + 0.1 * R, c.z + 0.75 * R));
    this.at(seconds, () => {
      this.history = [];
      this.release();
    });
  }
  /** 轻轻摇 seconds 秒（摇篮） */
  simRock(seconds = 5.5) {
    this.rockSimUntil = this.t + seconds;
  }

  private at(dt: number, fn: () => void) {
    this.timeline.push({ at: this.t + dt, fn });
  }

  get isGrabbed() {
    return this.grabbed;
  }
  get isAsleep() {
    return this.asleep;
  }
  get isBusy() {
    return this.grabbed || this.nuzzling || this.asleep || !!this.two || !!this.hugSim || this.t < this.tickleUntil || this.vel.lengthSq() > 0.04 || this.offset.lengthSq() > 0.01;
  }

  update(dt: number) {
    this.t += dt;
    const R = this.moon.radius;
    const base = this.moon.springPos;
    // 排好的小事
    if (this.timeline.length) {
      const due = this.timeline.filter((x) => x.at <= this.t);
      this.timeline = this.timeline.filter((x) => x.at > this.t);
      for (const x of due) x.fn();
    }
    // 两指模拟：捏 / 拧按时间走，到点松手
    if (this.two?.sim) {
      const s = this.two.sim;
      s.t += dt;
      if (s.t < s.dur) {
        const u = easeInOut(s.t / s.dur);
        const twistRad = (s.twistDeg * Math.PI) / 180;
        const target = twistRad * u;
        this.applyTwo(1 - (1 + (s.to - 1) * u), target - s.done, this.two.axis.x, this.two.axis.y);
        s.done = target;
      } else if (s.t > s.dur + s.hold) this.endTwo();
    }
    // 绕圈模拟：窗平面上绕月亮一圈
    if (this.hugSim) {
      const h = this.hugSim;
      h.t += dt;
      const m = this.cam.project(this.moon.center);
      const cx = m.x * this.cam.halfW;
      const cy = m.y * this.cam.halfH;
      const rho = 0.95 * R * (this.cam.eyeZ / (this.cam.eyeZ - this.moon.center.z)) + 0.35;
      const a = -Math.PI / 2 - Math.PI * 2 * 1.08 * Math.min(1, h.t / h.dur);
      const nx = (cx + rho * Math.cos(a)) / this.cam.halfW;
      const ny = (cy + rho * Math.sin(a)) / this.cam.halfH;
      this.skyDrag(nx, ny, 0, h.d);
      if (h.t >= h.dur + 0.2) this.hugSim = null;
    }
    // 搓：腮红、光，搓久了困
    const rubbing = this.nuzzling && (this.t - this.rubAt < 0.25 || this.t < this.rubSimUntil);
    if (rubbing) {
      const E = params.eggs.rub;
      this.rubT += dt;
      this.moon.blushBoost = Math.max(this.moon.blushBoost, E.blush);
      this.moon.glowBoost = Math.max(this.moon.glowBoost, E.glow);
      if (this.rubT > E.sleepyAfter && !this.rubbedYawn) {
        this.rubbedYawn = true;
        this.moon.flashExpr("sleepy", 2.0);
      }
    }
    // 抓着不动：看手指 → 看你 + 慢眨
    if (this.grabbed && params.eggs.hold.enabled) {
      const E = params.eggs.hold;
      if (this.pointerTarget.distanceTo(this.lastTarget) > 0.004) {
        this.stillT = 0;
        this.lastTarget.copy(this.pointerTarget);
        if (!this.trusted) this.moon.lookWeight = 0;
      } else this.stillT += dt;
      if (this.stillT > E.lookFinger && this.stillT < E.trust) {
        this.moon.lookTarget = this.pointerTarget.clone().add(this.grabLocal).add(new THREE.Vector3(0, 0, 0.9));
        this.moon.lookWeight = 0.6;
      } else if (this.stillT >= E.trust && !this.trusted) {
        this.trusted = true;
        this.moon.lookWeight = 0;
        this.moon.flashExpr("content", 4);
        this.moon.blinker.blinkNow(false, true);
        this.moon.blushBoost = 0.3;
        this.ev.onTrust?.();
      }
    }
    // 扣着 / 摇篮 → 睡着；睡着时光暗一点、脸一直是睡着的
    if (this.faceDown) {
      this.faceDownT += dt;
      if (!this.asleep && this.faceDownT > params.eggs.facedown.after) this.sleep();
    }
    const gentle = this.t - this.rockHit < 0.6 || this.t < this.rockSimUntil;
    this.rockEnergy = approach(this.rockEnergy, gentle ? 1 : 0, gentle ? 0.4 : 1.2, dt);
    if (this.rockEnergy > 0.5 && !this.asleep && params.eggs.rock.enabled) {
      const E = params.eggs.rock;
      this.rockT += dt;
      if (this.rockT > E.sleepyAfter) this.moon.flashExpr("sleepy", 0.4);
      if (this.rockT > E.sleepAfter) this.sleep();
    } else if (this.rockEnergy < 0.2) this.rockT = 0;
    if (this.asleep) {
      this.moon.glowBoost = -0.35;
      if (!this.moon.flashing) this.moon.flashExpr("sleeping", 0.5);
    }

    if (this.grabbed) {
      // 抓着：位移追手指（很硬的弹簧，稍微有点拖曳感）
      const target = this.pointerTarget.clone().sub(base);
      const k = 1 - Math.exp(-dt * 16);
      const prev = this.offset.clone();
      this.offset.lerp(target, k);
      this.vel.copy(this.offset).sub(prev).divideScalar(Math.max(dt, 1e-4));
    } else if (this.nuzzling) {
      // 蹭：往玻璃这边贴近，轻轻左右蹭（搓的时候蹭得更欢）
      const amp = rubbing ? 0.06 : 0.03;
      const target = new THREE.Vector3(Math.sin(this.t * 7) * amp, -0.05, 0.55);
      this.offset.lerp(target, 1 - Math.exp(-dt * 5));
      this.vel.set(0, 0, 0);
    } else {
      // 零重力：一点点阻尼 + 很弱地想回家
      const w = 1.6;
      this.vel.addScaledVector(this.offset, -w * w * dt);
      this.vel.multiplyScalar(Math.exp(-dt * 1.1));
      this.offset.addScaledVector(this.vel, dt);
      this.collide(base, R);
    }
    // 压扁（撞墙 / 戳 / 捏）
    const sq = this.squash.step(dt);
    // 弹簧往负方向踢 = 压扁；阻尼小，所以会压扁 → 拉长 → 回弹，像有弹性的糯米团
    if (this.two) {
      this.moon.extra.squash = this.two.amount;
      this.moon.extra.squashAxis.copy(this.two.axis);
    } else {
      this.moon.extra.squash = -sq * params.squash.impact;
      this.moon.extra.squashAxis.copy(this.squashAxis);
    }
    this.moon.extra.pos.copy(this.offset);
    // 翻滚之后自己转回来看你；转过的圈数够多 → 停稳后抖落星尘（V9-C）
    if (this.holdRestoreAt && this.t > this.holdRestoreAt) {
      this.moon.rot.hold = Math.min(1, this.moon.rot.hold + dt * 1.6);
      if (this.moon.rot.hold >= 1) {
        this.holdRestoreAt = 0;
        this.at(0.5, () => this.ev.onSettled?.(this.spinAcc));
      }
    }
    // 转太多圈 → 晕
    const wl = this.moon.rot.w.length();
    this.spinWindow.push({ t: this.t, a: wl * dt });
    while (this.spinWindow.length && this.t - this.spinWindow[0].t > 2) this.spinWindow.shift();
    this.spinAcc = this.spinWindow.reduce((s, x) => s + x.a, 0);
    if (this.spinAcc > Math.PI * 3.2 && this.t > this.dizzyUntil) this.dizzyPending = true;
    // 晕要等它慢下来、脸转回来再晕（转的时候脸在背面，晕了也看不见）
    if (this.dizzyPending && wl < 2.5) {
      this.dizzyPending = false;
      this.dizzyUntil = this.t + 3.5;
      this.moon.flashExpr("dizzy", 2.6);
      this.ev.onDizzy?.();
    }
    if (this.lookUntil && this.t > this.lookUntil) {
      this.lookUntil = 0;
      this.moon.lookWeight = 0;
    }
  }

  /** 盒子的侧壁 = 屏幕四边从眼睛延伸进去的视锥面；近处是玻璃。撞上去：反弹 + 沿法线压扁 */
  private collide(base: THREE.Vector3, R: number) {
    const p = base.clone().add(this.offset);
    const depth = -p.z;
    const ext = this.cam.extentAt(Math.max(0.2, depth));
    const restitution = 0.72;
    const hit = (axis: "x" | "y", sign: number, limit: number) => {
      const speed = Math.abs(this.vel[axis]);
      this.offset[axis] = limit - base[axis];
      this.vel[axis] = -sign * speed * restitution;
      if (speed > 0.25) {
        this.squashAxis.set(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, 0);
        this.squash.kick(-clamp(speed * 1.1, 0, 5));
        this.moon.flashExpr(speed > 3 ? "squeeze" : "surprised", 0.35);
        this.ev.onBounce?.(speed);
      }
    };
    const bottomLimit = -ext.h + R * 1.0;
    if (p.x > ext.w - R && this.vel.x > 0) hit("x", 1, ext.w - R);
    if (p.x < -ext.w + R && this.vel.x < 0) hit("x", -1, -ext.w + R);
    if (p.y > ext.h - R && this.vel.y > 0) hit("y", 1, ext.h - R);
    if (p.y < bottomLimit && this.vel.y < 0) hit("y", -1, bottomLimit);
    // 玻璃：不许穿过来（特写动作除外，它走动作通道）
    const nearZ = -R * 0.9;
    if (p.z > nearZ && this.vel.z > 0) {
      this.offset.z = nearZ - base.z;
      const speed = this.vel.z;
      this.vel.z = -speed * 0.5;
      if (speed > 0.4) {
        this.squashAxis.set(0, 0, 1);
        this.squash.kick(-clamp(speed, 0, 4));
        this.moon.flashExpr("squeeze", 0.4);
        this.ev.onBounce?.(speed);
      }
    }
    // 最远飞到这么深，再远就软软地拉回来
    const far = -9;
    if (p.z < far) this.vel.z += (far - p.z) * 3 * 0.016;
  }
}
