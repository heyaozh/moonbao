// 小日子：没人理它的时候，它也在过自己的日子（按权重随机、带冷却）。
//   看流星划过并转头追 · 打哈欠 · 闭眼哼歌 · 夜里打瞌睡 · 和一颗小星星玩 · 东张西望
// 还有「开场五秒」：你打开时它正在做自己的事，发现你，转过来笑。
// 这些都只是「表情 + 视线 + 小动作」的组合，不需要新的动画资产。

import * as THREE from "three";
import type { WindowCamera } from "../world/camera";
import type { World } from "../world/world";
import type { MoonInteraction } from "./interact";
import { clamp } from "./math";
import { params } from "./params";
import type { MoonRenderer } from "./renderer";

/** 小日子要用到的外部效果（主入口接：符号、小动作） */
export interface LifeHooks {
  zzz?: (on: boolean) => void;
  note?: () => void;
  bang?: () => void;
  dilate?: () => void;
  sneeze?: () => void;
  stretch?: () => void;
  blank?: (seconds: number) => void;
  sway?: (seconds: number) => void;
  // ── V9-D ──
  lazy?: (on: boolean) => void;
  whistle?: (seconds: number) => void;
  rollOver?: (hold: number) => void;
  count?: (points: THREE.Vector3[]) => void;
  hide?: (side: number, edgeX: number) => void;
  peek?: () => void;
  unhide?: (found: boolean) => void;
  cloud?: (seconds: number) => void;
  doodle?: () => void;
  bump?: (target: THREE.Vector3) => void;
  burst?: (p: THREE.Vector3) => void;
}

type Kind = "glance" | "meteor" | "yawn" | "hum" | "star" | "doze" | "sneeze" | "space" | "stretch" | "lazy" | "chase" | "count" | "hide" | "cloud" | "doodle";

const WEIGHTS: Record<Kind, number> = { glance: 3, meteor: 2, yawn: 1, hum: 1.2, star: 1.4, doze: 0.6, sneeze: 0.25, space: 1.0, stretch: 0.5, lazy: 0.4, chase: 1.0, count: 0.9, hide: 0.5, cloud: 1.5, doodle: 0.3 };
const DUR: Record<Kind, [number, number]> = { glance: [1.2, 2.2], meteor: [1.6, 1.6], yawn: [2.2, 2.2], hum: [3, 4.5], star: [5, 6.5], doze: [8, 14], sneeze: [2.4, 2.4], space: [2.5, 4.5], stretch: [2.2, 2.2], lazy: [20, 40], chase: [4.6, 4.6], count: [6, 6], hide: [14, 14], cloud: [6, 6], doodle: [5, 5] };

