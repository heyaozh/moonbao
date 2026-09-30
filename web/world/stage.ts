// 舞台：WebGL 渲染器 + 窗相机 + 两个场景 + 后期。
//
// 为什么两个场景：用户的话在「黑洞」气泡里，气泡边缘要把背后的星光弯成爱因斯坦环——这需要先拿到「气泡背后」的画面。
//   back  = 天空、银河、星星、流星、地照、月亮、往后退的旧对话     → 先渲到 rtBack
//   front = 当前的黑洞气泡、光点写的字、最近处的光斑               → 以 rtBack 为底图渲染，气泡着色器可以采样 rtBack
// 然后：辉光（UnrealBloom）→ 最终合成（色调映射 + 暗角 + 颗粒 + sRGB）。全程 HDR（半精度浮点）。

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { Pass } from "three/addons/postprocessing/Pass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { params } from "../moon/params";
import { WindowCamera } from "./camera";

class LayerPass extends Pass {
  constructor(private stage: Stage) {
    super();
    this.needsSwap = false;
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const s = this.stage;
    renderer.setRenderTarget(s.rtBack);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(s.back, s.cam.camera);
    s.front.background = s.rtBack.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    renderer.clear(true, true, false);
    renderer.render(s.front, s.cam.camera);
  }
}

/** 消毒：NaN / Inf → 0、亮度封顶。任何一个着色器出一个坏像素，都不该被辉光扩散成整屏黑。 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (!(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b)) c = vec3(0.0);
      gl_FragColor = vec4(clamp(c, 0.0, 48.0), 1.0);
    }
  `,
};

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uExposure: { value: 1 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.02 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
  float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
    uniform sampler2D tDiffuse;
    uniform float uExposure, uVignette, uGrain, uTime;
    uniform vec2 uRes;
    varying vec2 vUv;
    // ACES filmic（与 three.js 同一个拟合）
    vec3 RRTAndODTFit(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 aces(vec3 color) {
      const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color *= 1.0 / 0.6;
      color = ACESInputMat * color;
      color = RRTAndODTFit(color);
      color = ACESOutputMat * color;
      return clamp(color, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c) {
      c = max(c, vec3(0.0));
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
    }
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
      vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
      float r = length(p * vec2(1.0, 0.82));
      c *= 1.0 - uVignette * sstep(0.25, 0.95, r);
      c = toSRGB(aces(c));
      float n = hash(vUv * uRes + fract(uTime * 7.13) * 91.7) - 0.5;
      c += n * uGrain + (hash(vUv * uRes * 1.37 + 3.1) - 0.5) / 255.0;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export class Stage {
  readonly gl: THREE.WebGLRenderer;
  readonly cam = new WindowCamera();
  readonly back = new THREE.Scene();
  readonly front = new THREE.Scene();
  rtBack: THREE.WebGLRenderTarget;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private final: ShaderPass;
  width = 1;
  height = 1;
  pixelRatio = 1;
  private t = 0;
  /** 录制用的固定尺寸（null = 跟随窗口） */
  private fixedSize: { w: number; h: number; pr: number } | null = null;
  /** 画质档（见 params.perf.adaptive） */
  quality = 0;
  private prCap: number = params.perf.maxPixelRatio;
  private bloomScale = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.autoClear = false;
    const rtOpts = { type: THREE.HalfFloatType, samples: params.perf.msaa, depthBuffer: true };
    this.rtBack = new THREE.WebGLRenderTarget(4, 4, rtOpts);
    this.composer = new EffectComposer(this.gl, new THREE.WebGLRenderTarget(4, 4, rtOpts));
    this.composer.addPass(new LayerPass(this));
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 0.7);
    // 辉光的模糊链可以用更低的分辨率（合成时是采样纹理，和屏幕分辨率无关）
    const bloomSetSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w: number, h: number) => bloomSetSize(Math.max(8, Math.round(w * this.bloomScale)), Math.max(8, Math.round(h * this.bloomScale)));
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.final.material.toneMapped = false;
    this.composer.addPass(this.final);
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  resize() {
    const w = this.fixedSize?.w ?? innerWidth;
    const h = this.fixedSize?.h ?? innerHeight;
    // 页面在隐藏的标签 / 面板里打开时视口可能是 0×0：先不排，等有了真尺寸（resize 事件）再排。
    // 否则相机的半高算成 NaN，那段时间开的对话（气泡、字）永远是 NaN、看不见。
    if (!(w > 0 && h > 0)) return;
    this.width = w;
    this.height = h;
    this.pixelRatio = this.fixedSize?.pr ?? Math.min(devicePixelRatio || 1, params.perf.maxPixelRatio, this.prCap);
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.setSize(w, h, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.rtBack.setSize(Math.round(w * this.pixelRatio), Math.round(h * this.pixelRatio));
    this.cam.resize(w, h);
  }

  /** 录 GIF：把画布固定成某个尺寸（例如竖屏 540×960），传 null 恢复跟随窗口。 */
  setFixedSize(size: { w: number; h: number; pr?: number } | null) {
    this.fixedSize = size ? { w: size.w, h: size.h, pr: size.pr ?? 1 } : null;
    this.resize();
  }

  /** 换画质档：像素比上限、多重采样、辉光分辨率。 */
  setQuality(q: number) {
    const P = params.perf;
    const tiers = [
      { pr: P.maxPixelRatio, msaa: P.msaa, bloom: 1 },
      { pr: 1.5, msaa: Math.min(2, P.msaa), bloom: 1 },
      { pr: 1.25, msaa: 0, bloom: 0.5 },
      { pr: 1, msaa: 0, bloom: 0.5 },
    ];
    this.quality = THREE.MathUtils.clamp(Math.round(q), 0, tiers.length - 1);
    const t = tiers[this.quality];
    this.prCap = t.pr;
    this.bloomScale = t.bloom;
    for (const rt of [this.rtBack, this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== t.msaa) {
        rt.samples = t.msaa;
        rt.dispose(); // 下次用到时按新的采样数重建
      }
    }
    this.resize();
  }

  /** 画面缓冲的实际像素尺寸。 */
  get bufferSize() {
    return { w: Math.round(this.width * this.pixelRatio), h: Math.round(this.height * this.pixelRatio) };
  }

  render(dt: number) {
    this.t += dt;
    const P = params.post;
    this.bloom.strength = P.bloomStrength;
    this.bloom.radius = P.bloomRadius;
    this.bloom.threshold = P.bloomThreshold;
    const u = this.final.uniforms;
    u.uExposure.value = P.exposure;
    u.uVignette.value = P.vignette;
    u.uGrain.value = P.grain;
    u.uTime.value = this.t;
    const b = this.bufferSize;
    (u.uRes.value as THREE.Vector2).set(b.w, b.h);
    this.composer.render(dt);
  }

  /** 截图（无头验收管线用）：渲染一帧后读画布。 */
  snapshot(quality = 0.88): string {
    this.render(0);
    return (this.gl.domElement as HTMLCanvasElement).toDataURL("image/jpeg", quality);
  }
}
