// 天球层：NASA 真实银河 + 星表里的真实恒星，按用户所在地和时间摆正（world.ts 算好 世界 → 赤道 的旋转）。
// 这一层画在「无穷远」：每个像素的方向 = 从一个虚拟眼睛穿过窗上这一点。虚拟眼睛只跟真实眼睛移动 m 倍，
// m = params 里的 parallax（2026-09-23 用户：远处的星空「不太动」）。
// 所以它不需要球体几何：银河是全屏四边形逐像素算方向，恒星是点精灵直接算屏幕位置。

import * as THREE from "three";
import { params } from "../moon/params";
import { asset } from "../asset";

/** 两个材质共享的 uniform（同一个对象）；uEyeM / uVis 各自一份（视差可以不同）。 */
const commonUniforms = () => ({
  uW2E: { value: new THREE.Matrix3() },
  uE2W: { value: new THREE.Matrix3() },
  uHalf: { value: new THREE.Vector2(1, 1) },
  uTime: { value: 0 },
});

const milkyVert = /* glsl */ `
  varying vec2 vNdc;
  void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.99998, 1.0); }
`;
const milkyFrag = /* glsl */ `
  float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  uniform sampler2D uTex;
  uniform mat3 uW2E;
  uniform vec3 uEyeM;
  uniform vec2 uHalf;
  uniform float uVis, uGain, uBlack, uContrast, uSat, uNebula, uTime, uAutoK;
  uniform vec3 uTintLow, uTintMid, uTintHigh, uNebA, uNebB;
  varying vec2 vNdc;
  const float PI = 3.14159265;
  float hash3(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
  void main() {
    vec3 W = vec3(vNdc * uHalf, 0.0);
    vec3 d = normalize(W - uEyeM);
    vec3 e = uW2E * d;
    float ra = atan(e.y, e.x);
    float dec = asin(clamp(e.z, -1.0, 1.0));
    vec2 uv = vec2(fract(0.5 - ra / (2.0 * PI)), 0.5 + dec / PI);
    // 赤经 0/360 接缝：导数取连续的那一个，避免一条细线
    vec2 uv2 = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
    vec2 dx = dFdx(uv), dy = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
    if (dot(dx, dx) + dot(dy, dy) > dot(dx2, dx2) + dot(dy2, dy2)) { dx = dx2; dy = dy2; }
    vec3 c = textureGrad(uTex, uv, dx, dy).rgb;
    c = max(c - uBlack, 0.0) / (1.0 - uBlack);
    c *= uAutoK; // 自动曝光：画面里的这段银河偏暗时先提亮（上对比之前）
    c = pow(max(c, vec3(0.0)), vec3(uContrast));
    float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 chroma = c / max(L, 1e-4);
    float lo = sstep(0.0, 0.18, L);
    vec3 tint = mix(uTintLow, uTintMid, sstep(0.02, 0.22, L));
    tint = mix(tint, uTintHigh, sstep(0.2, 0.75, L));
    vec3 col = L * tint * mix(vec3(1.0), chroma, uSat);
    // 淡彩星云：只在银河带上，低频噪声调两种颜色
    float n = fbm(e * 3.1 + vec3(0.0, 0.0, uTime * 0.002));
    float n2 = fbm(e * 5.7 + 11.3);
    col += uNebula * lo * sstep(0.35, 0.8, n) * mix(uNebA, uNebB, n2) * 0.22;
    gl_FragColor = vec4(col * uGain * uVis, 1.0);
  }
`;

