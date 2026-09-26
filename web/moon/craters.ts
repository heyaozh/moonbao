// 程序化陨石坑：启动时在 GPU 上烘焙一张 equirectangular 贴图（R = 高度，G = 反照率调制），运行时零开销。
// 为什么：用户偏好的 NASA 柔和贴图（look-dev 样板）很柔，概念图里的月亮有清楚的小坑。两者叠加，强度用 params.moon.craterDetail 调（0 = 纯样板）。
// 做法：3D 细胞噪声（球面上没有接缝和两极拉伸），每个细胞一个随机坑：碗形凹陷 + 凸起的坑沿；三个尺度叠加。

import * as THREE from "three";

const frag = /* glsl */ `
  varying vec2 vUv;
  uniform float uSeed;
  const float PI = 3.14159265;
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973) + uSeed);
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  // 返回 (高度, 反照率调制)
  vec2 craters(vec3 p, float scale, float density) {
    vec3 q = p * scale;
    vec3 c0 = floor(q);
    float h = 0.0;
    float alb = 0.0;
    for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
    for (int z = -1; z <= 1; z++) {
      vec3 c = c0 + vec3(x, y, z);
      vec3 r = hash33(c);
      if (r.z > density) continue;
      vec3 center = c + 0.2 + 0.6 * hash33(c + 17.0);
      float R = mix(0.16, 0.5, r.x * r.x);
      float d = length(q - center) / R;
      if (d > 1.8) continue;
      float bowl = -(1.0 - d * d) * step(d, 1.0);
      float q1 = (d - 1.0) / 0.16;
      float rim = exp(-q1 * q1) * 0.55;
      float q2 = (d - 1.0) / 0.5;
      float ejecta = exp(-q2 * q2) * 0.08 * step(1.0, d);
      h += (bowl * 0.9 + rim + ejecta) * R;
      float q3 = (d - 1.0) / 0.12;
      alb += (-0.10 * step(d, 0.85) + 0.07 * exp(-q3 * q3)) * (0.6 + 0.4 * r.y);
    }
    return vec2(h, alb);
  }
  void main() {
    float lon = (vUv.x - 0.5) * 2.0 * PI;
    float lat = (vUv.y - 0.5) * PI;
    vec3 n = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
    vec2 a = craters(n, 4.0, 0.55) * 1.0;
    vec2 b = craters(n + 3.1, 9.0, 0.6) * 0.55;
    vec2 c = craters(n + 7.7, 19.0, 0.65) * 0.3;
    vec2 d = craters(n + 11.3, 38.0, 0.6) * 0.16;
    vec2 t = a + b + c + d;
    gl_FragColor = vec4(0.5 + t.x * 0.9, 0.5 + t.y, 0.0, 1.0);
  }
`;

export function bakeCraters(renderer: THREE.WebGLRenderer, width = 2048, height = 1024, seed = 0.37): THREE.Texture {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    wrapS: THREE.RepeatWrapping,
    depthBuffer: false,
  });
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSeed: { value: seed } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: frag,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  scene.add(quad);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  mat.dispose();
  quad.geometry.dispose();
  rt.texture.wrapS = THREE.RepeatWrapping;
  return rt.texture;
}
