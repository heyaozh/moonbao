// 小动作（V9-C）：伸懒腰、抖落星尘、打喷嚏、摇头、耸肩、摇摆、鼓脸放气、吹口哨、发呆、共同注意。
// 都不是新的动作原语（LLM 不选它们）：由手势、小日子和彩蛋触发，走 MoonRenderer.gesture 通道叠在「看你」的姿态上，
// 时间线用 App 时钟（录片可复现）。想让 LLM 也能选的，再提案加进 ACTIONS。

import * as THREE from "three";
import { approach } from "./math";
import { params } from "./params";
import type { MoonRenderer } from "./renderer";

const easeInOutQ = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutQ = (t: number) => 1 - Math.pow(1 - Math.min(1, t), 3);
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = Math.min(1, t);
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
};

export interface GestureHooks {
  dust?: (p: THREE.Vector3, v?: THREE.Vector3, life?: number) => void;
  /** 一阵尘：从 from 往 dir 方向 */
  gust?: (from: THREE.Vector3, k: number, dir?: THREE.Vector3) => void;
  note?: () => void;
  sound?: { sneeze?: () => void; pfft?: () => void; shake?: () => void; stretch?: () => void };
}

interface Anim {
  t0: number;
  dur: number;
  fn: (t: number, dt: number) => void;
  end?: () => void;
}

export class Gestures {
  private t = 0;
  private tl: { at: number; fn: () => void }[] = [];
  private anims: Anim[] = [];
  private noteClock = 0;
  private noteEvery = 0;
  private noteUntil = 0;
  private lazyOn = false;
  private tilting = false;
  private hiding: { side: number; edgeX: number } | null = null;

  constructor(
    private moon: MoonRenderer,
    private hooks: GestureHooks = {}
  ) {}

  private at(dt: number, fn: () => void) {
    this.tl.push({ at: this.t + dt, fn });
  }
  private anim(dur: number, fn: (t: number, dt: number) => void, end?: () => void) {
    this.anims.push({ t0: this.t, dur, fn, end });
  }
  private get g() {
    return this.moon.gesture;
  }

  /** 伸懒腰：闭眼张嘴、竖向拉长再晃回来、往上抬一点 */
  stretch() {
    const E = params.eggs.stretch;
    this.moon.flashExpr("yawn", 1.1);
    this.moon.kickStretch(E.amount);
    this.anim(1.2, (t) => (this.g.dy = 0.06 * Math.sin((Math.PI * t) / 1.2)), () => (this.g.dy = 0));
    this.at(1.1, () => this.moon.flashExpr("content", 1.0));
    this.hooks.sound?.stretch?.();
  }

  /** 抖落星尘：像狗甩水，左右快速摆头，甩出几粒光 */
  shakeOff() {
    this.moon.flashExpr("squeeze", 0.55);
    this.anim(0.65, (t) => (this.g.yaw = 0.38 * Math.sin(Math.PI * 2 * 9 * t) * (1 - t / 0.65)), () => (this.g.yaw = 0));
    for (const d of [0.05, 0.2, 0.36]) {
      this.at(d, () => {
        const c = this.moon.center;
        const R = this.moon.radius;
        for (let i = 0; i < 7; i++) {
          const a = Math.random() * Math.PI * 2;
          const p = new THREE.Vector3(c.x + Math.cos(a) * R * 0.9, c.y + Math.sin(a) * R * 0.9, c.z + R * 0.6);
          this.hooks.dust?.(p, new THREE.Vector3(Math.cos(a) * 1.4, Math.sin(a) * 1.4 + 0.3, 0.2));
        }
      });
    }
    this.at(0.7, () => this.moon.flashExpr("happy", 0.9));
    this.hooks.sound?.shake?.();
  }

