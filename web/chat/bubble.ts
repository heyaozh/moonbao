// 用户的话 = 黑洞气泡（2026-09-26 用户：聊天框像黑洞中浮现的字幕，边缘扭曲背景光像爱因斯坦环；倾斜时只漂浮不变形）。
// 做法：前景场景以「背景层渲染图」为底；气泡平面比圆角矩形大一圈，
//   外圈：按「离边越近偏折越大」往里采样背景 → 背后的星光被弯成环；贴边一道细光子环 + 一道更弱的外弧；
//   里面：近黑的深蓝 + 缓慢的旋涡噪声；字画在最上层，永不扭曲。
// 同一个着色器也画「语音黑洞」：形状从小圆长大（uForm），漩涡强度跟着音量（uSwirl）。
// 窗相机的离轴投影下，和屏幕平行的平面只平移缩放、不会被拉歪——所以倾斜时它天然「只漂浮」。

import * as THREE from "three";
import { params } from "../moon/params";
import { layoutUser, UI_FONT } from "./glyphs";

const vert = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const frag = /* glsl */ `
  uniform sampler2D uBg;
  uniform sampler2D uText;
  uniform vec2 uRes;
  uniform vec2 uHalf;        // 圆角矩形半宽高（世界单位）
  uniform float uRadius;     // 圆角
  uniform float uForm;       // 0 = 奇点 … 1 = 完整气泡
  uniform float uLens;       // 透镜强度
  uniform float uSwirl;      // 漩涡（语音时跟着音量）
  uniform float uMargin;     // 透镜影响的外圈宽度
  uniform float uPxPerUnit;  // 这个深度上 1 世界单位 = 多少缓冲像素
  uniform float uTime;
  uniform float uOpacity;
  uniform float uTail;       // 小尾巴（0 = 没有）
  uniform float uTextAlpha;
  uniform float uCheap;      // 1 = 旧气泡：不采样背景，只画环和字
  uniform vec3 uRing, uRing2, uInner, uTextColor;
  varying vec2 vP;
  float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
  float sdTri(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 e0 = b - a, e1 = c - b, e2 = a - c;
    vec2 v0 = p - a, v1 = p - b, v2 = p - c;
    vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    float s = sign(e0.x * e2.y - e0.y * e2.x);
    vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
    return -sqrt(d.x) * sign(d.y);
  }
  float shape(vec2 p) {
    float f = sstep(0.0, 1.0, uForm);
    float r0 = min(uHalf.x, uHalf.y) * 0.18 + 0.02;
    // 奇点从尾巴那一侧长出来
    vec2 seed = vec2(uHalf.x - uRadius, -uHalf.y + uRadius);
    vec2 c = mix(seed, vec2(0.0), f);
    vec2 h = mix(vec2(r0), uHalf, f);
    float r = mix(r0, uRadius, f);
    float d = sdRoundBox(p - c, h, r);
    if (uTail > 0.0) {
      vec2 a = vec2(uHalf.x - uRadius * 1.6, -uHalf.y + 0.02);
      vec2 b = vec2(uHalf.x + uRadius * 0.55, -uHalf.y - uRadius * 0.35);
      vec2 cc = vec2(uHalf.x - uRadius * 0.2, -uHalf.y + uRadius * 0.9);
      d = smin(d, sdTri(p, a, b, cc), uRadius * 0.35 * uTail * f + 1e-4);
    }
    return d;
  }
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    float d = shape(vP);
    vec2 suv = gl_FragCoord.xy / uRes;
    // 形状的外法线（数值梯度）
    vec2 e = vec2(0.0025, 0.0);
    vec2 n = normalize(vec2(shape(vP + e.xy) - shape(vP - e.xy), shape(vP + e.yx) - shape(vP - e.yx)) + 1e-6);
    vec2 t = vec2(-n.y, n.x);
    float zone = 1.0 - sstep(0.0, uMargin, d);
    vec3 col;
    if (uCheap < 0.5) {
      // 引力透镜：离边越近偏折越大，往「背后」采样（背后的星光被弯到边上一圈）
      float k = uLens * 0.02 / (max(d, 0.0) + 0.018);
      vec2 disp = -n * k + t * k * 0.45 * (0.35 + uSwirl);
      vec2 suv2 = suv + disp * uPxPerUnit / uRes;
      // 语音黑洞：整体旋涡
      if (uSwirl > 0.001) {
        float ang = uSwirl * 0.9 / (length(vP) + 0.06);
        vec2 cs = vec2(cos(ang), sin(ang));
        vec2 rp = vec2(vP.x * cs.x - vP.y * cs.y, vP.x * cs.y + vP.y * cs.x) - vP;
        suv2 += rp * uPxPerUnit / uRes * zone;
      }
      vec3 bent = texture2D(uBg, suv2).rgb;
      // 第二个像（更弱，反方向）
      vec3 ghost = texture2D(uBg, suv + n * k * 1.8 * uPxPerUnit / uRes).rgb;
      vec3 bg = texture2D(uBg, suv).rgb;
      col = mix(bg, bent * 1.25 + ghost * 0.18, zone);
    } else {
      col = vec3(0.0);
    }
    // 光子环：紧贴边缘一道细亮环（一侧更亮，像多普勒增亮）+ 更外一道弱弧
    float ang = atan(vP.y, vP.x);
    float asym = 0.55 + 0.45 * cos(ang - 0.9 + uTime * 0.15);
    float rq = (d - 0.004) / 0.0045;
    float ring = exp(-rq * rq);
    float rq2 = (d - 0.026) / 0.009;
    float ring2 = exp(-rq2 * rq2) * 0.35;
    float halo = exp(-max(d, 0.0) / 0.05) * 0.12;
    col += (uRing * ring * (0.7 + 0.9 * asym) + uRing2 * (ring2 + halo) * asym) * uLens * sstep(0.2, 0.6, uForm + 0.2);
    // 里面：近黑的深蓝，缓慢的旋涡噪声，贴边一圈内发光
    float inside = sstep(0.002, -0.002, d);
    if (inside > 0.0) {
      float r = length(vP);
      float sw = atan(vP.y, vP.x) + uTime * (0.25 + uSwirl * 2.0) + 3.0 / (r + 0.3);
      float nn = noise(vec2(sw * 2.0, r * 9.0 - uTime * 0.4)) * 0.5 + noise(vec2(sw * 5.0, r * 23.0)) * 0.25;
      vec3 inner = uInner * (0.55 + 0.35 * nn) + uRing2 * exp(d / 0.02) * 0.25;
      // 字
      vec2 tuv = vP / uHalf * 0.5 + 0.5;
      float ta = texture2D(uText, tuv).a * uTextAlpha;
      inner = mix(inner, uTextColor, ta);
      col = mix(col, inner, inside * (uCheap > 0.5 ? 0.92 : 1.0));
    }
    float alpha = uCheap > 0.5 ? max(inside * 0.92, clamp(ring + ring2 + halo, 0.0, 1.0)) : 1.0;
    gl_FragColor = vec4(col * uOpacity, alpha * uOpacity);
  }
`;

