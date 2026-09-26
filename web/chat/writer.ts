// 月亮的话 = 许多很小的光点（小流星）从远处不同方向飞来，汇聚成手写字（2026-09-26 用户）。
// 一条消息 = 一组行（发光字贴图，按「笔锋」从左往右揭开）+ 一群光点（实例化的小流星，GPU 算轨迹）。
// 两档：日常 = 就近凝结，快；重要时刻（grand）= 远方流星，慢而隆重。

import * as THREE from "three";
import { params } from "../moon/params";
import { ensureFonts, layoutLines, mulberry, renderLine, sampleInk, type LineLayout, type RenderedLine, type TextStyle } from "./glyphs";

// ───────────── 光点（实例化的小流星） ─────────────
const pVert = /* glsl */ `
  attribute vec2 aCorner;       // x: 0 头 … 1 尾；y: -1 / +1 两侧
  attribute vec3 iStart;
  attribute vec3 iCtrl;
  attribute vec3 iTarget;
  attribute vec4 iTime;         // t0, dur, size, seed
  uniform float uTime, uTrail, uPx, uOpacity, uSettle;
  uniform vec2 uRes;
  varying float vAlong;
  varying float vSide;
  varying float vBright;
  vec3 bez(float t) { float s = 1.0 - t; return s * s * iStart + 2.0 * s * t * iCtrl + t * t * iTarget; }
  float ease(float u) { float s = 1.0 - u; return 1.0 - s * s * s; }
  void main() {
    float t0 = iTime.x, dur = iTime.y, size = iTime.z, seed = iTime.w;
    float u = (uTime - t0) / dur;
    if (u < 0.0 || uOpacity < 0.002 || seed < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float uc = clamp(u, 0.0, 1.0);
    float hero = step(0.955, seed);
    float uh = clamp(u - uTrail * (1.0 + hero * 5.0) / dur, 0.0, 1.0);
    vec3 p = bez(ease(uc));
    vec3 q = bez(ease(uh));
    vec4 hp = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vec4 tp = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
    vec2 hs = hp.xy / hp.w * uRes;
    vec2 ts = tp.xy / tp.w * uRes;
    vec2 d = hs - ts;
    float len = length(d);
    vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float w = size * uPx * (1.0 + hero * 0.6);
    vec2 s = mix(hs + dir * w, ts - dir * w * 0.5, aCorner.x) + nrm * aCorner.y * w;
    gl_Position = vec4(s / uRes * hp.w, hp.z, hp.w);
    vAlong = aCorner.x;
    vSide = aCorner.y;
    // 飞行中亮；落定后慢慢变成一粒轻轻闪的星尘
    float landed = clamp((uTime - t0 - dur) / uSettle, 0.0, 1.0);
    float twinkle = 0.75 + 0.25 * sin(uTime * (3.0 + seed * 5.0) + seed * 50.0);
    vBright = mix(0.6 + hero * 1.8, 0.3 * twinkle, landed) * uOpacity;
  }
`;
const pFrag = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlong;
  varying float vSide;
  varying float vBright;
  void main() {
    float across = exp(-vSide * vSide * 3.0);
    float along = pow(clamp(1.0 - vAlong, 0.0, 1.0), 1.6);
    gl_FragColor = vec4(uColor * across * along * vBright, 1.0);
  }