  /** 打喷嚏：后仰蓄力、眼睛慢慢眯上 → 猛地往前一缩 + 一团月尘 + 光闪 → 呆住眨眼 */
  sneeze() {
    this.moon.flashExpr("presneeze", 0.8);
    this.anim(0.75, (t) => {
      const u = t / 0.75;
      this.g.dz = -0.12 * u;
      this.g.pitch = -0.14 * u;
    });
    this.at(0.75, () => {
      this.moon.flashExpr("squeeze", 0.35);
      this.moon.kickStretch(-2.6);
      this.moon.glowBoost = 0.35;
      this.anim(0.35, (t) => {
        const u = t / 0.35;
        this.g.dz = 0.24 * (1 - u);
        this.g.pitch = 0.22 * (1 - u);
      }, () => {
        this.g.dz = 0;
        this.g.pitch = 0;
      });
      const c = this.moon.center;
      this.hooks.gust?.(c.clone().add(new THREE.Vector3(0, -0.2, this.moon.radius * 0.9)), 0.9, new THREE.Vector3(0, -0.2, 1));
      this.hooks.sound?.sneeze?.();
    });
    this.at(1.05, () => {
      this.moon.glowBoost = -0.12;
      this.moon.flashExpr("surprised", 0.5);
      this.moon.blinker.blinkNow(true);
    });
    this.at(1.6, () => this.moon.flashExpr("content", 0.9));
  }

  /** 摇头：「这个我不懂诶」「我是小满呀」 */
  headShake() {
    const a = (params.eggs.headshake.deg * Math.PI) / 180;
    this.anim(0.95, (t) => (this.g.yaw = a * Math.sin((Math.PI * 2 * t) / 0.45) * Math.min(1, (0.95 - t) * 4)), () => (this.g.yaw = 0));
  }

  /** 耸肩：快速上抬 + 闭眼 + 波浪嘴 = 不知道 */
  shrug() {
    const r = params.eggs.shrug.rise;
    this.moon.flashExpr("shrug", 0.95);
    this.anim(0.55, (t) => (this.g.dy = r * Math.sin((Math.PI * t) / 0.55)), () => (this.g.dy = 0));
  }

  /** 摇摆：按节拍左右摇、上下点，边摇边冒 ♪ */
  sway(seconds = 4) {
    const a = (params.eggs.sway.rollDeg * Math.PI) / 180;
    this.moon.flashExpr("content", seconds);
    this.anim(seconds, (t) => {
      const env = Math.min(1, t * 2, (seconds - t) * 2);
      this.g.roll = a * Math.sin(Math.PI * 2 * 1.4 * t) * env;
      this.g.dy = 0.03 * Math.abs(Math.sin(Math.PI * 2 * 1.4 * t)) * env;
    }, () => {
      this.g.roll = 0;
      this.g.dy = 0;
    });
    this.notes(seconds, 0.72);
  }

  /** 鼓脸：整体胀大，hold 秒后「噗」地放气 */
  puff(hold = params.eggs.puff.hold) {
    this.moon.flashExpr("pout", hold + 0.3);
    this.anim(0.3, (t) => (this.moon.puff = Math.min(1, t / 0.3)));
    this.at(hold, () => {
      this.anim(0.3, (t) => (this.moon.puff = Math.max(0, 1 - t / 0.3)), () => (this.moon.puff = 0));
      this.moon.kickStretch(-1.4);
      const c = this.moon.center;
      this.hooks.gust?.(c.clone().add(new THREE.Vector3(0, -0.1, this.moon.radius)), 0.4, new THREE.Vector3(0, -0.3, 1));
      this.hooks.sound?.pfft?.();
      this.moon.flashExpr("surprised", 0.3);
      this.at(0.35, () => this.moon.flashExpr("smile", 1.0));
    });
  }

  /** 吹口哨：o 嘴、视线飘开、轻轻晃，冒 ♪（偷懒被抓到装没事） */
  whistle(seconds = 3) {
    this.moon.flashExpr("whistle", seconds);
    this.anim(seconds, (t) => {
      this.g.dy = 0.025 * Math.sin(Math.PI * 2 * 1.5 * t);
      this.g.yaw = 0.1 * Math.sin(Math.PI * 2 * 0.5 * t);
    }, () => {
      this.g.dy = 0;
      this.g.yaw = 0;
    });
    this.notes(seconds, 0.6);
  }

  /** 发呆 - -：停几秒，然后双眨回神 */
  blankStare(seconds = 3) {
    this.moon.flashExpr("blank", seconds);
    this.at(seconds, () => {
      this.moon.blinker.blinkNow(true);
      this.moon.flashExpr("surprised", 0.3);
      this.at(0.35, () => this.moon.flashExpr("smile", 0.9));
    });
  }