export class BlackHoleBubble {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private textTex: THREE.CanvasTexture | null = null;
  /** 气泡半宽高（世界单位） */
  half = new THREE.Vector2(0.3, 0.1);
  form = 0;
  private formTarget = 1;
  swirl = 0;
  text = "";
  opacity = 1;
  /** 旧气泡（退到背景场景里）：不能再绑定背景渲染图（会形成反馈环，WebGL 直接跳过这次绘制） */
  cheap = false;
  /** 语音黑洞：圆形 */
  round = false;

  constructor(private bg: () => THREE.Texture, cheapAtStart = false) {
    this.cheap = cheapAtStart;
    const B = params.bubble;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: {
          uBg: { value: null },
          uText: { value: null },
          uRes: { value: new THREE.Vector2(1, 1) },
          uHalf: { value: new THREE.Vector2(0.3, 0.1) },
          uRadius: { value: B.radius },
          uForm: { value: 0 },
          uLens: { value: B.lens },
          uSwirl: { value: 0 },
          uMargin: { value: B.margin },
          uPxPerUnit: { value: 100 },
          uTime: { value: 0 },
          uOpacity: { value: 1 },
          uTail: { value: 1 },
          uTextAlpha: { value: 0 },
          uCheap: { value: cheapAtStart ? 1 : 0 },
          uRing: { value: new THREE.Color(B.ring) },
          uRing2: { value: new THREE.Color(B.ring2) },
          uInner: { value: new THREE.Color(B.inner) },
          uTextColor: { value: new THREE.Color(B.textColor) },
        },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        // 贵的版本自己采样背景，输出的就是最终颜色（不透明）；便宜的旧气泡正常混合
        blending: THREE.NormalBlending,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
  }

