// 不聊天也好玩：直接操作月亮（2026-09-26 用户第 3 点）。
// 没人碰它时是零重力；你可以戳它、抓着它走、把它甩出去——屏幕四边是盒子的侧壁，撞上去整体压扁再弹回；
// 往深处甩没有墙，它会慢慢减速，再自己飘回来。偏心甩会让它翻滚，转太多圈就晕。
//   点 = 戳（>.< + 压扁 + 往后缩）· 连戳 3 下 = 鼓脸委屈，两秒后原谅
//   拖 = 抓着走 · 甩 = 飞出去 + 翻滚 · 长按 = 贴过来蹭你 · 双击 = 特写 · 点空白处 = 看过去 · 摇手机 = 被晃晕

import * as THREE from "three";
import type { WindowCamera } from "../world/camera";
import { Spring, clamp } from "./math";
import { params } from "./params";
import type { MoonRenderer } from "./renderer";

export interface InteractEvents {
  onPoke?: (strength: number) => void;
  onBounce?: (speed: number) => void;
  onGrab?: () => void;
  onRelease?: (speed: number) => void;
  onDizzy?: () => void;
  onTapSky?: (nx: number, ny: number) => void;
}

const TAP_MS = 260;
const TAP_MOVE_PX = 10;
const LONG_MS = 480;
const DOUBLE_MS = 320;