/** 陪它玩的小星星：暖金色的一粒光，绕着月亮飞。 */
class CompanionStar {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  pos = new THREE.Vector3();
  alpha = 0;
  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0 }, uPx: { value: 1 }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          uniform float uPx, uTime;
          void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = (18.0 + 4.0 * sin(uTime * 9.0)) * uPx; }
        `,
        fragmentShader: /* glsl */ `
          uniform float uAlpha;
          void main() {
            vec2 p = gl_PointCoord - 0.5;
            float r = length(p) * 2.0;
            float core = exp(-r * r * 22.0) * 3.0;
            float glow = exp(-r * r * 4.0) * 0.5;
            float spikes = (exp(-abs(p.x) * 60.0) + exp(-abs(p.y) * 60.0)) * exp(-r * r * 3.0) * 0.9;
            gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * (core + glow + spikes) * uAlpha, 1.0);
          }
        `,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      })
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  update(t: number, pr: number) {
    (this.points.geometry.getAttribute("position") as THREE.BufferAttribute).setXYZ(0, this.pos.x, this.pos.y, this.pos.z);
    this.points.geometry.getAttribute("position").needsUpdate = true;
    const u = this.points.material.uniforms;
    u.uAlpha.value = this.alpha;
    u.uPx.value = pr;
    u.uTime.value = t;
    this.points.visible = this.alpha > 0.01;
  }
}

export class Behaviors {
  readonly star = new CompanionStar();
  /** 追光斑用的那粒光（贴着玻璃飘过） */
  readonly toy = new CompanionStar();
  /** 躲猫猫：躲在哪一边（没躲 = 0） */
  hideSide = 0;
  private idle = 0;
  private nextIn = 6;
  private cur: { kind: Kind; t: number; dur: number; data?: any } | null = null;
  private t = 0;
  private opening: { t: number; kind: Kind } | null = null;
  /** 聊天中 / 录制中不要自己玩（主循环每帧喂） */
  paused = false;
  /** 场景 / 彩蛋锁住：不自己玩（切场景时 base() 解锁） */
  locked = false;
  /** 外部效果（V9-C） */
  hooks: LifeHooks = {};

  constructor(
    private moon: MoonRenderer,
    private world: World,
    private cam: WindowCamera,
    private interact: MoonInteraction,
    private pixelRatio: () => number
  ) {
    // 背景里自然出现的流星：没事的时候转头去追
    world.meteors.onSpawn = (m) => {
      if (this.cur || this.paused || this.locked || this.idle < 2 || this.interact.isBusy) return;
      this.start("meteor", { head: m.head, life: m.life, natural: true });
    };
  }

  /** 有人在跟它玩 / 说话：打断小日子 */
  notifyActivity() {
    this.idle = 0;
    if (this.cur?.kind === "doze") {
      this.moon.flashExpr("surprised", 0.5);
      setTimeout(() => this.moon.flashExpr("happy", 1.2), 500);
    }
    // 偷懒被抓到：吹口哨装没事，飘回来
    const caughtLazy = this.cur?.kind === "lazy";
    this.stop();
    if (caughtLazy && params.eggs.whistle.enabled) this.hooks.whistle?.(2.2);
  }

  /** 躲猫猫：你点了屏幕某处（归一化坐标）——点在它躲的那一边就算找到了 */
  foundMe(nx: number, _ny: number): boolean {
    if (this.cur?.kind !== "hide" || !this.hideSide) return false;
    if (Math.sign(nx) !== this.hideSide || Math.abs(nx) < 0.5) return false;
    this.hideSide = 0;
    this.hooks.unhide?.(true);
    this.cur = null;
    this.idle = 0;
    this.nextIn = 8 + Math.random() * 8;
    return true;
  }

  /** 开场：它正在做自己的事，被你发现 */
  playOpening(kind: Kind = Math.random() < 0.5 ? "star" : "doze") {
    this.opening = { t: 0, kind };
    this.start(kind);
  }

  /** 直接演一段小日子（彩蛋 / 录片用） */
  play(kind: Kind, data?: any) {
    this.stop();
    this.start(kind, data);
  }

  private start(kind: Kind, data?: any) {
    const [a, b] = DUR[kind];
    this.cur = { kind, t: 0, dur: a + Math.random() * (b - a), data };
    const m = this.moon;
    switch (kind) {
      case "glance": {
        const nx = (Math.random() * 2 - 1) * 0.8;
        const ny = Math.random() * 0.9 - 0.1;
        this.interact.lookAtScreen(nx, ny, this.cur.dur);
        if (Math.random() < 0.4) m.flashExpr("thinking", this.cur.dur);
        break;
      }
      case "meteor": {
        if (!data) {
          // 自己放一颗从上方划过的流星
          const depth = 5;
          const ext = this.cam.extentAt(depth);
          const start = new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * ext.w * 0.7, ext.h * (0.55 + Math.random() * 0.3), -depth);
          const dir = new THREE.Vector3(-Math.sign(start.x) * (0.8 + Math.random() * 0.3), -0.45, 0).normalize();
          const met = this.world.meteors.spawn(this.cam, { start, dir, speed: 4.2, life: 1.3, trail: 1.4 });
          if (!met) {
            this.cur = null;
            return;
          }
          this.cur.data = { head: () => met.start.clone().addScaledVector(met.dir, met.speed * met.age), life: met.life };
        }
        // 看到流星那一瞬：瞳孔放大；突然出现的（不是自己放的）吓一跳冒「!」
        if (params.eggs.dilate.enabled) this.hooks.dilate?.();
        else m.flashExpr("surprised", 0.5);
        if (data?.natural && params.eggs.symbols.enabled && Math.random() < params.eggs.symbols.bangChance) this.hooks.bang?.();
        this.cur.data.sharedAt = -1;
        break;
      }
      case "yawn":
        m.flashExpr("sleepy", this.cur.dur);
        break;
      case "hum":
        m.flashExpr(Math.random() < 0.35 ? "calm" : "content", this.cur.dur);
        // 心情好就摇摆（带 ♪）；否则点点头 + 冒 ♪
        if (params.eggs.sway.enabled && m.emotion.valence >= params.eggs.sway.minValence) this.hooks.sway?.(this.cur.dur);
        else {
          m.playAction("nod", 0.25, "reflex");
          this.cur.data = { noteT: 0.3 };
        }
        break;
      case "sneeze":
        this.hooks.sneeze?.();
        break;
      case "space":
        this.hooks.blank?.(this.cur.dur - 0.3);
        break;
      case "stretch":
        this.hooks.stretch?.();
        break;
      case "star": {
        const c = m.center;
        this.star.pos.set(c.x + 1.6, c.y + 0.6, c.z + 0.3);
        this.star.alpha = 0;
        m.flashExpr("happy", this.cur.dur);
        break;
      }
      case "doze":
        m.flashExpr("sleeping", this.cur.dur);
        if (params.eggs.symbols.enabled) this.hooks.zzz?.(true);
        this.cur.data = { rollAt: 2.5 + Math.random() * 2, rolled: false };
        break;
      // ── V9-D ──
      case "lazy":
        this.hooks.lazy?.(true);
        break;
      case "chase": {
        // 一粒光斑从左往右贴着玻璃飘过，它盯着、撞过去，光斑炸成几粒星
        const c = m.center;
        const R = m.radius;
        this.toy.pos.set(c.x - R * 2.2, c.y - R * 0.3, c.z + R * 1.1);
        this.toy.alpha = 0;
        this.cur.data = { bumped: false };
        break;
      }
      case "count": {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < params.eggs.count.stars; i++) pts.push(new THREE.Vector3(-1.8 + Math.random() * 3.6, 1.2 + Math.random() * 1.6, -3.5));
        this.hooks.count?.(pts);
        break;
      }
      case "hide": {
        const side = Math.random() < 0.5 ? -1 : 1;
        const edge = this.cam.extentAt(-m.center.z).w;
        this.hideSide = side;
        this.cur.data = { peeked: false };
        this.hooks.hide?.(side, edge);
        break;
      }
      case "cloud":
        this.hooks.cloud?.(this.cur.dur - 0.2);
        break;
      case "doodle":
        this.hooks.doodle?.();
        try {
          localStorage.setItem("moonbao.doodle", new Date().toDateString());
        } catch {
          /* 私密模式 */
        }
        break;
    }
  }

  private stop() {
    if (!this.cur) return;
    if (this.cur.kind === "star") this.cur.data = { leaving: true };
    const k = this.cur.kind;
    this.cur = null;
    if (k !== "doze") this.moon.lookWeight = 0;
    if (k === "doze") this.hooks.zzz?.(false);
    if (k === "lazy") this.hooks.lazy?.(false);
    if (k === "hide" && this.hideSide) {
      this.hideSide = 0;
      this.hooks.unhide?.(false);
    }
    if (k === "chase") this.toy.alpha = 0;
  }

  update(dt: number) {
    this.t += dt;
    const busy = this.paused || this.locked || this.interact.isBusy || this.moon.busy;
    this.idle = busy ? 0 : this.idle + dt;
    // 星星离场：往外飞、淡出
    if (!this.cur || this.cur.kind !== "star") {
      this.star.alpha = Math.max(0, this.star.alpha - dt * 1.5);
      this.star.pos.x += dt * 1.2;
      this.star.pos.y += dt * 0.6;
    }
    if (this.cur) {
      const c = this.cur;
      c.t += dt;
      const m = this.moon;
      if (c.kind === "meteor" && c.data) {
        m.lookTarget = c.data.head();
        // 共同注意（V9-C）：追到一半回头看你一眼（「你看！」），再追
        const A = params.eggs.attend;
        const share = A.enabled && c.t > A.lookBackAt && c.t < A.lookBackAt + A.lookBackFor;
        if (share && c.data.sharedAt < 0) {
          c.data.sharedAt = c.t;
          m.flashExpr("happy", A.lookBackFor + 0.2);
        }
        m.lookWeight = share ? 0 : clamp(c.t / 0.25, 0, 0.85) * (c.t < c.data.life ? 1 : 0);
        if (c.t > c.data.life && c.t < c.data.life + dt * 1.5) m.flashExpr(params.eggs.starry.enabled && Math.random() < 0.6 ? "starry" : "happy", 1.1);
      } else if (c.kind === "doze" && c.data && !c.data.rolled && c.t > c.data.rollAt && params.eggs.rollover.enabled && c.dur - c.t > 9) {
        c.data.rolled = true;
        this.hooks.rollOver?.(3);
      } else if (c.kind === "chase" && c.data) {
        // 光斑贴着玻璃从左飘到右；到了它面前它撞过去，光斑炸开
        const R = m.radius;
        const center = m.center;
        const u = Math.min(1, c.t / 3.2);
        this.toy.pos.set(center.x - R * 2.2 + R * 3.0 * u, center.y - R * 0.3 + Math.sin(c.t * 2.2) * R * 0.25, center.z + R * 1.1);
        this.toy.alpha = c.data.bumped ? Math.max(0, this.toy.alpha - dt * 6) : Math.min(1, c.t * 2);
        m.lookTarget = this.toy.pos.clone();
        m.lookWeight = c.data.bumped ? 0 : 0.85;
        if (!c.data.bumped && u >= 1) {
          c.data.bumped = true;
          this.hooks.bump?.(this.toy.pos.clone());
          this.hooks.burst?.(this.toy.pos.clone());
        }
      } else if (c.kind === "hide" && c.data && !c.data.peeked && c.t > params.eggs.hide.wait) {
        c.data.peeked = true;
        this.hooks.peek?.();
      } else if (c.kind === "hum" && c.data?.noteT != null) {
        c.data.noteT -= dt;
        if (c.data.noteT <= 0) {
          this.hooks.note?.();
          c.data.noteT = 0.7;
        }
      } else if (c.kind === "star") {
        // 小星星绕着它飞：一个倾斜的椭圆，忽远忽近
        const R = m.radius;
        const a = c.t * 1.9;
        const center = m.center;
        this.star.pos.set(center.x + Math.cos(a) * R * 1.9, center.y + Math.sin(a * 1.3) * R * 0.9 + 0.15, center.z + Math.sin(a) * R * 1.1 + 0.2);
        this.star.alpha = Math.min(1, c.t * 2) * (c.t > c.dur - 0.6 ? Math.max(0, (c.dur - c.t) / 0.6) : 1);
        m.lookTarget = this.star.pos.clone();
        m.lookWeight = 0.8;
        if (Math.sin(a) > 0.95 && Math.random() < 0.05) m.flashExpr(Math.random() < 0.5 ? "cheeky" : "laugh", 0.7);
      }
      if (c.t >= c.dur) {
        const wasOpening = this.opening && this.opening.kind === c.kind;
        this.stop();
        this.nextIn = 6 + Math.random() * 10;
        if (wasOpening) this.finishOpening();
      }
    } else if (!busy && this.idle > 3) {
      this.nextIn -= dt;
      if (this.nextIn <= 0) {
        this.start(this.pick());
      }
    }
    this.toy.update(this.t, this.pixelRatio());
    if (this.opening) {
      this.opening.t += dt;
      // 开场最多演 2.4 秒就「发现你」
      if (this.opening.t > 2.4 && this.cur && this.cur.kind === this.opening.kind) {
        this.stop();
        this.finishOpening();
      }
    }
    this.star.update(this.t, this.pixelRatio());
  }

  private finishOpening() {
    this.opening = null;
    const m = this.moon;
    m.lookWeight = 0;
    m.flashExpr("surprised", 0.55);
    m.blinker.blinkNow(true);
    setTimeout(() => {
      m.flashExpr("happy", 1.6);
      m.playAction("bounce", 0.6, "manual");
    }, 550);
  }

  private doodledToday() {
    try {
      return localStorage.getItem("moonbao.doodle") === new Date().toDateString();
    } catch {
      return false;
    }
  }

  private pick(): Kind {
    const hour = this.world.now().getHours();
    const night = hour >= 23 || hour < 6;
    const E = params.eggs;
    const w = {
      ...WEIGHTS,
      doze: night ? 2.5 : WEIGHTS.doze,
      yawn: night ? 2 : WEIGHTS.yawn,
      meteor: this.world.state.night > 0.5 ? WEIGHTS.meteor : 0.2,
      sneeze: E.sneeze.enabled ? E.sneeze.idleWeight : 0,
      space: E.blank.enabled ? E.blank.idleWeight : 0,
      // 伸懒腰：发呆够久才会
      stretch: E.stretch.enabled && this.idle > 45 ? WEIGHTS.stretch : 0,
      // V9-D：偷懒（难得）、追光斑、数星星（夜里）、躲猫猫（夜里）、看云（白天）、主动写一个字（夜里、很久没人理、每天一次）
      lazy: E.lazy.enabled ? E.lazy.idleWeight : 0,
      chase: E.chase.enabled ? E.chase.idleWeight : 0,
      count: E.count.enabled && this.world.state.night > 0.5 ? E.count.idleWeight : 0,
      hide: E.hide.enabled && night ? E.hide.idleWeight : 0,
      cloud: E.cloud.enabled && this.world.state.day > 0.5 ? E.cloud.idleWeight : 0,
      doodle: E.doodle.enabled && this.world.state.night > 0.5 && this.idle > E.doodle.idleAfter && !this.doodledToday() ? E.doodle.idleWeight : 0,
    };
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (const [k, v] of Object.entries(w) as [Kind, number][]) {
      if ((r -= v) <= 0) return k;
    }
    return "glance";
  }
}