  /** 共同注意：看 target → 回头看你一眼（「你看！」）→ 再看 target */
  attend(target: THREE.Vector3 | (() => THREE.Vector3), total = 3) {
    const E = params.eggs.attend;
    const tgt = () => (typeof target === "function" ? target() : target);
    this.anim(total, (t) => {
      const back = t > E.lookBackAt && t < E.lookBackAt + E.lookBackFor;
      this.moon.lookTarget = tgt();
      this.moon.lookWeight = back ? 0 : 0.85;
    }, () => (this.moon.lookWeight = 0));
    this.at(E.lookBackAt, () => this.moon.flashExpr("happy", E.lookBackFor + 0.2));
  }

  dilate() {
    this.moon.flashExpr("dilate", 0.6);
  }

  // ── V9-D ──

  /** 偷懒：沉到屏幕底、光暗一点、眼睛 - -；关掉就飘回来 */
  lazy(on: boolean) {
    this.lazyOn = on;
    if (on) this.moon.flashExpr("blank", 0.6);
  }

  /** 翻身睡：慢慢转过去背对你，停一会儿，再转回来 */
  rollOver(hold = 3) {
    const turn = 2.5;
    this.anim(turn, (t) => (this.g.yaw = 2.8 * easeInOutQ(t / turn)));
    this.at(turn + hold, () => this.anim(turn, (t) => (this.g.yaw = 2.8 * (1 - easeInOutQ(t / turn))), () => (this.g.yaw = 0)));
  }

  /** 小仪式：转一圈看看自己亮的那一面，亮起来，最后星星眼看你 */
  ritual() {
    const dur = 3.4;
    this.moon.flashExpr("content", dur);
    this.moon.glowBoost = 0.4;
    this.anim(dur, (t) => (this.g.yaw = Math.PI * 2 * easeInOutQ(t / dur)), () => (this.g.yaw = 0));
    this.at(dur, () => {
      this.moon.flashExpr("starry", 1.4);
      this.moon.glowBoost = 0.3;
    });
  }