export class MoonInteraction {
  /** 手势 / 物理的位移（相对「家」）与速度（世界单位 / 秒） */
  readonly offset = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  private grabbed = false;
  private grabDepthZ = 0;
  private grabLocal = new THREE.Vector3();
  private pointerTarget = new THREE.Vector3();
  private history: { t: number; p: THREE.Vector3 }[] = [];
  private down: { id: number; x: number; y: number; t: number; onMoon: boolean; hit: THREE.Vector3 | null; moved: boolean } | null = null;
  private longTimer: ReturnType<typeof setTimeout> | null = null;
  private nuzzling = false;
  private lastTapAt = 0;
  private pokes: number[] = [];
  private squash = new Spring(0, 16, 0.32);
  private squashAxis = new THREE.Vector3(1, 0, 0);
  private spinAcc = 0;
  private spinWindow: { t: number; a: number }[] = [];
  private dizzyUntil = 0;
  private holdRestoreAt = 0;
  private lookUntil = 0;
  private t = 0;
  private ray = new THREE.Ray();
  private sphere = new THREE.Sphere();
  enabled = true;

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
    // 摇手机
    let lastA: number | null = null;
    addEventListener("devicemotion", (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const m = Math.hypot(a.x, a.y, a.z);
      if (lastA != null && Math.abs(m - lastA) > 14) this.shake(Math.min(1, Math.abs(m - lastA) / 30));
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
    if (!this.enabled || this.down) return;
    const n = this.ndc(e);
    const hit = this.hitMoon(n.x, n.y);
    this.down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), onMoon: !!hit, hit, moved: false };
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
    const d = this.down;
    if (!d || e.pointerId !== d.id) return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (!d.moved && moved > TAP_MOVE_PX) {
      d.moved = true;
      if (this.longTimer) clearTimeout(this.longTimer);
      if (d.onMoon && !this.nuzzling) this.startGrab(d.hit!);
    }
    if (this.grabbed) {
      const n = this.ndc(e);
      const p = this.onPlane(n.x, n.y, this.grabDepthZ);
      this.pointerTarget.copy(p).sub(this.grabLocal);
      this.history.push({ t: performance.now(), p: this.pointerTarget.clone() });
      while (this.history.length > 8) this.history.shift();
    }
  }

  private onUp(e: PointerEvent) {
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

  poke(hit: THREE.Vector3) {
    const n = hit.clone().sub(this.moon.center).normalize();
    // 往里压扁（沿命中点法线，偏向屏幕平面，正面戳也看得出来），再往后缩一点
    this.squashAxis.set(n.x, n.y, n.z * 0.5).normalize();
    this.squash.kick(-2.6);
    this.vel.addScaledVector(n, -0.9);
    this.vel.z -= 0.35;
    // 眨一下 + >.<，然后开心；连戳就委屈
    const now = this.t;
    this.pokes = this.pokes.filter((x) => now - x < 1.6);
    this.pokes.push(now);
    if (this.pokes.length >= 3) {
      this.moon.flashExpr("pout", 2.0);
      this.pokes = [];
      setTimeout(() => this.moon.flashExpr("smile", 1.2), 2000);
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
    this.history = [{ t: performance.now(), p: this.pointerTarget.clone() }];
    this.moon.flashExpr("surprised", 0.35);
    this.ev.onGrab?.();
  }

  private release() {
    this.grabbed = false;
    // 松手的速度：看最近 ~80ms 的轨迹
    const h = this.history;
    let v = new THREE.Vector3();
    if (h.length >= 2) {
      const a = h[0];
      const b = h[h.length - 1];
      const dt = Math.max(0.016, (b.t - a.t) / 1000);
      v = b.p.clone().sub(a.p).divideScalar(dt);
    }
    const speed = v.length();
    this.vel.copy(v.clampLength(0, 9));
    // 偏心甩 → 翻滚：ω = r × v / R²（抓的位置越靠边转得越快）
    const R = this.moon.radius;
    const r = this.grabLocal.clone().setZ(R * 0.6);
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
    this.moon.flashExpr("content", 30);
  }
  private stopNuzzle() {
    this.nuzzling = false;
    this.moon.flashExpr("happy", 0.8);
  }

  /** 看向屏幕上的某一点（点空白处） */
  lookAtScreen(nx: number, ny: number, seconds = 1.4) {
    this.moon.lookTarget = this.onPlane(nx, ny, -3.5, this.moon.lookTarget ?? new THREE.Vector3());
    this.moon.lookWeight = 0.75;
    this.lookUntil = this.t + seconds;
  }

  shake(k: number) {
    const a = Math.random() * Math.PI * 2;
    this.vel.x += Math.cos(a) * 2.5 * k;
    this.vel.y += Math.sin(a) * 2.5 * k;
    this.moon.rot.w.add(new THREE.Vector3((Math.random() - 0.5) * 12 * k, (Math.random() - 0.5) * 18 * k, (Math.random() - 0.5) * 8 * k));
    this.moon.rot.hold = 0.1;
    this.holdRestoreAt = this.t + 1.2;
  }

  get isGrabbed() {
    return this.grabbed;
  }
  get isBusy() {
    return this.grabbed || this.nuzzling || this.vel.lengthSq() > 0.04 || this.offset.lengthSq() > 0.01;
  }

  update(dt: number) {
    this.t += dt;
    const R = this.moon.radius;
    const base = this.moon.springPos;
    if (this.grabbed) {
      // 抓着：位移追手指（很硬的弹簧，稍微有点拖曳感）
      const target = this.pointerTarget.clone().sub(base);
      const k = 1 - Math.exp(-dt * 16);
      const prev = this.offset.clone();
      this.offset.lerp(target, k);
      this.vel.copy(this.offset).sub(prev).divideScalar(Math.max(dt, 1e-4));
    } else if (this.nuzzling) {
      // 蹭：往玻璃这边贴近，轻轻左右蹭
      const target = new THREE.Vector3(Math.sin(this.t * 7) * 0.03, -0.05, 0.55);
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
    // 压扁（撞墙 / 戳）
    const sq = this.squash.step(dt);
    // 弹簧往负方向踢 = 压扁；阻尼小，所以会压扁 → 拉长 → 回弹，像有弹性的糯米团
    this.moon.extra.squash = -sq * params.squash.impact;
    this.moon.extra.squashAxis.copy(this.squashAxis);
    this.moon.extra.pos.copy(this.offset);
    // 翻滚之后自己转回来看你
    if (this.holdRestoreAt && this.t > this.holdRestoreAt) {
      this.moon.rot.hold = Math.min(1, this.moon.rot.hold + dt * 1.6);
      if (this.moon.rot.hold >= 1) this.holdRestoreAt = 0;
    }
    // 转太多圈 → 晕
    const wl = this.moon.rot.w.length();
    this.spinWindow.push({ t: this.t, a: wl * dt });
    while (this.spinWindow.length && this.t - this.spinWindow[0].t > 2) this.spinWindow.shift();
    this.spinAcc = this.spinWindow.reduce((s, x) => s + x.a, 0);
    if (this.spinAcc > Math.PI * 3.2 && this.t > this.dizzyUntil) {
      this.dizzyUntil = this.t + 3.5;
      this.moon.flashExpr("dizzy", 2.4);
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