const starVert = /* glsl */ `
  attribute vec3 aDir;
  attribute float aMag;
  attribute vec3 aColor;
  attribute float aPhase;
  uniform mat3 uE2W;
  uniform vec3 uEyeM;
  uniform vec2 uHalf;
  uniform float uPx, uTime, uVis, uMagLimit, uSizeB, uSizeF, uBriB, uBriF, uTwinkle, uTwinkleSpeed;
  varying vec3 vCol;
  varying float vBri;
  void main() {
    vec3 d = uE2W * aDir;
    if (d.z > -0.02 || aMag > uMagLimit) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    float t = -uEyeM.z / d.z;
    vec3 W = uEyeM + t * d;
    gl_Position = vec4(W.x / uHalf.x, W.y / uHalf.y, 0.99997, 1.0);
    float u = clamp((uMagLimit - aMag) / (uMagLimit + 1.5), 0.0, 1.0);
    float size = mix(uSizeF, uSizeB, pow(u, 1.7));
    float bri = mix(uBriF, uBriB, pow(u, 2.4));
    float tw = sin(uTime * uTwinkleSpeed * (0.6 + aPhase) + aPhase * 40.0) * 0.6 + sin(uTime * uTwinkleSpeed * 2.3 * (0.8 + aPhase) + aPhase * 17.0) * 0.4;
    bri *= 1.0 + uTwinkle * tw * (0.4 + 0.6 * (1.0 - u));
    gl_PointSize = size * uPx * 2.4;
    vCol = aColor;
    vBri = bri * uVis;
  }
`;
const starFrag = /* glsl */ `
  float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  varying vec3 vCol;
  varying float vBri;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p) * 2.0;
    float core = exp(-r * r * 18.0);
    float halo = exp(-r * r * 3.2) * 0.22;
    float a = (core + halo) * sstep(1.0, 0.7, r);
    gl_FragColor = vec4(vCol * vBri * a, 1.0);
  }
`;

/** B-V 色指数 → 近似 RGB（线性）。 */
export function bvToColor(bv: number, sat: number): THREE.Color {
  const b = Math.max(-0.4, Math.min(2.0, bv));
  // Ballesteros 公式：B-V → 温度
  const T = 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
  // 温度 → sRGB（Tanner Helland 近似）
  const t = T / 100;
  let r: number, g: number, bl: number;
  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
    bl = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332);
    g = 288.12 * Math.pow(t - 60, -0.0755);
    bl = 255;
  }
  const c = new THREE.Color().setRGB(Math.min(255, Math.max(0, r)) / 255, Math.min(255, Math.max(0, g)) / 255, Math.min(255, Math.max(0, bl)) / 255, THREE.SRGBColorSpace);
  return c.lerp(new THREE.Color(1, 1, 1), 1 - sat);
}

export class Celestial {
  readonly milky: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private uniforms = commonUniforms();
  private t = 0;

