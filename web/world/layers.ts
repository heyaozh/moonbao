// 天球之外的几层：程序化补星（让画面像概念图那样密）、最近处的虚化光斑、偶尔的流星、屏幕下方的地照、白天的云。
// 每一层都在真实的 3D 深度上，倾斜时的位移由窗相机 + 每层 parallax 决定。

import * as THREE from "three";
import { expRandom, lerp } from "../moon/math";
import { params } from "../moon/params";
import type { WindowCamera } from "./camera";

const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ───────────── 补星 ─────────────
const fillVert = /* glsl */ `
  attribute vec3 aColor;
  attribute float aPhase;
  attribute float aSize;
  uniform vec2 uExtent;
  uniform float uPx, uTime, uVis, uBright, uTwinkle, uTwinkleSpeed;
  varying vec3 vCol;
  varying float vBri;
  void main() {
    vec3 p = vec3(position.xy * uExtent, position.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    float tw = sin(uTime * uTwinkleSpeed * (0.5 + aPhase) + aPhase * 31.0);
    vBri = uBright * uVis * (1.0 + uTwinkle * tw) * (0.55 + 0.45 * aSize);
    vCol = aColor;
    gl_PointSize = aSize * uPx * 2.2;
  }
`;
const fillFrag = /* glsl */ `
  float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  varying vec3 vCol;
  varying float vBri;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = exp(-r * r * 9.0) + exp(-r * r * 2.2) * 0.12;
    gl_FragColor = vec4(vCol * vBri * a * sstep(1.0, 0.75, r), 1.0);
  }
`;

export class FillStars {
  readonly group = new THREE.Group();
  private layers: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
  private t = 0;
  private tmp = new THREE.Vector3();

  constructor() {
    const warm = new THREE.Color(params.sky.warmColor);
    const cool = new THREE.Color(params.sky.coolColor);
    for (const L of params.sky.fill) {
      const n = L.count;
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const phase = new Float32Array(n);
      const size = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = rand(-1, 1);
        pos[i * 3 + 1] = rand(-1, 1);
        pos[i * 3 + 2] = -L.depth * rand(0.85, 1.15);
        const c = Math.random() < L.warm ? warm.clone().lerp(new THREE.Color(1, 1, 1), rand(0, 0.35)) : cool.clone().lerp(new THREE.Color(1, 1, 1), rand(0, 0.6));
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
        phase[i] = Math.random();
        // 大小呈长尾分布：大多数很小，偶尔几颗大一点
        size[i] = L.size * (0.45 + Math.pow(Math.random(), 3) * 1.4);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
      g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
      g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
      const m = new THREE.ShaderMaterial({
        uniforms: {
          uExtent: { value: new THREE.Vector2(1, 1) },
          uPx: { value: 1 },
          uTime: { value: 0 },
          uVis: { value: 1 },
          uBright: { value: L.brightness },
          uTwinkle: { value: params.sky.fillTwinkle },
          uTwinkleSpeed: { value: params.sky.fillTwinkleSpeed },
        },
        vertexShader: fillVert,
        fragmentShader: fillFrag,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      pts.renderOrder = -80;
      this.layers.push(pts);
      this.group.add(pts);
    }
  }

  update(dt: number, cam: WindowCamera, visibility: number, pixelRatio: number) {
    this.t += dt;
    params.sky.fill.forEach((L, i) => {
      const pts = this.layers[i];
      if (!pts) return;
      const ext = cam.extentAt(L.depth);
      const u = pts.material.uniforms;
      (u.uExtent.value as THREE.Vector2).set(ext.w * params.sky.fillSpread, ext.h * params.sky.fillSpread);
      u.uPx.value = pixelRatio;
      u.uTime.value = this.t;
      u.uVis.value = visibility;
      u.uBright.value = L.brightness;
      u.uTwinkle.value = params.sky.fillTwinkle;
      u.uTwinkleSpeed.value = params.sky.fillTwinkleSpeed;
      pts.position.copy(cam.layerOffset(L.depth, L.parallax, this.tmp));
    });
  }
}

// ───────────── 光斑（最近处，景深虚化） ─────────────
const bokehVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aPhase;
  uniform float uPxPerUnit, uEyeZ, uTime;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(0.2, -mv.z);
    gl_PointSize = aSize * uPxPerUnit * uEyeZ / dist;
    vAlpha = aAlpha * (0.75 + 0.25 * sin(uTime * 0.6 + aPhase * 6.28));
  }
`;
const bokehFrag = /* glsl */ `
  float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  uniform vec3 uColor;
  uniform float uRing, uOpacity;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    // 虚化光斑：中心亮、边缘软，外缘一圈很淡的亮环（镜头 bokeh 的味道）
    float disc = sstep(1.0, 0.7, r);
    float core = exp(-r * r * 2.2);
    float ring = sstep(0.55, 0.85, r) * disc;
    float a = disc * (0.35 + 0.65 * core) + ring * uRing;
    gl_FragColor = vec4(uColor * a * vAlpha * uOpacity * 1.6, 1.0);
  }
