// 它在想的时候（等 LLM 的那一两秒）不能让人觉得无聊（2026-09-26 用户第 6 点）：
//   召集星星：天上的小星星开始往写字区飘——它们就是待会儿拼字的光点（回复一到，写字优先用它们当起点）
//   三颗星星排成 · · · 在它旁边一颗接一颗地跳
//   困惑时：星星拼出一个 3D 问号，在它头顶慢慢转

import * as THREE from "three";
import { ensureFonts, FONT_CANDIDATES, fontState } from "./glyphs";

const ptsVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aPhase;
  uniform float uPx, uTime;
  varying float vA;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPx * (0.85 + 0.15 * sin(uTime * 6.0 + aPhase * 30.0));
    vA = aAlpha;
  }
`;
const ptsFrag = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p) * 2.0;
    float core = exp(-r * r * 14.0) * 2.2;
    float glow = exp(-r * r * 3.5) * 0.35;
    gl_FragColor = vec4(uColor * (core + glow) * vA, 1.0);
  }
`;

const sparkleFrag = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p) * 2.0;
    // 四角星：两条细长的光芒 + 小圆心
    float rays = exp(-abs(p.x) * 34.0) * exp(-abs(p.y) * 5.0) + exp(-abs(p.y) * 34.0) * exp(-abs(p.x) * 5.0);
    float core = exp(-r * r * 30.0) * 2.0;
    gl_FragColor = vec4(uColor * (rays * 1.6 + core) * vA, 1.0);
  }
