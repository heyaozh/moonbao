// 光点写符号（V9-A 地基）：睡觉冒 z z z、哼歌冒 ♪、惊讶冒「!」、彩蛋冒 ♥、它主动写的「☾」……
// 和思考时的 3D 问号同一套做法：Canvas2D 把一个字符画出来 → 在墨迹上采样光点 → 光点从四周弹簧聚拢成字 →
// 整个字慢慢漂起、淡出。一个符号最多 160 个光点，同时最多 4 个符号，预算很小。

import * as THREE from "three";
import { FONT_CANDIDATES, fontState, ZH_FONT } from "../chat/glyphs";
import { makePoints } from "../chat/thinking";
import { Spring, clamp } from "../moon/math";
import { params } from "../moon/params";

const CAP = 160;
const POOL = 4;
const cache = new Map<string, THREE.Vector2[]>();

function symbolFont() {
  return `700 110px ${FONT_CANDIDATES[fontState.en]}, ${ZH_FONT}, "Hiragino Sans", "PingFang SC", "Apple Symbols", sans-serif`;
}

/** 一个字符的墨迹采样（归一化：宽 1 = 画布宽），有缓存 */
function sampleChar(ch: string, font: string): THREE.Vector2[] {
  const key = `${font}|${ch}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = 128;
  const H = 160;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.font = font;
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(ch, W / 2, H / 2);
  const d = g.getImageData(0, 0, W, H).data;
  const raw: [number, number][] = [];
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let y = 0; y < H; y += 2)
    for (let x = 0; x < W; x += 2)
      if (d[(y * W + x) * 4 + 3] > 140) {
        raw.push([x, y]);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  // 按字形自己的包围盒归一化：高 = 1、居中——这样 size 就是「字高（世界单位）」，和字体无关
  const h = Math.max(1, y1 - y0);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const pts = raw.map(([x, y]) => new THREE.Vector2((x - cx) / h, (cy - y) / h));
  // 打散后取前 CAP 个：墨多的字也不会超预算，稀疏得均匀
  for (let i = pts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pts[i], pts[j]] = [pts[j], pts[i]];
  }
  const out = pts.slice(0, CAP);
  cache.set(key, out);
  return out;
}

export type AnchorName = "head" | "right" | "left";

export interface PopOpts {
  /** 挂在月亮的哪一边（默认头顶） */
  anchor?: AnchorName | THREE.Vector3;
  /** 再偏一点（以半径为单位） */
  offset?: { x: number; y: number; z: number };
  /** 字高（世界单位，默认 0.3） */
  size?: number;
  /** 寿命（秒） */
  life?: number;
  /** 每秒漂起多少（世界单位） */
  rise?: number;
  /** 左右摇摆的幅度（0..1） */
  sway?: number;
  color?: string;
  /** 聚拢弹簧的阻尼（越小越弹） */
  zeta?: number;
}

interface Sym {
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  targets: THREE.Vector2[];
  pos: Float32Array;
  vel: Float32Array;
  active: boolean;
  age: number;
  life: number;
  size: number;
  rise: number;
  sway: number;
  phase: number;
  anchor: AnchorName | THREE.Vector3;
  offset: THREE.Vector3;
  scale: Spring;
  stamp: number;
}

export class SymbolFX {
  readonly group = new THREE.Group();
  private syms: Sym[] = [];
  private t = 0;
  private center = new THREE.Vector3();
  private radius = 0.8;
  private zzzOn = false;
  private zzzClock = 0;
  private zzzI = 0;

  constructor() {
    for (let i = 0; i < POOL; i++) {
      const points = makePoints(CAP, "#ffe6bd", 58);
      this.group.add(points);
      this.syms.push({
        points,
        targets: [],
        pos: new Float32Array(CAP * 3),
        vel: new Float32Array(CAP * 3),
        active: false,
        age: 0,
        life: 1,
        size: 0.3,
        rise: 0.3,
        sway: 0.5,
        phase: 0,
        anchor: "head",
        offset: new THREE.Vector3(),
        scale: new Spring(1, 14, 0.42),
        stamp: 0,
      });
    }
  }

  private anchorWorld(a: AnchorName | THREE.Vector3, out: THREE.Vector3) {
    const R = this.radius;
    const c = this.center;
    if (a instanceof THREE.Vector3) return out.copy(a);
    if (a === "head") return out.set(c.x + R * 0.55, c.y + R * 1.45, c.z + 0.1);
    if (a === "right") return out.set(c.x + R * 1.3, c.y + R * 0.35, c.z + R * 0.4);
    return out.set(c.x - R * 1.3, c.y + R * 0.35, c.z + R * 0.4);
  }

  /** 冒一个符号。字体没加载好时先等字体（几毫秒），所以是异步的；调用方不用等。 */
  pop(ch: string, opts: PopOpts = {}) {
    const font = symbolFont();
    const go = () => this.spawn(ch, font, opts);
    const fonts = (document as any).fonts;
    if (fonts?.load) fonts.load(font, ch).then(go, go);
    else go();
  }

  private spawn(ch: string, font: string, o: PopOpts) {
    // 挑一个空闲的；都在忙就顶掉最老的
    let s = this.syms.find((x) => !x.active) ?? this.syms.reduce((a, b) => (a.stamp < b.stamp ? a : b));
    s.targets = sampleChar(ch, font);
    s.active = true;
    s.age = 0;
    s.stamp = this.t;
    s.life = o.life ?? 2;
    s.size = o.size ?? 0.3;
    s.rise = o.rise ?? 0.3;
    s.sway = o.sway ?? 0.5;
    s.phase = Math.random() * Math.PI * 2;
    s.anchor = o.anchor ?? "head";
    s.offset.set(o.offset?.x ?? 0, o.offset?.y ?? 0, o.offset?.z ?? 0).multiplyScalar(this.radius);
    s.scale.zeta = o.zeta ?? 0.42;
    s.scale.set(0.35);
    s.scale.target = 1;
    (s.points.material.uniforms.uColor.value as THREE.Color).set(o.color ?? "#ffe6bd");
    const base = this.anchorWorld(s.anchor, new THREE.Vector3()).add(s.offset);
    const n = s.targets.length;
    for (let i = 0; i < CAP; i++) {
      // 从四周散着飞进来
      const r = s.size * 1.6;
      s.pos[i * 3] = base.x + (Math.random() * 2 - 1) * r;
      s.pos[i * 3 + 1] = base.y + (Math.random() * 2 - 1) * r;
      s.pos[i * 3 + 2] = base.z + (Math.random() * 2 - 1) * r * 0.5;
      s.vel[i * 3] = s.vel[i * 3 + 1] = s.vel[i * 3 + 2] = 0;
    }
    const sz = s.points.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    for (let i = 0; i < CAP; i++) sz.setX(i, i < n ? 4.6 : 0);
    sz.needsUpdate = true;
  }

  /** 睡觉冒 z z z：开着就隔一会儿冒一个，越冒越大、越冒越偏右上 */
  zzz(on: boolean) {
    if (on && !this.zzzOn) {
      this.zzzClock = 0.2;
      this.zzzI = 0;
    }
    this.zzzOn = on;
  }
  /** 哼歌：冒一个 ♪ */
  note() {
    const E = params.eggs.notes;
    this.pop("♪", { anchor: "right", offset: { x: (Math.random() - 0.5) * 0.3, y: Math.random() * 0.2, z: 0 }, size: E.size * (0.85 + Math.random() * 0.3), life: E.life, rise: E.rise, sway: 0.9, color: "#ffe3a1" });
  }
  /** 惊讶：头顶「!」弹出来 */
  bang() {
    const E = params.eggs.bang;
    this.pop("!", { anchor: "head", size: E.size, life: E.life, rise: 0.05, sway: 0.15, color: "#fff2d6", zeta: 0.3 });
  }

  update(dt: number, moonCenter: THREE.Vector3, moonRadius: number, pixelRatio: number) {
    this.t += dt;
    this.center.copy(moonCenter);
    this.radius = moonRadius;
    if (this.zzzOn) {
      this.zzzClock -= dt;
      if (this.zzzClock <= 0) {
        const E = params.eggs.zzz;
        const i = this.zzzI++ % 3;
        this.pop("z", { anchor: "head", offset: { x: 0.14 * i, y: 0.05 * i, z: 0 }, size: E.size * (1 + 0.3 * i), life: E.life, rise: E.rise, sway: 0.5, color: "#dfe6ff" });
        this.zzzClock = E.every;
      }
    }
    const base = new THREE.Vector3();
    for (const s of this.syms) {
      const pa = s.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      const aa = s.points.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
      if (!s.active) {
        s.points.visible = false;
        continue;
      }
      s.age += dt;
      if (s.age >= s.life) {
        s.active = false;
        s.points.visible = false;
        continue;
      }
      s.points.visible = true;
      const k = s.scale.step(dt);
      this.anchorWorld(s.anchor, base).add(s.offset);
      base.y += s.rise * s.age;
      base.x += Math.sin(s.age * 2.1 + s.phase) * s.sway * 0.06;
      const alpha = Math.min(clamp(s.age / 0.18, 0, 1), clamp((s.life - s.age) / 0.45, 0, 1));
      const n = s.targets.length;
      for (let i = 0; i < CAP; i++) {
        if (i >= n) {
          aa.setX(i, 0);
          continue;
        }
        const tg = s.targets[i];
        const tx = base.x + tg.x * s.size * k;
        const ty = base.y + tg.y * s.size * k;
        const tz = base.z;
        const j = i * 3;
        s.vel[j] = (s.vel[j] + (tx - s.pos[j]) * dt * 70) * Math.exp(-dt * 10);
        s.vel[j + 1] = (s.vel[j + 1] + (ty - s.pos[j + 1]) * dt * 70) * Math.exp(-dt * 10);
        s.vel[j + 2] = (s.vel[j + 2] + (tz - s.pos[j + 2]) * dt * 70) * Math.exp(-dt * 10);
        s.pos[j] += s.vel[j] * dt;
        s.pos[j + 1] += s.vel[j + 1] * dt;
        s.pos[j + 2] += s.vel[j + 2] * dt;
        pa.setXYZ(i, s.pos[j], s.pos[j + 1], s.pos[j + 2]);
        aa.setX(i, alpha * (0.85 + 0.15 * Math.sin(this.t * 5 + i)));
      }
      pa.needsUpdate = aa.needsUpdate = true;
      s.points.material.uniforms.uPx.value = pixelRatio;
      s.points.material.uniforms.uTime.value = this.t;
    }
  }
}