`;

export class Bokeh {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private vel: Float32Array;
  private t = 0;

  constructor() {
    const B = params.bokeh;
    const n = B.count;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const alpha = new Float32Array(n);
    const phase = new Float32Array(n);
    this.vel = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      // 少挡脸：拒绝采样，中间留空
      let x = 0;
      let y = 0;
      for (let k = 0; k < 20; k++) {
        x = rand(-1.15, 1.15);
        y = rand(-1.9, 1.9);
        if (Math.hypot(x, y * 0.7) > B.centerClear) break;
      }
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = rand(B.depthMin, B.depthMax);
      size[i] = rand(B.sizeMin, B.sizeMax);
      alpha[i] = rand(B.opacityMin, B.opacityMax);
      phase[i] = Math.random();
      const a = Math.random() * Math.PI * 2;
      this.vel[i * 2] = Math.cos(a) * B.drift * rand(0.4, 1);
      this.vel[i * 2 + 1] = Math.sin(a) * B.drift * rand(0.4, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uPxPerUnit: { value: 100 },
        uEyeZ: { value: 2 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(B.color) },
        uRing: { value: B.ring },
        uOpacity: { value: 1 },
      },
      vertexShader: bokehVert,
      fragmentShader: bokehFrag,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 100;
  }

  update(dt: number, cam: WindowCamera, bufferH: number, opacity: number) {
    this.t += dt;
    const B = params.bokeh;
    const pos = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const n = arr.length / 3;
    const W = cam.halfW * 1.25;
    const H = cam.halfH * 1.15;
    for (let i = 0; i < n; i++) {
      arr[i * 3] += this.vel[i * 2] * dt;
      arr[i * 3 + 1] += this.vel[i * 2 + 1] * dt;
      if (arr[i * 3] > W) arr[i * 3] = -W;
      if (arr[i * 3] < -W) arr[i * 3] = W;
      if (arr[i * 3 + 1] > H) arr[i * 3 + 1] = -H;
      if (arr[i * 3 + 1] < -H) arr[i * 3 + 1] = H;
    }
    pos.needsUpdate = true;
    const u = this.points.material.uniforms;
    u.uPxPerUnit.value = bufferH / (2 * cam.halfH);
    u.uEyeZ.value = cam.eyeZ;
    u.uTime.value = this.t;
    (u.uColor.value as THREE.Color).set(B.color);
    u.uRing.value = B.ring;
    u.uOpacity.value = opacity;
  }
}

// ───────────── 流星 ─────────────
const meteorVert = /* glsl */ `
  attribute float aSide;
  attribute float aAlong;
  uniform vec3 uHead, uTail;
  uniform float uWidth;
  uniform vec2 uRes;
  varying float vAlong;
  varying float vSide;
  void main() {
    vec4 h = projectionMatrix * viewMatrix * vec4(uHead, 1.0);
    vec4 t = projectionMatrix * viewMatrix * vec4(uTail, 1.0);
    vec2 hs = h.xy / h.w * uRes;
    vec2 ts = t.xy / t.w * uRes;
    vec2 dir = normalize(hs - ts + 1e-5);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec4 c = mix(h, t, aAlong);
    vec2 s = c.xy / c.w * uRes;
    // 头圆一点：头端往前多伸半个宽度
    s += nrm * aSide * uWidth * (1.0 - aAlong * 0.85) + dir * uWidth * (1.0 - aAlong) * 0.8;
    gl_Position = vec4(s / uRes * c.w, c.z, c.w);
    vAlong = aAlong;
    vSide = aSide;
  }
`;
const meteorFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha, uBright;
  varying float vAlong;
  varying float vSide;
  void main() {
    float across = 1.0 - vSide * vSide;
    float along = pow(clamp(1.0 - vAlong, 0.0, 1.0), 2.2);
    float head = exp(-vAlong * 38.0) * 2.5;
    gl_FragColor = vec4(uColor * (along + head) * across * uAlpha * uBright, 1.0);
  }
`;