  constructor() {
    const tex = new THREE.TextureLoader().load(asset("sky/milkyway_4k.jpg"), (t) => this.buildLumMap(t.image as HTMLImageElement));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const M = params.sky.milkyWay;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uEyeM: { value: new THREE.Vector3(0, 0, 2) },
        uVis: { value: 1 },
        uTex: { value: tex },
        uGain: { value: M.gain },
        uAutoK: { value: 1 },
        uBlack: { value: M.black },
        uContrast: { value: M.contrast },
        uSat: { value: M.saturation },
        uNebula: { value: M.nebula },
        uTintLow: { value: new THREE.Color(M.tintLow) },
        uTintMid: { value: new THREE.Color(M.tintMid) },
        uTintHigh: { value: new THREE.Color(M.tintHigh) },
        uNebA: { value: new THREE.Color(M.nebulaA) },
        uNebB: { value: new THREE.Color(M.nebulaB) },
      },
      vertexShader: milkyVert,
      fragmentShader: milkyFrag,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
    });
    this.milky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.milky.frustumCulled = false;
    this.milky.renderOrder = -90;

    const S = params.sky.stars;
    const smat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uEyeM: { value: new THREE.Vector3(0, 0, 2) },
        uVis: { value: 1 },
        uPx: { value: 1 },
        uMagLimit: { value: S.magLimit },
        uSizeB: { value: S.sizeBright },
        uSizeF: { value: S.sizeFaint },
        uBriB: { value: S.brightBright },
        uBriF: { value: S.brightFaint },
        uTwinkle: { value: S.twinkle },
        uTwinkleSpeed: { value: S.twinkleSpeed },
      },
      vertexShader: starVert,
      fragmentShader: starFrag,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
    });
    this.stars = new THREE.Points(new THREE.BufferGeometry(), smat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -85;
    void this.loadStars();
  }

  private async loadStars() {
    // 星表：扁平数组 [ra_rad, dec_rad, mag, bv] × N（JSON：任何静态托管都认这个类型）
    const res = await fetch(asset("sky/stars.json"));
    const buf = Float32Array.from(((await res.json()) as { data: number[] }).data);
    const n = buf.length / 4;
    const dir = new Float32Array(n * 3);
    const mag = new Float32Array(n);
    const color = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    const sat = params.sky.stars.colorSaturation;
    for (let i = 0; i < n; i++) {
      const ra = buf[i * 4];
      const dec = buf[i * 4 + 1];
      const c = Math.cos(dec);
      dir[i * 3] = c * Math.cos(ra);
      dir[i * 3 + 1] = c * Math.sin(ra);
      dir[i * 3 + 2] = Math.sin(dec);
      mag[i] = buf[i * 4 + 2];
      const col = bvToColor(buf[i * 4 + 3], sat);
      color[i * 3] = col.r;
      color[i * 3 + 1] = col.g;
      color[i * 3 + 2] = col.b;
      phase[i] = Math.random();
    }
    const g = this.stars.geometry;
    // three 需要 position 属性来决定绘制数量；方向放在 aDir
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aDir", new THREE.BufferAttribute(dir, 3));
    g.setAttribute("aMag", new THREE.BufferAttribute(mag, 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  }

  // ---- 银河自动曝光：在 CPU 上用缩小的亮度图估「画面里这段银河有多亮」 ----
  private lum: Float32Array | null = null;
  private readonly lumW = 512;
  private readonly lumH = 256;
  private autoK = 1;
  private autoTarget = 1;
  private autoFor: number[] | null = null;
  private autoHalf = "";

  private buildLumMap(img: HTMLImageElement) {
    try {
      const c = document.createElement("canvas");
      c.width = this.lumW;
      c.height = this.lumH;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, this.lumW, this.lumH);
      const d = g.getImageData(0, 0, this.lumW, this.lumH).data;
      const lin = (v: number) => {
        const x = v / 255;
        return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      };
      const m = new Float32Array(this.lumW * this.lumH);
      for (let i = 0; i < m.length; i++) m[i] = 0.2126 * lin(d[i * 4]) + 0.7152 * lin(d[i * 4 + 1]) + 0.0722 * lin(d[i * 4 + 2]);
      this.lum = m;
      this.autoFor = null;
    } catch {
      this.lum = null; // 读不到像素（跨源等）：不做自动曝光
    }
  }

  /** 画面里（窗平面 9×15 个方向）银河亮度的 p90 → 要提亮几倍 */
  private measureBand(w2e: number[], half: { w: number; h: number }, eyeZ: number) {
    const M = params.sky.milkyWay;
    const L = this.lum;
    if (!L) return 1;
    const vals: number[] = [];
    for (let iy = 0; iy < 15; iy++) {
      for (let ix = 0; ix < 9; ix++) {
        let dx = ((ix / 8) * 2 - 1) * half.w;
        let dy = ((iy / 14) * 2 - 1) * half.h;
        let dz = -eyeZ;
        const l = Math.hypot(dx, dy, dz);
        dx /= l;
        dy /= l;
        dz /= l;
        const ex = w2e[0] * dx + w2e[1] * dy + w2e[2] * dz;
        const ey = w2e[3] * dx + w2e[4] * dy + w2e[5] * dz;
        const ez = w2e[6] * dx + w2e[7] * dy + w2e[8] * dz;
        const ra = Math.atan2(ey, ex);
        const dec = Math.asin(Math.max(-1, Math.min(1, ez)));
        const u = (((0.5 - ra / (2 * Math.PI)) % 1) + 1) % 1;
        const v = 0.5 - dec / Math.PI; // 图的行（上 = 北天极）
        const px = Math.min(this.lumW - 1, Math.floor(u * this.lumW));
        const py = Math.min(this.lumH - 1, Math.max(0, Math.floor(v * this.lumH)));
        vals.push(Math.max(0, (L[py * this.lumW + px] - M.black) / (1 - M.black)));
      }
    }
    vals.sort((a, b) => a - b);
    const p90 = vals[Math.floor(vals.length * 0.9)];
    return Math.max(1, Math.min(M.autoMax, M.autoTarget / Math.max(p90, 1e-4)));
  }

  /** 当前的自动曝光倍数（调试面板看） */
  get milkyAutoK() {
    return this.autoK;
  }

  /** w2e = 世界方向 → 赤道坐标 的 3×3（行主序 9 个数）。 */
  update(dt: number, w2e: number[], eye: { x: number; y: number }, eyeZ: number, half: { w: number; h: number }, visibility: number, pixelRatio: number) {
    this.t += dt;
    const u = this.uniforms;
    // Matrix3.set 按行主序传参
    (u.uW2E.value as THREE.Matrix3).set(w2e[0], w2e[1], w2e[2], w2e[3], w2e[4], w2e[5], w2e[6], w2e[7], w2e[8]);
    (u.uE2W.value as THREE.Matrix3).copy(u.uW2E.value as THREE.Matrix3).transpose();
    (u.uHalf.value as THREE.Vector2).set(half.w, half.h);
    u.uTime.value = this.t;
    const M = params.sky.milkyWay;
    const S = params.sky.stars;
    const mu = this.milky.material.uniforms;
    (mu.uEyeM.value as THREE.Vector3).set(eye.x * M.parallax, eye.y * M.parallax, eyeZ);
    mu.uVis.value = visibility;
    mu.uGain.value = M.gain;
    // 取景变了（每分钟 / 改尺寸）才重估；倍数慢慢过去（1.5 秒），不会一跳
    const halfKey = `${half.w.toFixed(3)}|${half.h.toFixed(3)}`;
    if (w2e !== this.autoFor || halfKey !== this.autoHalf) {
      this.autoFor = w2e;
      this.autoHalf = halfKey;
      this.autoTarget = M.auto ? this.measureBand(w2e, half, eyeZ) : 1;
    }
    if (!M.auto) this.autoTarget = 1;
    this.autoK += (this.autoTarget - this.autoK) * (1 - Math.exp(-dt / 1.5));
    mu.uAutoK.value = this.autoK;
    mu.uBlack.value = M.black;
    mu.uContrast.value = M.contrast;
    mu.uSat.value = M.saturation;
    mu.uNebula.value = M.nebula;
    (mu.uTintLow.value as THREE.Color).set(M.tintLow);
    (mu.uTintMid.value as THREE.Color).set(M.tintMid);
    (mu.uTintHigh.value as THREE.Color).set(M.tintHigh);
    (mu.uNebA.value as THREE.Color).set(M.nebulaA);
    (mu.uNebB.value as THREE.Color).set(M.nebulaB);
    const su = this.stars.material.uniforms;
    (su.uEyeM.value as THREE.Vector3).set(eye.x * S.parallax, eye.y * S.parallax, eyeZ);
    su.uVis.value = visibility;
    su.uPx.value = pixelRatio;
    su.uMagLimit.value = S.magLimit;
    su.uSizeB.value = S.sizeBright;
    su.uSizeF.value = S.sizeFaint;
    su.uBriB.value = S.brightBright;
    su.uBriF.value = S.brightFaint;
    su.uTwinkle.value = S.twinkle;
    su.uTwinkleSpeed.value = S.twinkleSpeed;
  }
}