  /** 久别归来：睡着且身上落了星尘 → 醒 → 惊讶 → 抖落星尘 → 冲到玻璃前特写 → 慢眨 */
  longReturn() {
    this.moon.flashExpr("sleeping", 1.7);
    const c = this.moon.center;
    const R = this.moon.radius;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.8;
      const p = new THREE.Vector3(c.x + Math.cos(a) * R * r, c.y + Math.sin(a) * R * r, c.z + R * 0.98);
      this.hooks.dust?.(p, new THREE.Vector3(0, 0, 0), 2.4);
    }
    this.at(1.7, () => {
      this.moon.flashExpr("surprised", 0.6);
      this.moon.blinker.blinkNow(true);
    });
    this.at(2.3, () => this.shakeOff());
    this.at(3.2, () => this.moon.playAction("lean_in", 1, "manual"));
    this.at(5.8, () => {
      this.moon.flashExpr("content", 1.6);
      this.moon.blinker.blinkNow(false, true);
    });
  }

  /** 问完歪着头等你打字 */
  tiltWait() {
    this.tilting = true;
  }
  tiltRelease() {
    this.tilting = false;
  }

  /** 躲猫猫：躲到 side 那边的屏幕外（edgeX = 月亮深度处的屏幕半宽），只在玩的时候 */
  hide(side: number, edgeX: number) {
    this.hiding = { side, edgeX };
    const R = this.moon.radius;
    const to = side * (edgeX + R * 0.75);
    this.moon.flashExpr("surprised", 0.5);
    this.anim(0.6, (t) => (this.g.dx = to * easeOutQ(t / 0.6)));
  }
  /** 没人找：探半个身子出来偷看 */
  peek() {
    if (!this.hiding) return;
    const h = this.hiding;
    const R = this.moon.radius;
    const from = this.g.dx;
    const to = h.side * (h.edgeX - R * 0.45);
    this.moon.flashExpr("pout", 1.4);
    this.anim(0.5, (t) => (this.g.dx = from + (to - from) * easeOutQ(t / 0.5)));
  }
  /** 回来：被找到就笑着弹出来；没人找就自己回来 */
  unhide(found: boolean) {
    if (!this.hiding) return;
    this.hiding = null;
    const from = this.g.dx;
    this.anim(0.55, (t) => (this.g.dx = from * (1 - easeOutBack(t / 0.55))), () => (this.g.dx = 0));
    if (found) {
      this.moon.flashExpr("laugh", 1.4);
      this.at(0.3, () => this.moon.playAction("bounce", 0.7, "manual"));
    } else this.moon.flashExpr("smile", 1.0);
  }
  get isHiding() {
    return !!this.hiding;
  }

  /** 数星星：视线一颗一颗跳 + 小点头，数到最后数乱了 → 发呆 */
  countStars(points: THREE.Vector3[], every = 0.8) {
    points.forEach((p, i) =>
      this.at(i * every, () => {
        this.moon.lookTarget = p;
        this.moon.lookWeight = 0.8;
        this.anim(0.28, (t) => (this.g.pitch = 0.1 * Math.sin((Math.PI * t) / 0.28)), () => (this.g.pitch = 0));
      })
    );
    this.at(points.length * every, () => {
      this.moon.lookWeight = 0;
      this.blankStare(1.4);
    });
  }

  /** 看云：视线从左上慢慢扫到右上，看完打个哈欠 */
  cloudWatch(dur = 5) {
    this.moon.flashExpr("content", dur);
    const tgt = new THREE.Vector3();
    this.anim(dur, (t) => {
      const u = t / dur;
      this.moon.lookTarget = tgt.set(-2.2 + 4.4 * u, 2.4, -4);
      this.moon.lookWeight = 0.7;
    }, () => (this.moon.lookWeight = 0));
    this.at(dur - 0.2, () => this.moon.flashExpr("sleepy", 1.3));
  }

  /** 往某处撞一下（追光斑） */
  bump(target: THREE.Vector3) {
    const dir = target.clone().sub(this.moon.center);
    const dx = Math.sign(dir.x || 1) * 0.14;
    this.moon.flashExpr("surprised", 0.3);
    this.anim(0.4, (t) => {
      const s = Math.sin((Math.PI * t) / 0.4);
      this.g.dz = 0.2 * s;
      this.g.dx = dx * s;
    }, () => {
      this.g.dz = 0;
      this.g.dx = 0;
    });
    this.at(0.4, () => this.moon.flashExpr("happy", 1.0));
  }

  private notes(seconds: number, every: number) {
    this.noteUntil = this.t + seconds;
    this.noteEvery = every;
    this.noteClock = 0.15;
  }

  update(dt: number) {
    this.t += dt;
    // 偷懒 / 歪头等：持续状态，慢慢过去、慢慢回来
    const L = params.eggs.lazy;
    if (this.lazyOn) {
      this.g.dy = approach(this.g.dy, -L.sink, 1.4, dt);
      this.moon.glowBoost = -L.dim;
      if (!this.moon.flashing) this.moon.flashExpr("blank", 0.5);
    } else if (!this.anims.length && this.g.dy < -0.01) this.g.dy = approach(this.g.dy, 0, 0.6, dt);
    if (this.tilting) this.g.roll = approach(this.g.roll, 0.22, 0.5, dt);
    else if (!this.anims.length && Math.abs(this.g.roll) > 0.001 && this.g.roll > 0.2) this.g.roll = approach(this.g.roll, 0, 0.5, dt);
    if (this.tl.length) {
      const due = this.tl.filter((x) => x.at <= this.t);
      this.tl = this.tl.filter((x) => x.at > this.t);
      for (const x of due) x.fn();
    }
    for (const a of this.anims) {
      const t = this.t - a.t0;
      if (t <= a.dur) a.fn(t, dt);
    }
    const done = this.anims.filter((a) => this.t - a.t0 > a.dur);
    this.anims = this.anims.filter((a) => this.t - a.t0 <= a.dur);
    for (const a of done) a.end?.();
    if (this.t < this.noteUntil) {
      this.noteClock -= dt;
      if (this.noteClock <= 0) {
        this.hooks.note?.();
        this.noteClock = this.noteEvery;
      }
    }
  }
}