`;

export function makePoints(n: number, color: string, order: number, sparkle = false) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(n), 1));
  const ph = new Float32Array(n);
  for (let i = 0; i < n; i++) ph[i] = Math.random();
  g.setAttribute("aPhase", new THREE.BufferAttribute(ph, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: 1 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: ptsVert,
    fragmentShader: sparkle ? sparkleFrag : ptsFrag,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = order;
  return p;
}

interface Gatherer {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  alive: boolean;
  age: number;
}

export class ThinkingFX {
  readonly gather = makePoints(64, "#ffe2b0", 55);
  readonly dots = makePoints(3, "#fff0cf", 56, true);
  readonly question = makePoints(120, "#ffe6bd", 57);
  private gs: Gatherer[] = [];
  private t = 0;
  private thinkingSince = -1;
  private qTargets: THREE.Vector3[] = [];
  private qPos: THREE.Vector3[] = [];
  private qVel: THREE.Vector3[] = [];
  private qAlpha = 0;
  private qOn = false;
  private dotsAlpha = 0;
  /** 召集星星的目的地（写字区中心，世界坐标） */
  gatherTo = new THREE.Vector3(0, -0.5, -0.4);

  constructor() {
    for (let i = 0; i < 64; i++) this.gs.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), alive: false, age: 0 });
    void this.buildQuestion();
  }

  /** 开始 / 停止「在想」 */
  setThinking(on: boolean, extent: { w: number; h: number }) {
    if (on && this.thinkingSince < 0) {
      this.thinkingSince = this.t;
      // 从四面八方的远处召集星星
      for (const g of this.gs) {
        const a = Math.random() * Math.PI * 2;
        const depth = 2.5 + Math.random() * 6;
        g.pos.set(Math.cos(a) * extent.w * (1 + depth * 0.4) * (0.6 + Math.random() * 0.6), Math.sin(a) * extent.h * (0.8 + Math.random() * 0.5), -depth);
        g.vel.set(0, 0, 0);
        g.alive = true;
        g.age = -Math.random() * 1.2;
      }
    } else if (!on) {
      this.thinkingSince = -1;
    }
  }

  /** 写字要起点时拿走一颗召集来的星星（世界坐标），没有就 null */
  take(): THREE.Vector3 | null {
    for (const g of this.gs) {
      if (g.alive && g.age > 0) {
        g.alive = false;
        return g.pos.clone();
      }
    }
    return null;
  }

  showQuestion(on: boolean) {
    this.qOn = on;
    if (on) {
      for (const p of this.qPos) p.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, -2 - Math.random() * 3);
      for (const v of this.qVel) v.set(0, 0, 0);
    }
  }

  private async buildQuestion() {
    const font = `700 120px ${FONT_CANDIDATES[fontState.en]}`;
    await ensureFonts("?", { en: 120, zh: 120, lineHeight: 1, maxWidth: 999 }).catch(() => undefined);
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 160;
    const g = c.getContext("2d")!;
    g.font = font;
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.fillText("?", 64, 128);
    const d = g.getImageData(0, 0, 128, 160).data;
    const pts: THREE.Vector3[] = [];
    for (let y = 0; y < 160; y += 3)
      for (let x = 0; x < 128; x += 3) if (d[(y * 128 + x) * 4 + 3] > 150) pts.push(new THREE.Vector3((x - 64) / 128, (80 - y) / 128, 0));
    for (let i = pts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pts[i], pts[j]] = [pts[j], pts[i]];
    }
    this.qTargets = pts.slice(0, 120);
    this.qPos = this.qTargets.map(() => new THREE.Vector3(0, 0, -3));
    this.qVel = this.qTargets.map(() => new THREE.Vector3());
  }

  update(dt: number, moonCenter: THREE.Vector3, moonRadius: number, pixelRatio: number) {
    this.t += dt;
    // 召集星星：先慢后快地飘向写字区（到了就在那儿打转等着）
    const gp = this.gather.geometry.getAttribute("position") as THREE.BufferAttribute;
    const ga = this.gather.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const gsz = this.gather.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    this.gs.forEach((g, i) => {
      if (g.alive) {
        g.age += dt;
        if (g.age > 0) {
          const to = this.gatherTo.clone().add(new THREE.Vector3(Math.sin(i * 1.7 + this.t) * 0.5, Math.cos(i * 2.3 + this.t * 0.8) * 0.25, Math.sin(i * 0.9) * 0.3));
          const acc = to.sub(g.pos).multiplyScalar(1.1);
          g.vel.addScaledVector(acc, dt).multiplyScalar(Math.exp(-dt * 1.3));
          g.pos.addScaledVector(g.vel, dt);
        }
      }
      gp.setXYZ(i, g.pos.x, g.pos.y, g.pos.z);
      const target = g.alive && g.age > 0 ? Math.min(1, g.age * 1.5) : 0;
      ga.setX(i, ga.getX(i) + (target - ga.getX(i)) * (1 - Math.exp(-dt * 6)));
      gsz.setX(i, 4.5);
    });
    gp.needsUpdate = ga.needsUpdate = gsz.needsUpdate = true;

    // 三颗星星 · · ·：想了 1.2 秒以上才出现，在月亮右边一颗接一颗地跳
    const thinking = this.thinkingSince >= 0 ? this.t - this.thinkingSince : -1;
    this.dotsAlpha += ((thinking > 1.2 ? 1 : 0) - this.dotsAlpha) * (1 - Math.exp(-dt * 6));
    const dp = this.dots.geometry.getAttribute("position") as THREE.BufferAttribute;
    const da = this.dots.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const ds = this.dots.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    for (let i = 0; i < 3; i++) {
      const hop = Math.max(0, Math.sin(this.t * 5 - i * 0.9)) * 0.06;
      dp.setXYZ(i, moonCenter.x + moonRadius * 1.25 + i * 0.13, moonCenter.y - moonRadius * 0.15 + hop, moonCenter.z + moonRadius * 0.4);
      da.setX(i, this.dotsAlpha * 1.4);
      ds.setX(i, 17);
    }
    dp.needsUpdate = da.needsUpdate = ds.needsUpdate = true;

    // 3D 问号：弹簧聚拢，在头顶慢慢绕 y 轴转
    this.qAlpha += ((this.qOn ? 1 : 0) - this.qAlpha) * (1 - Math.exp(-dt * 4));
    const qp = this.question.geometry.getAttribute("position") as THREE.BufferAttribute;
    const qa = this.question.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const qs = this.question.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const rot = this.t * 1.1;
    const scale = moonRadius * 1.25;
    const head = moonCenter.clone().add(new THREE.Vector3(moonRadius * 0.55, moonRadius * 1.45, 0.1));
    for (let i = 0; i < this.qTargets.length; i++) {
      const tg = this.qTargets[i];
      const x = tg.x * Math.cos(rot);
      const z = tg.x * Math.sin(rot);
      const target = new THREE.Vector3(head.x + x * scale, head.y + tg.y * scale + Math.sin(this.t * 2) * 0.03, head.z + z * scale);
      const p = this.qPos[i];
      const v = this.qVel[i];
      v.addScaledVector(target.sub(p), dt * 60).multiplyScalar(Math.exp(-dt * 9));
      p.addScaledVector(v, dt);
      qp.setXYZ(i, p.x, p.y, p.z);
      qa.setX(i, this.qAlpha);
      qs.setX(i, 5.2);
    }
    qp.needsUpdate = qa.needsUpdate = qs.needsUpdate = true;

    for (const p of [this.gather, this.dots, this.question]) {
      p.material.uniforms.uPx.value = pixelRatio;
      p.material.uniforms.uTime.value = this.t;
    }
  }
}