interface Meteor {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  start: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  life: number;
  age: number;
  trail: number;
  alive: boolean;
  onHead?: (p: THREE.Vector3, u: number) => void;
}

export class Meteors {
  readonly group = new THREE.Group();
  private pool: Meteor[] = [];
  private nextIn = 3;
  /** 有流星出现时通知外面（月亮会转头看它） */
  onSpawn?: (m: { head: () => THREE.Vector3; life: number }) => void;
  enabled = true;

  constructor() {
    const g = new THREE.BufferGeometry();
    // 4 个顶点：头左、头右、尾左、尾右
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setAttribute("aSide", new THREE.BufferAttribute(new Float32Array([-1, 1, -1, 1]), 1));
    g.setAttribute("aAlong", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 1]), 1));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.ShaderMaterial({
        uniforms: {
          uHead: { value: new THREE.Vector3() },
          uTail: { value: new THREE.Vector3() },
          uWidth: { value: 2 },
          uRes: { value: new THREE.Vector2(1, 1) },
          uColor: { value: new THREE.Color(params.meteors.color) },
          uAlpha: { value: 0 },
          uBright: { value: params.meteors.brightness },
        },
        vertexShader: meteorVert,
        fragmentShader: meteorFrag,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = -50;
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push({ mesh, start: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 1, life: 1, age: 0, trail: 1, alive: false });
    }
  }

  /** 放一颗流星。不给参数 = 背景里随机一颗。 */
  spawn(cam: WindowCamera, opts: { start?: THREE.Vector3; dir?: THREE.Vector3; speed?: number; life?: number; trail?: number } = {}) {
    const m = this.pool.find((x) => !x.alive);
    if (!m) return null;
    const M = params.meteors;
    const depth = rand(M.depthMin, M.depthMax);
    const ext = cam.extentAt(depth);
    m.start.copy(opts.start ?? new THREE.Vector3(rand(-ext.w * 0.9, ext.w * 0.9), rand(0, ext.h * 0.9), -depth));
    // 大多斜着往下划
    const a = rand(-Math.PI * 0.85, -Math.PI * 0.15) + (Math.random() < 0.5 ? 0 : 0);
    m.dir.copy(opts.dir ?? new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.6 - 0.2, rand(-0.1, 0.1)).normalize());
    m.speed = opts.speed ?? M.speed * rand(0.7, 1.3) * (depth / 6);
    m.life = opts.life ?? M.life * rand(0.7, 1.3);
    m.trail = opts.trail ?? M.trail * rand(0.6, 1.2) * (depth / 6);
    m.age = 0;
    m.alive = true;
    m.mesh.visible = true;
    const head = () => m.start.clone().addScaledVector(m.dir, m.speed * m.age);
    this.onSpawn?.({ head, life: m.life });
    return m;
  }

  update(dt: number, cam: WindowCamera, bufferW: number, bufferH: number, visibility: number) {
    const M = params.meteors;
    if (this.enabled && visibility > 0.2) {
      this.nextIn -= dt;
      if (this.nextIn <= 0) {
        this.spawn(cam);
        this.nextIn = Math.max(1.5, expRandom(M.interval));
      }
    }
    for (const m of this.pool) {
      if (!m.alive) continue;
      m.age += dt;
      const u = m.age / m.life;
      if (u >= 1) {
        m.alive = false;
        m.mesh.visible = false;
        continue;
      }
      const head = m.start.clone().addScaledVector(m.dir, m.speed * m.age);
      const tailLen = m.trail * Math.min(1, u * 3) * (1 - Math.max(0, u - 0.7) / 0.3);
      const tail = head.clone().addScaledVector(m.dir, -Math.max(0.001, tailLen));
      const un = m.mesh.material.uniforms;
      (un.uHead.value as THREE.Vector3).copy(head);
      (un.uTail.value as THREE.Vector3).copy(tail);
      (un.uRes.value as THREE.Vector2).set(bufferW / 2, bufferH / 2);
      un.uWidth.value = M.width * (bufferH / 900);
      un.uAlpha.value = Math.sin(Math.PI * Math.min(1, u * 1.15)) * visibility;
      un.uBright.value = M.brightness;
      (un.uColor.value as THREE.Color).set(M.color);
    }
  }
}

