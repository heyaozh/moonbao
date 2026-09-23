// MoonRenderer：three.js 版的 CharacterRenderer。
// 只消费协议（情绪目标 / 动作意图 / 在听 / 在说），把它们变成：弹簧驱动的位置与转动、眨眼、光、月相。
// 组成：窗相机（离轴投影）+ 夜空（远星 / 尘埃）+ 球（月相 shader）+ 光晕 + 两颗豆眼。

import * as THREE from "three";
import type { Action } from "../../shared/protocol";
import type { CharacterRenderer } from "../runtime/renderer";
import { ActionRunner } from "./actions";
import { Blinker } from "./blink";
import { WindowCamera } from "./camera";
import { Eyes } from "./eyes";
import { Spring, Spring3, approach, clamp, deg, drift } from "./math";
import { params } from "./params";
import { Sky, SkyBackdrop, skyColorsAt } from "./sky";

const moonVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vWorld;
  varying vec3 vObj;
  void main() {
    vObj = position;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const moonFrag = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uEarthshine;
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform float uSoft;
  uniform float uMottle;
  uniform float uRim;
  uniform vec3 uRimColor;
  uniform float uGlow;
  varying vec3 vN;
  varying vec3 vWorld;
  varying vec3 vObj;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  void main() {
    vec3 N = normalize(vN);
    float d = dot(N, uSunDir);
    float lit = smoothstep(-uSoft, uSoft, d);
    float mot = (vnoise(vObj * 6.0) - 0.5) * uMottle + (vnoise(vObj * 15.0) - 0.5) * uMottle * 0.5;
    vec3 col = mix(uShade * uEarthshine, uLit, lit) * (1.0 + mot);
    vec3 V = normalize(cameraPosition - vWorld);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * uRim * uGlow;
    col += uRimColor * rim;
    col *= mix(0.72, 1.0, clamp(uGlow, 0.0, 1.0)) + max(uGlow - 1.0, 0.0) * 0.3;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function makeHaloTexture() {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, "rgba(255,255,255,0.9)");
  grd.addColorStop(0.3, "rgba(255,255,255,0.5)");
  grd.addColorStop(0.6, "rgba(255,255,255,0.16)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface MoonRendererOptions {
  canvas: HTMLCanvasElement;
  /** 背景 / 暗角 / 玻璃反光的 DOM 元素（渲染层顺手更新它们的样式） */
  stage?: HTMLElement;
  vignette?: HTMLElement;
  glint?: HTMLElement;
}

export class MoonRenderer implements CharacterRenderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam = new WindowCamera();
  readonly sky = new Sky();
  readonly backdrop = new SkyBackdrop();
  readonly eyes = new Eyes();
  readonly actions = new ActionRunner();
  readonly blinker = new Blinker();
  readonly moon: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly body = new THREE.Group();
  readonly halo: THREE.Sprite;

  /** 钟点覆盖（调试用，null = 用真实时间） */
  hourOverride: number | null = null;

  // 情绪
  private target = { valence: 0.2, arousal: 0.5 };
  private cur = { valence: 0.2, arousal: 0.5 };
  private listening = false;
  private speaking = false;
  private glow = params.light.glowDefault;
  private glowTarget = params.light.glowDefault;

  // 运动
  private pos = new Spring3(0, 0, -params.space.moonDepth, params.motion.posOmega, params.motion.posZeta);
  private rot = new Spring3(0, 0, 0, params.motion.rotOmega, params.motion.rotZeta); // yaw, pitch, roll（脸）
  private bodyYaw = new Spring(0, params.motion.rotOmega, params.motion.rotZeta);
  private squash = new Spring(0, params.motion.scaleOmega, params.motion.scaleZeta);
  private swayX = new Spring(0, params.space.moonSwayOmega, params.space.moonSwayZeta);
  private swayY = new Spring(0, params.space.moonSwayOmega, params.space.moonSwayZeta);
  private t = 0;
  private seed = Math.random() * 1000;
  private lastRender = 0;
  private w = 1;
  private h = 1;
  private sunDir = new THREE.Vector3();
  private stats = { frames: 0, since: 0, fps: 0 };
  private stage?: HTMLElement;
  private vignetteEl?: HTMLElement;
  private glintEl?: HTMLElement;
  private lastHourKey = "";

  constructor(opts: MoonRendererOptions) {
    this.stage = opts.stage;
    this.vignetteEl = opts.vignette;
    this.glintEl = opts.glint;
    this.gl = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.gl.setClearColor(0x000000, 0);
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;

    const geo = new THREE.SphereGeometry(1, 96, 64);
    const mat = new THREE.ShaderMaterial({
      vertexShader: moonVert,
      fragmentShader: moonFrag,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 0, 1) },
        uEarthshine: { value: 0.2 },
        uLit: { value: new THREE.Color(params.moon.litColor) },
        uShade: { value: new THREE.Color(params.moon.shadeColor) },
        uSoft: { value: params.moon.terminatorSoftness },
        uMottle: { value: params.moon.mottle },
        uRim: { value: params.moon.rim },
        uRimColor: { value: new THREE.Color(params.moon.rimColor) },
        uGlow: { value: 1 },
      },
    });
    this.moon = new THREE.Mesh(geo, mat);
    this.moon.renderOrder = 1;
    this.body.add(this.moon);
    this.body.add(this.eyes.face);

    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: makeHaloTexture(), color: new THREE.Color(params.light.haloColor), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.halo.renderOrder = 0;

    this.scene.add(this.backdrop.mesh, this.sky.group, this.halo, this.body);
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  /** 录制用的固定尺寸（null = 跟随窗口） */
  private fixedSize: { w: number; h: number; pr: number } | null = null;

  resize() {
    const w = this.fixedSize?.w ?? innerWidth;
    const h = this.fixedSize?.h ?? innerHeight;
    this.w = w;
    this.h = h;
    this.gl.setPixelRatio(this.fixedSize?.pr ?? Math.min(devicePixelRatio || 1, params.perf.maxPixelRatio));
    this.gl.setSize(w, h, false);
    this.cam.resize(w, h);
  }

  /** 录 GIF：把画布固定成某个尺寸（例如竖屏 540×960），传 null 恢复跟随窗口。 */
  setFixedSize(size: { w: number; h: number; pr?: number } | null) {
    this.fixedSize = size ? { w: size.w, h: size.h, pr: size.pr ?? 1 } : null;
    this.resize();
  }

  // ---------- CharacterRenderer ----------
  setEmotion(valence: number, arousal: number) {
    this.target.valence = clamp(valence, -1, 1);
    this.target.arousal = clamp(arousal, 0, 1);
  }
  playAction(name: Action, intensity: number) {
    this.actions.play(name, intensity);
    if (name === "bounce" || name === "spin") this.blinker.blinkNow(false);
    if (name === "shiver" || name === "hide_edge") this.blinker.blinkNow(true);
  }
  setListening(on: boolean) {
    this.listening = on;
  }
  setSpeaking(on: boolean) {
    this.speaking = on;
  }

  get fps() {
    return this.stats.fps;
  }
  get emotion() {
    return { ...this.cur };
  }

  update(dt: number) {
    const P = params;
    this.t += dt;

    // 情绪惯性
    const k = 1 - Math.exp(-dt / P.motion.emotionTau);
    this.cur.valence += (this.target.valence - this.cur.valence) * k;
    this.cur.arousal += (this.target.arousal - this.cur.arousal) * k;
    const arousal = clamp(this.cur.arousal + (this.speaking ? 0.1 : 0), 0, 1);

    // 相机（倾斜 → 眼睛偏移 → 离轴投影）
    this.cam.update(dt);

    // 动作姿态
    const R = P.moon.radius;
    const pose = this.actions.update(dt, {
      halfW: this.cam.halfW,
      radius: R,
      moonDepth: P.space.moonDepth,
      eyeDistance: P.space.eyeDistance,
    });

    // 待机漂浮：Perlin，不是正弦；活力越高幅度越大、越快
    const ag = 1 + arousal * P.motion.driftArousalGain;
    const tt = (this.t / P.motion.driftPeriod) * ag;
    const driftX = drift(tt, this.seed) * P.motion.driftAmpX * ag;
    const driftY = drift(tt + 31.7, this.seed + 1) * P.motion.driftAmpY * ag;
    const driftRoll = drift(tt * 0.7 + 63.1, this.seed + 2) * deg(P.motion.driftRollDeg);

    // 月亮「有重量」：相机横移时它慢半拍地跟一点
    this.swayX.omega = this.swayY.omega = P.space.moonSwayOmega;
    this.swayX.zeta = this.swayY.zeta = P.space.moonSwayZeta;
    this.swayX.target = this.cam.eye.x * P.space.moonSwayGain;
    this.swayY.target = this.cam.eye.y * P.space.moonSwayGain;
    this.swayX.step(dt);
    this.swayY.step(dt);

    // 位置 / 转动弹簧
    this.pos.tune(P.motion.posOmega, P.motion.posZeta);
    this.rot.tune(P.motion.rotOmega, P.motion.rotZeta);
    this.pos.setTarget(driftX + pose.dx + this.swayX.x, driftY + pose.dy + this.swayY.x, -P.space.moonDepth + pose.dz);
    this.rot.setTarget(pose.yaw, pose.pitch, pose.roll + driftRoll);
    this.bodyYaw.target = pose.bodyYaw;
    this.pos.step(dt);
    this.rot.step(dt);
    this.bodyYaw.step(dt);

    // squash & stretch：速度拉伸 + 落地脉冲
    this.squash.omega = P.motion.scaleOmega;
    this.squash.zeta = P.motion.scaleZeta;
    if (pose.squashPulse) this.squash.kick(-P.squash.landPulse * 40);
    this.squash.target = 0;
    this.squash.step(dt);
    const vy = this.pos.vy;
    const stretch = clamp(vy * P.squash.velocityGain + this.squash.x, -P.squash.max, P.squash.max);
    this.body.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.body.scale.set(R * (1 - stretch * 0.5), R * (1 + stretch), R * (1 - stretch * 0.5));
    this.moon.rotation.set(0, this.bodyYaw.x + this.t * 0.01, 0);

    // 光：动作给的 glow 目标，或回到默认；在听时稍亮
    this.glowTarget = pose.glow ?? P.light.glowDefault * (this.listening ? 1.12 : 1);
    this.glow = approach(this.glow, this.glowTarget, P.light.glowTau, dt);

    // 月相：一盏方向光绕着转（世界空间，+z 朝观察者）
    const phase = deg(P.light.phaseDeg);
    const el = deg(P.light.sunElevationDeg);
    this.sunDir.set(Math.sin(phase) * Math.cos(el), Math.sin(el), Math.cos(phase) * Math.cos(el)).normalize();
    const u = this.moon.material.uniforms;
    u.uSunDir.value.copy(this.sunDir);
    // 地照在新月附近最强：随 (1 - cos phase) 插值
    const es = (1 - Math.cos(phase)) / 2;
    u.uEarthshine.value = P.light.earthshineMin + (P.light.earthshineMax - P.light.earthshineMin) * es;
    u.uSoft.value = P.moon.terminatorSoftness;
    u.uMottle.value = P.moon.mottle;
    u.uRim.value = P.moon.rim;
    u.uGlow.value = this.glow;
    (u.uLit.value as THREE.Color).set(P.moon.litColor);
    (u.uShade.value as THREE.Color).set(P.moon.shadeColor);
    (u.uRimColor.value as THREE.Color).set(P.moon.rimColor);

    // 眼睛：眨眼 + 形态 + 暗部程度（眼睛朝向相机，所以用「朝相机方向」和太阳方向的夹角）
    this.blinker.lidCap = pose.lidCap;
    this.blinker.update(dt, this.cur.valence, arousal);
    if (pose.shape) this.blinker.force(pose.shape, 0.05);
    this.eyes.openness = this.blinker.openness;
    this.eyes.setShape(this.blinker.openness < 0.12 ? "closed" : this.blinker.shape);
    this.eyes.setDaze(this.blinker.daze);
    this.eyes.gazeX.target = pose.gazeX;
    this.eyes.gazeY.target = pose.gazeY;
    this.eyes.setSecondEyeOpacity(pose.secondEye);
    const toCam = new THREE.Vector3().copy(this.cam.camera.position).sub(this.body.position).normalize();
    const eyeLit = THREE.MathUtils.smoothstep(toCam.dot(this.sunDir), -0.3, 0.3);
    // 眼睛在 body 里，body 有缩放：把半径按 1（body.scale 已经是 R）传；lookAt 要世界坐标，先把矩阵刷新
    this.body.updateMatrixWorld(true);
    this.eyes.update(dt, 1, 1 - eyeLit, this.cam.camera.position, {
      yaw: this.rot.x,
      pitch: this.rot.y,
      roll: this.rot.z,
    });

    // 光晕：跟着月亮，在它后面一点
    const night = this.updateBackground();
    // 和月心同一深度：球的前半面挡住光晕中心，倾斜时光晕不会和月亮错位
    this.halo.position.copy(this.body.position);
    const hs = P.light.haloScale * R * 2 * (0.9 + 0.1 * this.glow);
    this.halo.scale.set(hs, hs, 1);
    (this.halo.material as THREE.SpriteMaterial).opacity = P.light.haloOpacity * this.glow * (0.35 + 0.65 * night);
    ((this.halo.material as THREE.SpriteMaterial).color as THREE.Color).set(P.light.haloColor);

    // 夜空
    const shortPx = Math.min(this.w, this.h) * this.gl.getPixelRatio();
    this.sky.update(dt, shortPx / 2, P.sky.dayStarVisibility + (1 - P.sky.dayStarVisibility) * night);

    // 渲染（帧率上限）
    const isTouch = matchMedia("(pointer: coarse)").matches;
    const interval = 1000 / (isTouch ? P.perf.fpsMobile : P.perf.fpsDesktop);
    const now = performance.now();
    if (now - this.lastRender >= interval - 1) {
      this.lastRender = now;
      this.renderNow();
      this.stats.frames++;
    }
    this.stats.since += dt;
    if (this.stats.since >= 1) {
      this.stats.fps = this.stats.frames / this.stats.since;
      this.stats.frames = 0;
      this.stats.since = 0;
    }
  }

  renderNow() {
    this.gl.render(this.scene, this.cam.camera);
  }

  /** 占位背景 + 暗角 + 玻璃反光（都是 DOM/CSS，几乎零成本）。返回「夜的程度」。 */
  private updateBackground(): number {
    const hour = this.hourOverride ?? new Date().getHours() + new Date().getMinutes() / 60;
    const c = skyColorsAt(hour);
    const key = `${c.top}${c.mid}${c.bottom}`;
    this.backdrop.set(c.top, c.mid, c.bottom, this.h * this.gl.getPixelRatio());
    if (this.stage && key !== this.lastHourKey) {
      this.lastHourKey = key;
      this.stage.style.background = `linear-gradient(180deg, ${c.top} 0%, ${c.mid} 55%, ${c.bottom} 100%)`;
    }
    if (this.vignetteEl) {
      this.vignetteEl.style.opacity = String(params.sky.vignette);
    }
    if (this.glintEl) {
      // 反光随倾斜滑动：眼睛往右，反光往左（像玻璃上的窗外灯）
      const gx = -this.cam.eye.x * 40;
      const gy = this.cam.eye.y * 40;
      this.glintEl.style.opacity = String(params.sky.glassGlint);
      this.glintEl.style.transform = `translate3d(${gx.toFixed(1)}%, ${gy.toFixed(1)}%, 0)`;
    }
    return c.night;
  }

  /** 截图：渲染一帧然后取 dataURL（无头验收管线用）。 */
  snapshot(quality = 0.85): string {
    this.renderNow();
    return this.gl.domElement.toDataURL("image/jpeg", quality);
  }
}