  /** 设置文字并按文字量排版气泡大小（unitsPerPx：画布像素 → 世界单位） */
  setText(text: string, unitsPerPx: number, maxWidthPx: number) {
    this.text = text;
    const B = params.bubble;
    const S = Math.min(3, (devicePixelRatio || 1) * 1.5);
    const fontPx = B.fontPx * S;
    const L = layoutUser(text, fontPx, maxWidthPx * S);
    const padX = B.padX * S;
    const padY = B.padY * S;
    const w = Math.ceil(L.width + padX * 2);
    const h = Math.ceil(L.height + padY * 2);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    g.font = `400 ${fontPx}px ${UI_FONT}`;
    g.fillStyle = "#fff";
    g.textBaseline = "alphabetic";
    L.lines.forEach((ln, i) => g.fillText(ln, padX, padY + L.lineH * (i + 0.78)));
    this.textTex?.dispose();
    this.textTex = new THREE.CanvasTexture(c);
    this.textTex.colorSpace = THREE.SRGBColorSpace;
    this.textTex.minFilter = THREE.LinearFilter;
    this.textTex.generateMipmaps = false;
    this.mesh.material.uniforms.uText.value = this.textTex;
    this.half.set((w / S) * unitsPerPx * 0.5, (h / S) * unitsPerPx * 0.5);
  }

  /** 直接定大小（语音黑洞还没有字的时候） */
  setHalf(hx: number, hy: number) {
    this.half.set(hx, hy);
  }

  formTo(v: number) {
    this.formTarget = v;
  }

  update(dt: number, time: number, bufferW: number, bufferH: number, pxPerUnit: number, textAlpha: number) {
    const B = params.bubble;
    this.form += (this.formTarget - this.form) * (1 - Math.exp(-dt * B.formSpeed));
    const u = this.mesh.material.uniforms;
    u.uBg.value = this.cheap ? blackTex() : this.bg();
    u.uCheap.value = this.cheap ? 1 : 0;
    (u.uRes.value as THREE.Vector2).set(bufferW, bufferH);
    (u.uHalf.value as THREE.Vector2).copy(this.half);
    u.uRadius.value = this.round ? Math.min(this.half.x, this.half.y) * 0.999 : Math.min(B.radius, this.half.y * 0.95, this.half.x * 0.95);
    u.uTail.value = this.round ? 0 : 1;
    u.uForm.value = this.form;
    u.uLens.value = B.lens;
    u.uSwirl.value = this.swirl;
    u.uMargin.value = B.margin;
    u.uPxPerUnit.value = pxPerUnit;
    u.uTime.value = time;
    u.uOpacity.value = this.opacity;
    u.uTextAlpha.value = textAlpha;
    (u.uRing.value as THREE.Color).set(B.ring);
    (u.uRing2.value as THREE.Color).set(B.ring2);
    (u.uInner.value as THREE.Color).set(B.inner);
    (u.uTextColor.value as THREE.Color).set(B.textColor);
    // 平面比形状大一圈（透镜要画在外面）
    const m = B.margin * 1.2;
    this.mesh.scale.set(1, 1, 1);
    const g = this.mesh.geometry;
    const hx = this.half.x + m + B.radius * 0.6;
    const hy = this.half.y + m + B.radius * 0.6;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    pos.setXYZ(0, -hx, hy, 0);
    pos.setXYZ(1, hx, hy, 0);
    pos.setXYZ(2, -hx, -hy, 0);
    pos.setXYZ(3, hx, -hy, 0);
    pos.needsUpdate = true;
  }

  dispose() {
    this.textTex?.dispose();
    this.mesh.material.dispose();
    this.mesh.geometry.dispose();
  }
}

let _black: THREE.DataTexture | null = null;
function blackTex() {
  if (!_black) {
    _black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    _black.needsUpdate = true;
  }
  return _black;
}
