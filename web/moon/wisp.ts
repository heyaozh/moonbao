// 你点星空的地方亮起一颗半透明、会发光的小月亮（2026-09-30 用户的点子）：让「它在看那边」读得出来。
// 冒出来（带一点过冲）→ 轻轻浮着、呼吸 → 淡掉。月亮转一点头、眼睛看着它（头转不过 lookMaxDeg，脸一直朝着你）。

import * as THREE from "three";
import { params } from "./params";

const frag = /* glsl */ `
  uniform float uAlpha;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec2 q = (vUv - 0.5) * 2.0;
    float r = length(q);
    float R = 0.42;
    float disc = 1.0 - smoothstep(R - 0.05, R, r);
    // 小月亮的明暗：左上方来的光，柔和的明暗交界
    vec2 s = q / R;
    vec3 n = vec3(s, sqrt(max(0.0, 1.0 - dot(s, s))));
    float lit = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))) * 0.75 + 0.4, 0.0, 1.0);
    float halo = exp(-r * r * 4.0) * 0.5;
    float a = (disc * (0.45 + 0.55 * lit) + halo) * uAlpha;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export class GazeWisp {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private t = 1e9;
  private base = new THREE.Vector3();

  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0 }, uColor: { value: new THREE.Color(params.gaze.wispColor) } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.mesh.visible = false;
    this.mesh.renderOrder = 35;
    this.mesh.frustumCulled = false;
  }

  /** 在世界坐标 p 亮起 */
  show(p: THREE.Vector3) {
    this.base.copy(p);
    this.t = 0;
    this.mesh.visible = true;
  }

  get active() {
    return this.t < params.gaze.wispLife;
  }
  get position() {
    return this.mesh.position;
  }

  update(dt: number) {
    if (!this.mesh.visible) return;
    this.t += dt;
    const G = params.gaze;
    if (this.t >= G.wispLife) {
      this.mesh.visible = false;
      return;
    }
    const u = this.t / G.wispLife;
    // 冒出来：0.35 秒，过冲一点（easeOutBack）
    const k = Math.min(1, this.t / 0.35);
    const pop = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
    const fade = u > 0.65 ? 1 - (u - 0.65) / 0.35 : 1;
    const s = G.wispSize * pop * (1 + 0.06 * Math.sin(this.t * 5));
    this.mesh.scale.set(s, s, 1);
    this.mesh.position.set(this.base.x, this.base.y + Math.sin(this.t * 2.2) * 0.02, this.base.z);
    this.mesh.material.uniforms.uAlpha.value = G.wispOpacity * fade * Math.min(1, this.t / 0.1);
  }
}
