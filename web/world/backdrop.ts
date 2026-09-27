// 天空底色：屏幕空间的三色渐变，按太阳高度角在 params.sky.gradient 的关键色之间插值。
// 夜里是深海军蓝（不是纯黑）——概念图里「无限深的藏青色星空」。

import * as THREE from "three";
import { clamp } from "../moon/math";
import { params } from "../moon/params";

const col = (hex: string) => new THREE.Color(hex);

export interface SkyTone {
  top: THREE.Color;
  mid: THREE.Color;
  bottom: THREE.Color;
  /** 夜的程度 0..1（1 = 全黑夜，星星全亮） */
  night: number;
  /** 太阳高度（度） */
  sunAltDeg: number;
}

/** 按太阳高度角插值天空关键色。 */
export function skyToneAt(sunAltDeg: number): SkyTone {
  const g = params.sky.gradient;
  const a = clamp(sunAltDeg, g[0].alt, g[g.length - 1].alt);
  let i = 0;
  while (i < g.length - 2 && a > g[i + 1].alt) i++;
  const A = g[i];
  const B = g[i + 1];
  const t = clamp((a - A.alt) / (B.alt - A.alt), 0, 1);
  const s = t * t * (3 - 2 * t);
  return {
    top: col(A.top).lerp(col(B.top), s),
    mid: col(A.mid).lerp(col(B.mid), s),
    bottom: col(A.bottom).lerp(col(B.bottom), s),
    // 太阳在 -12° 以下算全夜，-2° 以上星星基本看不见
    night: clamp((-2 - sunAltDeg) / 10, 0, 1),
    sunAltDeg,
  };
}

export class Backdrop {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(0, 0, 0) },
        uMid: { value: new THREE.Color(0, 0, 0) },
        uBottom: { value: new THREE.Color(0, 0, 0) },
        uEye: { value: new THREE.Vector2() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.99999, 1.0); }
      `,
      fragmentShader: /* glsl */ `
  float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
        uniform vec3 uTop, uMid, uBottom;
        uniform vec2 uEye;
        varying vec2 vUv;
        void main() {
          // 倾斜时渐变跟着动一点点，像天是一个很远的穹顶
          float y = clamp(vUv.y + uEye.y * 0.04, 0.0, 1.0);
          vec3 c = y > 0.45 ? mix(uMid, uTop, sstep(0.45, 1.0, y)) : mix(uBottom, uMid, sstep(0.0, 0.45, y));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
  }

  update(tone: SkyTone, eye: { x: number; y: number }) {
    const u = this.mesh.material.uniforms;
    (u.uTop.value as THREE.Color).copy(tone.top);
    (u.uMid.value as THREE.Color).copy(tone.mid);
    (u.uBottom.value as THREE.Color).copy(tone.bottom);
    (u.uEye.value as THREE.Vector2).set(eye.x, eye.y);
  }
}
