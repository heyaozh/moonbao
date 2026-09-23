// 夜空：三层远星（越远越暗越冷、视差越大）+ 月亮前面的几粒虚化尘埃。
// 全部是 Points + 一个小 shader；星星数量上千也只是一次 draw call。

import * as THREE from "three";
import { drift, lerp } from "./math";
import { params } from "./params";

const vert = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  uniform float uPx;      // 屏幕平面上 1 世界单位 = 多少像素 × 眼距
  uniform float uTime;
  uniform float uTwinkle;
  uniform float uTwinkleSpeed;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPx / -mv.z;
    float tw = 1.0 - uTwinkle * 0.5 * (1.0 + sin(uTime * uTwinkleSpeed * (0.6 + aPhase) + aPhase * 6.2831));
    vAlpha = tw;
  }
`;
const frag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBrightness;
  uniform float uVisibility;
  uniform float uSoft;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, uSoft, d);
    gl_FragColor = vec4(uColor * uBrightness, a * vAlpha * uVisibility);
    #include <colorspace_fragment>
  }
`;

function makeMaterial(color: string, brightness: number, soft: number) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uPx: { value: 300 },
      uTime: { value: 0 },
      uTwinkle: { value: params.stars.twinkle },
      uTwinkleSpeed: { value: params.stars.twinkleSpeed },
      uColor: { value: new THREE.Color(color) },
      uBrightness: { value: brightness },
      uVisibility: { value: 1 },
      uSoft: { value: soft },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export class Sky {
  readonly group = new THREE.Group();
  private layers: THREE.Points[] = [];
  private dust!: THREE.Points;
  private dustVel: Float32Array;
  private dustSeed: Float32Array;
  private t = 0;

  constructor() {
    const ez = params.space.eyeDistance;
    for (const L of params.stars.layers) {
      // 该深度处能看见的半范围 ≈ (ez + depth)/ez × 窗半宽；乘 spread 保证倾斜时不露边
      const ext = ((ez + L.depth) / ez) * 2.0 * params.stars.spread;
      const pos = new Float32Array(L.count * 3);
      const size = new Float32Array(L.count);
      const phase = new Float32Array(L.count);
      for (let i = 0; i < L.count; i++) {
        pos[i * 3] = (Math.random() * 2 - 1) * ext;
        pos[i * 3 + 1] = (Math.random() * 2 - 1) * ext;
        pos[i * 3 + 2] = -L.depth * (0.8 + Math.random() * 0.4);
        size[i] = L.size * (0.6 + Math.random() * 0.9) * (Math.random() < 0.06 ? 1.8 : 1);
        phase[i] = Math.random();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
      geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
      const pts = new THREE.Points(geo, makeMaterial(L.color, L.brightness, 0.25));
      pts.frustumCulled = false;
      this.layers.push(pts);
      this.group.add(pts);
    }

    const D = params.stars.dust;
    const pos = new Float32Array(D.count * 3);
    const size = new Float32Array(D.count);
    const phase = new Float32Array(D.count);
    this.dustVel = new Float32Array(D.count * 2);
    this.dustSeed = new Float32Array(D.count);
    for (let i = 0; i < D.count; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 1.6;
      pos[i * 3 + 1] = (Math.random() * 2 - 1) * 1.6;
      pos[i * 3 + 2] = -lerp(D.depthMin, D.depthMax, Math.random());
      size[i] = D.size * (0.5 + Math.random());
      phase[i] = Math.random();
      this.dustSeed[i] = Math.random() * 1000;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    const mat = makeMaterial(D.color, 1, 0.0);
    mat.uniforms.uVisibility.value = D.opacity;
    mat.uniforms.uTwinkle.value = 0.15;
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  /** @param pxPerUnit 屏幕平面上 1 世界单位 = 多少像素
   *  @param eye 观察者相对窗中心的偏移：用来抵消远层的视差（远星 ≈ 无穷远，头动它不动） */
  update(dt: number, pxPerUnit: number, starVisibility: number, eye: { x: number; y: number }) {
    this.t += dt;
    const uPx = pxPerUnit * params.space.eyeDistance;
    const ez = params.space.eyeDistance;
    this.layers.forEach((L, i) => {
      const cfg = params.stars.layers[i];
      // 深度 d 处的点在窗上的位移 = eye·d/(ez+d)；把整层反向平移 eye·d/ez·(1-parallax) 就抵消掉 (1-parallax) 的份
      const k = (cfg.depth / ez) * (1 - cfg.parallax);
      L.position.set(-eye.x * k, -eye.y * k, 0);
    });
    for (const L of this.layers) {
      const u = (L.material as THREE.ShaderMaterial).uniforms;
      u.uPx.value = uPx;
      u.uTime.value = this.t;
      u.uTwinkle.value = params.stars.twinkle;
      u.uTwinkleSpeed.value = params.stars.twinkleSpeed;
      u.uVisibility.value = starVisibility;
    }
    const du = (this.dust.material as THREE.ShaderMaterial).uniforms;
    du.uPx.value = uPx;
    du.uTime.value = this.t;
    du.uVisibility.value = params.stars.dust.opacity * (0.4 + 0.6 * starVisibility);
    // 尘埃缓慢飘：噪声驱动，偶尔从月亮前面划过
    const pos = this.dust.geometry.getAttribute("position") as THREE.BufferAttribute;
    const v = params.stars.dust.driftSpeed;
    for (let i = 0; i < pos.count; i++) {
      const s = this.dustSeed[i];
      let x = pos.getX(i) + drift(this.t * 0.15 + s, 1) * v * dt * 8;
      let y = pos.getY(i) + (drift(this.t * 0.12 + s, 2) * 0.5 + 0.25) * v * dt * 8;
      if (x > 1.9) x = -1.9;
      if (x < -1.9) x = 1.9;
      if (y > 1.9) y = -1.9;
      if (y < -1.9) y = 1.9;
      pos.setXY(i, x, y);
    }
    pos.needsUpdate = true;
  }
}

/** 背景渐变：一块放在最远处的大平面，颜色按屏幕高度插值（屏幕空间，不随倾斜视差）。
 *  放进 WebGL 而不是 CSS，是为了截图 / GIF 自带天空。 */
export class SkyBackdrop {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  constructor() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; uniform float uHeight;
        void main(){
          float y = gl_FragCoord.y / uHeight; // 0 = 底，1 = 顶
          vec3 c = y < 0.45 ? mix(uBottom, uMid, y / 0.45) : mix(uMid, uTop, (y - 0.45) / 0.55);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      uniforms: {
        uTop: { value: new THREE.Color("#050916") },
        uMid: { value: new THREE.Color("#0c1530") },
        uBottom: { value: new THREE.Color("#182448") },
        uHeight: { value: 1000 },
      },
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat);
    this.mesh.position.z = -40;
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }
  set(top: string, mid: string, bottom: string, heightPx: number) {
    const u = this.mesh.material.uniforms;
    (u.uTop.value as THREE.Color).set(top);
    (u.uMid.value as THREE.Color).set(mid);
    (u.uBottom.value as THREE.Color).set(bottom);
    u.uHeight.value = heightPx;
  }
}

/** 占位背景：按钟点在关键色之间插值，返回 [top, mid, bottom] 与「夜的程度」0..1。 */
export function skyColorsAt(hour: number): { top: string; mid: string; bottom: string; night: number } {
  const stops = params.sky.stops;
  let i = 0;
  while (i < stops.length - 2 && stops[i + 1].hour <= hour) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const t = (hour - a.hour) / (b.hour - a.hour);
  const mix = (x: string, y: string) => "#" + new THREE.Color(x).lerp(new THREE.Color(y), t).getHexString();
  // 夜的程度：0~5 与 20~24 = 1，正午 = 0
  const night = hour < 5 || hour >= 20 ? 1 : hour < 8 ? 1 - (hour - 5) / 3 : hour >= 17 ? (hour - 17) / 3 : 0;
  return { top: mix(a.top, b.top), mid: mix(a.mid, b.mid), bottom: mix(a.bottom, b.bottom), night };
}