// ───────────── 地照（屏幕下方的微光） ─────────────
export class EarthGlow {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  constructor() {
    const E = params.earthglow;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: { uInner: { value: new THREE.Color(E.inner) }, uOuter: { value: new THREE.Color(E.outer) }, uStrength: { value: E.strength } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uInner, uOuter; uniform float uStrength; varying vec2 vUv;
          void main() {
            vec2 p = (vUv - vec2(0.5, 0.0)) * vec2(2.0, 1.0);
            float r = length(p);
            float g = exp(-r * r * 2.6);
            vec3 c = mix(uOuter, uInner, exp(-r * r * 9.0));
            gl_FragColor = vec4(c * g * uStrength, 1.0);
          }
        `,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -60;
  }
  update(cam: WindowCamera, night: number) {
    const E = params.earthglow;
    const ext = cam.extentAt(E.depth);
    this.mesh.position.set(0, -ext.h - E.height * 0.08, -E.depth);
    this.mesh.scale.set(E.width, E.height, 1);
    const u = this.mesh.material.uniforms;
    (u.uInner.value as THREE.Color).set(E.inner);
    (u.uOuter.value as THREE.Color).set(E.outer);
    u.uStrength.value = E.strength * lerp(E.day, E.night, night);
  }
}

// ───────────── 白天的云 ─────────────
const cloudFrag = /* glsl */ `
  float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  uniform float uTime, uCoverage, uOpacity, uSeed, uSunset;
  uniform vec3 uColor, uShade, uSunsetColor;
  varying vec2 vUv;
  float hash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.02 + 7.1; a *= 0.5; } return s; }
  void main() {
    vec2 p = vUv * vec2(3.0, 2.2) + vec2(uTime + uSeed, uSeed * 0.37);
    float n = fbm(p);
    float d = fbm(p * 1.9 + 3.3);
    float c = sstep(1.0 - uCoverage, 1.0 - uCoverage + 0.28, n * 0.8 + d * 0.35);
    float shade = sstep(0.2, 0.9, fbm(p + vec2(0.0, 0.18)));
    vec3 col = mix(uColor, uShade, shade * 0.55);
    col = mix(col, uSunsetColor, uSunset * (0.35 + 0.65 * shade));
    float edge = sstep(0.0, 0.2, vUv.x) * sstep(1.0, 0.8, vUv.x) * sstep(0.0, 0.25, vUv.y) * sstep(1.0, 0.75, vUv.y);
    gl_FragColor = vec4(col, c * uOpacity * edge);
  }
`;

export class Clouds {
  readonly group = new THREE.Group();
  private layers: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private t = 0;
  private depths = [9, 4.5];
  private tmp = new THREE.Vector3();
  constructor() {
    this.depths.forEach((d, i) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uCoverage: { value: 0.4 },
            uOpacity: { value: 0 },
            uSeed: { value: i * 13.7 },
            uSunset: { value: 0 },
            uColor: { value: new THREE.Color() },
            uShade: { value: new THREE.Color() },
            uSunsetColor: { value: new THREE.Color() },
          },
          vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: cloudFrag,
          transparent: true,
          depthWrite: false,
        })
      );
      m.renderOrder = -70 + i;
      m.frustumCulled = false;
      this.layers.push(m);
      this.group.add(m);
    });
  }
  update(dt: number, cam: WindowCamera, day: number, sunset: number) {
    this.t += dt;
    const C = params.clouds;
    this.group.visible = day > 0.01;
    this.depths.forEach((d, i) => {
      const m = this.layers[i];
      const ext = cam.extentAt(d);
      m.position.copy(cam.layerOffset(d, 0.5, this.tmp)).setZ(-d);
      m.position.y += ext.h * 0.25;
      m.scale.set(ext.w * 2.6, ext.h * 1.5, 1);
      const u = m.material.uniforms;
      u.uTime.value = this.t * C.speed * (i === 0 ? 0.6 : 1);
      u.uCoverage.value = C.coverage * (i === 0 ? 0.9 : 0.7);
      u.uOpacity.value = C.opacity * day * (i === 0 ? 0.75 : 1);
      u.uSunset.value = sunset;
      (u.uColor.value as THREE.Color).set(C.color);
      (u.uShade.value as THREE.Color).set(C.shade);
      (u.uSunsetColor.value as THREE.Color).set(C.sunsetColor);
    });
  }
}