`;

export class StarParticles {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private start: Float32Array;
  private ctrl: Float32Array;
  private target: Float32Array;
  private time: Float32Array;
  count = 0;
  /** 每个光点属于哪一行、哪个字（撤残影用） */
  private owner: Int32Array;
  constructor(readonly capacity: number) {
    this.owner = new Int32Array(capacity * 2).fill(-1);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setAttribute("aCorner", new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    this.start = new Float32Array(capacity * 3);
    this.ctrl = new Float32Array(capacity * 3);
    this.target = new Float32Array(capacity * 3);
    this.time = new Float32Array(capacity * 4);
    g.setAttribute("iStart", new THREE.InstancedBufferAttribute(this.start, 3));
    g.setAttribute("iCtrl", new THREE.InstancedBufferAttribute(this.ctrl, 3));
    g.setAttribute("iTarget", new THREE.InstancedBufferAttribute(this.target, 3));
    g.setAttribute("iTime", new THREE.InstancedBufferAttribute(this.time, 4));
    g.instanceCount = 0;
    this.mesh = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uTrail: { value: 0.09 },
          uPx: { value: 1 },
          uRes: { value: new THREE.Vector2(1, 1) },
          uOpacity: { value: 1 },
          uSettle: { value: 1.4 },
          uColor: { value: new THREE.Color(params.writer.particleColor) },
        },
        vertexShader: pVert,
        fragmentShader: pFrag,
        // 屏幕空间拼的四边形，朝向随飞行方向变：两面都画（否则一半以上会被当背面剔掉）
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 60;
  }

  add(s: THREE.Vector3, c: THREE.Vector3, t: THREE.Vector3, t0: number, dur: number, size: number, hero = false, line = -1, ci = -1) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.owner[i * 2] = line;
    this.owner[i * 2 + 1] = ci;
    this.start.set([s.x, s.y, s.z], i * 3);
    this.ctrl.set([c.x, c.y, c.z], i * 3);
    this.target.set([t.x, t.y, t.z], i * 3);
    // seed ≥ 0.955 的是「主角流星」（着色器里拖长尾、更亮）
    this.time.set([t0, dur, size, hero ? 0.96 + Math.random() * 0.04 : Math.random() * 0.95], i * 4);
    const g = this.mesh.geometry;
    for (const n of ["iStart", "iCtrl", "iTarget", "iTime"]) {
      const a = g.getAttribute(n) as THREE.InstancedBufferAttribute;
      a.needsUpdate = true;
      a.addUpdateRange(i * a.itemSize, a.itemSize);
    }
    g.instanceCount = this.count;
  }

  /** 撤掉某一行从第 fromCi 个字起的光点（那一行重排了，字挪了位置） */
  kill(line: number, fromCi: number) {
    const a = this.mesh.geometry.getAttribute("iTime") as THREE.InstancedBufferAttribute;
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.owner[i * 2] === line && this.owner[i * 2 + 1] >= fromCi) {
        this.time[i * 4 + 3] = -1;
        this.owner[i * 2] = -1;
        any = true;
      }
    }
    if (any) {
      a.clearUpdateRanges();
      a.needsUpdate = true;
    }
  }

  update(time: number, bufferW: number, bufferH: number, pixelRatio: number, opacity: number) {
    const u = this.mesh.material.uniforms;
    u.uTime.value = time;
    (u.uRes.value as THREE.Vector2).set(bufferW / 2, bufferH / 2);
    u.uPx.value = pixelRatio;
    u.uOpacity.value = opacity;
    u.uTrail.value = params.writer.trail;
    (u.uColor.value as THREE.Color).set(params.writer.particleColor);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// ───────────── 发光字的行 ─────────────
const lineVert = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const lineFrag = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uFront, uW, uSoft, uOpacity, uCool;
  uniform vec3 uCore, uGlow, uCoolCol;
  varying vec2 vUv;
  float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  void main() {
    vec4 t = texture2D(uTex, vUv);
    float x = vUv.x * uW;
    float rev = 1.0 - sstep(uFront - uSoft, uFront, x);
    float core = sstep(0.62, 0.97, t.a);
    vec3 glow = mix(uGlow, uCoolCol, uCool);
    vec3 coreC = mix(uCore, uCoolCol * 1.2, uCool * 0.8);
    vec3 col = mix(glow * t.a * 0.55, coreC * 1.35, core);
    // 笔锋：正在写的地方更亮一点
    float pq = (x - uFront) / (uSoft * 0.6);
    float pen = exp(-pq * pq) * t.a * 1.6;
    col += uCore * pen * (1.0 - uCool);
    gl_FragColor = vec4(col * rev * uOpacity, 1.0);
  }
`;

interface LineObj {
  layout: LineLayout;
  rendered: RenderedLine;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** 每个字开始揭开 / 揭完的时间 */
  revealAt: number[];
  revealDur: number[];
  /** 已经放出光点的字数 */
  spawned: number;
  /** 行在消息组里的左上角（世界单位） */
  x0: number;
  yTop: number;
  key: string;
}

export interface WriterContext {
  /** 画布像素 → 世界单位 */
  unitsPerPx: number;
  /** 月心（世界），有些光点从月亮那儿飞来 */
  moonCenter: THREE.Vector3;
  /** 召集来的星星（思考时就在往写字区飘），优先用它们当起点 */
  takeGathered?: () => THREE.Vector3 | null;
}

/** 一条月亮的消息。 */
export class MoonText {
  readonly group = new THREE.Group();
  readonly backing: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly particles = new StarParticles(9000);
  private lines: LineObj[] = [];
  private text = "";
  private done = false;
  private seed = Math.floor(Math.random() * 1e9);
  private style: TextStyle;
  private busy = Promise.resolve();
  opacity = 1;
  cool = 0;
  grand = false;
  /** 排版后的尺寸（世界单位） */
  width = 0;
  height = 0;
  /** 最后一个字揭完的时间 */
  finishAt = 0;
  /** 每个字开始揭开时（写字的音） */
  onGlyph?: () => void;
  private revealedCount = 0;

  private bigK = 1;
  get isBig() {
    return this.bigK > 1;
  }
  /** 预知的全文（演示剧本知道） */
  hintText: string | null = null;
  /** 放大过的短句：按预知全文量出的总宽（居中用，写的过程中不跟着字数挪） */
  get estWidth() {
    if (this.hintText) {
      const L = layoutLines(this.hintText, this.style, this.seed);
      return Math.max(...L.map((l) => l.width)) * this.ctx.unitsPerPx;
    }
    return (this.hintLength ?? 0) * this.style.en * 0.5 * this.ctx.unitsPerPx;
  }
  /** 预知的全文长度（演示剧本知道；真大脑流式时是 null） */
  hintLength: number | null = null;
  private baseStyle: TextStyle;

  constructor(private ctx: WriterContext, style: TextStyle) {
    this.style = style;
    this.baseStyle = style;
    this.group.add(this.particles.mesh);
    // 字后面一层很淡的暗底，保证压在亮银河上也读得清
    this.backing = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: backingTexture(), transparent: true, opacity: 0, depthWrite: false, depthTest: false, color: 0x000000 })
    );
    this.backing.renderOrder = 40;
    this.group.add(this.backing);
  }

  get lineCount() {
    return this.lines.length;
  }
  get fullText() {
    return this.text;
  }

  private running = false;
  private dirty = false;
  private clock = 0;

  /** 流式追加：full = 目前为止的全文。now = 时钟（秒）。正在排版时来的新字合并成一次。 */
  setText(full: string, done: boolean, now: number) {
    this.text = full;
    this.done = done;
    this.clock = now;
    if (this.running) {
      this.dirty = true;
      return this.busy;
    }
    this.running = true;
    this.busy = (async () => {
      do {
        this.dirty = false;
        await this.relayout(this.clock);
      } while (this.dirty);
      this.running = false;
    })();
    return this.busy;
  }

  private async relayout(now: number) {
    // 短句的隆重档写得大（概念图里的 "moonbao" 横跨大半个屏幕）。要事先知道全长（hintLength），流式里猜不准就不放大
    if (this.grand && this.hintLength != null) {
      const n = this.hintLength;
      const k = n <= 10 ? 3.0 : n <= 20 ? 1.6 : 1;
      if (k !== this.bigK && this.lines.length === 0) {
        this.bigK = k;
        this.style = { ...this.style, en: this.baseStyle.en * k, zh: this.baseStyle.zh * k };
      }
    }
    // 逐字排版（不等整词）：偶尔一个词在行尾放不下会跳到下一行，那几个字的光点会重新飞一次，可以接受
    const shown = this.text;
    if (!shown) return;
    await ensureFonts(shown, this.style);
    const layouts = layoutLines(shown, this.style, this.seed);
    if (this.bigK > 1) for (const L of layouts) L.indent = 0;
    const upp = this.ctx.unitsPerPx;
    const lh = Math.max(this.style.en, this.style.zh) * this.style.lineHeight * upp;
    let yTop = 0;
    layouts.forEach((L, i) => {
      const key = L.text;
      let lo = this.lines[i];
      if (!lo || lo.key !== key) {
        const rendered = renderLine(L, this.style, this.seed + i * 101, params.writer.glowPx);
        const tex = new THREE.CanvasTexture(rendered.canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        const w = rendered.canvas.width * upp;
        const h = rendered.canvas.height * upp;
        const x0 = L.indent * upp - rendered.padX * upp;
        const mesh =
          lo?.mesh ??
          new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.ShaderMaterial({
              uniforms: {
                uTex: { value: tex },
                uFront: { value: 0 },
                uW: { value: 1 },
                uSoft: { value: 12 },
                uOpacity: { value: 1 },
                uCool: { value: 0 },
                uCore: { value: new THREE.Color(params.writer.coreColor) },
                uGlow: { value: new THREE.Color(params.writer.glowColor) },
                uCoolCol: { value: new THREE.Color(params.writer.coolColor) },
              },
              vertexShader: lineVert,
              fragmentShader: lineFrag,
              blending: THREE.AdditiveBlending,
              transparent: true,
              depthWrite: false,
              depthTest: false,
            })
          );
        if (lo) {
          (lo.mesh.material.uniforms.uTex.value as THREE.Texture).dispose();
          // 从第一个不一样的字起，旧的光点撤掉（它们会在新位置上重新飞来）
          let same = 0;
          const oldChars = lo.layout.chars;
          while (same < oldChars.length && same < L.chars.length && oldChars[same].ch === L.chars[same].ch && Math.abs(oldChars[same].x0 - L.chars[same].x0) < 0.5) same++;
          this.particles.kill(i, same);
          lo.spawned = Math.min(lo.spawned, same);
          lo.revealAt.length = Math.min(lo.revealAt.length, same);
          lo.revealDur.length = Math.min(lo.revealDur.length, same);
        }
        mesh.material.uniforms.uTex.value = tex;
        mesh.material.uniforms.uW.value = rendered.canvas.width;
        mesh.material.uniforms.uSoft.value = Math.max(this.style.en, this.style.zh) * 0.45;
        mesh.scale.set(w, h, 1);
        mesh.position.set(x0 + w / 2, yTop - h / 2 + rendered.padY * upp - L.dy * upp, 0);
        mesh.rotation.z = L.tilt;
        mesh.renderOrder = 50;
        if (!lo) this.group.add(mesh);
        const prev = lo;
        lo = {
          layout: L,
          rendered,
          mesh,
          revealAt: prev?.revealAt.slice(0, L.chars.length) ?? [],
          revealDur: prev?.revealDur.slice(0, L.chars.length) ?? [],
          spawned: prev ? Math.min(prev.spawned, L.chars.length) : 0,
          x0,
          yTop: yTop - L.dy * upp,
          key,
        };
        this.lines[i] = lo;
      }
      yTop -= lh;
    });
    // 行数变少了（后面的词挪回了上一行）：多出来的旧行和它的光点撤掉
    while (this.lines.length > layouts.length) {
      const i = this.lines.length - 1;
      const lo = this.lines.pop()!;
      this.particles.kill(i, 0);
      (lo.mesh.material.uniforms.uTex.value as THREE.Texture).dispose();
      lo.mesh.material.dispose();
      lo.mesh.geometry.dispose();
      lo.mesh.removeFromParent();
    }
    this.width = Math.max(...this.lines.map((l) => l.x0 + l.rendered.canvas.width * upp), 0);
    this.height = -yTop;
    // 新出现的字：放光点、排揭开时间
    let charClock = now;
    for (const lo of this.lines) {
      if (lo.spawned >= lo.layout.chars.length) continue;
      const pts = sampleInk(lo.rendered, lo.layout, params.writer.perChar);
      for (let ci = lo.spawned; ci < lo.layout.chars.length; ci++) {
        const ch = lo.layout.chars[ci].ch;
        const W = params.writer;
        const dur = this.grand ? W.grandDur : W.dailyDur;
        if (/\s/.test(ch)) {
          lo.revealAt[ci] = charClock;
          lo.revealDur[ci] = 0.05;
          continue;
        }
        const mine = pts.filter((p) => p.ci === ci);
        for (const p of mine) {
          const tgt = new THREE.Vector3(lo.x0 + p.x * upp, lo.yTop - (p.y - lo.rendered.padY) * upp - lo.rendered.padY * upp + (lo.rendered.padY * upp), 0);
          // 行本身有小倾斜：把点绕行中心转一下，和贴图对齐
          const mc = lo.mesh.position;
          tgt.sub(mc).applyAxisAngle(ZAXIS, lo.layout.tilt).add(mc);
          const t0 = charClock + p.order * W.charSpread + Math.random() * 0.08;
          const hero = Math.random() < W.heroShare;
          const d = dur * (0.75 + Math.random() * 0.5) * (hero ? 1.25 : 1);
          const start = hero ? this.pickStart(tgt) : this.dustStart(tgt);
          const ctrl = start.clone().lerp(tgt, 0.5).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.3) * 1.0, (Math.random() - 0.5) * 0.6).multiplyScalar(start.distanceTo(tgt) * 0.35));
          this.particles.add(start, ctrl, tgt, t0, d, W.particleSize * (0.7 + Math.random() * 0.6), hero, this.lines.indexOf(lo), ci);
        }
        lo.revealAt[ci] = charClock + dur * 0.62;
        lo.revealDur[ci] = this.grand ? 0.42 : 0.26;
        charClock += this.grand ? W.grandCharGap : W.dailyCharGap;
      }
      lo.spawned = lo.layout.chars.length;
    }
    this.finishAt = Math.max(this.finishAt, charClock + (this.grand ? params.writer.grandDur : params.writer.dailyDur) + 0.3);
  }

  /** 星尘：从字附近、稍深处凝结过来（短而细，不抢戏） */
  private dustStart(tgtLocal: THREE.Vector3): THREE.Vector3 {
    const g = Math.random() < 0.25 ? this.ctx.takeGathered?.() : null;
    if (g) return this.group.worldToLocal(g.clone());
    const a = Math.random() * Math.PI * 2;
    const dist = (this.grand ? 0.5 : 0.35) + Math.random() * (this.grand ? 1.1 : 0.8);
    return tgtLocal.clone().add(new THREE.Vector3(Math.cos(a) * dist, Math.sin(a) * dist * 0.7, -(0.3 + Math.random() * 1.4)));
  }

  /** 光点从哪飞来：召集来的星星 > 月亮身边 > 远处四面八方（重要时刻）/ 附近（日常） */
  private pickStart(tgtLocal: THREE.Vector3): THREE.Vector3 {
    const r = Math.random();
    const g = r < 0.3 ? this.ctx.takeGathered?.() : null;
    if (g) return this.group.worldToLocal(g.clone());
    if (r > 0.9) {
      // 一小部分从月亮边上出发（它在指挥星星）
      const a = Math.random() * Math.PI * 2;
      const m = this.ctx.moonCenter.clone().add(new THREE.Vector3(Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0.1));
      return this.group.worldToLocal(m);
    }
    if (this.grand) {
      // 远方：主要从月亮那一侧的天空、从深处飞来（一个 110° 的扇面），不是四面八方同时炸过来
      const moonL = this.group.worldToLocal(this.ctx.moonCenter.clone());
      const base = Math.atan2(moonL.y - tgtLocal.y, moonL.x - tgtLocal.x);
      const a = base + (Math.random() - 0.5) * 1.9;
      const dist = 2.5 + Math.random() * 4;
      return tgtLocal.clone().add(new THREE.Vector3(Math.cos(a) * dist, Math.sin(a) * dist, -(1.5 + Math.random() * 6)));
    }
    const a = Math.random() * Math.PI * 2;
    const dist = 0.7 + Math.random() * 1.4;
    return tgtLocal.clone().add(new THREE.Vector3(Math.cos(a) * dist, Math.sin(a) * dist * 0.8, -(0.8 + Math.random() * 2.5)));
  }

  /** 每帧：笔锋位置、透明度、光点。 */
  update(now: number, bufferW: number, bufferH: number, pixelRatio: number) {
    // 数一数已经开始揭开的字（不含空白），多出来的每个字响一个音
    let started = 0;
    for (const lo of this.lines) for (let i = 0; i < lo.layout.chars.length; i++) if (lo.revealAt[i] != null && now >= lo.revealAt[i] && !/\s/.test(lo.layout.chars[i].ch)) started++;
    if (started > this.revealedCount) {
      for (let k = this.revealedCount; k < started; k++) this.onGlyph?.();
      this.revealedCount = started;
    }
    for (const lo of this.lines) {
      // 笔锋 = 最后一个开始揭开的字，揭到哪了
      let front = 0;
      const chars = lo.layout.chars;
      for (let i = 0; i < chars.length; i++) {
        const at = lo.revealAt[i];
        if (at == null || now < at) break;
        const u = Math.min(1, (now - at) / Math.max(0.01, lo.revealDur[i]));
        front = lo.rendered.padX + chars[i].x0 + (chars[i].x1 - chars[i].x0) * u + (u >= 1 ? lo.rendered.padX * 0.5 : 0);
        if (u < 1) break;
        if (i === chars.length - 1) front = lo.rendered.canvas.width + 50;
      }
      const u = lo.mesh.material.uniforms;
      u.uFront.value = front;
      u.uOpacity.value = this.opacity;
      u.uCool.value = this.cool;
    }
    this.particles.update(now, bufferW, bufferH, pixelRatio, this.opacity * (1 - this.cool * 0.6));
    // 暗底
    const pad = 0.14;
    this.backing.scale.set(this.width + pad * 2, this.height + pad * 2, 1);
    this.backing.position.set(this.width / 2, -this.height / 2 + 0.02, -0.001);
    this.backing.material.opacity = params.writer.backing * this.opacity * (this.lines.length ? 1 : 0);
  }

  dispose() {
    for (const lo of this.lines) {
      (lo.mesh.material.uniforms.uTex.value as THREE.Texture).dispose();
      lo.mesh.material.dispose();
      lo.mesh.geometry.dispose();
    }
    this.particles.dispose();
    this.backing.material.map?.dispose();
    this.backing.material.dispose();
  }
}

const ZAXIS = new THREE.Vector3(0, 0, 1);

let _backingTex: THREE.Texture | null = null;
function backingTexture() {
  if (_backingTex) return _backingTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.6, "rgba(255,255,255,0.7)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  _backingTex = new THREE.CanvasTexture(c);
  return _backingTex;
}

export { mulberry };
